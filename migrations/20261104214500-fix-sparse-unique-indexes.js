/**
 * Compound sparse unique indexes still index every document that has tenantId.
 * A missing sku, phone, receipt number, or provider event then collides.
 * Partial indexes include a document only when the optional field is a string.
 */

const FIXES = [
  ["products", "tenant_sku_unique", { tenantId: 1, sku: 1 }, { sku: { $type: "string" } }],
  ["stock_items", "tenant_sku_unique", { tenantId: 1, sku: 1 }, { sku: { $type: "string" } }],
  ["customers", "tenant_phone_unique", { tenantId: 1, phone: 1 }, { phone: { $type: "string" } }],
  ["orders", "tenant_branch_receipt_unique", { tenantId: 1, branchId: 1, receiptNumber: 1 }, { receiptNumber: { $type: "string" } }],
  ["payments", "tenant_provider_event_unique", { tenantId: 1, providerEventId: 1 }, { providerEventId: { $type: "string" } }],
];

async function recreate(db, [name, index, keys, filter]) {
  const collection = db.collection(name);
  const existing = await collection.indexes();
  if (existing.some((item) => item.name === index)) await collection.dropIndex(index);
  await collection.createIndex(keys, { unique: true, name: index, partialFilterExpression: filter });
}

module.exports = {
  async up(db) {
    for (const fix of FIXES) await recreate(db, fix);
  },

  async down(db) {
    for (const [name, index, keys] of FIXES) {
      const collection = db.collection(name);
      const existing = await collection.indexes();
      if (existing.some((item) => item.name === index)) await collection.dropIndex(index);
      await collection.createIndex(keys, { unique: true, sparse: true, name: index });
    }
  },
};
