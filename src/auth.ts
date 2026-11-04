import argon2 from "argon2";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { NextFunction, Request, Response } from "express";
import { config } from "./config";
import { col } from "./db";
import { asId, id } from "./ids";
import { HttpError } from "./http";
import { long, num } from "./money";
import { logger } from "./logger";

export interface AuthContext {
  userId: string;
  aud: "platform" | "tenant";
  sessionId: string;
  tv: number;
  tenantId?: string;
  roleId: string;
  branchIds: string[];
  permissions: string[];
  email: string;
  name: string;
}

const ACCESS_SECONDS = 15 * 60;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function checkPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function signAccess(input: {
  userId: string;
  aud: "platform" | "tenant";
  sessionId: string;
  tv: number;
  tenantId?: string;
  roleId: string;
  branchIds: string[];
}): string {
  return jwt.sign(
    {
      sub: input.userId,
      aud: input.aud,
      sessionId: input.sessionId,
      tv: input.tv,
      tenantId: input.tenantId,
      roleId: input.roleId,
      branchIds: input.branchIds,
    },
    config.accessSecret,
    { expiresIn: ACCESS_SECONDS },
  );
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.isProduction,
    path: "/api/v1",
    maxAge: REFRESH_MS,
  };
}

export function setRefreshCookie(response: Response, token: string): void {
  response.cookie("refresh_token", token, cookieOptions());
}

export function clearRefreshCookie(response: Response): void {
  response.clearCookie("refresh_token", { path: "/api/v1" });
}

export async function openSession(input: {
  aud: "platform" | "tenant";
  userId: string;
  tenantId?: string;
  familyId?: string;
  userAgent?: string;
  ip?: string;
}): Promise<{ sessionId: string; refreshToken: string; familyId: string }> {
  const refreshToken = crypto.randomBytes(32).toString("hex");
  const sessionOid = id();
  const sessionId = sessionOid.toHexString();
  const familyId = input.familyId ?? crypto.randomUUID();
  const collection = input.aud === "platform" ? "platform_sessions" : "user_sessions";
  await col(collection).insertOne({
    _id: sessionOid,
    userId: input.userId,
    tenantId: input.tenantId,
    refreshTokenHash: hashToken(refreshToken),
    familyId,
    expiresAt: new Date(Date.now() + REFRESH_MS),
    revokedAt: null,
    replacedBySessionId: null,
    userAgent: input.userAgent ?? "",
    ip: input.ip ?? "",
    createdAt: new Date(),
  });
  return { sessionId, refreshToken, familyId };
}

export async function rotateSession(aud: "platform" | "tenant", refreshToken: string, request: Request) {
  const collection = aud === "platform" ? "platform_sessions" : "user_sessions";
  const existing = await col(collection).findOne({ refreshTokenHash: hashToken(refreshToken) });
  if (!existing) throw new HttpError(401, "invalid_refresh", "Sign in again.");
  if (existing.revokedAt) {
    await col(collection).updateMany({ familyId: existing.familyId }, { $set: { revokedAt: new Date() } });
    throw new HttpError(401, "refresh_reused", "This session was revoked.");
  }
  if (new Date(existing.expiresAt).getTime() < Date.now()) {
    throw new HttpError(401, "refresh_expired", "Sign in again.");
  }
  const next = await openSession({
    aud,
    userId: String(existing.userId),
    tenantId: existing.tenantId ? String(existing.tenantId) : undefined,
    familyId: String(existing.familyId),
    userAgent: request.get("user-agent"),
    ip: request.ip,
  });
  await col(collection).updateOne(
    { _id: existing._id },
    { $set: { revokedAt: new Date(), replacedBySessionId: next.sessionId } },
  );
  return next;
}

export async function revokeSession(aud: "platform" | "tenant", refreshToken: string): Promise<void> {
  const collection = aud === "platform" ? "platform_sessions" : "user_sessions";
  const existing = await col(collection).findOne({ refreshTokenHash: hashToken(refreshToken) });
  if (!existing) return;
  await col(collection).updateMany({ familyId: existing.familyId }, { $set: { revokedAt: new Date() } });
}

async function permissionsFor(roleCollection: string, roleId: string): Promise<string[]> {
  const role = await col(roleCollection).findOne({ _id: asId(roleId) });
  return Array.isArray(role?.permissionKeys) ? role.permissionKeys.map(String) : [];
}

export async function buildAuthFromToken(payload: jwt.JwtPayload): Promise<AuthContext> {
  const aud = payload.aud === "platform" ? "platform" : payload.aud === "tenant" ? "tenant" : null;
  if (!aud || typeof payload.sub !== "string") throw new HttpError(401, "invalid_token", "Sign in again.");
  if (aud === "platform") {
    const user = await col("platform_users").findOne({ _id: asId(payload.sub) });
    if (!user || user.status !== "active") throw new HttpError(401, "invalid_token", "Sign in again.");
    if (num(user.tv) !== Number(payload.tv)) throw new HttpError(401, "invalid_token", "Sign in again.");
    const permissions = await permissionsFor("platform_roles", String(user.roleId));
    return {
      userId: String(user._id),
      aud,
      sessionId: String(payload.sessionId),
      tv: num(user.tv),
      roleId: String(user.roleId),
      branchIds: [],
      permissions,
      email: String(user.email),
      name: String(user.name),
    };
  }
  const user = await col("users").findOne({ _id: asId(payload.sub) });
  if (!user || user.status !== "active") throw new HttpError(401, "invalid_token", "Sign in again.");
  if (num(user.tv) !== Number(payload.tv)) throw new HttpError(401, "invalid_token", "Sign in again.");
  const tenant = await col("tenants").findOne({ _id: asId(user.tenantId) });
  if (!tenant || tenant.status === "suspended" || tenant.status === "deleted") {
    throw new HttpError(401, "tenant_blocked", "This business cannot sign in.");
  }
  const permissions = await permissionsFor("roles", String(user.roleId));
  let branchIds = Array.isArray(user.branchIds) ? user.branchIds.map(String) : [];
  if (permissions.includes("settings.business.read")) {
    const branches = await col("branches").find({ tenantId: user.tenantId }).toArray();
    branchIds = branches.map((branch) => String(branch._id));
  }
  return {
    userId: String(user._id),
    aud,
    sessionId: String(payload.sessionId),
    tv: num(user.tv),
    tenantId: String(user.tenantId),
    roleId: String(user.roleId),
    branchIds,
    permissions,
    email: String(user.email),
    name: String(user.name),
  };
}

export async function requireAuth(request: Request, _response: Response, next: NextFunction): Promise<void> {
  try {
    const header = request.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new HttpError(401, "unauthorized", "Sign in again.");
    const payload = jwt.verify(token, config.accessSecret) as jwt.JwtPayload;
    request.auth = await buildAuthFromToken(payload);
    next();
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(401, "unauthorized", "Sign in again."));
  }
}

export function requireAudience(aud: "platform" | "tenant") {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (request.auth?.aud !== aud) {
      next(new HttpError(403, "forbidden", "This account cannot call this API."));
      return;
    }
    next();
  };
}

export function requirePermission(permission: string) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.auth?.permissions.includes(permission)) {
      next(new HttpError(403, "forbidden", "You do not have permission to do that."));
      return;
    }
    next();
  };
}

export function requireModule(code: string) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    try {
      const tenantId = request.auth?.tenantId;
      if (!tenantId) throw new HttpError(403, "forbidden", "Tenant scope is missing.");
      const enabled = await col("tenant_modules").findOne({ tenantId, moduleCode: code, enabled: true });
      if (!enabled) throw new HttpError(403, "module_disabled", `${code} is not enabled for this business.`);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function assertBranch(auth: AuthContext, branchId: string): void {
  if (!auth.branchIds.includes(branchId)) {
    throw new HttpError(403, "forbidden", "You cannot use this branch.");
  }
}

export async function recordLogin(input: {
  audience: "platform" | "tenant";
  userId: string;
  tenantId?: string;
  success: boolean;
  request: Request;
}): Promise<void> {
  await col("login_history").insertOne({
    _id: id(),
    audience: input.audience,
    userId: input.userId,
    tenantId: input.tenantId,
    success: input.success,
    ip: input.request.ip ?? "",
    userAgent: input.request.get("user-agent") ?? "",
    at: new Date(),
  });
}

export async function audit(input: {
  tenantId?: string;
  actorId: string;
  actorAudience: "platform" | "tenant";
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  requestId?: string;
  ip?: string;
}): Promise<void> {
  await col("audit_logs").insertOne({
    _id: id(),
    tenantId: input.tenantId ?? null,
    actorId: input.actorId,
    actorAudience: input.actorAudience,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before ?? null,
    after: input.after ?? null,
    requestId: input.requestId ?? "",
    ip: input.ip ?? "",
    at: new Date(),
  });
}

export async function issueReset(collection: "platform_users" | "users", userId: string): Promise<string> {
  const token = crypto.randomBytes(24).toString("hex");
  await col(collection).updateOne(
    { _id: asId(userId) },
    { $set: { passwordResetHash: hashToken(token), passwordResetExpires: new Date(Date.now() + 30 * 60 * 1000) } },
  );
  if (!config.isProduction) logger.info({ userId }, "password reset token issued");
  return token;
}

export async function consumeReset(collection: "platform_users" | "users", token: string, password: string): Promise<void> {
  const user = await col(collection).findOne({ passwordResetHash: hashToken(token) });
  if (!user || !user.passwordResetExpires || new Date(user.passwordResetExpires).getTime() < Date.now()) {
    throw new HttpError(400, "invalid_reset", "This reset link is invalid.");
  }
  await col(collection).updateOne(
    { _id: user._id },
    {
      $set: { passwordHash: await hashPassword(password), tv: long(num(user.tv) + 1), updatedAt: new Date() },
      $unset: { passwordResetHash: "", passwordResetExpires: "" },
    },
  );
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function readRefresh(request: Request): string {
  const token = request.cookies?.refresh_token;
  if (typeof token !== "string" || token.length < 10) throw new HttpError(401, "invalid_refresh", "Sign in again.");
  return token;
}
