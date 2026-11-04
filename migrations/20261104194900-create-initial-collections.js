/**
 * Initial schema for pos-db.
 * Collections and indexes follow docs/DATABASE.md.
 * Down drops these collections. It does not drop schema_migrations.
 */

const { ObjectId } = require("mongodb");

const stringId = { bsonType: "string" };
const objectId = { bsonType: "objectId" };
const date = { bsonType: "date" };
const int64 = { bsonType: ["int", "long"] };

function schema(required, properties) {
  return {
    bsonType: "object",
    required: ["_id", ...required],
    properties: { _id: objectId, ...properties },
  };
}

const collections = [
  {
    name: "platform_users",
    schema: schema(["email", "name", "passwordHash", "roleId", "status", "tv"], {
      email: stringId,
      name: stringId,
      passwordHash: stringId,
      roleId: stringId,
      status: { enum: ["active", "disabled"] },
      tv: int64,
    }),
    indexes: [[{ email: 1 }, { unique: true, name: "email_unique" }]],
  },
  {
    name: "platform_roles",
    schema: schema(["code", "name", "permissionKeys"], {
      code: stringId,
      name: stringId,
      permissionKeys: { bsonType: "array" },
    }),
    indexes: [[{ code: 1 }, { unique: true, name: "code_unique" }]],
  },
  {
    name: "platform_sessions",
    schema: schema(["userId", "refreshTokenHash", "familyId", "expiresAt"], {
      userId: stringId,
      refreshTokenHash: stringId,
      familyId: stringId,
      expiresAt: date,
    }),
    indexes: [
      [{ refreshTokenHash: 1 }, { unique: true, name: "refresh_token_hash_unique" }],
      [{ familyId: 1 }, { name: "family_id" }],
      [{ userId: 1 }, { name: "user_id" }],
    ],
  },
  {
    name: "tenants",
    schema: schema(
      ["name", "legalName", "slug", "status", "currency", "minorUnitScale", "timezone", "taxMode", "stockPolicy"],
      {
        name: stringId,
        legalName: stringId,
        slug: stringId,
        status: { enum: ["active", "inactive", "suspended", "deleted"] },
        currency: stringId,
        minorUnitScale: int64,
        timezone: stringId,
        taxMode: { enum: ["inclusive", "exclusive"] },
        stockPolicy: { enum: ["on_payment", "on_prepared"] },
      },
    ),
    indexes: [
      [{ slug: 1 }, { unique: true, name: "slug_unique" }],
      [{ status: 1 }, { name: "status" }],
    ],
  },
  {
    name: "plans",
    schema: schema(["code", "name", "moduleCodes", "status"], {
      code: stringId,
      name: stringId,
      moduleCodes: { bsonType: "array" },
      status: stringId,
    }),
    indexes: [[{ code: 1 }, { unique: true, name: "code_unique" }]],
  },
  {
    name: "tenant_subscriptions",
    schema: schema(["tenantId", "planId", "status"], {
      tenantId: stringId,
      planId: stringId,
      status: stringId,
    }),
    indexes: [
      [
        { tenantId: 1 },
        {
          unique: true,
          name: "one_active_subscription",
          partialFilterExpression: { status: "active" },
        },
      ],
    ],
  },
  {
    name: "module_definitions",
    schema: schema(["code", "name", "dependencies", "permissions", "status"], {
      code: stringId,
      name: stringId,
      dependencies: { bsonType: "array" },
      permissions: { bsonType: "array" },
      status: { enum: ["active", "deprecated"] },
    }),
    indexes: [[{ code: 1 }, { unique: true, name: "code_unique" }]],
  },
  {
    name: "tenant_modules",
    schema: schema(["tenantId", "moduleCode", "enabled"], {
      tenantId: stringId,
      moduleCode: stringId,
      enabled: { bsonType: "bool" },
    }),
    indexes: [[{ tenantId: 1, moduleCode: 1 }, { unique: true, name: "tenant_module_unique" }]],
  },
  {
    name: "integration_providers",
    schema: schema(["code", "name", "availability"], {
      code: stringId,
      name: stringId,
      availability: { enum: ["unavailable", "partner_only", "enabled"] },
    }),
    indexes: [[{ code: 1 }, { unique: true, name: "code_unique" }]],
  },
  {
    name: "tenant_integrations",
    schema: schema(["tenantId", "providerCode", "enabled", "status"], {
      tenantId: stringId,
      providerCode: stringId,
      enabled: { bsonType: "bool" },
      status: stringId,
    }),
    indexes: [[{ tenantId: 1, providerCode: 1 }, { unique: true, name: "tenant_provider_unique" }]],
  },
  {
    name: "system_settings",
    schema: {
      bsonType: "object",
      required: ["_id", "key"],
      properties: { _id: objectId, key: { enum: ["global"] } },
    },
    indexes: [[{ key: 1 }, { unique: true, name: "key_unique" }]],
  },
  {
    name: "branches",
    schema: schema(["tenantId", "name", "code", "status"], {
      tenantId: stringId,
      name: stringId,
      code: stringId,
      status: stringId,
    }),
    indexes: [[{ tenantId: 1, code: 1 }, { unique: true, name: "tenant_code_unique" }]],
  },
  {
    name: "sequences",
    schema: schema(["key", "value"], { key: stringId, value: int64 }),
    indexes: [[{ key: 1 }, { unique: true, name: "key_unique" }]],
  },
  {
    name: "users",
    schema: schema(["tenantId", "email", "name", "passwordHash", "roleId", "branchIds", "status", "tv"], {
      tenantId: stringId,
      email: stringId,
      name: stringId,
      passwordHash: stringId,
      roleId: stringId,
      branchIds: { bsonType: "array" },
      status: { enum: ["active", "disabled"] },
      tv: int64,
    }),
    indexes: [[{ tenantId: 1, email: 1 }, { unique: true, name: "tenant_email_unique" }]],
  },
  {
    name: "roles",
    schema: schema(["tenantId", "name", "permissionKeys", "isSystem"], {
      tenantId: stringId,
      name: stringId,
      permissionKeys: { bsonType: "array" },
      isSystem: { bsonType: "bool" },
    }),
    indexes: [[{ tenantId: 1, name: 1 }, { unique: true, name: "tenant_name_unique" }]],
  },
  {
    name: "user_sessions",
    schema: schema(["tenantId", "userId", "refreshTokenHash", "familyId", "expiresAt"], {
      tenantId: stringId,
      userId: stringId,
      refreshTokenHash: stringId,
      familyId: stringId,
      expiresAt: date,
    }),
    indexes: [
      [{ refreshTokenHash: 1 }, { unique: true, name: "refresh_token_hash_unique" }],
      [{ tenantId: 1, userId: 1 }, { name: "tenant_user" }],
      [{ familyId: 1 }, { name: "family_id" }],
    ],
  },
  {
    name: "login_history",
    schema: schema(["audience", "userId", "success", "at"], {
      audience: { enum: ["platform", "tenant"] },
      userId: stringId,
      success: { bsonType: "bool" },
      at: date,
    }),
    indexes: [
      [{ tenantId: 1, at: 1 }, { name: "tenant_at" }],
      [{ userId: 1, at: 1 }, { name: "user_at" }],
    ],
  },
  {
    name: "audit_logs",
    schema: schema(["actorId", "actorAudience", "action", "entityType", "entityId", "at"], {
      actorId: stringId,
      actorAudience: { enum: ["platform", "tenant"] },
      action: stringId,
      entityType: stringId,
      entityId: stringId,
      at: date,
    }),
    indexes: [
      [{ tenantId: 1, at: 1 }, { name: "tenant_at" }],
      [{ entityType: 1, entityId: 1 }, { name: "entity" }],
    ],
  },
  {
    name: "categories",
    schema: schema(["tenantId", "name", "sortOrder", "status"], {
      tenantId: stringId,
      name: stringId,
      sortOrder: int64,
      status: stringId,
    }),
    indexes: [[{ tenantId: 1, parentId: 1, sortOrder: 1 }, { name: "tenant_parent_sort" }]],
  },
  {
    name: "products",
    schema: schema(["tenantId", "name", "type", "status", "trackInventory"], {
      tenantId: stringId,
      name: stringId,
      type: { enum: ["simple", "variant", "recipe", "service"] },
      status: { enum: ["active", "archived"] },
      trackInventory: { bsonType: "bool" },
    }),
    indexes: [
      [{ tenantId: 1, sku: 1 }, { unique: true, sparse: true, name: "tenant_sku_unique" }],
      [{ tenantId: 1, categoryId: 1, status: 1 }, { name: "tenant_category_status" }],
    ],
  },
  {
    name: "barcodes",
    schema: schema(["tenantId", "code", "productId"], {
      tenantId: stringId,
      code: stringId,
      productId: stringId,
    }),
    indexes: [[{ tenantId: 1, code: 1 }, { unique: true, name: "tenant_code_unique" }]],
  },
  {
    name: "stock_items",
    schema: schema(["tenantId", "name", "kind", "baseUnit", "displayUnit", "status"], {
      tenantId: stringId,
      name: stringId,
      kind: { enum: ["ingredient", "finished", "retail", "packaging"] },
      baseUnit: { enum: ["mg", "ml", "milli_each"] },
      displayUnit: stringId,
      status: stringId,
    }),
    indexes: [[{ tenantId: 1, sku: 1 }, { unique: true, sparse: true, name: "tenant_sku_unique" }]],
  },
  {
    name: "inventory_balances",
    schema: schema(["tenantId", "branchId", "stockItemId", "onHandBase", "reservedBase", "version"], {
      tenantId: stringId,
      branchId: stringId,
      stockItemId: stringId,
      onHandBase: int64,
      reservedBase: int64,
      version: int64,
    }),
    indexes: [
      [{ tenantId: 1, branchId: 1, stockItemId: 1 }, { unique: true, name: "tenant_branch_item_unique" }],
    ],
  },
  {
    name: "stock_movements",
    schema: schema(["tenantId", "branchId", "stockItemId", "type", "qtyBase", "idempotencyKey", "occurredAt"], {
      tenantId: stringId,
      branchId: stringId,
      stockItemId: stringId,
      type: {
        enum: [
          "purchase",
          "sale",
          "recipe_consumption",
          "adjustment",
          "transfer_out",
          "transfer_in",
          "wastage",
          "reservation",
          "reservation_release",
          "reversal",
        ],
      },
      qtyBase: int64,
      idempotencyKey: stringId,
      occurredAt: date,
    }),
    indexes: [
      [{ tenantId: 1, idempotencyKey: 1 }, { unique: true, name: "tenant_idempotency_unique" }],
      [{ tenantId: 1, branchId: 1, stockItemId: 1, occurredAt: 1 }, { name: "tenant_branch_item_time" }],
      [{ tenantId: 1, orderId: 1 }, { name: "tenant_order" }],
    ],
  },
  {
    name: "recipes",
    schema: schema(["tenantId", "productId", "version", "yieldQty", "status", "lines"], {
      tenantId: stringId,
      productId: stringId,
      version: int64,
      yieldQty: int64,
      status: { enum: ["active", "archived"] },
      lines: { bsonType: "array" },
    }),
    indexes: [
      [
        { tenantId: 1, productId: 1, variantId: 1 },
        {
          unique: true,
          name: "one_active_recipe",
          partialFilterExpression: { status: "active" },
        },
      ],
    ],
  },
  {
    name: "suppliers",
    schema: schema(["tenantId", "name", "status"], {
      tenantId: stringId,
      name: stringId,
      status: stringId,
    }),
    indexes: [[{ tenantId: 1, name: 1 }, { name: "tenant_name" }]],
  },
  {
    name: "purchases",
    schema: schema(["tenantId", "branchId", "status", "lines"], {
      tenantId: stringId,
      branchId: stringId,
      status: { enum: ["draft", "received", "cancelled"] },
      lines: { bsonType: "array" },
    }),
    indexes: [[{ tenantId: 1, branchId: 1, status: 1 }, { name: "tenant_branch_status" }]],
  },
  {
    name: "customers",
    schema: schema(["tenantId", "name"], {
      tenantId: stringId,
      name: stringId,
    }),
    indexes: [[{ tenantId: 1, phone: 1 }, { unique: true, sparse: true, name: "tenant_phone_unique" }]],
  },
  {
    name: "terminals",
    schema: schema(["tenantId", "branchId", "name", "code", "status"], {
      tenantId: stringId,
      branchId: stringId,
      name: stringId,
      code: stringId,
      status: stringId,
    }),
    indexes: [[{ tenantId: 1, code: 1 }, { unique: true, name: "tenant_code_unique" }]],
  },
  {
    name: "shifts",
    schema: schema(["tenantId", "branchId", "terminalId", "userId", "openedAt", "status"], {
      tenantId: stringId,
      branchId: stringId,
      terminalId: stringId,
      userId: stringId,
      openedAt: date,
      status: { enum: ["open", "closed"] },
    }),
    indexes: [[{ tenantId: 1, terminalId: 1, status: 1 }, { name: "tenant_terminal_status" }]],
  },
  {
    name: "orders",
    schema: schema(["tenantId", "branchId", "status", "orderType", "lines", "idempotencyKey", "taxMode"], {
      tenantId: stringId,
      branchId: stringId,
      status: { enum: ["draft", "held", "open", "paid", "completed", "cancelled", "refunded"] },
      orderType: { enum: ["counter", "dine_in", "takeaway", "delivery", "online"] },
      lines: { bsonType: "array" },
      idempotencyKey: stringId,
      taxMode: { enum: ["inclusive", "exclusive"] },
    }),
    indexes: [
      [{ tenantId: 1, idempotencyKey: 1 }, { unique: true, name: "tenant_idempotency_unique" }],
      [
        { tenantId: 1, branchId: 1, receiptNumber: 1 },
        { unique: true, sparse: true, name: "tenant_branch_receipt_unique" },
      ],
      [{ tenantId: 1, branchId: 1, createdAt: 1 }, { name: "tenant_branch_created" }],
      [{ tenantId: 1, status: 1 }, { name: "tenant_status" }],
    ],
  },
  {
    name: "payments",
    schema: schema(["tenantId", "orderId", "method", "status", "amountMinor", "idempotencyKey"], {
      tenantId: stringId,
      orderId: stringId,
      method: { enum: ["cash", "upi", "card", "razorpay"] },
      status: { enum: ["pending", "captured", "failed", "refunded"] },
      amountMinor: int64,
      idempotencyKey: stringId,
    }),
    indexes: [
      [{ tenantId: 1, idempotencyKey: 1 }, { unique: true, name: "tenant_idempotency_unique" }],
      [
        { tenantId: 1, providerEventId: 1 },
        { unique: true, sparse: true, name: "tenant_provider_event_unique" },
      ],
    ],
  },
  {
    name: "refunds",
    schema: schema(["tenantId", "orderId", "paymentId", "amountMinor", "status", "idempotencyKey"], {
      tenantId: stringId,
      orderId: stringId,
      paymentId: stringId,
      amountMinor: int64,
      status: stringId,
      idempotencyKey: stringId,
    }),
    indexes: [
      [{ tenantId: 1, idempotencyKey: 1 }, { unique: true, name: "tenant_idempotency_unique" }],
      [{ tenantId: 1, orderId: 1 }, { name: "tenant_order" }],
    ],
  },
  {
    name: "invoices",
    schema: schema(["tenantId", "orderId", "number", "issuedAt"], {
      tenantId: stringId,
      orderId: stringId,
      number: stringId,
      issuedAt: date,
    }),
    indexes: [[{ tenantId: 1, number: 1 }, { unique: true, name: "tenant_number_unique" }]],
  },
  {
    name: "expense_categories",
    schema: schema(["tenantId", "name", "kind", "status"], {
      tenantId: stringId,
      name: stringId,
      kind: { enum: ["operating", "cogs", "other"] },
      status: stringId,
    }),
    indexes: [[{ tenantId: 1, name: 1 }, { unique: true, name: "tenant_name_unique" }]],
  },
  {
    name: "expenses",
    schema: schema(["tenantId", "branchId", "categoryId", "title", "amountMinor", "paidBy", "spentAt", "status"], {
      tenantId: stringId,
      branchId: stringId,
      categoryId: stringId,
      title: stringId,
      amountMinor: int64,
      paidBy: { enum: ["cash", "upi", "card", "bank"] },
      spentAt: date,
      status: { enum: ["draft", "pending_approval", "approved", "rejected"] },
    }),
    indexes: [
      [{ tenantId: 1, branchId: 1, spentAt: 1 }, { name: "tenant_branch_spent" }],
      [{ tenantId: 1, status: 1 }, { name: "tenant_status" }],
    ],
  },
  {
    name: "tax_configs",
    schema: schema(["tenantId", "name", "rateBps", "components", "isDefault"], {
      tenantId: stringId,
      name: stringId,
      rateBps: int64,
      components: { bsonType: "array" },
      isDefault: { bsonType: "bool" },
    }),
    indexes: [[{ tenantId: 1, isDefault: 1 }, { name: "tenant_default" }]],
  },
  {
    name: "notifications",
    schema: schema(["tenantId", "userId", "type", "title"], {
      tenantId: stringId,
      userId: stringId,
      type: stringId,
      title: stringId,
    }),
    indexes: [[{ tenantId: 1, userId: 1 }, { name: "tenant_user" }]],
  },
  {
    name: "files",
    schema: schema(["tenantId", "purpose", "storageKey", "mime", "size"], {
      tenantId: stringId,
      purpose: { enum: ["logo", "product", "receipt", "expense"] },
      storageKey: stringId,
      mime: stringId,
      size: int64,
    }),
    indexes: [[{ tenantId: 1, purpose: 1 }, { name: "tenant_purpose" }]],
  },
  {
    name: "sync_inbox",
    schema: schema(["tenantId", "terminalId", "idempotencyKey", "entityType", "entityId", "result", "receivedAt"], {
      tenantId: stringId,
      terminalId: stringId,
      idempotencyKey: stringId,
      entityType: stringId,
      entityId: stringId,
      result: { enum: ["applied", "duplicate", "conflict"] },
      receivedAt: date,
    }),
    indexes: [[{ tenantId: 1, idempotencyKey: 1 }, { unique: true, name: "tenant_idempotency_unique" }]],
  },
  {
    name: "sync_conflicts",
    schema: schema(["tenantId", "terminalId", "kind", "entityType", "entityId", "status"], {
      tenantId: stringId,
      terminalId: stringId,
      kind: { enum: ["oversell", "stale_catalog"] },
      entityType: stringId,
      entityId: stringId,
      status: { enum: ["open", "resolved"] },
    }),
    indexes: [[{ tenantId: 1, status: 1 }, { name: "tenant_status" }]],
  },
  {
    name: "integration_logs",
    schema: schema(["providerCode", "operation", "success", "attempt", "at"], {
      providerCode: stringId,
      operation: stringId,
      success: { bsonType: "bool" },
      attempt: int64,
      at: date,
    }),
    indexes: [[{ tenantId: 1, providerCode: 1, at: 1 }, { name: "tenant_provider_at" }]],
  },
];

const PROVIDERS = [
  {
    _id: new ObjectId("000000000000000000000101"),
    code: "razorpay",
    name: "Razorpay",
    availability: "unavailable",
    notes: "Public merchant API. The adapter is enabled in Phase 8.",
  },
  {
    _id: new ObjectId("000000000000000000000102"),
    code: "swiggy",
    name: "Swiggy",
    availability: "partner_only",
    notes: "Partner POS program. No open self-serve API.",
  },
  {
    _id: new ObjectId("000000000000000000000103"),
    code: "zomato",
    name: "Zomato",
    availability: "partner_only",
    notes: "POS partner API under commercial approval.",
  },
  {
    _id: new ObjectId("000000000000000000000104"),
    code: "porter",
    name: "Porter",
    availability: "partner_only",
    notes: "Partner logistics API. Not an open booking API.",
  },
];

async function ensureCollection(db, name, jsonSchema) {
  const existing = await db.listCollections({ name }).toArray();
  const validator = { $jsonSchema: jsonSchema };
  if (existing.length === 0) {
    await db.createCollection(name, {
      validator,
      validationLevel: "strict",
      validationAction: "error",
    });
    return;
  }
  await db.command({
    collMod: name,
    validator,
    validationLevel: "strict",
    validationAction: "error",
  });
}

module.exports = {
  async up(db) {
    for (const collection of collections) {
      await ensureCollection(db, collection.name, collection.schema);
      for (const [keys, options] of collection.indexes) {
        try {
          await db.collection(collection.name).createIndex(keys, options);
        } catch (error) {
          if (error.code !== 85 && error.code !== 86) throw error;
        }
      }
    }

    const now = new Date();
    await db.collection("system_settings").updateOne(
      { key: "global" },
      { $setOnInsert: { _id: new ObjectId(), key: "global", createdAt: now, updatedAt: now } },
      { upsert: true },
    );

    for (const provider of PROVIDERS) {
      await db.collection("integration_providers").updateOne(
        { code: provider.code },
        { $setOnInsert: { ...provider, createdAt: now, updatedAt: now } },
        { upsert: true },
      );
    }
  },

  async down(db) {
    const names = collections.map((collection) => collection.name).reverse();
    for (const name of names) {
      const existing = await db.listCollections({ name }).toArray();
      if (existing.length > 0) {
        await db.collection(name).drop();
      }
    }
  },
};
