type Json = Record<string, unknown>;

const string = { type: "string" };
const money = { type: "string", example: "80.00", description: "Decimal string. The server stores integer minor units." };
const qty = { type: "string", example: "1", description: "Decimal quantity. Recipe and stock units are converted on the server." };

function obj(properties: Json, required: string[] = []): Json {
  return { type: "object", properties, required, additionalProperties: false };
}

function ref(name: string): Json {
  return { $ref: `#/components/schemas/${name}` };
}

const errorResponses: Json = {
  "400": { description: "Validation failed", content: { "application/json": { schema: ref("ErrorEnvelope") } } },
  "401": { description: "Sign in required", content: { "application/json": { schema: ref("ErrorEnvelope") } } },
  "403": { description: "Missing permission or module", content: { "application/json": { schema: ref("ErrorEnvelope") } } },
  "404": { description: "Not found", content: { "application/json": { schema: ref("ErrorEnvelope") } } },
  "409": { description: "Duplicate or idempotency conflict", content: { "application/json": { schema: ref("ErrorEnvelope") } } },
  "422": { description: "Business rule rejected the request", content: { "application/json": { schema: ref("ErrorEnvelope") } } },
};

function operation(input: {
  tag: string;
  summary: string;
  auth?: "bearer" | "none";
  body?: string;
  params?: string[];
  query?: Json[];
  idempotency?: boolean;
  status?: string;
  description?: string;
}): Json {
  const parameters = [
    ...(input.params ?? []).map((name) => ({ $ref: `#/components/parameters/${name}` })),
    ...(input.query ?? []),
  ];
  if (input.idempotency) parameters.push({ $ref: "#/components/parameters/IdempotencyKey" });
  return {
    tags: [input.tag],
    summary: input.summary,
    description: input.description,
    security: input.auth === "none" ? [] : [{ bearerAuth: [] }],
    parameters: parameters.length ? parameters : undefined,
    requestBody: input.body
      ? { required: true, content: { "application/json": { schema: ref(input.body) } } }
      : undefined,
    responses: {
      [input.status ?? "200"]: {
        description: input.status === "202" ? "Accepted" : "Success",
        content: { "application/json": { schema: ref("SuccessEnvelope") } },
      },
      ...errorResponses,
    },
  };
}

const paths: Record<string, Json> = {};

function route(method: string, path: string, spec: Parameters<typeof operation>[0]): void {
  paths[path] = { ...paths[path], [method]: operation(spec) };
}

const pageQuery = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
  { name: "cursor", in: "query", schema: string },
];
const reportQuery = [
  { name: "range", in: "query", schema: { type: "string", enum: ["today", "yesterday", "week", "month"] } },
  { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
  { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
  { name: "branchId", in: "query", schema: string },
];

route("get", "/api/v1/health", { tag: "Health", summary: "Liveness", auth: "none" });
route("get", "/api/v1/health/ready", { tag: "Health", summary: "Readiness, including the expected migration", auth: "none" });

route("post", "/api/v1/platform/auth/login", { tag: "Platform auth", summary: "Super admin sign in", auth: "none", body: "PlatformLogin" });
route("post", "/api/v1/platform/auth/refresh", { tag: "Platform auth", summary: "Rotate the platform refresh cookie", auth: "none", description: "Reads the refresh_token cookie." });
route("post", "/api/v1/platform/auth/logout", { tag: "Platform auth", summary: "Revoke the platform refresh cookie", auth: "none" });
route("post", "/api/v1/platform/auth/forgot-password", { tag: "Platform auth", summary: "Request a platform password reset", auth: "none", body: "EmailOnly", status: "202" });
route("post", "/api/v1/platform/auth/reset-password", { tag: "Platform auth", summary: "Set a new platform password", auth: "none", body: "PasswordReset" });

route("post", "/api/v1/admin/auth/login", { tag: "Business auth", summary: "Business admin sign in", auth: "none", body: "TenantLogin" });
route("post", "/api/v1/admin/auth/refresh", { tag: "Business auth", summary: "Rotate the business refresh cookie", auth: "none" });
route("post", "/api/v1/admin/auth/logout", { tag: "Business auth", summary: "Revoke the business refresh cookie", auth: "none" });
route("post", "/api/v1/admin/auth/forgot-password", { tag: "Business auth", summary: "Request a business password reset", auth: "none", body: "TenantEmail", status: "202" });
route("post", "/api/v1/admin/auth/reset-password", { tag: "Business auth", summary: "Set a new business password", auth: "none", body: "PasswordReset" });

route("post", "/api/v1/pos/auth/login", { tag: "POS auth", summary: "Cashier sign in", auth: "none", body: "TenantLogin" });
route("post", "/api/v1/pos/auth/refresh", { tag: "POS auth", summary: "Rotate the POS refresh cookie", auth: "none" });
route("post", "/api/v1/pos/auth/logout", { tag: "POS auth", summary: "Revoke the POS refresh cookie", auth: "none" });

route("get", "/api/v1/platform/tenants", { tag: "Platform", summary: "List businesses", query: [{ name: "status", in: "query", schema: { type: "string", enum: ["active", "inactive", "suspended", "deleted"] } }, ...pageQuery] });
route("post", "/api/v1/platform/tenants", { tag: "Platform", summary: "Create a business and its owner", body: "TenantCreate", status: "201" });
route("get", "/api/v1/platform/tenants/{tenantId}", { tag: "Platform", summary: "Get a business", params: ["TenantId"] });
route("patch", "/api/v1/platform/tenants/{tenantId}", { tag: "Platform", summary: "Update a business", params: ["TenantId"], body: "TenantPatch" });
route("post", "/api/v1/platform/tenants/{tenantId}/status", { tag: "Platform", summary: "Activate, deactivate, or suspend a business", params: ["TenantId"], body: "TenantStatus" });
route("delete", "/api/v1/platform/tenants/{tenantId}", { tag: "Platform", summary: "Mark a business deleted", params: ["TenantId"] });
route("get", "/api/v1/platform/modules", { tag: "Platform", summary: "Module registry" });
route("get", "/api/v1/platform/tenants/{tenantId}/modules", { tag: "Platform", summary: "Modules assigned to a business", params: ["TenantId"] });
route("put", "/api/v1/platform/tenants/{tenantId}/modules", { tag: "Platform", summary: "Replace module assignments", params: ["TenantId"], body: "ModuleAssign" });
route("get", "/api/v1/platform/plans", { tag: "Platform", summary: "List plans" });
route("post", "/api/v1/platform/plans", { tag: "Platform", summary: "Create a plan", body: "PlanCreate", status: "201" });
route("get", "/api/v1/platform/users", { tag: "Platform", summary: "List platform users" });
route("post", "/api/v1/platform/users", { tag: "Platform", summary: "Create a platform user", body: "PlatformUserCreate", status: "201" });
route("get", "/api/v1/platform/roles", { tag: "Platform", summary: "List platform roles" });
route("get", "/api/v1/platform/integrations", { tag: "Platform", summary: "Integration providers and availability" });
route("get", "/api/v1/platform/settings", { tag: "Platform", summary: "Global settings" });
route("get", "/api/v1/platform/audit-logs", { tag: "Platform", summary: "Platform audit log", query: pageQuery });
route("get", "/api/v1/platform/analytics/usage", { tag: "Platform", summary: "Tenant counts by status" });

route("get", "/api/v1/admin/bootstrap", { tag: "Business", summary: "Session, branches, terminals, and enabled modules" });
route("get", "/api/v1/admin/branches", { tag: "Business", summary: "List branches" });
route("post", "/api/v1/admin/branches", { tag: "Business", summary: "Create a branch", body: "BranchCreate", status: "201" });
route("get", "/api/v1/admin/categories", { tag: "Catalog", summary: "List categories" });
route("post", "/api/v1/admin/categories", { tag: "Catalog", summary: "Create a category", body: "CategoryCreate", status: "201" });
route("get", "/api/v1/admin/products", { tag: "Catalog", summary: "List products", query: [...pageQuery, { name: "status", in: "query", schema: string }, { name: "categoryId", in: "query", schema: string }] });
route("post", "/api/v1/admin/products", { tag: "Catalog", summary: "Create a product", body: "ProductCreate", status: "201" });
route("get", "/api/v1/admin/products/{productId}", { tag: "Catalog", summary: "Get a product", params: ["ProductId"] });
route("post", "/api/v1/admin/products/{productId}/archive", { tag: "Catalog", summary: "Archive a product", params: ["ProductId"] });
route("post", "/api/v1/admin/stock-items", { tag: "Inventory", summary: "Create a stock item", body: "StockItemCreate", status: "201" });
route("get", "/api/v1/admin/stock-items", { tag: "Inventory", summary: "List stock items" });
route("get", "/api/v1/admin/branches/{branchId}/balances", { tag: "Inventory", summary: "On-hand balances", params: ["BranchId"] });
route("get", "/api/v1/admin/branches/{branchId}/movements", { tag: "Inventory", summary: "Stock movements", params: ["BranchId"] });
route("post", "/api/v1/admin/branches/{branchId}/adjustments", { tag: "Inventory", summary: "Stock in or stock out", params: ["BranchId"], body: "StockAdjustment", idempotency: true });
route("post", "/api/v1/admin/suppliers", { tag: "Inventory", summary: "Create a supplier", body: "SupplierCreate", status: "201" });
route("get", "/api/v1/admin/suppliers", { tag: "Inventory", summary: "List suppliers" });
route("post", "/api/v1/admin/purchases", { tag: "Inventory", summary: "Receive a purchase", body: "PurchaseCreate", idempotency: true, status: "201" });
route("get", "/api/v1/admin/purchases", { tag: "Inventory", summary: "List purchases" });
route("post", "/api/v1/admin/products/{productId}/recipes", { tag: "Recipes", summary: "Activate a recipe and archive the previous one", params: ["ProductId"], body: "RecipeWrite", status: "201" });
route("get", "/api/v1/admin/products/{productId}/recipes", { tag: "Recipes", summary: "List recipes for a product", params: ["ProductId"] });
route("post", "/api/v1/admin/recipes/cost-preview", { tag: "Recipes", summary: "Preview ingredient cost", body: "CostPreview" });
route("get", "/api/v1/admin/expense-categories", { tag: "Expenses", summary: "List expense categories" });
route("post", "/api/v1/admin/expense-categories", { tag: "Expenses", summary: "Create an expense category", body: "ExpenseCategoryCreate", status: "201" });
route("get", "/api/v1/admin/expenses", { tag: "Expenses", summary: "List expenses" });
route("post", "/api/v1/admin/expenses", { tag: "Expenses", summary: "Record an expense", body: "ExpenseCreate", status: "201" });
route("get", "/api/v1/admin/users", { tag: "Business", summary: "List employees" });
route("post", "/api/v1/admin/users", { tag: "Business", summary: "Create an employee", body: "EmployeeCreate", status: "201" });
route("get", "/api/v1/admin/roles", { tag: "Business", summary: "List roles" });
route("post", "/api/v1/admin/roles", { tag: "Business", summary: "Create a role", body: "RoleCreate", status: "201" });
route("get", "/api/v1/admin/customers", { tag: "Business", summary: "List customers" });
route("post", "/api/v1/admin/customers", { tag: "Business", summary: "Create a customer", body: "CustomerCreate", status: "201" });
route("get", "/api/v1/admin/terminals", { tag: "Business", summary: "List terminals" });
route("get", "/api/v1/admin/settings", { tag: "Business", summary: "Business settings" });
route("patch", "/api/v1/admin/settings", { tag: "Business", summary: "Update business settings", body: "BusinessSettings" });
route("get", "/api/v1/admin/modules", { tag: "Business", summary: "Enabled modules for this business" });
route("get", "/api/v1/admin/reports/sales-summary", { tag: "Reports", summary: "Sales summary", query: reportQuery });
route("get", "/api/v1/admin/reports/profit", { tag: "Reports", summary: "Profit summary, including the operating profit estimate", query: reportQuery });
route("post", "/api/v1/admin/reports/exports", {
  tag: "Reports",
  summary: "Download a report as CSV, spreadsheet, or PDF",
  body: "ReportExport",
  description: "The response is the file itself, not the JSON envelope. Content type follows format.",
});

route("get", "/api/v1/pos/bootstrap", { tag: "POS", summary: "Cashier session, terminal, and payment methods" });
route("post", "/api/v1/pos/shifts", { tag: "POS", summary: "Open a shift", body: "ShiftOpen", status: "201" });
route("post", "/api/v1/pos/shifts/{shiftId}/close", { tag: "POS", summary: "Close a shift", params: ["ShiftId"], body: "ShiftClose" });
route("get", "/api/v1/pos/catalog", { tag: "POS", summary: "Sellable products", query: [{ name: "q", in: "query", schema: string }, { name: "categoryId", in: "query", schema: string }] });
route("get", "/api/v1/pos/barcodes/{code}", { tag: "POS", summary: "Find a product by barcode", params: ["Barcode"] });
route("post", "/api/v1/pos/orders", { tag: "POS", summary: "Create a sale. Prices are recomputed on the server.", body: "OrderCreate", idempotency: true, status: "201" });
route("get", "/api/v1/pos/orders", { tag: "POS", summary: "Recent orders for the cashier's branches" });
route("get", "/api/v1/pos/orders/{orderId}", { tag: "POS", summary: "Get an order", params: ["OrderId"] });
route("post", "/api/v1/pos/orders/{orderId}/hold", { tag: "POS", summary: "Hold an order", params: ["OrderId"] });
route("post", "/api/v1/pos/orders/{orderId}/resume", { tag: "POS", summary: "Resume a held order", params: ["OrderId"] });
route("post", "/api/v1/pos/orders/{orderId}/cancel", { tag: "POS", summary: "Cancel an order", params: ["OrderId"], body: "OrderCancel" });
route("post", "/api/v1/pos/orders/{orderId}/payments", { tag: "POS", summary: "Capture a cash payment and post stock", params: ["OrderId"], body: "CashPayment", idempotency: true, status: "201" });
route("post", "/api/v1/pos/orders/{orderId}/refunds", { tag: "POS", summary: "Refund a captured payment", params: ["OrderId"], body: "RefundCreate", idempotency: true, status: "201" });
route("get", "/api/v1/pos/orders/{orderId}/receipt", { tag: "POS", summary: "Receipt JSON, or PDF when format=pdf", params: ["OrderId"], query: [{ name: "format", in: "query", schema: { type: "string", enum: ["json", "pdf"] } }] });
route("post", "/api/v1/pos/orders/{orderId}/razorpay/orders", { tag: "POS", summary: "Razorpay order. Returns 501 until Razorpay is configured.", params: ["OrderId"] });

route("post", "/api/v1/sync/batches", { tag: "Sync", summary: "Apply an offline cash batch. Absolute on-hand quantities are rejected.", body: "SyncBatch" });
route("get", "/api/v1/sync/conflicts", { tag: "Sync", summary: "Open sync conflicts" });

const line = obj({ stockItemId: string, quantity: qty, unit: string, unitCost: money }, ["stockItemId", "quantity", "unit", "unitCost"]);
const recipeLine = obj({ stockItemId: string, quantity: qty, unit: string, wastagePercent: { type: "string", example: "0" } }, ["stockItemId", "quantity", "unit"]);
const orderLine = obj({ productId: string, variantId: { type: "string", nullable: true }, qty }, ["productId", "qty"]);

export const openApi = {
  openapi: "3.0.3",
  info: {
    title: "POS platform API",
    version: "2026-11-04",
    description: "Platform, business admin, POS, and offline sync. Send Authorization: Bearer on protected routes. Refresh tokens use the refresh_token cookie. Money and quantities are decimal strings.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "Health" },
    { name: "Platform auth" },
    { name: "Business auth" },
    { name: "POS auth" },
    { name: "Platform" },
    { name: "Business" },
    { name: "Catalog" },
    { name: "Inventory" },
    { name: "Recipes" },
    { name: "Expenses" },
    { name: "Reports" },
    { name: "POS" },
    { name: "Sync" },
  ],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    parameters: {
      IdempotencyKey: { name: "Idempotency-Key", in: "header", required: true, schema: string },
      TenantId: { name: "tenantId", in: "path", required: true, schema: string },
      ProductId: { name: "productId", in: "path", required: true, schema: string },
      BranchId: { name: "branchId", in: "path", required: true, schema: string },
      OrderId: { name: "orderId", in: "path", required: true, schema: string },
      ShiftId: { name: "shiftId", in: "path", required: true, schema: string },
      Barcode: { name: "code", in: "path", required: true, schema: string },
    },
    schemas: {
      SuccessEnvelope: obj({
        data: { description: "Response payload" },
        meta: obj({ requestId: string, nextCursor: { type: "string", nullable: true } }),
      }),
      ErrorEnvelope: obj({
        error: obj({ code: string, message: string, requestId: string, details: { type: "array", items: {} } }, ["code", "message"]),
      }),
      PlatformLogin: obj({ email: { type: "string", format: "email" }, password: string }, ["email", "password"]),
      TenantLogin: obj({ email: { type: "string", format: "email" }, password: string, tenantSlug: string }, ["email", "password", "tenantSlug"]),
      EmailOnly: obj({ email: { type: "string", format: "email" } }, ["email"]),
      TenantEmail: obj({ email: { type: "string", format: "email" }, tenantSlug: string }, ["email", "tenantSlug"]),
      PasswordReset: obj({ token: string, password: { type: "string", minLength: 8 } }, ["token", "password"]),
      TenantCreate: obj({
        name: string, legalName: string, slug: string, ownerEmail: { type: "string", format: "email" }, ownerName: string,
        ownerPassword: { type: "string", minLength: 8 }, timezone: string, currency: string,
        taxMode: { type: "string", enum: ["inclusive", "exclusive"] }, stockPolicy: { type: "string", enum: ["on_payment", "on_prepared"] },
        modules: { type: "array", items: string }, phone: string, gstin: string,
      }, ["name", "legalName", "slug", "ownerEmail", "ownerName", "ownerPassword"]),
      TenantPatch: obj({
        name: string, legalName: string, phone: string, gstin: string, timezone: string,
        taxMode: { type: "string", enum: ["inclusive", "exclusive"] }, stockPolicy: { type: "string", enum: ["on_payment", "on_prepared"] },
      }),
      TenantStatus: obj({ status: { type: "string", enum: ["active", "inactive", "suspended"] } }, ["status"]),
      ModuleAssign: obj({
        modules: { type: "array", items: obj({ code: string, enabled: { type: "boolean" }, settings: { type: "object" } }, ["code", "enabled"]) },
      }, ["modules"]),
      PlanCreate: obj({ code: string, name: string, description: string, moduleCodes: { type: "array", items: string }, price: money, interval: string }, ["code", "name"]),
      PlatformUserCreate: obj({ email: { type: "string", format: "email" }, name: string, password: { type: "string", minLength: 8 }, roleId: string }, ["email", "name", "password", "roleId"]),
      BranchCreate: obj({ name: string, code: string, phone: string, timezone: string }, ["name", "code"]),
      CategoryCreate: obj({ name: string, parentId: string, sortOrder: { type: "integer" } }, ["name"]),
      ProductCreate: obj({
        name: string, type: { type: "string", enum: ["simple", "variant", "recipe", "service"] }, categoryId: string, sku: string,
        sellingPrice: money, taxRate: { type: "string", example: "5" }, discountRate: string, trackInventory: { type: "boolean" },
        unitCode: string, description: string, hsnCode: string,
      }, ["name", "type", "sellingPrice"]),
      StockItemCreate: obj({
        name: string, kind: { type: "string", enum: ["ingredient", "finished", "retail", "packaging"] },
        baseUnit: { type: "string", enum: ["mg", "ml", "milli_each"] }, displayUnit: string, sku: string, minQty: qty, minUnit: string,
      }, ["name", "kind", "baseUnit", "displayUnit"]),
      StockAdjustment: obj({
        stockItemId: string, quantity: qty, unit: string, direction: { type: "string", enum: ["in", "out"] }, reason: string, unitCost: money,
      }, ["stockItemId", "quantity", "unit", "direction", "reason"]),
      SupplierCreate: obj({ name: string, phone: string, gstin: string, address: string }, ["name"]),
      PurchaseCreate: obj({ branchId: string, supplierId: string, lines: { type: "array", items: line } }, ["branchId", "lines"]),
      RecipeWrite: obj({ lines: { type: "array", items: recipeLine } }, ["lines"]),
      CostPreview: obj({ productId: string, qty }, ["productId"]),
      ExpenseCategoryCreate: obj({ name: string, kind: { type: "string", enum: ["operating", "cogs", "other"] } }, ["name"]),
      ExpenseCreate: obj({
        branchId: string, categoryId: string, title: string, amount: money,
        paidBy: { type: "string", enum: ["cash", "upi", "card", "bank"] }, description: string, employeeId: string, spentAt: { type: "string", format: "date-time" },
      }, ["branchId", "categoryId", "title", "amount", "paidBy"]),
      EmployeeCreate: obj({
        email: { type: "string", format: "email" }, name: string, password: { type: "string", minLength: 8 }, roleId: string,
        branchIds: { type: "array", items: string },
      }, ["email", "name", "password", "roleId"]),
      RoleCreate: obj({ name: string, permissionKeys: { type: "array", items: string } }, ["name", "permissionKeys"]),
      CustomerCreate: obj({ name: string, phone: string, email: string, notes: string }, ["name"]),
      BusinessSettings: obj({
        name: string, legalName: string, phone: string, timezone: string,
        taxMode: { type: "string", enum: ["inclusive", "exclusive"] }, stockPolicy: { type: "string", enum: ["on_payment", "on_prepared"] }, gstin: string,
      }),
      ReportExport: obj({
        report: { type: "string", enum: ["sales-summary", "profit"] },
        format: { type: "string", enum: ["pdf", "xlsx", "csv"] },
        filters: obj({ from: string, to: string, branchId: string }),
      }, ["report", "format"]),
      ShiftOpen: obj({ branchId: string, terminalId: string, openingCash: money }, ["branchId", "terminalId", "openingCash"]),
      ShiftClose: obj({ closingCash: money }, ["closingCash"]),
      OrderCreate: obj({
        branchId: string, terminalId: string, shiftId: string,
        orderType: { type: "string", enum: ["counter", "dine_in", "takeaway", "delivery", "online"] },
        lines: { type: "array", items: orderLine }, offlineReceiptRef: string,
      }, ["branchId", "lines"]),
      OrderCancel: obj({ reason: string, prepared: { type: "boolean" } }, ["reason"]),
      CashPayment: obj({ amount: money, method: { type: "string", enum: ["cash"] } }, ["amount"]),
      RefundCreate: obj({ amount: money, reason: string }, ["amount", "reason"]),
      SyncBatch: obj({
        terminalId: string, catalogVersion: string,
        operations: {
          type: "array",
          items: obj({
            idempotencyKey: string,
            entityType: { type: "string", enum: ["order", "payment", "movement"] },
            entityId: string,
            groupId: string,
            payload: { type: "object" },
          }, ["idempotencyKey", "entityType", "entityId", "payload"]),
        },
      }, ["terminalId", "operations"]),
    },
  },
};
