import { createRequire } from "node:module";
import { afterAll, beforeAll, expect, it } from "vitest";
import request from "supertest";
import { hashPassword } from "../src/auth";
import { app } from "../src/app";
import { closeDb, connectDb, getDb } from "../src/db";
import { ObjectId } from "mongodb";
import { long } from "../src/money";

const nodeRequire = createRequire(__filename);
const PLATFORM_EMAIL = "admin@pos.local";
const PLATFORM_PASSWORD = "PosAdmin#2026";

async function loginPlatform() {
  const response = await request(app).post("/api/v1/platform/auth/login").send({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

async function loginTenant(email: string, password: string, tenantSlug: string) {
  const response = await request(app).post("/api/v1/admin/auth/login").send({ email, password, tenantSlug });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.data.accessToken as string;
}

beforeAll(async () => {
  await connectDb();
  const db = getDb();
  await nodeRequire("../migrations/20261104194900-create-initial-collections.js").up(db);
  await nodeRequire("../migrations/20261104201000-seed-module-definitions.js").up(db);
  await nodeRequire("../migrations/20261104214500-fix-sparse-unique-indexes.js").up(db);
  const existing = await db.collection("platform_users").findOne({ email: PLATFORM_EMAIL });
  if (!existing) {
    const roleId = new ObjectId("000000000000000000000333");
    await db.collection("platform_roles").updateOne(
      { code: "super_admin" },
      {
        $setOnInsert: {
          _id: roleId,
          code: "super_admin",
          name: "Super Admin",
          permissionKeys: [
            "platform.tenant.read",
            "platform.tenant.write",
            "platform.tenant.status",
            "platform.module.read",
            "platform.module.write",
            "platform.module.assign",
            "platform.plan.read",
            "platform.plan.write",
            "platform.user.read",
            "platform.user.write",
            "platform.integration.read",
            "platform.integration.write",
            "platform.settings.read",
            "platform.settings.write",
            "platform.audit.read",
          ],
        },
      },
      { upsert: true },
    );
    const role = await db.collection("platform_roles").findOne({ code: "super_admin" });
    await db.collection("platform_users").insertOne({
      _id: new ObjectId("000000000000000000000334"),
      email: PLATFORM_EMAIL,
      name: "Platform Admin",
      passwordHash: await hashPassword(PLATFORM_PASSWORD),
      roleId: role?._id instanceof ObjectId ? role._id.toHexString() : role?._id,
      status: "active",
      tv: long(0),
    });
  }
});

afterAll(async () => {
  await closeDb();
});

it("runs the cafe sale path, blocks other tenants, and rejects a disabled module", async () => {
  const platformToken = await loginPlatform();
  const slug = `cafe-${Date.now()}`;
  const created = await request(app)
    .post("/api/v1/platform/tenants")
    .set("Authorization", `Bearer ${platformToken}`)
    .send({
      name: "Morning Cafe",
      legalName: "Morning Cafe",
      slug,
      ownerEmail: `owner-${slug}@cafe.test`,
      ownerName: "Asha",
      ownerPassword: "CafeOwner#2026",
      modules: [
        "pos.billing",
        "catalog.products",
        "catalog.barcode",
        "inventory.stock",
        "inventory.purchase",
        "inventory.supplier",
        "recipe.management",
        "expense.management",
        "employee.management",
        "reports.sales",
        "reports.finance",
        "tax.gst",
      ],
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);

  const ownerToken = await loginTenant(`owner-${slug}@cafe.test`, "CafeOwner#2026", slug);
  const bootstrap = await request(app).get("/api/v1/admin/bootstrap").set("Authorization", `Bearer ${ownerToken}`);
  expect(bootstrap.status).toBe(200);
  const branchId = bootstrap.body.data.branches[0]._id as string;

  const onion = await request(app)
    .post("/api/v1/admin/stock-items")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name: "Onion", kind: "ingredient", baseUnit: "mg", displayUnit: "kg", sku: `onion-${slug}` });
  expect(onion.status, JSON.stringify(onion.body)).toBe(201);

  const stocked = await request(app)
    .post(`/api/v1/admin/branches/${branchId}/adjustments`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .set("Idempotency-Key", `open-${slug}`)
    .send({ stockItemId: onion.body.data._id, quantity: "100", unit: "kg", direction: "in", reason: "opening", unitCost: "40.00" });
  expect(stocked.status, JSON.stringify(stocked.body)).toBe(200);

  const sandwich = await request(app)
    .post("/api/v1/admin/products")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name: "Sandwich", type: "recipe", sku: `sand-${slug}`, sellingPrice: "80.00", taxRate: "5", trackInventory: true, unitCode: "piece" });
  expect(sandwich.status, JSON.stringify(sandwich.body)).toBe(201);

  const recipe = await request(app)
    .post(`/api/v1/admin/products/${sandwich.body.data.id}/recipes`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ lines: [{ stockItemId: onion.body.data._id, quantity: "100", unit: "g", wastagePercent: "0" }] });
  expect(recipe.status, JSON.stringify(recipe.body)).toBe(201);

  const pos = await request(app).post("/api/v1/pos/auth/login").send({ email: `owner-${slug}@cafe.test`, password: "CafeOwner#2026", tenantSlug: slug });
  expect(pos.status).toBe(200);
  const posToken = pos.body.data.accessToken as string;
  const posBoot = await request(app).get("/api/v1/pos/bootstrap").set("Authorization", `Bearer ${posToken}`);
  const terminalId = posBoot.body.data.terminals[0]._id as string;
  const shift = await request(app)
    .post("/api/v1/pos/shifts")
    .set("Authorization", `Bearer ${posToken}`)
    .send({ branchId, terminalId, openingCash: "0.00" });
  expect(shift.status).toBe(201);

  const order = await request(app)
    .post("/api/v1/pos/orders")
    .set("Authorization", `Bearer ${posToken}`)
    .set("Idempotency-Key", `sale-${slug}`)
    .send({ branchId, terminalId, shiftId: shift.body.data._id, lines: [{ productId: sandwich.body.data.id, qty: "1" }] });
  expect(order.status, JSON.stringify(order.body)).toBe(201);
  expect(order.body.data.total).toBe("84.00");

  const paid = await request(app)
    .post(`/api/v1/pos/orders/${order.body.data.id}/payments`)
    .set("Authorization", `Bearer ${posToken}`)
    .set("Idempotency-Key", `pay-${slug}`)
    .send({ amount: order.body.data.total, method: "cash" });
  expect(paid.status, JSON.stringify(paid.body)).toBe(201);

  const replay = await request(app)
    .post(`/api/v1/pos/orders/${order.body.data.id}/payments`)
    .set("Authorization", `Bearer ${posToken}`)
    .set("Idempotency-Key", `pay-${slug}`)
    .send({ amount: order.body.data.total, method: "cash" });
  expect(replay.status).toBe(200);

  const balances = await request(app)
    .get(`/api/v1/admin/branches/${branchId}/balances`)
    .set("Authorization", `Bearer ${ownerToken}`);
  expect(balances.status).toBe(200);
  expect(balances.body.data[0].onHandBase).toBe(99_900_000);

  const category = await request(app)
    .post("/api/v1/admin/expense-categories")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name: `Maintenance ${slug}`, kind: "operating" });
  const expense = await request(app)
    .post("/api/v1/admin/expenses")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ branchId, categoryId: category.body.data._id, title: "Cleaning materials", amount: "500.00", paidBy: "cash", description: "Purchased cleaning materials" });
  expect(expense.status, JSON.stringify(expense.body)).toBe(201);

  const summary = await request(app)
    .get("/api/v1/admin/reports/sales-summary?range=today")
    .set("Authorization", `Bearer ${ownerToken}`);
  expect(summary.status).toBe(200);
  expect(summary.body.data.orders).toBe(1);
  expect(summary.body.data.grossProfit).toBe("76.00");

  const exported = await request(app)
    .post("/api/v1/admin/reports/exports")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ report: "sales-summary", format: "csv", filters: {} });
  expect(exported.status).toBe(200);
  expect(exported.text).toContain("grossProfit");

  const other = await request(app)
    .post("/api/v1/platform/tenants")
    .set("Authorization", `Bearer ${platformToken}`)
    .send({
      name: "Other Shop",
      legalName: "Other Shop",
      slug: `shop-${slug}`,
      ownerEmail: `owner-${slug}@shop.test`,
      ownerName: "Ravi",
      ownerPassword: "ShopOwner#2026",
      modules: ["pos.billing", "catalog.products"],
    });
  expect(other.status).toBe(201);
  const otherToken = await loginTenant(`owner-${slug}@shop.test`, "ShopOwner#2026", `shop-${slug}`);
  const hidden = await request(app).get(`/api/v1/admin/products/${sandwich.body.data.id}`).set("Authorization", `Bearer ${otherToken}`);
  expect(hidden.status).toBe(404);
  const denied = await request(app)
    .post(`/api/v1/admin/products/${sandwich.body.data.id}/recipes`)
    .set("Authorization", `Bearer ${otherToken}`)
    .send({ lines: [{ stockItemId: onion.body.data._id, quantity: "1", unit: "g" }] });
  expect(denied.status).toBe(403);
  expect(denied.body.error.code).toBe("module_disabled");
});
