import { checkPassword, hashPassword } from "./auth";
import { config } from "./config";
import { col } from "./db";
import { createTenant, id } from "./domain";
import { assertLocalDatabase } from "./local-db";
import { ObjectId } from "mongodb";
import { long } from "./money";
import { asId, idText } from "./ids";

export const SUPER_ADMIN_EMAIL = process.env.SEED_PLATFORM_EMAIL ?? "admin@pos.local";
export const SUPER_ADMIN_PASSWORD = process.env.SEED_PLATFORM_PASSWORD ?? "PosAdmin#2026";
export const BUSINESS_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "owner@morning.cafe";
export const BUSINESS_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "CafeOwner#2026";
export const BUSINESS_SLUG = process.env.SEED_ADMIN_SLUG ?? "morning-cafe";

const SUPER_ADMIN_ROLE_ID = new ObjectId("000000000000000000000333");
const SUPER_ADMIN_USER_ID = new ObjectId("000000000000000000000334");

const TEST_MODULES = [
  "pos.billing", "catalog.products", "catalog.barcode", "inventory.stock", "inventory.purchase",
  "inventory.supplier", "recipe.management", "expense.management", "employee.management",
  "customer.management", "reports.sales", "reports.finance", "tax.gst",
];

export function assertSeedDatabase(): void {
  assertLocalDatabase();
}

async function setPassword(collection: "platform_users" | "users", user: Record<string, unknown>, password: string): Promise<"created" | "reset" | "unchanged"> {
  if (await checkPassword(String(user.passwordHash), password)) return "unchanged";
  await col(collection).updateOne(
    { _id: asId(user._id) },
    { $set: { passwordHash: await hashPassword(password), status: "active", updatedAt: new Date() }, $inc: { tv: long(1) } },
  );
  return "reset";
}

export async function ensureSuperAdmin(): Promise<"created" | "reset" | "unchanged"> {
  await col("platform_roles").updateOne(
    { code: "super_admin" },
    {
      $setOnInsert: {
        _id: SUPER_ADMIN_ROLE_ID,
        code: "super_admin",
        name: "Super Admin",
        permissionKeys: [
          "platform.tenant.read", "platform.tenant.write", "platform.tenant.status",
          "platform.module.read", "platform.module.write", "platform.module.assign",
          "platform.plan.read", "platform.plan.write", "platform.user.read", "platform.user.write",
          "platform.integration.read", "platform.integration.write", "platform.settings.read",
          "platform.settings.write", "platform.audit.read",
        ],
      },
    },
    { upsert: true },
  );
  const role = await col("platform_roles").findOne({ code: "super_admin" });
  const existing = await col("platform_users").findOne({ email: SUPER_ADMIN_EMAIL });
  if (existing) return setPassword("platform_users", existing, SUPER_ADMIN_PASSWORD);
  await col("platform_users").insertOne({
    _id: SUPER_ADMIN_USER_ID,
    email: SUPER_ADMIN_EMAIL,
    name: "Platform Admin",
    passwordHash: await hashPassword(SUPER_ADMIN_PASSWORD),
    roleId: idText(role?._id),
    status: "active",
    tv: long(0),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return "created";
}

export async function ensureBusinessAdmin(): Promise<"created" | "reset" | "unchanged"> {
  const passwordHash = await hashPassword(BUSINESS_ADMIN_PASSWORD);
  let tenant = await col("tenants").findOne({ slug: BUSINESS_SLUG });
  if (!tenant) {
    await createTenant({
      name: "Morning Cafe",
      legalName: "Morning Cafe",
      slug: BUSINESS_SLUG,
      ownerEmail: BUSINESS_ADMIN_EMAIL,
      ownerName: "Asha",
      ownerPasswordHash: passwordHash,
      timezone: "Asia/Kolkata",
      currency: "INR",
      taxMode: "exclusive",
      stockPolicy: "on_payment",
      modules: TEST_MODULES,
      actorId: "seed",
    });
    return "created";
  }
  const existing = await col("users").findOne({ tenantId: idText(tenant._id), email: BUSINESS_ADMIN_EMAIL.toLowerCase() });
  if (existing) return setPassword("users", existing, BUSINESS_ADMIN_PASSWORD);
  const role = await col("roles").findOne({ tenantId: idText(tenant._id), name: "Business Owner" });
  const branch = await col("branches").findOne({ tenantId: idText(tenant._id) });
  await col("users").insertOne({
    _id: id(),
    tenantId: idText(tenant._id),
    email: BUSINESS_ADMIN_EMAIL.toLowerCase(),
    name: "Asha",
    phone: "",
    passwordHash,
    roleId: idText(role?._id),
    branchIds: branch ? [idText(branch._id)] : [],
    status: "active",
    tv: long(0),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return "created";
}

export function printAccounts(superAdmin: string, businessAdmin: string): void {
  console.log(`Local database ${config.mongoUri}/${config.mongoDb}`);
  console.log(`Super admin ${superAdmin}: ${SUPER_ADMIN_EMAIL} / ${SUPER_ADMIN_PASSWORD}`);
  console.log(`Business admin ${businessAdmin}: slug ${BUSINESS_SLUG}, ${BUSINESS_ADMIN_EMAIL} / ${BUSINESS_ADMIN_PASSWORD}`);
}
