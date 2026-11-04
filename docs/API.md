# HTTP API

Phase 1 catalog for `/api/v1`. When the server exists, the generated OpenAPI document must match this file. Clients pin a spec version. See [adr/006-openapi-is-the-contract.md](adr/006-openapi-is-the-contract.md).

## Conventions

- JSON requests and responses. UTF-8.
- Authenticated calls send `Authorization: Bearer {accessToken}`.
- Tenant and branch come from the token and, where a route is branch-specific, from a path `branchId` checked against `branchIds`. A `tenantId` field in a tenant-audience body is ignored.
- Platform routes that act on one business take `tenantId` in the path and require a platform permission.
- Writes that create orders, payments, movements, or sync batches require header `Idempotency-Key`. The server stores it as `idempotencyKey`.
- Lists use `limit` (default 50, max 200) and `cursor`. Responses include `nextCursor`.
- Money and quantities on the wire are decimal strings plus a currency or unit code. The server converts to integers before validation against domain rules. Responses use the same strings.
- Timestamps are ISO-8601 in UTC.

Success envelope:

```json
{
  "data": {},
  "meta": { "requestId": "uuid", "nextCursor": null }
}
```

Error envelope:

```json
{
  "error": {
    "code": "module_disabled",
    "message": "Recipe management is not enabled for this business.",
    "requestId": "uuid",
    "details": []
  }
}
```

Production errors omit stacks and driver text. Validation errors use code `validation_failed` and put field messages in `details`.

| HTTP | When |
| --- | --- |
| 400 | Validation |
| 401 | Missing or expired access token, or token version mismatch |
| 403 | Permission, module, branch, or audience |
| 404 | Id not found inside the caller's scope |
| 409 | Idempotency payload mismatch, dependency cycle, duplicate sku or barcode |
| 422 | Domain rule, such as disable module while another module depends on it |
| 429 | Rate limit |
| 501 | Integration adapter not available |

A reused idempotency key with the same payload returns the original success. The same key with a different payload returns 409 `idempotency_conflict`.

## Health

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/health` | None |
| GET | `/api/v1/health/ready` | None |

`ready` returns 503 when MongoDB is unreachable or the applied migration is behind the build.

## Platform

Audience `platform`.

### Auth

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/platform/auth/login` | Email and password. Sets refresh cookie. |
| POST | `/api/v1/platform/auth/refresh` | Rotates refresh token. |
| POST | `/api/v1/platform/auth/logout` | Revokes the session family. |
| POST | `/api/v1/platform/auth/forgot-password` | Always 202. Does not reveal whether the email exists. |
| POST | `/api/v1/platform/auth/reset-password` | Single-use token. |

### Tenants

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/v1/platform/tenants` | `platform.tenant.read` |
| POST | `/api/v1/platform/tenants` | `platform.tenant.write` |
| GET | `/api/v1/platform/tenants/:tenantId` | `platform.tenant.read` |
| PATCH | `/api/v1/platform/tenants/:tenantId` | `platform.tenant.write` |
| POST | `/api/v1/platform/tenants/:tenantId/status` | `platform.tenant.status` |
| DELETE | `/api/v1/platform/tenants/:tenantId` | `platform.tenant.status` |

`POST` creates the tenant, the owner user, preset roles, the default branch, and the subscription. Status body: `{ "status": "active" | "inactive" | "suspended" }`. `DELETE` sets `deleted`.

Query `status` filters the list. The list payload includes module counts and subscription status, not secrets.

### Plans

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/v1/platform/plans` | `platform.plan.read` |
| POST | `/api/v1/platform/plans` | `platform.plan.write` |
| GET | `/api/v1/platform/plans/:planId` | `platform.plan.read` |
| PATCH | `/api/v1/platform/plans/:planId` | `platform.plan.write` |

### Module registry and assignment

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/v1/platform/modules` | `platform.module.read` |
| POST | `/api/v1/platform/modules` | `platform.module.write` |
| GET | `/api/v1/platform/modules/:code` | `platform.module.read` |
| PATCH | `/api/v1/platform/modules/:code` | `platform.module.write` |
| GET | `/api/v1/platform/tenants/:tenantId/modules` | `platform.module.read` |
| PUT | `/api/v1/platform/tenants/:tenantId/modules` | `platform.module.assign` |

`PUT` replaces the enabled set. The body is `{ "modules": [{ "code": "recipe.management", "enabled": true, "settings": {} }] }`. The service rejects an enabled code with a missing dependency and a disabled code that another enabled code still needs. The write is one transaction.

### Platform users

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/v1/platform/users` | `platform.user.read` |
| POST | `/api/v1/platform/users` | `platform.user.write` |
| GET | `/api/v1/platform/users/:userId` | `platform.user.read` |
| PATCH | `/api/v1/platform/users/:userId` | `platform.user.write` |
| POST | `/api/v1/platform/users/:userId/status` | `platform.user.write` |
| GET | `/api/v1/platform/roles` | `platform.user.read` |

### Integrations, settings, audit, usage

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/v1/platform/integrations` | `platform.integration.read` |
| PATCH | `/api/v1/platform/integrations/:provider` | `platform.integration.write` |
| GET | `/api/v1/platform/tenants/:tenantId/integrations` | `platform.integration.read` |
| PUT | `/api/v1/platform/tenants/:tenantId/integrations/:provider` | `platform.integration.write` |
| GET | `/api/v1/platform/settings` | `platform.settings.read` |
| PATCH | `/api/v1/platform/settings` | `platform.settings.write` |
| GET | `/api/v1/platform/audit-logs` | `platform.audit.read` |
| GET | `/api/v1/platform/analytics/usage` | `platform.tenant.read` |

Usage returns tenant counts by status, assigned module histogram, and order volume per tenant for a date range. It does not return line-level sales of a tenant to a support role that lacks `platform.audit.read`. Credential fields are write-only.

Partner providers answer management `PUT` with the stored flag, and runtime calls answer 501 `integration_unavailable` until `availability` is `enabled`.

## Business admin

Audience `tenant`. Prefix `/api/v1/admin`. Each route also requires the module named in the last column when a module is listed.

### Auth and bootstrap

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/admin/auth/login` | Rejects `suspended` and `deleted` tenants. `inactive` allows owners only. |
| POST | `/api/v1/admin/auth/refresh` | |
| POST | `/api/v1/admin/auth/logout` | |
| POST | `/api/v1/admin/auth/forgot-password` | 202 either way |
| POST | `/api/v1/admin/auth/reset-password` | |
| GET | `/api/v1/admin/bootstrap` | Profile, branches, enabled modules, permission keys, settings |

### Branches, users, roles

| Method | Path | Permission | Module |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/branches` | `settings.business.read` | |
| POST | `/api/v1/admin/branches` | `settings.business.write` | |
| GET | `/api/v1/admin/branches/:branchId` | `settings.business.read` | |
| PATCH | `/api/v1/admin/branches/:branchId` | `settings.business.write` | |
| GET | `/api/v1/admin/users` | `employee.user.read` | `employee.management` |
| POST | `/api/v1/admin/users` | `employee.user.write` | `employee.management` |
| PATCH | `/api/v1/admin/users/:userId` | `employee.user.write` | `employee.management` |
| POST | `/api/v1/admin/users/:userId/status` | `employee.user.write` | `employee.management` |
| GET | `/api/v1/admin/roles` | `access.role.read` | |
| POST | `/api/v1/admin/roles` | `access.role.manage` | |
| PATCH | `/api/v1/admin/roles/:roleId` | `access.role.manage` | |
| DELETE | `/api/v1/admin/roles/:roleId` | `access.role.manage` | |

System roles return 422 on delete. User `branchIds` must be branches of the tenant.

### Catalog

Module `catalog.products` unless noted.

| Method | Path | Permission |
| --- | --- | --- |
| GET, POST | `/api/v1/admin/categories` | `catalog.product.read`, `catalog.product.write` |
| PATCH | `/api/v1/admin/categories/:categoryId` | `catalog.product.write` |
| GET | `/api/v1/admin/products` | `catalog.product.read` |
| POST | `/api/v1/admin/products` | `catalog.product.write` |
| GET, PATCH | `/api/v1/admin/products/:productId` | read / write |
| POST | `/api/v1/admin/products/:productId/archive` | `catalog.product.write` |
| GET, POST | `/api/v1/admin/barcodes` | Barcode routes also require `catalog.barcode` |

Product create with `trackInventory` and module `inventory.stock` creates the stock item in the same transaction.

### Inventory and purchasing

| Method | Path | Permission | Module |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/stock-items` | `inventory.balance.read` | `inventory.stock` |
| POST | `/api/v1/admin/stock-items` | `inventory.movement.write` | `inventory.stock` |
| GET | `/api/v1/admin/branches/:branchId/balances` | `inventory.balance.read` | `inventory.stock` |
| GET | `/api/v1/admin/branches/:branchId/movements` | `inventory.balance.read` | `inventory.stock` |
| POST | `/api/v1/admin/branches/:branchId/adjustments` | `inventory.movement.write` | `inventory.stock` |
| POST | `/api/v1/admin/transfers` | `inventory.movement.write` | `inventory.stock` |
| GET | `/api/v1/admin/suppliers` | `inventory.supplier.read` | `inventory.supplier` |
| POST | `/api/v1/admin/suppliers` | `inventory.supplier.write` | `inventory.supplier` |
| PATCH | `/api/v1/admin/suppliers/:supplierId` | `inventory.supplier.write` | `inventory.supplier` |
| GET | `/api/v1/admin/purchases` | `inventory.purchase.read` | `inventory.purchase` |
| POST | `/api/v1/admin/purchases` | `inventory.purchase.write` | `inventory.purchase` |
| POST | `/api/v1/admin/purchases/:purchaseId/receive` | `inventory.purchase.write` | `inventory.purchase` |

Adjustments and transfers send a signed or paired delta plus `Idempotency-Key`. They do not send a new absolute on-hand value. The server computes the next balance.

### Recipes

Module `recipe.management`.

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/v1/admin/products/:productId/recipes` | `recipe.read` |
| POST | `/api/v1/admin/products/:productId/recipes` | `recipe.write` |
| PATCH | `/api/v1/admin/recipes/:recipeId` | `recipe.write` |
| POST | `/api/v1/admin/recipes/:recipeId/activate` | `recipe.write` |
| POST | `/api/v1/admin/recipes/cost-preview` | `recipe.read` |

Cost preview is a dry run. It returns ingredient cost, suggested margin, and the integer consumption for a sample quantity. It does not move stock.

### Expenses

Module `expense.management`.

| Method | Path | Permission |
| --- | --- | --- |
| GET, POST | `/api/v1/admin/expense-categories` | `expense.read` / `expense.write` |
| GET, POST | `/api/v1/admin/expenses` | `expense.read` / `expense.write` |
| GET, PATCH | `/api/v1/admin/expenses/:expenseId` | `expense.read` / `expense.write` |
| POST | `/api/v1/admin/expenses/:expenseId/approval` | `expense.approve` |

Approval body: `{ "status": "approved" | "rejected" }`.

### Customers, terminals, settings

| Method | Path | Permission | Module |
| --- | --- | --- | --- |
| GET, POST, PATCH | `/api/v1/admin/customers` | `customer.read` / `customer.write` | `customer.management` |
| GET, POST, PATCH | `/api/v1/admin/terminals` | `settings.business.read` / `write` | `pos.billing` |
| GET, PATCH | `/api/v1/admin/settings` | `settings.business.read` / `write` | |
| GET, PATCH | `/api/v1/admin/tax-configs` | `settings.business.read` / `write` | `tax.gst` |
| GET | `/api/v1/admin/modules` | `settings.module.read` | |
| PATCH | `/api/v1/admin/modules/:code/settings` | `settings.module.write` | that code |

Tenant admins cannot enable a module the platform has not assigned. `PATCH` settings returns 403 when `enabled` is false.

### Reports

| Method | Path | Permission | Module |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/reports/sales-summary` | `report.sales.read` | `reports.sales` |
| GET | `/api/v1/admin/reports/products` | `report.sales.read` | `reports.sales` |
| GET | `/api/v1/admin/reports/payments` | `report.sales.read` | `reports.sales` |
| GET | `/api/v1/admin/reports/profit` | `report.finance.read` | `reports.finance` |
| GET | `/api/v1/admin/reports/inventory` | `inventory.balance.read` | `inventory.stock` |
| GET | `/api/v1/admin/reports/expenses` | `report.finance.read` | `reports.finance` |
| GET | `/api/v1/admin/reports/tax` | `report.finance.read` | `tax.gst` |
| POST | `/api/v1/admin/reports/exports` | `report.export` | matching report module |

Query filters on summaries: `from`, `to`, `branchId`, `categoryId`, `productId`, `paymentMethod`, `userId`, `orderType`.

Export body: `{ "report": "sales-summary", "format": "pdf" | "xlsx" | "csv", "filters": {} }`. The response is the file when generation is fast enough to finish in the request. When Redis arrives, the same route may return 202 and a document id; the JSON shape gains an optional `jobId` and clients must tolerate either a file or a job. Phase 6 implements the synchronous file response.

Dashboard numbers for the admin home are `GET /api/v1/admin/reports/sales-summary` and `GET /api/v1/admin/reports/profit` with preset ranges (`today`, `yesterday`, `week`, `month`). The formulas are in [ARCHITECTURE.md](ARCHITECTURE.md).

## POS

Audience `tenant`. Prefix `/api/v1/pos`. Module `pos.billing` unless noted. Cashier permission keys apply.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/pos/auth/login` | Requires an openable branch in `branchIds`. |
| POST | `/api/v1/pos/auth/refresh` | |
| POST | `/api/v1/pos/auth/logout` | |
| GET | `/api/v1/pos/bootstrap` | Catalog version, modules, payment methods, tax mode, stock policy, terminal |
| POST | `/api/v1/pos/shifts` | Open shift. Body includes `openingCashMinor` as a decimal string field `openingCash`. |
| POST | `/api/v1/pos/shifts/:shiftId/close` | `closingCash` decimal string |
| GET | `/api/v1/pos/catalog` | Search `q`, `categoryId`. Module `catalog.products` |
| GET | `/api/v1/pos/barcodes/:code` | Module `catalog.barcode` |
| POST | `/api/v1/pos/orders` | Price is recomputed. Idempotency-Key required |
| GET | `/api/v1/pos/orders` | History for the caller's branches |
| GET | `/api/v1/pos/orders/:orderId` | |
| POST | `/api/v1/pos/orders/:orderId/hold` | |
| POST | `/api/v1/pos/orders/:orderId/resume` | |
| POST | `/api/v1/pos/orders/:orderId/cancel` | Body `reason`. Stock rule depends on preparation state |
| POST | `/api/v1/pos/orders/:orderId/payments` | Cash online or offline-sync. Gateway payments use the Razorpay routes |
| POST | `/api/v1/pos/orders/:orderId/refunds` | `pos.order.refund` |
| GET | `/api/v1/pos/orders/:orderId/receipt` | JSON receipt. `?format=pdf` returns a PDF |
| POST | `/api/v1/pos/orders/:orderId/kitchen` | Module `restaurant.kds`. Body `kitchenStatus` |

Razorpay, module `payments.razorpay`:

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/pos/orders/:orderId/razorpay/orders` | Creates a Razorpay order. Returns `keyId` and `providerOrderId`. |
| POST | `/api/v1/pos/orders/:orderId/razorpay/verify` | Verifies the checkout signature and captures locally. |

`POST /api/v1/webhooks/razorpay` is unauthenticated at the session layer and authenticated by the webhook signature. Duplicate `providerEventId` returns 200 without a second capture.

## Sync

Audience `tenant`. Documented in [OFFLINE-SYNC.md](OFFLINE-SYNC.md).

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/sync/batches` | Batch of order, movement, and cash payment operations |
| GET | `/api/v1/sync/catalog` | `since` catalog version |
| GET | `/api/v1/sync/conflicts` | Open conflicts for an authorized branch |
| POST | `/api/v1/sync/conflicts/:conflictId/resolve` | Records resolution note. Stock fixes go through adjustments |

Sync routes require `pos.order.create` and an active terminal id that belongs to the user's branch. They re-check module access. A disabled `recipe.management` module rejects recipe explosions and accepts only products that do not need a recipe, even if the terminal cached the recipe earlier.

## Compatibility

Additive response fields are compatible. Removing a field, changing a type, or changing an idempotency rule requires `/api/v2` and a note in each client repository's changelog. The Phase 1 catalog is version `2026-11-04`.
