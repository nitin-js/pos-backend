# Roadmap

Phase 1 writes this design and does not scaffold applications. Each later phase ends with a build and the tests that phase introduced. Work starts in the repository named on the row. A change that crosses repositories is listed on every row it touches and is not assumed to exist until that repository's commit lands.

## Phase 1 — Architecture

Status: this document set.

| Repository | Deliverable |
| --- | --- |
| `pos-backend` | Architecture, database, sync protocol, API catalog, ADRs, checklist |
| `pos-admin-frontend` | App boundaries, screen map, navigation |
| `pos-desktop` | POS boundaries, screen map, local offline design |

## Phase 2 — Working environment

| Repository | Deliverable |
| --- | --- |
| `pos-backend` | TypeScript, Express shell, Pino, Zod, Vitest, Supertest, `migrate-mongo` scripts, connection to `mongodb://localhost:27017` database `pos-db`, boot check for migration version, `/api/v1/health` |
| `pos-admin-frontend` | npm workspaces, Turborepo, Vite apps `business-admin` and `super-admin`, shared package folders, Tailwind, React Router, Zustand, TanStack Query |
| `pos-desktop` | Vite React app, Tailwind, router, Zustand, TanStack Query, PWA shell. No Electron dependency yet |

Exit test: each repo installs, lints, and runs its empty test suite. The API answers health against `pos-db` on `localhost:27017`.

## Phase 3 — Tenancy foundation

| Repository | Deliverable |
| --- | --- |
| `pos-backend` | Migrations for platform collections, users, roles, modules. Auth, refresh rotation, tenant CRUD, module assignment with dependency checks, preset roles, audit and login history. Supertest for isolation and module dependency |
| `pos-admin-frontend` | Super Admin login, tenant list and detail, module assignment. Business Admin login and a bootstrap-driven empty shell |
| `pos-desktop` | POS login against `/api/v1/pos/auth` and a bootstrap screen. No billing yet |

## Phase 4 — Core POS

| Repository | Deliverable |
| --- | --- |
| `pos-backend` | Catalog and order migrations. Pricing, tax, cash payment, hold, receipt JSON and PDF. Tests for discount, GST inclusive and exclusive, idempotent create |
| `pos-admin-frontend` | Products, categories, barcodes |
| `pos-desktop` | Billing screen: search, scan, cart, cash, receipt |

## Phase 5 — Inventory and recipes

| Repository | Deliverable |
| --- | --- |
| `pos-backend` | Stock items, balances, movements, purchases, recipes, consumption in the sale transaction, onion-case unit test |
| `pos-admin-frontend` | Inventory, suppliers, purchases, recipe editor with cost preview |
| `pos-desktop` | Sale of a recipe product shows updated stock only after the server responds, until Phase 7 caches deltas |

## Phase 6 — Business admin operations

| Repository | Deliverable |
| --- | --- |
| `pos-backend` | Expenses, report aggregations, export to PDF, XLSX, and CSV. Finance definitions from [ARCHITECTURE.md](ARCHITECTURE.md) |
| `pos-admin-frontend` | Dashboard, employees, roles, expenses, reports, branches, settings |
| `pos-desktop` | No new domain surface beyond showing receipt numbers and shift close |

## Phase 7 — Offline

| Repository | Deliverable |
| --- | --- |
| `pos-backend` | Sync routes and conflict tests, including two concurrent deltas and a retry |
| `pos-desktop` | IndexedDB outbox in the browser build. SQLite driver interface behind the same outbox API, implemented for real in Phase 9 if the shell is required first. Conflict list |
| `pos-admin-frontend` | Read-only conflict queue for the branch |

The protocol is [OFFLINE-SYNC.md](OFFLINE-SYNC.md). Phase 7 does not reinterpret it.

## Phase 8 — Payments and integration seams

| Repository | Deliverable |
| --- | --- |
| `pos-backend` | Razorpay order create, signature verify, webhook idempotency, refund. Adapter interface. Swiggy, Zomato, and Porter remain `partner_only` and return `integration_unavailable`. Redis and BullMQ only if webhook retry needs them |
| `pos-desktop` | Online Razorpay checkout using the public key id returned by the API |
| `pos-admin-frontend` | Payment reconciliation view. Integration status page that shows partner-only providers as unavailable |

## Phase 9 — Desktop shell

| Repository | Deliverable |
| --- | --- |
| `pos-desktop` | Electron main process, SQLite outbox, ESC/POS printing, preload bridge, auto-update. Renderer stays free of Node imports |
| `pos-backend` | No schema change expected. Printer settings already sit on `terminals` |
| `pos-admin-frontend` | None unless terminal printer fields need a form, which Phase 6 settings should already include |

## Phase 10 — Release

| Repository | Deliverable |
| --- | --- |
| `pos-backend` | GitHub Actions: lint, unit, Supertest, migration smoke. Backup note in the deploy docs |
| `pos-admin-frontend` | Production builds for both hosts. Playwright for the admin half of the cafe journey |
| `pos-desktop` | Playwright for billing. Packaged installer smoke test |

Cafe journey the suite must cover: Super Admin creates a cafe tenant and assigns billing, products, inventory, recipe, and expenses. Owner creates a sandwich and a recipe, receives onion stock, cashier sells one sandwich, onion falls by 100 g, owner records an expense and downloads the daily sales export. Separate tests cover a disabled table module, a cross-tenant read, a refund after preparation that does not restock, and a duplicated sync batch.

## Standing rule between phases

A feature commit names the repository, the module, new files, edited files, API changes, the migration file, the client repositories that must follow, and the tests. The template is in [CHECKLIST.md](CHECKLIST.md).
