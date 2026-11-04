const MODULES = [
  ["pos.billing", "POS Billing", [], [
    ["pos.order.create", "Create sales"],
    ["pos.order.hold", "Hold sales"],
    ["pos.order.cancel", "Cancel sales"],
    ["pos.order.refund", "Refund sales"],
    ["pos.shift.manage", "Open and close shifts"],
  ]],
  ["catalog.products", "Products", [], [
    ["catalog.product.read", "View products"],
    ["catalog.product.write", "Edit products"],
  ]],
  ["catalog.barcode", "Barcodes", ["catalog.products"], [
    ["catalog.product.read", "View barcodes"],
    ["catalog.product.write", "Edit barcodes"],
  ]],
  ["inventory.stock", "Inventory", ["catalog.products"], [
    ["inventory.balance.read", "View stock"],
    ["inventory.movement.write", "Adjust stock"],
  ]],
  ["inventory.purchase", "Purchases", ["inventory.stock"], [
    ["inventory.purchase.read", "View purchases"],
    ["inventory.purchase.write", "Receive purchases"],
  ]],
  ["inventory.supplier", "Suppliers", ["inventory.stock"], [
    ["inventory.supplier.read", "View suppliers"],
    ["inventory.supplier.write", "Edit suppliers"],
  ]],
  ["recipe.management", "Recipes", ["inventory.stock", "catalog.products"], [
    ["recipe.read", "View recipes"],
    ["recipe.write", "Edit recipes"],
  ]],
  ["expense.management", "Expenses", [], [
    ["expense.read", "View expenses"],
    ["expense.write", "Record expenses"],
    ["expense.approve", "Approve expenses"],
  ]],
  ["employee.management", "Employees", [], [
    ["employee.user.read", "View employees"],
    ["employee.user.write", "Edit employees"],
  ]],
  ["customer.management", "Customers", [], [
    ["customer.read", "View customers"],
    ["customer.write", "Edit customers"],
  ]],
  ["reports.sales", "Sales reports", ["pos.billing"], [
    ["report.sales.read", "View sales reports"],
    ["report.export", "Download reports"],
  ]],
  ["reports.finance", "Finance reports", ["pos.billing", "expense.management"], [
    ["report.finance.read", "View profit reports"],
    ["report.export", "Download reports"],
  ]],
  ["tax.gst", "GST", ["pos.billing"], [
    ["settings.business.read", "View tax settings"],
    ["settings.business.write", "Edit tax settings"],
  ]],
  ["payments.razorpay", "Razorpay", ["pos.billing"], [
    ["pos.order.create", "Take Razorpay payments"],
  ]],
  ["restaurant.tables", "Tables", ["pos.billing"], []],
  ["restaurant.kds", "Kitchen display", ["pos.billing"], [
    ["kitchen.status.write", "Update kitchen status"],
  ]],
  ["restaurant.online_orders", "Online orders", ["pos.billing"], [
    ["pos.order.create", "Accept online orders"],
  ]],
  ["delivery.management", "Delivery", ["pos.billing"], [
    ["pos.order.create", "Update delivery"],
  ]],
];

const { ObjectId } = require("mongodb");

function idFor(index) {
  return new ObjectId(String(index + 1).padStart(24, "0"));
}

module.exports = {
  async up(db) {
    const now = new Date();
    for (const [index, moduleDef] of MODULES.entries()) {
      const [code, name, dependencies, permissions] = moduleDef;
      await db.collection("module_definitions").updateOne(
        { code },
        {
          $setOnInsert: {
            _id: idFor(index),
            code,
            name,
            description: name,
            dependencies,
            permissions: permissions.map(([key, description]) => ({ key, description })),
            settingsSchema: {},
            status: "active",
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    }
  },

  async down(db) {
    const codes = MODULES.map((moduleDef) => moduleDef[0]);
    await db.collection("module_definitions").deleteMany({ code: { $in: codes } });
  },
};
