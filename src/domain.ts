import crypto from "node:crypto";
import { col } from "./db";
import { asId, id, idText } from "./ids";
import { HttpError } from "./http";
import { decimalToScaled, long, num, priceLine, recipeConsumption, roundDiv, scaledToDecimal } from "./money";
import { fromBaseQuantity, toBaseQuantity } from "./units";
import { assertBranch, audit, AuthContext } from "./auth";

const OWNER_EXTRA = [
  "settings.business.read",
  "settings.business.write",
  "settings.module.read",
  "settings.module.write",
  "access.role.read",
  "access.role.manage",
];

const PRESET_NAMES = [
  "Business Owner",
  "Business Admin",
  "Manager",
  "Cashier",
  "Inventory Manager",
  "Accountant",
  "Kitchen Staff",
] as const;

export { asId, id, idText } from "./ids";

export async function listRows(collection: string, filter: Record<string, unknown>, limit: number, cursor?: string) {
  const query: Record<string, unknown> = { ...filter };
  if (cursor) query._id = { $gt: asId(cursor) };
  const rows = await col(collection).find(query).sort({ _id: 1 }).limit(limit + 1).toArray();
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  return { page, nextCursor: more ? String(page.at(-1)?._id) : null };
}

export async function tenantOrThrow(tenantId: string) {
  const tenant = await col("tenants").findOne({ _id: asId(tenantId) });
  if (!tenant || tenant.status === "deleted") throw new HttpError(404, "not_found", "Business not found.");
  return tenant;
}

export function moneyOut(value: unknown, scale = 2): string {
  return scaledToDecimal(num(value), scale);
}

async function enabledModuleCodes(tenantId: string): Promise<Set<string>> {
  const rows = await col("tenant_modules").find({ tenantId, enabled: true }).toArray();
  return new Set(rows.map((row) => String(row.moduleCode)));
}

export async function keysForModules(codes: Set<string>): Promise<string[]> {
  const defs = await col("module_definitions").find({ code: { $in: [...codes] } }).toArray();
  const keys = new Set<string>();
  for (const def of defs) {
    for (const permission of def.permissions ?? []) keys.add(String(permission.key));
  }
  return [...keys];
}

function presetAllows(preset: string, key: string): boolean {
  if (preset === "Business Owner" || preset === "Business Admin") return true;
  if (preset === "Manager") return /^(pos\.|report\.sales|inventory\.balance|expense\.read|expense\.write|customer\.)/.test(key);
  if (preset === "Cashier") return ["pos.order.create", "pos.order.hold", "pos.shift.manage"].includes(key);
  if (preset === "Inventory Manager") return key.startsWith("inventory.") || key.startsWith("recipe.");
  if (preset === "Accountant") return key.startsWith("expense.") || key.startsWith("report.");
  if (preset === "Kitchen Staff") return key === "kitchen.status.write";
  return false;
}

export async function syncOwnerKeys(tenantId: string): Promise<void> {
  const codes = await enabledModuleCodes(tenantId);
  const moduleKeys = await keysForModules(codes);
  const all = [...new Set([...moduleKeys, ...OWNER_EXTRA])];
  const roles = await col("roles").find({ tenantId, isSystem: true }).toArray();
  for (const role of roles) {
    const keys = all.filter((key) => presetAllows(String(role.name), key) || (role.name === "Business Owner" && OWNER_EXTRA.includes(key)));
    const unique = [...new Set(keys)];
    await col("roles").updateOne({ _id: role._id }, { $set: { permissionKeys: unique, updatedAt: new Date() } });
  }
}

export async function assertModulesValid(codes: string[]): Promise<void> {
  const defs = await col("module_definitions").find({ status: "active" }).toArray();
  const byCode = new Map(defs.map((def) => [String(def.code), def]));
  const enabled = new Set(codes);
  for (const code of enabled) {
    const def = byCode.get(code);
    if (!def) throw new HttpError(422, "unknown_module", `Unknown module ${code}.`);
    for (const dependency of def.dependencies ?? []) {
      if (!enabled.has(String(dependency))) {
        throw new HttpError(422, "module_dependency", `${code} requires ${dependency}.`);
      }
    }
  }
}

export async function replaceModules(tenantId: string, modules: { code: string; enabled: boolean; settings?: Record<string, unknown> }[], actorId: string) {
  const enabled = modules.filter((module) => module.enabled).map((module) => module.code);
  await assertModulesValid(enabled);
  const now = new Date();
  for (const module of modules) {
    await col("tenant_modules").updateOne(
      { tenantId, moduleCode: module.code },
      {
        $set: { enabled: module.enabled, settings: module.settings ?? {}, assignedBy: actorId, assignedAt: now, updatedAt: now },
        $setOnInsert: { _id: id(), tenantId, moduleCode: module.code, createdAt: now },
      },
      { upsert: true },
    );
  }
  await syncOwnerKeys(tenantId);
}

export async function createTenant(input: {
  name: string;
  legalName: string;
  slug: string;
  ownerEmail: string;
  ownerName: string;
  ownerPasswordHash: string;
  timezone: string;
  currency: string;
  taxMode: "inclusive" | "exclusive";
  stockPolicy: "on_payment" | "on_prepared";
  modules: string[];
  phone?: string;
  gstin?: string;
  actorId: string;
}) {
  await assertModulesValid(input.modules);
  const existing = await col("tenants").findOne({ slug: input.slug });
  if (existing) throw new HttpError(409, "duplicate", "That business slug is already used.");
  let plan = await col("plans").findOne({ code: "custom" });
  const now = new Date();
  if (!plan) {
    plan = {
      _id: id(),
      code: "custom",
      name: "Custom",
      description: "Assigned module set",
      moduleCodes: input.modules,
      limits: { branches: 20, terminals: 20, users: 100 },
      priceMinor: long(0),
      interval: "month",
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await col("plans").insertOne(plan);
  }
  const tenantOid = id();
  const tenantId = tenantOid.toHexString();
  await col("tenants").insertOne({
    _id: tenantOid,
    name: input.name,
    legalName: input.legalName,
    slug: input.slug,
    status: "active",
    ownerEmail: input.ownerEmail,
    phone: input.phone ?? "",
    address: {},
    currency: input.currency,
    minorUnitScale: long(2),
    timezone: input.timezone,
    gstin: input.gstin ?? "",
    taxMode: input.taxMode,
    stockPolicy: input.stockPolicy,
    planId: idText(plan._id),
    createdAt: now,
    updatedAt: now,
  });
  const branchOid = id();
  const branchId = branchOid.toHexString();
  await col("branches").insertOne({
    _id: branchOid,
    tenantId,
    name: "Main",
    code: "MAIN",
    address: {},
    phone: input.phone ?? "",
    timezone: input.timezone,
    status: "active",
    receiptPrefix: "R",
    createdAt: now,
    updatedAt: now,
  });
  const terminalOid = id();
  const terminalId = terminalOid.toHexString();
  await col("terminals").insertOne({
    _id: terminalOid,
    tenantId,
    branchId,
    name: "Counter 1",
    code: "T1",
    status: "active",
    printer: { interface: "browser", width: 32, copies: 1 },
    createdAt: now,
    updatedAt: now,
  });
  for (const preset of PRESET_NAMES) {
    await col("roles").insertOne({
      _id: id(),
      tenantId,
      name: preset,
      presetCode: preset.toLowerCase().replace(/\s+/g, "_"),
      permissionKeys: [],
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  await replaceModules(
    tenantId,
    input.modules.map((code) => ({ code, enabled: true, settings: {} })),
    input.actorId,
  );
  const ownerRole = await col("roles").findOne({ tenantId, name: "Business Owner" });
  const userOid = id();
  const userId = userOid.toHexString();
  await col("users").insertOne({
    _id: userOid,
    tenantId,
    email: input.ownerEmail.toLowerCase(),
    name: input.ownerName,
    phone: input.phone ?? "",
    passwordHash: input.ownerPasswordHash,
    roleId: idText(ownerRole?._id),
    branchIds: [branchId],
    status: "active",
    tv: long(0),
    createdAt: now,
    updatedAt: now,
  });
  await col("tenant_subscriptions").insertOne({
    _id: id(),
    tenantId,
    planId: idText(plan._id),
    status: "active",
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()),
    createdAt: now,
    updatedAt: now,
  });
  return { tenantId, branchId, terminalId, userId };
}

export async function publicTenant(tenant: Record<string, unknown>) {
  const modules = await col("tenant_modules").countDocuments({ tenantId: idText(tenant._id), enabled: true });
  return {
    id: tenant._id,
    name: tenant.name,
    legalName: tenant.legalName,
    slug: tenant.slug,
    status: tenant.status,
    ownerEmail: tenant.ownerEmail,
    phone: tenant.phone,
    currency: tenant.currency,
    timezone: tenant.timezone,
    taxMode: tenant.taxMode,
    stockPolicy: tenant.stockPolicy,
    gstin: tenant.gstin,
    enabledModules: modules,
  };
}

export async function createProduct(auth: AuthContext, input: {
  name: string;
  type: "simple" | "variant" | "recipe" | "service";
  categoryId?: string;
  sku?: string;
  sellingPrice: string;
  taxRate?: string;
  discountRate?: string;
  trackInventory: boolean;
  unitCode?: string;
  description?: string;
  hsnCode?: string;
}) {
  const tenant = await tenantOrThrow(auth.tenantId!);
  const scale = num(tenant.minorUnitScale) || 2;
  const now = new Date();
  let stockItemId: ReturnType<typeof id> | undefined;
  if (input.trackInventory && (input.type === "simple" || input.type === "variant")) {
    const modules = await enabledModuleCodes(auth.tenantId!);
    if (!modules.has("inventory.stock")) throw new HttpError(422, "module_dependency", "Inventory is required to track stock.");
    stockItemId = id();
    await col("stock_items").insertOne({
      _id: stockItemId,
      tenantId: auth.tenantId,
      name: input.name,
      kind: "retail",
      sku: input.sku,
      baseUnit: "milli_each",
      displayUnit: input.unitCode || "piece",
      purchaseCostMinor: long(0),
      minQtyBase: long(0),
      trackExpiry: false,
      trackBatch: false,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }
  const productId = id();
  await col("products").insertOne({
    _id: productId,
    tenantId: auth.tenantId,
    name: input.name,
    description: input.description ?? "",
    categoryId: input.categoryId,
    type: input.type,
    sku: input.sku,
    stockItemId,
    status: "active",
    imageFileIds: [],
    sellingPriceMinor: long(decimalToScaled(input.sellingPrice, scale)),
    discountBps: long(decimalToScaled(input.discountRate ?? "0", 2)),
    taxRateBps: long(decimalToScaled(input.taxRate ?? "0", 2)),
    hsnCode: input.hsnCode ?? "",
    unitCode: input.unitCode ?? "piece",
    trackInventory: input.trackInventory,
    variants: [],
    createdAt: now,
    updatedAt: now,
  });
  return presentProduct(await col("products").findOne({ _id: productId }), scale);
}

export function presentProduct(product: Record<string, unknown> | null, scale = 2) {
  if (!product) return null;
  return {
    id: product._id,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId ?? null,
    type: product.type,
    sku: product.sku ?? null,
    stockItemId: product.stockItemId ?? null,
    status: product.status,
    sellingPrice: moneyOut(product.sellingPriceMinor, scale),
    discountRate: moneyOut(product.discountBps, 2),
    taxRate: moneyOut(product.taxRateBps, 2),
    hsnCode: product.hsnCode ?? "",
    unitCode: product.unitCode,
    trackInventory: product.trackInventory,
    variants: product.variants ?? [],
  };
}

export async function postMovement(input: {
  tenantId: string;
  branchId: string;
  stockItemId: string;
  type: string;
  qtyBase: number;
  idempotencyKey: string;
  orderId?: string;
  orderLineId?: string;
  purchaseId?: string;
  recipeId?: string;
  unitCostMinor?: number;
  reason?: string;
  allowNegative?: boolean;
  createdBy?: string;
  terminalId?: string;
}) {
  const movementId = id();
  try {
    await col("stock_movements").insertOne({
      _id: movementId,
      tenantId: input.tenantId,
      branchId: input.branchId,
      stockItemId: input.stockItemId,
      type: input.type,
      qtyBase: long(input.qtyBase),
      unitCostMinor: long(input.unitCostMinor ?? 0),
      orderId: input.orderId,
      orderLineId: input.orderLineId,
      purchaseId: input.purchaseId,
      recipeId: input.recipeId,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason ?? "",
      occurredAt: new Date(),
      createdBy: input.createdBy,
      createdAt: new Date(),
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return { duplicate: true as const };
    throw error;
  }
  const filter: Record<string, unknown> = {
    tenantId: input.tenantId,
    branchId: input.branchId,
    stockItemId: input.stockItemId,
  };
  const upsert = input.qtyBase > 0 || Boolean(input.allowNegative);
  if (!input.allowNegative && input.qtyBase < 0) filter.onHandBase = { $gte: long(-input.qtyBase) };
  const updated = await col("inventory_balances").findOneAndUpdate(
    filter,
    {
      $inc: { onHandBase: long(input.qtyBase), version: long(1) },
      $set: { updatedAt: new Date() },
      $setOnInsert: { _id: id(), reservedBase: long(0), createdAt: new Date() },
    },
    { returnDocument: "after", upsert },
  );
  if (!updated) {
    await col("stock_movements").deleteOne({ _id: movementId });
    throw new HttpError(422, "insufficient_stock", "Not enough stock for this sale.");
  }
  const onHand = num((updated as { onHandBase?: unknown }).onHandBase);
  if (input.allowNegative && onHand < 0) {
    await col("sync_conflicts").insertOne({
      _id: id(),
      tenantId: input.tenantId,
      terminalId: input.terminalId ?? "server",
      kind: "oversell",
      entityType: "stock_item",
      entityId: input.stockItemId,
      onHandBase: long(onHand),
      details: { orderId: input.orderId ?? null },
      status: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  return { duplicate: false as const, onHand };
}

async function saleDeltas(tenantId: string, lines: Array<Record<string, unknown>>) {
  const deltas: Array<{ stockItemId: string; qtyBase: number; orderLineId: string; recipeId?: string; unitCostMinor: number }> = [];
  for (const line of lines) {
    const product = await col("products").findOne({ _id: asId(line.productId), tenantId });
    if (!product || product.type === "service" || product.trackInventory === false) continue;
    if (product.type === "recipe") {
      const recipe = await col("recipes").findOne({ tenantId, productId: idText(product._id), status: "active", variantId: line.variantId ?? null });
      const fallback = recipe ?? await col("recipes").findOne({ tenantId, productId: idText(product._id), status: "active" });
      if (!fallback) throw new HttpError(422, "recipe_missing", `No active recipe for ${product.name}.`);
      let lineCost = 0;
      for (const recipeLine of fallback.lines ?? []) {
        const consumed = recipeConsumption(num(recipeLine.qtyBase), num(line.qtyMilli), num(recipeLine.wastageBps));
        const stock = await col("stock_items").findOne({ _id: asId(recipeLine.stockItemId), tenantId });
        const cost = ingredientCost(consumed, stock);
        lineCost += cost;
        deltas.push({
          stockItemId: String(recipeLine.stockItemId),
          qtyBase: -consumed,
          orderLineId: String(line.id),
          recipeId: String(fallback._id),
          unitCostMinor: cost,
        });
      }
      line.lineCostMinor = lineCost;
      line.recipeId = fallback._id;
      line.recipeVersion = num(fallback.version);
    } else if (product.stockItemId) {
      const qty = num(line.qtyMilli);
      const stock = await col("stock_items").findOne({ _id: asId(product.stockItemId), tenantId });
      const cost = ingredientCost(qty, stock);
      line.lineCostMinor = cost;
      deltas.push({
        stockItemId: String(product.stockItemId),
        qtyBase: -qty,
        orderLineId: String(line.id),
        unitCostMinor: cost,
      });
    }
  }
  return deltas;
}

function ingredientCost(qtyBase: number, stock: Record<string, unknown> | null): number {
  if (!stock) return 0;
  const perDisplay = num(stock.purchaseCostMinor);
  const display = String(stock.displayUnit || "piece");
  const base = String(stock.baseUnit || "milli_each") as "mg" | "ml" | "milli_each";
  const one = toBaseQuantity("1", display, base);
  if (one === 0) return 0;
  return Number(roundDiv(BigInt(perDisplay) * BigInt(Math.abs(qtyBase)), BigInt(one)));
}

export async function buildOrderLines(auth: AuthContext, requested: Array<{ productId: string; variantId?: string | null; qty: string }>) {
  const tenant = await tenantOrThrow(auth.tenantId!);
  const scale = num(tenant.minorUnitScale) || 2;
  const lines = [];
  for (const item of requested) {
    const product = await col("products").findOne({ _id: asId(item.productId), tenantId: auth.tenantId, status: "active" });
    if (!product) throw new HttpError(404, "not_found", "Product not found.");
    const qtyMilli = decimalToScaled(item.qty, 3);
    if (qtyMilli <= 0) throw new HttpError(400, "validation_failed", "Quantity must be greater than zero.");
    const priced = priceLine({
      qtyMilli,
      unitPriceMinor: num(product.sellingPriceMinor),
      discountBps: num(product.discountBps),
      taxRateBps: num(product.taxRateBps),
      taxMode: tenant.taxMode === "inclusive" ? "inclusive" : "exclusive",
    });
    lines.push({
      id: id(),
      productId: product._id,
      variantId: item.variantId ?? null,
      name: product.name,
      qtyMilli: priced.qtyMilli,
      unitPriceMinor: priced.unitPriceMinor,
      discountMinor: priced.discountMinor,
      taxMinor: priced.taxMinor,
      extendedMinor: priced.extendedMinor,
      netMinor: priced.netMinor,
      lineCostMinor: 0,
      recipeId: null,
      recipeVersion: null,
    });
  }
  const subtotal = lines.reduce((sum, line) => sum + line.extendedMinor, 0);
  const discount = lines.reduce((sum, line) => sum + line.discountMinor, 0);
  const tax = lines.reduce((sum, line) => sum + line.taxMinor, 0);
  const total = tenant.taxMode === "inclusive" ? subtotal - discount : subtotal - discount + tax;
  return { lines, subtotal, discount, tax, total, scale, taxMode: tenant.taxMode, stockPolicy: tenant.stockPolicy };
}

export function presentOrder(order: Record<string, unknown>, scale = 2) {
  return {
    id: order._id,
    branchId: order.branchId,
    terminalId: order.terminalId ?? null,
    shiftId: order.shiftId ?? null,
    receiptNumber: order.receiptNumber ?? null,
    offlineReceiptRef: order.offlineReceiptRef ?? null,
    status: order.status,
    kitchenStatus: order.kitchenStatus ?? null,
    orderType: order.orderType,
    subtotal: moneyOut(order.subtotalMinor, scale),
    discount: moneyOut(order.discountMinor, scale),
    tax: moneyOut(order.taxMinor, scale),
    total: moneyOut(order.totalMinor, scale),
    taxMode: order.taxMode,
    lines: ((order.lines as Array<Record<string, unknown>>) ?? []).map((line) => ({
      id: line.id,
      productId: line.productId,
      name: line.name,
      qty: scaledToDecimal(num(line.qtyMilli), 3),
      unitPrice: moneyOut(line.unitPriceMinor, scale),
      discount: moneyOut(line.discountMinor, scale),
      tax: moneyOut(line.taxMinor, scale),
      lineCost: moneyOut(line.lineCostMinor, scale),
    })),
  };
}

export async function createPosOrder(auth: AuthContext, input: {
  branchId: string;
  terminalId?: string;
  shiftId?: string;
  orderType: "counter" | "dine_in" | "takeaway" | "delivery" | "online";
  lines: Array<{ productId: string; variantId?: string | null; qty: string }>;
  idempotencyKey: string;
  allowNegative?: boolean;
  offlineReceiptRef?: string;
}) {
  assertBranch(auth, input.branchId);
  const hash = crypto.createHash("sha256").update(JSON.stringify({
    branchId: input.branchId,
    lines: input.lines,
    orderType: input.orderType,
  })).digest("hex");
  const existing = await col("orders").findOne({ tenantId: auth.tenantId, idempotencyKey: input.idempotencyKey });
  if (existing) {
    if (existing.requestHash !== hash) throw new HttpError(409, "idempotency_conflict", "This idempotency key was used for a different sale.");
    const tenant = await tenantOrThrow(auth.tenantId!);
    return presentOrder(existing, num(tenant.minorUnitScale) || 2);
  }
  const priced = await buildOrderLines(auth, input.lines);
  const now = new Date();
  const order = {
    _id: id(),
    tenantId: auth.tenantId,
    branchId: input.branchId,
    terminalId: input.terminalId,
    shiftId: input.shiftId,
    status: "open",
    orderType: input.orderType,
    lines: priced.lines,
    subtotalMinor: long(priced.subtotal),
    discountMinor: long(priced.discount),
    taxMinor: long(priced.tax),
    totalMinor: long(priced.total),
    taxMode: priced.taxMode,
    idempotencyKey: input.idempotencyKey,
    requestHash: hash,
    offlineReceiptRef: input.offlineReceiptRef,
    stockPosted: false,
    allowNegative: Boolean(input.allowNegative),
    createdAt: now,
    updatedAt: now,
  };
  await col("orders").insertOne(order);
  return presentOrder(order, priced.scale);
}

export async function captureCashPayment(auth: AuthContext, orderId: string, input: { amount: string; idempotencyKey: string; allowNegative?: boolean }) {
  const tenant = await tenantOrThrow(auth.tenantId!);
  const scale = num(tenant.minorUnitScale) || 2;
  const order = await col("orders").findOne({ _id: asId(orderId), tenantId: auth.tenantId });
  if (!order) throw new HttpError(404, "not_found", "Order not found.");
  assertBranch(auth, String(order.branchId));
  const existing = await col("payments").findOne({ tenantId: auth.tenantId, idempotencyKey: input.idempotencyKey });
  if (existing) return { order: presentOrder(await col("orders").findOne({ _id: asId(orderId) }) as Record<string, unknown>, scale), duplicate: true };
  const amount = decimalToScaled(input.amount, scale);
  if (amount !== num(order.totalMinor)) throw new HttpError(422, "payment_mismatch", "Cash tender must equal the order total in this version.");
  let stockPosted = Boolean(order.stockPosted);
  if (!stockPosted && tenant.stockPolicy !== "on_prepared") {
    await postOrderStock(auth, order, Boolean(input.allowNegative ?? order.allowNegative));
    stockPosted = true;
  }
  await col("payments").insertOne({
    _id: id(),
    tenantId: auth.tenantId,
    orderId,
    method: "cash",
    status: "captured",
    amountMinor: long(amount),
    idempotencyKey: input.idempotencyKey,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const receiptNumber = order.receiptNumber ?? await nextReceipt(auth.tenantId!, String(order.branchId));
  await col("orders").updateOne(
    { _id: asId(orderId) },
    { $set: { status: "completed", paidAt: new Date(), receiptNumber, stockPosted, updatedAt: new Date() } },
  );
  const fresh = await col("orders").findOne({ _id: asId(orderId) });
  return { order: presentOrder(fresh as Record<string, unknown>, scale), duplicate: false };
}

async function postOrderStock(auth: AuthContext, order: Record<string, unknown>, allowNegative: boolean) {
  const lines = (order.lines as Array<Record<string, unknown>>) ?? [];
  const deltas = await saleDeltas(auth.tenantId!, lines);
  for (const delta of deltas) {
    await postMovement({
      tenantId: auth.tenantId!,
      branchId: String(order.branchId),
      stockItemId: delta.stockItemId,
      type: delta.recipeId ? "recipe_consumption" : "sale",
      qtyBase: delta.qtyBase,
      idempotencyKey: `${order._id}:${delta.orderLineId}:${delta.stockItemId}`,
      orderId: String(order._id),
      orderLineId: delta.orderLineId,
      recipeId: delta.recipeId,
      unitCostMinor: delta.unitCostMinor,
      allowNegative,
      createdBy: auth.userId,
      terminalId: order.terminalId ? String(order.terminalId) : undefined,
    });
  }
  const lineCost = new Map<string, number>();
  for (const delta of deltas) lineCost.set(delta.orderLineId, (lineCost.get(delta.orderLineId) ?? 0) + delta.unitCostMinor);
  const nextLines = lines.map((line) => ({ ...line, lineCostMinor: lineCost.get(String(line.id)) ?? num(line.lineCostMinor) }));
  await col("orders").updateOne({ _id: asId(order._id) }, { $set: { lines: nextLines, stockPosted: true } });
}

async function nextReceipt(tenantId: string, branchId: string): Promise<string> {
  const branch = await col("branches").findOne({ _id: asId(branchId), tenantId });
  const key = `${tenantId}:${branchId}:receipt`;
  const updated = await col("sequences").findOneAndUpdate(
    { key },
    { $inc: { value: long(1) }, $setOnInsert: { _id: id() } },
    { upsert: true, returnDocument: "after" },
  );
  const value = num((updated as { value?: unknown } | null)?.value || 1);
  return `${branch?.receiptPrefix ?? "R"}-${value}`;
}

export async function adjustStock(auth: AuthContext, branchId: string, input: {
  stockItemId: string;
  quantity: string;
  unit: string;
  direction: "in" | "out";
  reason: string;
  idempotencyKey: string;
  unitCost?: string;
}) {
  assertBranch(auth, branchId);
  const stock = await col("stock_items").findOne({ _id: asId(input.stockItemId), tenantId: auth.tenantId });
  if (!stock) throw new HttpError(404, "not_found", "Stock item not found.");
  const qty = toBaseQuantity(input.quantity, input.unit, stock.baseUnit);
  const signed = input.direction === "out" ? -qty : qty;
  if (input.unitCost && input.direction === "in") {
    const tenant = await tenantOrThrow(auth.tenantId!);
    await col("stock_items").updateOne(
      { _id: stock._id },
      { $set: { purchaseCostMinor: long(decimalToScaled(input.unitCost, num(tenant.minorUnitScale) || 2)), updatedAt: new Date() } },
    );
  }
  await postMovement({
    tenantId: auth.tenantId!,
    branchId,
    stockItemId: String(stock._id),
    type: "adjustment",
    qtyBase: signed,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    allowNegative: input.direction === "in",
    createdBy: auth.userId,
  });
  await audit({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    actorAudience: "tenant",
    action: "stock.adjust",
    entityType: "stock_item",
    entityId: String(stock._id),
    after: { quantity: input.quantity, unit: input.unit, direction: input.direction },
  });
}

export async function createRecipe(auth: AuthContext, productId: string, input: {
  lines: Array<{ stockItemId: string; quantity: string; unit: string; wastagePercent?: string }>;
}) {
  const product = await col("products").findOne({ _id: asId(productId), tenantId: auth.tenantId });
  if (!product) throw new HttpError(404, "not_found", "Product not found.");
  const lines = [];
  for (const line of input.lines) {
    const stock = await col("stock_items").findOne({ _id: asId(line.stockItemId), tenantId: auth.tenantId });
    if (!stock) throw new HttpError(404, "not_found", "Ingredient not found.");
    lines.push({
      stockItemId: stock._id,
      qtyBase: long(toBaseQuantity(line.quantity, line.unit, stock.baseUnit)),
      wastageBps: long(decimalToScaled(line.wastagePercent ?? "0", 2)),
      substitutes: [],
    });
  }
  const now = new Date();
  await col("recipes").updateMany({ tenantId: auth.tenantId, productId, status: "active" }, { $set: { status: "archived", updatedAt: now } });
  const recipeId = id();
  await col("recipes").insertOne({
    _id: recipeId,
    tenantId: auth.tenantId,
    productId,
    variantId: null,
    version: long(1),
    yieldQty: long(1),
    status: "active",
    lines,
    notes: "",
    createdAt: now,
    updatedAt: now,
  });
  if (product.type !== "recipe") {
    await col("products").updateOne({ _id: asId(productId) }, { $set: { type: "recipe", trackInventory: true, updatedAt: now } });
  }
  return { id: recipeId };
}

export function presentBalance(balance: Record<string, unknown>, stock: Record<string, unknown>) {
  const base = String(stock.baseUnit) as "mg" | "ml" | "milli_each";
  return {
    stockItemId: stock._id,
    name: stock.name,
    baseUnit: stock.baseUnit,
    displayUnit: stock.displayUnit,
    onHand: fromBaseQuantity(num(balance.onHandBase), base, String(stock.displayUnit)),
    onHandBase: num(balance.onHandBase),
  };
}

export async function salesSummary(auth: AuthContext, from: Date, to: Date, branchId?: string) {
  const filter: Record<string, unknown> = {
    tenantId: auth.tenantId,
    status: { $in: ["paid", "completed", "refunded"] },
    createdAt: { $gte: from, $lte: to },
  };
  if (branchId) {
    assertBranch(auth, branchId);
    filter.branchId = branchId;
  }
  const orders = await col("orders").find(filter).toArray();
  const tenant = await tenantOrThrow(auth.tenantId!);
  const scale = num(tenant.minorUnitScale) || 2;
  let gross = 0;
  let discounts = 0;
  let tax = 0;
  let net = 0;
  let cogs = 0;
  const byMethod: Record<string, number> = { cash: 0, upi: 0, card: 0, razorpay: 0 };
  for (const order of orders) {
    gross += num(order.subtotalMinor);
    discounts += num(order.discountMinor);
    tax += num(order.taxMinor);
    for (const line of order.lines ?? []) {
      net += num(line.netMinor);
      cogs += num(line.lineCostMinor);
    }
  }
  const payments = await col("payments").find({ tenantId: auth.tenantId, orderId: { $in: orders.map((order) => idText(order._id)) }, status: "captured" }).toArray();
  for (const payment of payments) {
    const method = String(payment.method);
    byMethod[method] = (byMethod[method] ?? 0) + num(payment.amountMinor);
  }
  const refunds = await col("refunds").find({ tenantId: auth.tenantId, orderId: { $in: orders.map((order) => idText(order._id)) }, status: "completed" }).toArray();
  const refundTotal = refunds.reduce((sum, refund) => sum + num(refund.amountMinor), 0);
  const expenses = await col("expenses").find({
    tenantId: auth.tenantId,
    status: "approved",
    spentAt: { $gte: from, $lte: to },
  }).toArray();
  let operating = 0;
  for (const expense of expenses) {
    const category = await col("expense_categories").findOne({ _id: asId(expense.categoryId) });
    if (!category || category.kind === "operating") operating += num(expense.amountMinor);
  }
  const netSales = net - refundTotal;
  const grossProfit = netSales - cogs;
  return {
    orders: orders.length,
    grossSales: moneyOut(gross, scale),
    discounts: moneyOut(discounts, scale),
    taxCollected: moneyOut(tax, scale),
    refunds: moneyOut(refundTotal, scale),
    netSalesExTax: moneyOut(netSales, scale),
    cogs: moneyOut(cogs, scale),
    grossProfit: moneyOut(grossProfit, scale),
    operatingExpenses: moneyOut(operating, scale),
    operatingProfitEstimate: moneyOut(grossProfit - operating, scale),
    averageOrderValue: moneyOut(orders.length ? Math.round((gross - discounts) / orders.length) : 0, scale),
    payments: Object.fromEntries(Object.entries(byMethod).map(([method, amount]) => [method, moneyOut(amount, scale)])),
  };
}
