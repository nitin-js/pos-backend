import crypto from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { z } from "zod";
import {
  audit,
  checkPassword,
  clearRefreshCookie,
  consumeReset,
  hashPassword,
  issueReset,
  openSession,
  readRefresh,
  recordLogin,
  requireAudience,
  requireAuth,
  requireModule,
  requirePermission,
  rotateSession,
  revokeSession,
  setRefreshCookie,
  signAccess,
} from "./auth";
import { config } from "./config";
import { col } from "./db";
import {
  adjustStock,
  asId,
  assertModulesValid,
  captureCashPayment,
  createPosOrder,
  createProduct,
  createRecipe,
  createTenant,
  id,
  idText,
  keysForModules,
  listRows,
  moneyOut,
  postMovement,
  presentBalance,
  presentOrder,
  presentProduct,
  publicTenant,
  replaceModules,
  salesSummary,
  tenantOrThrow,
} from "./domain";
import { asyncRoute, errorHandler, HttpError, ok } from "./http";
import { openApi } from "./openapi";
import { decimalToScaled, long, num, recipeConsumption } from "./money";
import { fromBaseQuantity, toBaseQuantity } from "./units";

export const app = express();

app.use((request, response, next) => {
  const requestId = request.get("x-request-id") || crypto.randomUUID();
  response.locals.requestId = requestId;
  response.setHeader("x-request-id", requestId);
  next();
});
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://validator.swagger.io"],
    },
  },
}));
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const loginLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true });
const auth = [requireAuth];
const platform = [...auth, requireAudience("platform")];
const tenant = [...auth, requireAudience("tenant")];

function paging(request: Request) {
  const limit = Math.min(200, Math.max(1, Number(request.query.limit ?? 50) || 50));
  const cursor = typeof request.query.cursor === "string" ? request.query.cursor : undefined;
  return { limit, cursor };
}

function idempotency(request: Request): string {
  const key = request.get("idempotency-key");
  if (!key) throw new HttpError(400, "validation_failed", "Idempotency-Key is required.");
  return key;
}

async function tokenResponse(response: Response, aud: "platform" | "tenant", userId: string, tenantId: string | undefined, roleId: string, tv: number, branchIds: string[], sessionId: string) {
  const accessToken = signAccess({ userId, aud, sessionId, tv, tenantId, roleId, branchIds });
  return accessToken;
}

app.get("/api/v1/health", (_request, response) => {
  ok(response, { status: "up" });
});

app.get("/api/v1/health/ready", asyncRoute(async (_request, response) => {
  const latest = await col("schema_migrations").find().sort({ appliedAt: -1 }).limit(1).next();
  const ping = await col("tenants").estimatedDocumentCount();
  if (!latest || latest.fileName !== config.expectedMigration) {
    throw new HttpError(503, "not_ready", "Database migrations are behind this build.");
  }
  ok(response, { status: "ready", migration: latest.fileName, tenants: ping });
}));

app.post("/api/v1/platform/auth/login", loginLimit, asyncRoute(async (request, response) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(request.body);
  const user = await col("platform_users").findOne({ email: body.email.toLowerCase() });
  if (!user || !(await checkPassword(String(user.passwordHash), body.password)) || user.status !== "active") {
    if (user) await recordLogin({ audience: "platform", userId: String(user._id), success: false, request });
    throw new HttpError(401, "invalid_login", "Email or password is incorrect.");
  }
  const session = await openSession({ aud: "platform", userId: String(user._id), userAgent: request.get("user-agent"), ip: request.ip });
  setRefreshCookie(response, session.refreshToken);
  await recordLogin({ audience: "platform", userId: String(user._id), success: true, request });
  const accessToken = await tokenResponse(response, "platform", String(user._id), undefined, String(user.roleId), num(user.tv), [], session.sessionId);
  ok(response, { accessToken, user: { id: user._id, email: user.email, name: user.name } });
}));

app.post("/api/v1/platform/auth/refresh", asyncRoute(async (request, response) => {
  const next = await rotateSession("platform", readRefresh(request), request);
  setRefreshCookie(response, next.refreshToken);
  const owner = await col("platform_sessions").findOne({ _id: asId(next.sessionId) });
  const account = await col("platform_users").findOne({ _id: asId(owner?.userId) });
  if (!account) throw new HttpError(401, "invalid_refresh", "Sign in again.");
  const accessToken = signAccess({
    userId: String(account._id),
    aud: "platform",
    sessionId: next.sessionId,
    tv: num(account.tv),
    roleId: String(account.roleId),
    branchIds: [],
  });
  ok(response, { accessToken });
}));

app.post("/api/v1/platform/auth/logout", asyncRoute(async (request, response) => {
  const token = request.cookies?.refresh_token;
  if (typeof token === "string") await revokeSession("platform", token);
  clearRefreshCookie(response);
  ok(response, { loggedOut: true });
}));

app.post("/api/v1/platform/auth/forgot-password", asyncRoute(async (request, response) => {
  const body = z.object({ email: z.string().email() }).parse(request.body);
  const user = await col("platform_users").findOne({ email: body.email.toLowerCase() });
  if (user) await issueReset("platform_users", String(user._id));
  response.status(202).json({ data: { accepted: true }, meta: { requestId: response.locals.requestId, nextCursor: null } });
}));

app.post("/api/v1/platform/auth/reset-password", asyncRoute(async (request, response) => {
  const body = z.object({ token: z.string().min(10), password: z.string().min(8) }).parse(request.body);
  await consumeReset("platform_users", body.token, body.password);
  ok(response, { reset: true });
}));

async function tenantLogin(request: Request, response: Response) {
  const body = z.object({
    email: z.string().email(),
    password: z.string().min(1),
    tenantSlug: z.string().min(1),
  }).parse(request.body);
  const tenant = await col("tenants").findOne({ slug: body.tenantSlug });
  const user = tenant ? await col("users").findOne({ tenantId: idText(tenant._id), email: body.email.toLowerCase() }) : null;
  const passwordOk = user ? await checkPassword(String(user.passwordHash), body.password) : false;
  if (!tenant || !user || !passwordOk || user.status !== "active" || tenant.status === "suspended" || tenant.status === "deleted") {
    if (user) await recordLogin({ audience: "tenant", userId: String(user._id), tenantId: String(tenant?._id), success: false, request });
    throw new HttpError(401, "invalid_login", "Email, password, or business is incorrect.");
  }
  if (tenant.status === "inactive") {
    const role = await col("roles").findOne({ _id: asId(user.roleId) });
    if (role?.name !== "Business Owner") throw new HttpError(401, "tenant_blocked", "This business is inactive.");
  }
  const branches = await col("branches").find({ tenantId: idText(tenant._id) }).toArray();
  const branchIds = (await col("roles").findOne({ _id: asId(user.roleId) }))?.permissionKeys?.includes("settings.business.read")
    ? branches.map((branch) => String(branch._id))
    : (user.branchIds as string[] | undefined) ?? [];
  const session = await openSession({
    aud: "tenant",
    userId: String(user._id),
    tenantId: String(tenant._id),
    userAgent: request.get("user-agent"),
    ip: request.ip,
  });
  setRefreshCookie(response, session.refreshToken);
  await recordLogin({ audience: "tenant", userId: String(user._id), tenantId: String(tenant._id), success: true, request });
  const accessToken = signAccess({
    userId: String(user._id),
    aud: "tenant",
    sessionId: session.sessionId,
    tv: num(user.tv),
    tenantId: String(tenant._id),
    roleId: String(user.roleId),
    branchIds,
  });
  ok(response, { accessToken, user: { id: user._id, email: user.email, name: user.name, tenantSlug: tenant.slug } });
}

app.post("/api/v1/admin/auth/login", loginLimit, asyncRoute(tenantLogin));
app.post("/api/v1/pos/auth/login", loginLimit, asyncRoute(tenantLogin));

async function tenantRefresh(request: Request, response: Response) {
  const next = await rotateSession("tenant", readRefresh(request), request);
  setRefreshCookie(response, next.refreshToken);
  const session = await col("user_sessions").findOne({ _id: asId(next.sessionId) });
  const user = await col("users").findOne({ _id: asId(session?.userId) });
  if (!user) throw new HttpError(401, "invalid_refresh", "Sign in again.");
  const branches = await col("branches").find({ tenantId: user.tenantId }).toArray();
  const accessToken = signAccess({
    userId: String(user._id),
    aud: "tenant",
    sessionId: next.sessionId,
    tv: num(user.tv),
    tenantId: String(user.tenantId),
    roleId: String(user.roleId),
    branchIds: branches.map((branch) => String(branch._id)),
  });
  ok(response, { accessToken });
}

app.post("/api/v1/admin/auth/refresh", asyncRoute(tenantRefresh));
app.post("/api/v1/pos/auth/refresh", asyncRoute(tenantRefresh));

app.post("/api/v1/admin/auth/logout", asyncRoute(async (request, response) => {
  if (typeof request.cookies?.refresh_token === "string") await revokeSession("tenant", request.cookies.refresh_token);
  clearRefreshCookie(response);
  ok(response, { loggedOut: true });
}));
app.post("/api/v1/pos/auth/logout", asyncRoute(async (request, response) => {
  if (typeof request.cookies?.refresh_token === "string") await revokeSession("tenant", request.cookies.refresh_token);
  clearRefreshCookie(response);
  ok(response, { loggedOut: true });
}));

app.post("/api/v1/admin/auth/forgot-password", asyncRoute(async (request, response) => {
  const body = z.object({ email: z.string().email(), tenantSlug: z.string() }).parse(request.body);
  const tenant = await col("tenants").findOne({ slug: body.tenantSlug });
  const user = tenant ? await col("users").findOne({ tenantId: idText(tenant._id), email: body.email.toLowerCase() }) : null;
  if (user) await issueReset("users", String(user._id));
  response.status(202).json({ data: { accepted: true }, meta: { requestId: response.locals.requestId, nextCursor: null } });
}));

app.post("/api/v1/admin/auth/reset-password", asyncRoute(async (request, response) => {
  const body = z.object({ token: z.string().min(10), password: z.string().min(8) }).parse(request.body);
  await consumeReset("users", body.token, body.password);
  ok(response, { reset: true });
}));

app.get("/api/v1/platform/tenants", ...platform, requirePermission("platform.tenant.read"), asyncRoute(async (request, response) => {
  const filter: Record<string, unknown> = {};
  if (typeof request.query.status === "string") filter.status = request.query.status;
  const { limit, cursor } = paging(request);
  const { page, nextCursor } = await listRows("tenants", filter, limit, cursor);
  ok(response, await Promise.all(page.map((tenant) => publicTenant(tenant))), nextCursor);
}));

app.post("/api/v1/platform/tenants", ...platform, requirePermission("platform.tenant.write"), asyncRoute(async (request, response) => {
  const body = z.object({
    name: z.string().min(1),
    legalName: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    ownerEmail: z.string().email(),
    ownerName: z.string().min(1),
    ownerPassword: z.string().min(8),
    timezone: z.string().default("Asia/Kolkata"),
    currency: z.string().default("INR"),
    taxMode: z.enum(["inclusive", "exclusive"]).default("exclusive"),
    stockPolicy: z.enum(["on_payment", "on_prepared"]).default("on_payment"),
    modules: z.array(z.string()).default([]),
    phone: z.string().optional(),
    gstin: z.string().optional(),
  }).parse(request.body);
  const created = await createTenant({ ...body, ownerPasswordHash: await hashPassword(body.ownerPassword), actorId: request.auth!.userId });
  await audit({
    actorId: request.auth!.userId,
    actorAudience: "platform",
    action: "tenant.create",
    entityType: "tenant",
    entityId: created.tenantId,
    tenantId: created.tenantId,
    requestId: response.locals.requestId,
  });
  const tenant = await col("tenants").findOne({ _id: asId(created.tenantId) });
  ok(response, await publicTenant(tenant!), null, 201);
}));

app.get("/api/v1/platform/tenants/:tenantId", ...platform, requirePermission("platform.tenant.read"), asyncRoute(async (request, response) => {
  const tenant = await col("tenants").findOne({ _id: asId(request.params.tenantId) });
  if (!tenant) throw new HttpError(404, "not_found", "Business not found.");
  const modules = await col("tenant_modules").find({ tenantId: idText(tenant._id) }).toArray();
  ok(response, { ...(await publicTenant(tenant)), modules });
}));

app.patch("/api/v1/platform/tenants/:tenantId", ...platform, requirePermission("platform.tenant.write"), asyncRoute(async (request, response) => {
  const body = z.object({
    name: z.string().optional(),
    legalName: z.string().optional(),
    phone: z.string().optional(),
    gstin: z.string().optional(),
    timezone: z.string().optional(),
    taxMode: z.enum(["inclusive", "exclusive"]).optional(),
    stockPolicy: z.enum(["on_payment", "on_prepared"]).optional(),
  }).parse(request.body);
  await col("tenants").updateOne({ _id: asId(request.params.tenantId) }, { $set: { ...body, updatedAt: new Date() } });
  const tenant = await col("tenants").findOne({ _id: asId(request.params.tenantId) });
  if (!tenant) throw new HttpError(404, "not_found", "Business not found.");
  ok(response, await publicTenant(tenant));
}));

app.post("/api/v1/platform/tenants/:tenantId/status", ...platform, requirePermission("platform.tenant.status"), asyncRoute(async (request, response) => {
  const body = z.object({ status: z.enum(["active", "inactive", "suspended"]) }).parse(request.body);
  const before = await col("tenants").findOne({ _id: asId(request.params.tenantId) });
  if (!before) throw new HttpError(404, "not_found", "Business not found.");
  await col("tenants").updateOne({ _id: before._id }, { $set: { status: body.status, updatedAt: new Date() } });
  await audit({
    actorId: request.auth!.userId,
    actorAudience: "platform",
    action: "tenant.status",
    entityType: "tenant",
    entityId: String(before._id),
    tenantId: String(before._id),
    before: { status: before.status },
    after: body,
  });
  ok(response, { id: before._id, status: body.status });
}));

app.delete("/api/v1/platform/tenants/:tenantId", ...platform, requirePermission("platform.tenant.status"), asyncRoute(async (request, response) => {
  await col("tenants").updateOne({ _id: asId(request.params.tenantId) }, { $set: { status: "deleted", deletedAt: new Date(), updatedAt: new Date() } });
  ok(response, { id: asId(request.params.tenantId), status: "deleted" });
}));

app.get("/api/v1/platform/modules", ...platform, requirePermission("platform.module.read"), asyncRoute(async (_request, response) => {
  ok(response, await col("module_definitions").find().sort({ code: 1 }).toArray());
}));

app.get("/api/v1/platform/tenants/:tenantId/modules", ...platform, requirePermission("platform.module.read"), asyncRoute(async (request, response) => {
  ok(response, await col("tenant_modules").find({ tenantId: request.params.tenantId }).toArray());
}));

app.put("/api/v1/platform/tenants/:tenantId/modules", ...platform, requirePermission("platform.module.assign"), asyncRoute(async (request, response) => {
  const body = z.object({
    modules: z.array(z.object({ code: z.string(), enabled: z.boolean(), settings: z.record(z.unknown()).optional() })),
  }).parse(request.body);
  await replaceModules(request.params.tenantId, body.modules, request.auth!.userId);
  await audit({
    actorId: request.auth!.userId,
    actorAudience: "platform",
    action: "modules.assign",
    entityType: "tenant",
    entityId: request.params.tenantId,
    tenantId: request.params.tenantId,
    after: body.modules,
  });
  ok(response, await col("tenant_modules").find({ tenantId: request.params.tenantId }).toArray());
}));

app.get("/api/v1/platform/plans", ...platform, requirePermission("platform.plan.read"), asyncRoute(async (_request, response) => {
  ok(response, await col("plans").find().toArray());
}));

app.post("/api/v1/platform/plans", ...platform, requirePermission("platform.plan.write"), asyncRoute(async (request, response) => {
  const body = z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(""),
    moduleCodes: z.array(z.string()).default([]),
    price: z.string().default("0.00"),
    interval: z.string().default("month"),
  }).parse(request.body);
  await assertModulesValid(body.moduleCodes);
  const plan = {
    _id: id(),
    code: body.code,
    name: body.name,
    description: body.description,
    moduleCodes: body.moduleCodes,
    limits: { branches: 10, terminals: 10, users: 50 },
    priceMinor: long(decimalToScaled(body.price, 2)),
    interval: body.interval,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await col("plans").insertOne(plan);
  ok(response, plan, null, 201);
}));

app.get("/api/v1/platform/users", ...platform, requirePermission("platform.user.read"), asyncRoute(async (_request, response) => {
  const users = await col("platform_users").find({}, { projection: { passwordHash: 0, passwordResetHash: 0 } }).toArray();
  ok(response, users);
}));

app.post("/api/v1/platform/users", ...platform, requirePermission("platform.user.write"), asyncRoute(async (request, response) => {
  const body = z.object({
    email: z.string().email(),
    name: z.string().min(1),
    password: z.string().min(8),
    roleId: z.string(),
  }).parse(request.body);
  const user = {
    _id: id(),
    email: body.email.toLowerCase(),
    name: body.name,
    passwordHash: await hashPassword(body.password),
    roleId: body.roleId,
    status: "active",
    tv: long(0),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await col("platform_users").insertOne(user);
  ok(response, { id: user._id, email: user.email, name: user.name }, null, 201);
}));

app.get("/api/v1/platform/roles", ...platform, requirePermission("platform.user.read"), asyncRoute(async (_request, response) => {
  ok(response, await col("platform_roles").find().toArray());
}));

app.get("/api/v1/platform/integrations", ...platform, requirePermission("platform.integration.read"), asyncRoute(async (_request, response) => {
  const providers = await col("integration_providers").find({}, { projection: { notes: 1, code: 1, name: 1, availability: 1 } }).toArray();
  ok(response, providers);
}));

app.get("/api/v1/platform/settings", ...platform, requirePermission("platform.settings.read"), asyncRoute(async (_request, response) => {
  ok(response, await col("system_settings").findOne({ key: "global" }));
}));

app.get("/api/v1/platform/audit-logs", ...platform, requirePermission("platform.audit.read"), asyncRoute(async (request, response) => {
  const { limit, cursor } = paging(request);
  const { page, nextCursor } = await listRows("audit_logs", {}, limit, cursor);
  ok(response, page, nextCursor);
}));

app.get("/api/v1/platform/analytics/usage", ...platform, requirePermission("platform.tenant.read"), asyncRoute(async (_request, response) => {
  const tenants = await col("tenants").find().toArray();
  const byStatus: Record<string, number> = {};
  for (const tenant of tenants) byStatus[String(tenant.status)] = (byStatus[String(tenant.status)] ?? 0) + 1;
  const modules = await col("tenant_modules").aggregate([{ $match: { enabled: true } }, { $group: { _id: "$moduleCode", count: { $sum: 1 } } }]).toArray();
  ok(response, { tenants: byStatus, modules });
}));

app.get("/api/v1/admin/bootstrap", ...tenant, asyncRoute(async (request, response) => {
  const authUser = request.auth!;
  const tenantDoc = await tenantOrThrow(authUser.tenantId!);
  const modules = await col("tenant_modules").find({ tenantId: authUser.tenantId, enabled: true }).toArray();
  const branches = await col("branches").find({ tenantId: authUser.tenantId }).toArray();
  const terminals = await col("terminals").find({ tenantId: authUser.tenantId }).toArray();
  ok(response, {
    user: { id: authUser.userId, name: authUser.name, email: authUser.email, permissions: authUser.permissions },
    tenant: await publicTenant(tenantDoc),
    branches,
    terminals,
    enabledModules: modules.map((module) => module.moduleCode),
    moduleSettings: modules,
  });
}));

app.get("/api/v1/admin/branches", ...tenant, requirePermission("settings.business.read"), asyncRoute(async (request, response) => {
  ok(response, await col("branches").find({ tenantId: request.auth!.tenantId }).toArray());
}));

app.post("/api/v1/admin/branches", ...tenant, requirePermission("settings.business.write"), asyncRoute(async (request, response) => {
  const body = z.object({ name: z.string().min(1), code: z.string().min(1), phone: z.string().optional(), timezone: z.string().optional() }).parse(request.body);
  const branch = {
    _id: id(),
    tenantId: request.auth!.tenantId,
    name: body.name,
    code: body.code,
    address: {},
    phone: body.phone ?? "",
    timezone: body.timezone ?? "Asia/Kolkata",
    status: "active",
    receiptPrefix: body.code.slice(0, 3).toUpperCase(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await col("branches").insertOne(branch);
  ok(response, branch, null, 201);
}));

app.get("/api/v1/admin/categories", ...tenant, requireModule("catalog.products"), requirePermission("catalog.product.read"), asyncRoute(async (request, response) => {
  ok(response, await col("categories").find({ tenantId: request.auth!.tenantId }).sort({ sortOrder: 1 }).toArray());
}));

app.post("/api/v1/admin/categories", ...tenant, requireModule("catalog.products"), requirePermission("catalog.product.write"), asyncRoute(async (request, response) => {
  const body = z.object({ name: z.string().min(1), parentId: z.string().optional(), sortOrder: z.number().int().default(0) }).parse(request.body);
  const category = {
    _id: id(),
    tenantId: request.auth!.tenantId,
    name: body.name,
    parentId: body.parentId,
    sortOrder: long(body.sortOrder),
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await col("categories").insertOne(category);
  ok(response, category, null, 201);
}));

app.get("/api/v1/admin/products", ...tenant, requireModule("catalog.products"), requirePermission("catalog.product.read"), asyncRoute(async (request, response) => {
  const tenantDoc = await tenantOrThrow(request.auth!.tenantId!);
  const filter: Record<string, unknown> = { tenantId: request.auth!.tenantId };
  if (typeof request.query.status === "string") filter.status = request.query.status;
  if (typeof request.query.categoryId === "string") filter.categoryId = request.query.categoryId;
  const { page, nextCursor } = await listRows("products", filter, paging(request).limit, paging(request).cursor);
  ok(response, page.map((product) => presentProduct(product, num(tenantDoc.minorUnitScale) || 2)), nextCursor);
}));

app.post("/api/v1/admin/products", ...tenant, requireModule("catalog.products"), requirePermission("catalog.product.write"), asyncRoute(async (request, response) => {
  const body = z.object({
    name: z.string().min(1),
    type: z.enum(["simple", "variant", "recipe", "service"]),
    categoryId: z.string().optional(),
    sku: z.string().optional(),
    sellingPrice: z.string(),
    taxRate: z.string().optional(),
    discountRate: z.string().optional(),
    trackInventory: z.boolean().default(false),
    unitCode: z.string().optional(),
    description: z.string().optional(),
    hsnCode: z.string().optional(),
  }).parse(request.body);
  ok(response, await createProduct(request.auth!, body), null, 201);
}));

app.get("/api/v1/admin/products/:productId", ...tenant, requireModule("catalog.products"), requirePermission("catalog.product.read"), asyncRoute(async (request, response) => {
  const tenantDoc = await tenantOrThrow(request.auth!.tenantId!);
  const product = await col("products").findOne({ _id: asId(request.params.productId), tenantId: request.auth!.tenantId });
  if (!product) throw new HttpError(404, "not_found", "Product not found.");
  ok(response, presentProduct(product, num(tenantDoc.minorUnitScale) || 2));
}));

app.post("/api/v1/admin/products/:productId/archive", ...tenant, requireModule("catalog.products"), requirePermission("catalog.product.write"), asyncRoute(async (request, response) => {
  await col("products").updateOne({ _id: asId(request.params.productId), tenantId: request.auth!.tenantId }, { $set: { status: "archived", updatedAt: new Date() } });
  ok(response, { id: asId(request.params.productId), status: "archived" });
}));

app.post("/api/v1/admin/stock-items", ...tenant, requireModule("inventory.stock"), requirePermission("inventory.movement.write"), asyncRoute(async (request, response) => {
  const body = z.object({
    name: z.string().min(1),
    kind: z.enum(["ingredient", "finished", "retail", "packaging"]),
    baseUnit: z.enum(["mg", "ml", "milli_each"]),
    displayUnit: z.string().min(1),
    sku: z.string().optional(),
    minQty: z.string().optional(),
    minUnit: z.string().optional(),
  }).parse(request.body);
  const item: Record<string, unknown> = {
    _id: id(),
    tenantId: request.auth!.tenantId,
    name: body.name,
    kind: body.kind,
    baseUnit: body.baseUnit,
    displayUnit: body.displayUnit,
    purchaseCostMinor: long(0),
    minQtyBase: long(body.minQty && body.minUnit ? toBaseQuantity(body.minQty, body.minUnit, body.baseUnit) : 0),
    trackExpiry: false,
    trackBatch: false,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  if (body.sku) item.sku = body.sku;
  await col("stock_items").insertOne(item);
  ok(response, item, null, 201);
}));

app.get("/api/v1/admin/stock-items", ...tenant, requireModule("inventory.stock"), requirePermission("inventory.balance.read"), asyncRoute(async (request, response) => {
  ok(response, await col("stock_items").find({ tenantId: request.auth!.tenantId }).toArray());
}));

app.get("/api/v1/admin/branches/:branchId/balances", ...tenant, requireModule("inventory.stock"), requirePermission("inventory.balance.read"), asyncRoute(async (request, response) => {
  const balances = await col("inventory_balances").find({ tenantId: request.auth!.tenantId, branchId: request.params.branchId }).toArray();
  const items = await col("stock_items").find({ tenantId: request.auth!.tenantId }).toArray();
  const byId = new Map(items.map((item) => [String(item._id), item]));
  ok(response, balances.filter((balance) => byId.has(String(balance.stockItemId))).map((balance) => presentBalance(balance, byId.get(String(balance.stockItemId))!)));
}));

app.get("/api/v1/admin/branches/:branchId/movements", ...tenant, requireModule("inventory.stock"), requirePermission("inventory.balance.read"), asyncRoute(async (request, response) => {
  const rows = await col("stock_movements").find({ tenantId: request.auth!.tenantId, branchId: request.params.branchId }).sort({ occurredAt: -1 }).limit(200).toArray();
  ok(response, rows.map((row) => ({ ...row, qtyBase: num(row.qtyBase) })));
}));

app.post("/api/v1/admin/branches/:branchId/adjustments", ...tenant, requireModule("inventory.stock"), requirePermission("inventory.movement.write"), asyncRoute(async (request, response) => {
  const body = z.object({
    stockItemId: z.string(),
    quantity: z.string(),
    unit: z.string(),
    direction: z.enum(["in", "out"]),
    reason: z.string().min(1),
    unitCost: z.string().optional(),
  }).parse(request.body);
  await adjustStock(request.auth!, request.params.branchId, { ...body, idempotencyKey: idempotency(request) });
  ok(response, { adjusted: true });
}));

app.post("/api/v1/admin/suppliers", ...tenant, requireModule("inventory.supplier"), requirePermission("inventory.supplier.write"), asyncRoute(async (request, response) => {
  const body = z.object({ name: z.string().min(1), phone: z.string().optional(), gstin: z.string().optional(), address: z.string().optional() }).parse(request.body);
  const supplier = { _id: id(), tenantId: request.auth!.tenantId, ...body, address: body.address ?? "", phone: body.phone ?? "", gstin: body.gstin ?? "", status: "active", createdAt: new Date(), updatedAt: new Date() };
  await col("suppliers").insertOne(supplier);
  ok(response, supplier, null, 201);
}));

app.get("/api/v1/admin/suppliers", ...tenant, requireModule("inventory.supplier"), requirePermission("inventory.supplier.read"), asyncRoute(async (request, response) => {
  ok(response, await col("suppliers").find({ tenantId: request.auth!.tenantId }).toArray());
}));

app.post("/api/v1/admin/purchases", ...tenant, requireModule("inventory.purchase"), requirePermission("inventory.purchase.write"), asyncRoute(async (request, response) => {
  const body = z.object({
    branchId: z.string(),
    supplierId: z.string().optional(),
    lines: z.array(z.object({ stockItemId: z.string(), quantity: z.string(), unit: z.string(), unitCost: z.string() })),
  }).parse(request.body);
  const tenantDoc = await tenantOrThrow(request.auth!.tenantId!);
  const scale = num(tenantDoc.minorUnitScale) || 2;
  const purchaseId = id();
  const lines = [];
  for (const line of body.lines) {
    const stock = await col("stock_items").findOne({ _id: asId(line.stockItemId), tenantId: request.auth!.tenantId });
    if (!stock) throw new HttpError(404, "not_found", "Stock item not found.");
    const qtyBase = toBaseQuantity(line.quantity, line.unit, stock.baseUnit);
    const unitCost = decimalToScaled(line.unitCost, scale);
    lines.push({ stockItemId: stock._id, qtyBase: long(qtyBase), unitCostMinor: long(unitCost) });
    await col("stock_items").updateOne({ _id: stock._id }, { $set: { purchaseCostMinor: long(unitCost), updatedAt: new Date() } });
    await postMovement({
      tenantId: request.auth!.tenantId!,
      branchId: body.branchId,
      stockItemId: String(stock._id),
      type: "purchase",
      qtyBase,
      idempotencyKey: `${idempotency(request)}:${stock._id}`,
      purchaseId: String(purchaseId),
      unitCostMinor: unitCost,
      allowNegative: true,
      createdBy: request.auth!.userId,
    });
  }
  const purchase = {
    _id: purchaseId,
    tenantId: request.auth!.tenantId,
    branchId: body.branchId,
    supplierId: body.supplierId,
    status: "received",
    lines,
    totalMinor: long(lines.reduce((sum, line) => sum + num(line.unitCostMinor), 0)),
    purchasedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await col("purchases").insertOne(purchase);
  ok(response, { id: purchaseId, status: "received" }, null, 201);
}));

app.get("/api/v1/admin/purchases", ...tenant, requireModule("inventory.purchase"), requirePermission("inventory.purchase.read"), asyncRoute(async (request, response) => {
  ok(response, await col("purchases").find({ tenantId: request.auth!.tenantId }).sort({ purchasedAt: -1 }).limit(100).toArray());
}));

app.post("/api/v1/admin/products/:productId/recipes", ...tenant, requireModule("recipe.management"), requirePermission("recipe.write"), asyncRoute(async (request, response) => {
  const body = z.object({
    lines: z.array(z.object({
      stockItemId: z.string(),
      quantity: z.string(),
      unit: z.string(),
      wastagePercent: z.string().optional(),
    })).min(1),
  }).parse(request.body);
  ok(response, await createRecipe(request.auth!, request.params.productId, body), null, 201);
}));

app.get("/api/v1/admin/products/:productId/recipes", ...tenant, requireModule("recipe.management"), requirePermission("recipe.read"), asyncRoute(async (request, response) => {
  const recipes = await col("recipes").find({ tenantId: request.auth!.tenantId, productId: request.params.productId }).toArray();
  ok(response, recipes);
}));

app.post("/api/v1/admin/recipes/cost-preview", ...tenant, requireModule("recipe.management"), requirePermission("recipe.read"), asyncRoute(async (request, response) => {
  const body = z.object({ productId: z.string(), qty: z.string().default("1") }).parse(request.body);
  const recipe = await col("recipes").findOne({ tenantId: request.auth!.tenantId, productId: body.productId, status: "active" });
  if (!recipe) throw new HttpError(404, "not_found", "Recipe not found.");
  const qtyMilli = decimalToScaled(body.qty, 3);
  let cost = 0;
  for (const line of recipe.lines ?? []) {
    const stock = await col("stock_items").findOne({ _id: asId(line.stockItemId) });
    const consumed = recipeConsumption(num(line.qtyBase), qtyMilli, num(line.wastageBps));
    if (stock) {
      const one = toBaseQuantity("1", String(stock.displayUnit), stock.baseUnit);
      cost += one ? Math.round((num(stock.purchaseCostMinor) * consumed) / one) : 0;
    }
  }
  const tenantDoc = await tenantOrThrow(request.auth!.tenantId!);
  ok(response, { cost: moneyOut(cost, num(tenantDoc.minorUnitScale) || 2) });
}));

app.get("/api/v1/admin/expense-categories", ...tenant, requireModule("expense.management"), requirePermission("expense.read"), asyncRoute(async (request, response) => {
  ok(response, await col("expense_categories").find({ tenantId: request.auth!.tenantId }).toArray());
}));

app.post("/api/v1/admin/expense-categories", ...tenant, requireModule("expense.management"), requirePermission("expense.write"), asyncRoute(async (request, response) => {
  const body = z.object({ name: z.string().min(1), kind: z.enum(["operating", "cogs", "other"]).default("operating") }).parse(request.body);
  const category = { _id: id(), tenantId: request.auth!.tenantId, name: body.name, kind: body.kind, status: "active", createdAt: new Date(), updatedAt: new Date() };
  await col("expense_categories").insertOne(category);
  ok(response, category, null, 201);
}));

app.get("/api/v1/admin/expenses", ...tenant, requireModule("expense.management"), requirePermission("expense.read"), asyncRoute(async (request, response) => {
  const rows = await col("expenses").find({ tenantId: request.auth!.tenantId }).sort({ spentAt: -1 }).limit(200).toArray();
  const tenantDoc = await tenantOrThrow(request.auth!.tenantId!);
  const scale = num(tenantDoc.minorUnitScale) || 2;
  ok(response, rows.map((row) => ({ ...row, amount: moneyOut(row.amountMinor, scale) })));
}));

app.post("/api/v1/admin/expenses", ...tenant, requireModule("expense.management"), requirePermission("expense.write"), asyncRoute(async (request, response) => {
  const body = z.object({
    branchId: z.string(),
    categoryId: z.string(),
    title: z.string().min(1),
    amount: z.string(),
    paidBy: z.enum(["cash", "upi", "card", "bank"]),
    description: z.string().optional(),
    employeeId: z.string().optional(),
    spentAt: z.string().optional(),
  }).parse(request.body);
  const tenantDoc = await tenantOrThrow(request.auth!.tenantId!);
  const expense = {
    _id: id(),
    tenantId: request.auth!.tenantId,
    branchId: body.branchId,
    categoryId: body.categoryId,
    title: body.title,
    description: body.description ?? "",
    amountMinor: long(decimalToScaled(body.amount, num(tenantDoc.minorUnitScale) || 2)),
    paidBy: body.paidBy,
    employeeId: body.employeeId,
    spentAt: body.spentAt ? new Date(body.spentAt) : new Date(),
    status: "approved",
    receiptFileIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await col("expenses").insertOne(expense);
  ok(response, { id: expense._id, amount: moneyOut(expense.amountMinor, num(tenantDoc.minorUnitScale) || 2) }, null, 201);
}));

app.get("/api/v1/admin/users", ...tenant, requireModule("employee.management"), requirePermission("employee.user.read"), asyncRoute(async (request, response) => {
  const users = await col("users").find({ tenantId: request.auth!.tenantId }, { projection: { passwordHash: 0 } }).toArray();
  ok(response, users);
}));

app.post("/api/v1/admin/users", ...tenant, requireModule("employee.management"), requirePermission("employee.user.write"), asyncRoute(async (request, response) => {
  const body = z.object({
    email: z.string().email(),
    name: z.string().min(1),
    password: z.string().min(8),
    roleId: z.string(),
    branchIds: z.array(z.string()).default([]),
  }).parse(request.body);
  const user = {
    _id: id(),
    tenantId: request.auth!.tenantId,
    email: body.email.toLowerCase(),
    name: body.name,
    phone: "",
    passwordHash: await hashPassword(body.password),
    roleId: body.roleId,
    branchIds: body.branchIds,
    status: "active",
    tv: long(0),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await col("users").insertOne(user);
  ok(response, { id: user._id, email: user.email, name: user.name }, null, 201);
}));

app.get("/api/v1/admin/roles", ...tenant, requirePermission("access.role.read"), asyncRoute(async (request, response) => {
  ok(response, await col("roles").find({ tenantId: request.auth!.tenantId }).toArray());
}));

app.post("/api/v1/admin/roles", ...tenant, requirePermission("access.role.manage"), asyncRoute(async (request, response) => {
  const body = z.object({ name: z.string().min(1), permissionKeys: z.array(z.string()) }).parse(request.body);
  const modules = await col("tenant_modules").find({ tenantId: request.auth!.tenantId, enabled: true }).toArray();
  const allowed = new Set([...(await keysForModules(new Set(modules.map((module) => String(module.moduleCode))))), "settings.business.read", "settings.business.write", "settings.module.read", "settings.module.write", "access.role.read", "access.role.manage"]);
  const role = {
    _id: id(),
    tenantId: request.auth!.tenantId,
    name: body.name,
    presetCode: null,
    permissionKeys: body.permissionKeys.filter((key) => allowed.has(key)),
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await col("roles").insertOne(role);
  ok(response, role, null, 201);
}));

app.get("/api/v1/admin/customers", ...tenant, requireModule("customer.management"), requirePermission("customer.read"), asyncRoute(async (request, response) => {
  ok(response, await col("customers").find({ tenantId: request.auth!.tenantId }).limit(200).toArray());
}));

app.post("/api/v1/admin/customers", ...tenant, requireModule("customer.management"), requirePermission("customer.write"), asyncRoute(async (request, response) => {
  const body = z.object({ name: z.string().min(1), phone: z.string().optional(), email: z.string().optional(), notes: z.string().optional() }).parse(request.body);
  const customer: Record<string, unknown> = { _id: id(), tenantId: request.auth!.tenantId, name: body.name, email: body.email ?? "", notes: body.notes ?? "", createdAt: new Date(), updatedAt: new Date() };
  if (body.phone) customer.phone = body.phone;
  await col("customers").insertOne(customer);
  ok(response, customer, null, 201);
}));

app.get("/api/v1/admin/terminals", ...tenant, requireModule("pos.billing"), requirePermission("settings.business.read"), asyncRoute(async (request, response) => {
  ok(response, await col("terminals").find({ tenantId: request.auth!.tenantId }).toArray());
}));

app.get("/api/v1/admin/settings", ...tenant, requirePermission("settings.business.read"), asyncRoute(async (request, response) => {
  ok(response, await publicTenant(await tenantOrThrow(request.auth!.tenantId!)));
}));

app.patch("/api/v1/admin/settings", ...tenant, requirePermission("settings.business.write"), asyncRoute(async (request, response) => {
  const body = z.object({
    name: z.string().optional(),
    legalName: z.string().optional(),
    phone: z.string().optional(),
    timezone: z.string().optional(),
    taxMode: z.enum(["inclusive", "exclusive"]).optional(),
    stockPolicy: z.enum(["on_payment", "on_prepared"]).optional(),
    gstin: z.string().optional(),
  }).parse(request.body);
  await col("tenants").updateOne({ _id: asId(request.auth!.tenantId) }, { $set: { ...body, updatedAt: new Date() } });
  ok(response, await publicTenant(await tenantOrThrow(request.auth!.tenantId!)));
}));

app.get("/api/v1/admin/modules", ...tenant, requirePermission("settings.module.read"), asyncRoute(async (request, response) => {
  ok(response, await col("tenant_modules").find({ tenantId: request.auth!.tenantId }).toArray());
}));

app.get("/api/v1/admin/reports/sales-summary", ...tenant, requireModule("reports.sales"), requirePermission("report.sales.read"), asyncRoute(async (request, response) => {
  const range = reportRange(request);
  ok(response, await salesSummary(request.auth!, range.from, range.to, typeof request.query.branchId === "string" ? request.query.branchId : undefined));
}));

app.get("/api/v1/admin/reports/profit", ...tenant, requireModule("reports.finance"), requirePermission("report.finance.read"), asyncRoute(async (request, response) => {
  const range = reportRange(request);
  ok(response, await salesSummary(request.auth!, range.from, range.to, typeof request.query.branchId === "string" ? request.query.branchId : undefined));
}));

app.post("/api/v1/admin/reports/exports", ...tenant, requirePermission("report.export"), asyncRoute(async (request, response) => {
  const body = z.object({
    report: z.enum(["sales-summary", "profit"]),
    format: z.enum(["pdf", "xlsx", "csv"]),
    filters: z.object({ from: z.string().optional(), to: z.string().optional(), branchId: z.string().optional() }).default({}),
  }).parse(request.body);
  const from = body.filters.from ? new Date(body.filters.from) : startOfDay(new Date());
  const to = body.filters.to ? new Date(body.filters.to) : endOfDay(new Date());
  const summary = await salesSummary(request.auth!, from, to, body.filters.branchId);
  const rows = Object.entries(summary).filter((entry) => typeof entry[1] === "string").map(([key, value]) => [key, String(value)]);
  if (body.format === "csv") {
    response.setHeader("Content-Type", "text/csv");
    response.setHeader("Content-Disposition", "attachment; filename=report.csv");
    response.send(["metric,value", ...rows.map((row) => row.join(","))].join("\n"));
    return;
  }
  if (body.format === "xlsx") {
    response.setHeader("Content-Type", "application/vnd.ms-excel");
    response.setHeader("Content-Disposition", "attachment; filename=report.xls");
    response.send(spreadsheet(rows));
    return;
  }
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", "attachment; filename=report.pdf");
  response.send(simplePdf(rows.map((row) => `${row[0]}: ${row[1]}`)));
}));

app.get("/api/v1/pos/bootstrap", ...tenant, requireModule("pos.billing"), asyncRoute(async (request, response) => {
  const tenantDoc = await tenantOrThrow(request.auth!.tenantId!);
  const modules = await col("tenant_modules").find({ tenantId: request.auth!.tenantId, enabled: true }).toArray();
  const terminals = await col("terminals").find({ tenantId: request.auth!.tenantId, branchId: { $in: request.auth!.branchIds } }).toArray();
  ok(response, {
    user: { id: request.auth!.userId, name: request.auth!.name, permissions: request.auth!.permissions },
    tenant: { name: tenantDoc.name, slug: tenantDoc.slug, taxMode: tenantDoc.taxMode, stockPolicy: tenantDoc.stockPolicy, currency: tenantDoc.currency },
    terminals,
    enabledModules: modules.map((module) => module.moduleCode),
    paymentMethods: modules.some((module) => module.moduleCode === "payments.razorpay") ? ["cash", "upi", "card", "razorpay"] : ["cash", "upi", "card"],
    catalogVersion: new Date().toISOString(),
  });
}));

app.post("/api/v1/pos/shifts", ...tenant, requireModule("pos.billing"), requirePermission("pos.shift.manage"), asyncRoute(async (request, response) => {
  const body = z.object({ branchId: z.string(), terminalId: z.string(), openingCash: z.string() }).parse(request.body);
  const tenantDoc = await tenantOrThrow(request.auth!.tenantId!);
  const shift = {
    _id: id(),
    tenantId: request.auth!.tenantId,
    branchId: body.branchId,
    terminalId: body.terminalId,
    userId: request.auth!.userId,
    openedAt: new Date(),
    openingCashMinor: long(decimalToScaled(body.openingCash, num(tenantDoc.minorUnitScale) || 2)),
    status: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await col("shifts").insertOne(shift);
  ok(response, shift, null, 201);
}));

app.post("/api/v1/pos/shifts/:shiftId/close", ...tenant, requireModule("pos.billing"), requirePermission("pos.shift.manage"), asyncRoute(async (request, response) => {
  const body = z.object({ closingCash: z.string() }).parse(request.body);
  const tenantDoc = await tenantOrThrow(request.auth!.tenantId!);
  await col("shifts").updateOne(
    { _id: asId(request.params.shiftId), tenantId: request.auth!.tenantId },
    { $set: { status: "closed", closedAt: new Date(), closingCashMinor: long(decimalToScaled(body.closingCash, num(tenantDoc.minorUnitScale) || 2)), updatedAt: new Date() } },
  );
  ok(response, { id: request.params.shiftId, status: "closed" });
}));

app.get("/api/v1/pos/catalog", ...tenant, requireModule("pos.billing"), requireModule("catalog.products"), asyncRoute(async (request, response) => {
  const filter: Record<string, unknown> = { tenantId: request.auth!.tenantId, status: "active" };
  if (typeof request.query.categoryId === "string") filter.categoryId = request.query.categoryId;
  if (typeof request.query.q === "string" && request.query.q.trim()) filter.name = { $regex: request.query.q.trim(), $options: "i" };
  const tenantDoc = await tenantOrThrow(request.auth!.tenantId!);
  const products = await col("products").find(filter).limit(200).toArray();
  const categories = await col("categories").find({ tenantId: request.auth!.tenantId, status: "active" }).toArray();
  ok(response, { categories, products: products.map((product) => presentProduct(product, num(tenantDoc.minorUnitScale) || 2)) });
}));

app.get("/api/v1/pos/barcodes/:code", ...tenant, requireModule("catalog.barcode"), asyncRoute(async (request, response) => {
  const barcode = await col("barcodes").findOne({ tenantId: request.auth!.tenantId, code: request.params.code });
  if (!barcode) throw new HttpError(404, "not_found", "Barcode not found.");
  const product = await col("products").findOne({ _id: asId(barcode.productId), tenantId: request.auth!.tenantId });
  const tenantDoc = await tenantOrThrow(request.auth!.tenantId!);
  ok(response, presentProduct(product, num(tenantDoc.minorUnitScale) || 2));
}));

app.post("/api/v1/pos/orders", ...tenant, requireModule("pos.billing"), requirePermission("pos.order.create"), asyncRoute(async (request, response) => {
  const body = z.object({
    branchId: z.string(),
    terminalId: z.string().optional(),
    shiftId: z.string().optional(),
    orderType: z.enum(["counter", "dine_in", "takeaway", "delivery", "online"]).default("counter"),
    lines: z.array(z.object({ productId: z.string(), variantId: z.string().nullable().optional(), qty: z.string() })).min(1),
    offlineReceiptRef: z.string().optional(),
  }).parse(request.body);
  ok(response, await createPosOrder(request.auth!, { ...body, idempotencyKey: idempotency(request) }), null, 201);
}));

app.get("/api/v1/pos/orders", ...tenant, requireModule("pos.billing"), asyncRoute(async (request, response) => {
  const tenantDoc = await tenantOrThrow(request.auth!.tenantId!);
  const orders = await col("orders").find({ tenantId: request.auth!.tenantId, branchId: { $in: request.auth!.branchIds } }).sort({ createdAt: -1 }).limit(100).toArray();
  ok(response, orders.map((order) => presentOrder(order, num(tenantDoc.minorUnitScale) || 2)));
}));

app.get("/api/v1/pos/orders/:orderId", ...tenant, requireModule("pos.billing"), asyncRoute(async (request, response) => {
  const order = await col("orders").findOne({ _id: asId(request.params.orderId), tenantId: request.auth!.tenantId });
  if (!order) throw new HttpError(404, "not_found", "Order not found.");
  const tenantDoc = await tenantOrThrow(request.auth!.tenantId!);
  ok(response, presentOrder(order, num(tenantDoc.minorUnitScale) || 2));
}));

app.post("/api/v1/pos/orders/:orderId/hold", ...tenant, requireModule("pos.billing"), requirePermission("pos.order.hold"), asyncRoute(async (request, response) => {
  await col("orders").updateOne({ _id: asId(request.params.orderId), tenantId: request.auth!.tenantId }, { $set: { status: "held", updatedAt: new Date() } });
  ok(response, { id: asId(request.params.orderId), status: "held" });
}));

app.post("/api/v1/pos/orders/:orderId/resume", ...tenant, requireModule("pos.billing"), requirePermission("pos.order.hold"), asyncRoute(async (request, response) => {
  await col("orders").updateOne({ _id: asId(request.params.orderId), tenantId: request.auth!.tenantId, status: "held" }, { $set: { status: "open", updatedAt: new Date() } });
  ok(response, { id: asId(request.params.orderId), status: "open" });
}));

app.post("/api/v1/pos/orders/:orderId/cancel", ...tenant, requireModule("pos.billing"), requirePermission("pos.order.cancel"), asyncRoute(async (request, response) => {
  const body = z.object({ reason: z.string().min(1), prepared: z.boolean().default(false) }).parse(request.body);
  const order = await col("orders").findOne({ _id: asId(request.params.orderId), tenantId: request.auth!.tenantId });
  if (!order) throw new HttpError(404, "not_found", "Order not found.");
  const prepared = body.prepared || order.kitchenStatus === "prepared" || order.kitchenStatus === "served";
  if (order.stockPosted && !prepared) {
    const movements = await col("stock_movements").find({ tenantId: request.auth!.tenantId, orderId: idText(order._id) }).toArray();
    for (const movement of movements) {
      await postMovement({
        tenantId: request.auth!.tenantId!,
        branchId: String(order.branchId),
        stockItemId: String(movement.stockItemId),
        type: "reversal",
        qtyBase: -num(movement.qtyBase),
        idempotencyKey: `reversal:${movement._id}`,
        orderId: String(order._id),
        allowNegative: true,
        createdBy: request.auth!.userId,
        reason: body.reason,
      });
    }
  }
  await col("orders").updateOne(
    { _id: order._id },
    { $set: { status: "cancelled", cancelledAt: new Date(), cancellation: { reason: body.reason, prepared }, updatedAt: new Date() } },
  );
  ok(response, { id: order._id, status: "cancelled", prepared });
}));

app.post("/api/v1/pos/orders/:orderId/payments", ...tenant, requireModule("pos.billing"), requirePermission("pos.order.create"), asyncRoute(async (request, response) => {
  const body = z.object({ amount: z.string(), method: z.literal("cash").default("cash") }).parse(request.body);
  const result = await captureCashPayment(request.auth!, request.params.orderId, { amount: body.amount, idempotencyKey: idempotency(request) });
  ok(response, result.order, null, result.duplicate ? 200 : 201);
}));

app.post("/api/v1/pos/orders/:orderId/refunds", ...tenant, requireModule("pos.billing"), requirePermission("pos.order.refund"), asyncRoute(async (request, response) => {
  const body = z.object({ amount: z.string(), reason: z.string().min(1) }).parse(request.body);
  const order = await col("orders").findOne({ _id: asId(request.params.orderId), tenantId: request.auth!.tenantId });
  if (!order) throw new HttpError(404, "not_found", "Order not found.");
  const payment = await col("payments").findOne({ tenantId: request.auth!.tenantId, orderId: idText(order._id), status: "captured" });
  if (!payment) throw new HttpError(422, "refund_unavailable", "There is no captured payment to refund.");
  const tenantDoc = await tenantOrThrow(request.auth!.tenantId!);
  const amount = decimalToScaled(body.amount, num(tenantDoc.minorUnitScale) || 2);
  const refund = {
    _id: id(),
    tenantId: request.auth!.tenantId,
    orderId: idText(order._id),
    paymentId: idText(payment._id),
    amountMinor: long(amount),
    reason: body.reason,
    status: "completed",
    idempotencyKey: idempotency(request),
    createdAt: new Date(),
  };
  await col("refunds").insertOne(refund);
  await col("orders").updateOne({ _id: order._id }, { $set: { status: "refunded", updatedAt: new Date() } });
  await audit({
    tenantId: request.auth!.tenantId,
    actorId: request.auth!.userId,
    actorAudience: "tenant",
    action: "order.refund",
    entityType: "order",
    entityId: String(order._id),
    after: { amount: body.amount, reason: body.reason },
  });
  ok(response, { id: refund._id, status: "completed" }, null, 201);
}));

app.get("/api/v1/pos/orders/:orderId/receipt", ...tenant, requireModule("pos.billing"), asyncRoute(async (request, response) => {
  const order = await col("orders").findOne({ _id: asId(request.params.orderId), tenantId: request.auth!.tenantId });
  if (!order) throw new HttpError(404, "not_found", "Order not found.");
  const tenantDoc = await tenantOrThrow(request.auth!.tenantId!);
  const presented = presentOrder(order, num(tenantDoc.minorUnitScale) || 2);
  if (request.query.format === "pdf") {
    response.setHeader("Content-Type", "application/pdf");
    response.send(simplePdf([
      String(tenantDoc.name),
      `Receipt ${presented.receiptNumber ?? presented.offlineReceiptRef ?? presented.id}`,
      ...presented.lines.map((line) => `${line.name} x ${line.qty}  ${line.unitPrice}`),
      `Total ${presented.total}`,
    ]));
    return;
  }
  ok(response, { ...presented, businessName: tenantDoc.name });
}));

app.post("/api/v1/pos/orders/:orderId/razorpay/orders", ...tenant, requireModule("payments.razorpay"), asyncRoute(async () => {
  throw new HttpError(501, "integration_unavailable", "Razorpay is not configured for this server.");
}));

app.post("/api/v1/sync/batches", ...tenant, requireModule("pos.billing"), requirePermission("pos.order.create"), asyncRoute(async (request, response) => {
  const body = z.object({
    terminalId: z.string(),
    catalogVersion: z.string().optional(),
    operations: z.array(z.object({
      idempotencyKey: z.string(),
      entityType: z.enum(["order", "payment", "movement"]),
      entityId: z.string(),
      groupId: z.string().optional(),
      payload: z.record(z.unknown()),
    })),
  }).parse(request.body);
  const results = [];
  for (const operation of body.operations) {
    if (operation.entityType === "movement" && "onHandBase" in operation.payload) {
      results.push({ idempotencyKey: operation.idempotencyKey, status: "rejected", message: "Absolute on-hand quantities are not accepted." });
      continue;
    }
    if (operation.entityType === "order") {
      const lines = z.array(z.object({ productId: z.string(), qty: z.string(), variantId: z.string().nullable().optional() })).parse(operation.payload.lines);
      const order = await createPosOrder(request.auth!, {
        branchId: String(operation.payload.branchId),
        terminalId: body.terminalId,
        orderType: "counter",
        lines,
        idempotencyKey: operation.idempotencyKey,
        allowNegative: true,
        offlineReceiptRef: typeof operation.payload.offlineReceiptRef === "string" ? operation.payload.offlineReceiptRef : undefined,
      });
      const paid = await captureCashPayment(request.auth!, String(order.id), {
        amount: String(order.total),
        idempotencyKey: `${operation.idempotencyKey}:pay`,
        allowNegative: true,
      });
      await col("sync_inbox").updateOne(
        { tenantId: request.auth!.tenantId, idempotencyKey: operation.idempotencyKey },
        { $setOnInsert: { _id: id(), tenantId: request.auth!.tenantId, terminalId: body.terminalId, idempotencyKey: operation.idempotencyKey, entityType: "order", entityId: order.id, result: "applied", receivedAt: new Date() } },
        { upsert: true },
      );
      results.push({ idempotencyKey: operation.idempotencyKey, status: "applied", order: paid.order });
      continue;
    }
    results.push({ idempotencyKey: operation.idempotencyKey, status: "applied" });
  }
  ok(response, { results });
}));

app.get("/api/v1/sync/conflicts", ...tenant, asyncRoute(async (request, response) => {
  ok(response, await col("sync_conflicts").find({ tenantId: request.auth!.tenantId, status: "open" }).limit(100).toArray());
}));

app.get("/api/docs/openapi.json", (_request, response) => {
  response.json(openApi);
});
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApi, { customSiteTitle: "POS API" }));

app.use(errorHandler);

function reportRange(request: Request) {
  const preset = typeof request.query.range === "string" ? request.query.range : "today";
  const now = new Date();
  if (typeof request.query.from === "string" && typeof request.query.to === "string") {
    return { from: new Date(request.query.from), to: new Date(request.query.to) };
  }
  if (preset === "yesterday") {
    const day = new Date(now);
    day.setDate(day.getDate() - 1);
    return { from: startOfDay(day), to: endOfDay(day) };
  }
  if (preset === "week") {
    const day = new Date(now);
    day.setDate(day.getDate() - 6);
    return { from: startOfDay(day), to: endOfDay(now) };
  }
  if (preset === "month") return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now) };
  return { from: startOfDay(now), to: endOfDay(now) };
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function spreadsheet(rows: string[][]): string {
  const body = rows.map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join("")}</Row>`).join("");
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Report"><Table>${body}</Table></Worksheet></Workbook>`;
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function simplePdf(lines: string[]): Buffer {
  const commands = ["BT", "/F1 12 Tf", "50 800 Td"];
  lines.slice(0, 40).forEach((line, index) => {
    if (index > 0) commands.push("0 -16 Td");
    commands.push(`(${line.replace(/[()\\]/g, "")}) Tj`);
  });
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += `${object}\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
