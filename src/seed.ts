import { hashPassword, type AuthContext } from "./auth";
import { connectDb, closeDb, col } from "./db";
import { adjustStock, createProduct, createRecipe, id } from "./domain";
import { long } from "./money";
import { idText } from "./ids";
import { assertSeedDatabase, BUSINESS_ADMIN_EMAIL, ensureBusinessAdmin, ensureSuperAdmin, printAccounts } from "./seed-accounts";

assertSeedDatabase();

async function ensureCafe() {
  const tenant = await col("tenants").findOne({ slug: "morning-cafe" });
  if (!tenant) return;
  const cashierRole = await col("roles").findOne({ tenantId: idText(tenant._id), name: "Cashier" });
  const branch = await col("branches").findOne({ tenantId: idText(tenant._id) });
  if (!branch) return;
  const cashier = await col("users").findOne({ tenantId: idText(tenant._id), email: "cashier@morning.cafe" });
  if (!cashier && cashierRole) {
    await col("users").insertOne({
      _id: id(),
      tenantId: idText(tenant._id),
      email: "cashier@morning.cafe",
      name: "Rahul",
      phone: "",
      passwordHash: await hashPassword("Cashier#2026"),
      roleId: idText(cashierRole._id),
      branchIds: [idText(branch._id)],
      status: "active",
      tv: long(0),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  const existingOnion = await col("stock_items").findOne({ tenantId: idText(tenant._id), sku: "ONION" });
  if (existingOnion) return;
  const owner = await col("users").findOne({ tenantId: idText(tenant._id), email: BUSINESS_ADMIN_EMAIL });
  const auth: AuthContext = {
    userId: String(owner?._id ?? "seed"),
    aud: "tenant",
    sessionId: "seed",
    tv: 0,
    tenantId: String(idText(tenant._id)),
    roleId: String(owner?.roleId ?? ""),
    branchIds: [String(branch._id)],
    permissions: [],
    email: BUSINESS_ADMIN_EMAIL,
    name: "Asha",
  };
  const onion = await col("stock_items").insertOne({
    _id: id(),
    tenantId: idText(tenant._id),
    name: "Onion",
    kind: "ingredient",
    sku: "ONION",
    baseUnit: "mg",
    displayUnit: "kg",
    purchaseCostMinor: long(0),
    minQtyBase: long(0),
    trackExpiry: false,
    trackBatch: false,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await adjustStock(auth, String(branch._id), {
    stockItemId: String(onion.insertedId),
    quantity: "100",
    unit: "kg",
    direction: "in",
    reason: "Opening stock",
    idempotencyKey: "seed-onion",
    unitCost: "40.00",
  });
  const product = await createProduct(auth, {
    name: "Sandwich",
    type: "recipe",
    sku: "SANDWICH",
    sellingPrice: "80.00",
    taxRate: "5",
    trackInventory: true,
    unitCode: "piece",
    description: "Cafe sandwich",
  });
  await createRecipe(auth, String(product?.id), {
    lines: [{ stockItemId: String(onion.insertedId), quantity: "100", unit: "g", wastagePercent: "0" }],
  });
  const category = await col("categories").findOne({ tenantId: idText(tenant._id), name: "Food" });
  if (!category) {
    await col("categories").insertOne({
      _id: id(),
      tenantId: idText(tenant._id),
      name: "Food",
      sortOrder: long(1),
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

connectDb().then(async () => {
  const superAdmin = await ensureSuperAdmin();
  const businessAdmin = await ensureBusinessAdmin();
  await ensureCafe();
  printAccounts(superAdmin, businessAdmin);
  console.log("Cashier: cashier@morning.cafe / Cashier#2026");
  await closeDb();
  process.exit(0);
}).catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
