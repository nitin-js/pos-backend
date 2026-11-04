# Development checklist

Update this file when a phase item lands. A database feature is unfinished until its migration, models, services, API catalog note, tests, and this checklist agree.

## Phase 1 — Architecture

Repository: all three, documentation only.

- [x] System and application architecture (`docs/ARCHITECTURE.md`)
- [x] Database schema, ER diagram, migration policy (`docs/DATABASE.md`)
- [x] Module dependency design (in `docs/ARCHITECTURE.md`)
- [x] Tenant isolation strategy (ADR 004 and architecture)
- [x] Offline sync strategy (`docs/OFFLINE-SYNC.md`, ADR 008)
- [x] API catalog (`docs/API.md`)
- [x] Roadmap (`docs/ROADMAP.md`)
- [x] ADRs 001–010
- [x] Admin screen map in `pos-admin-frontend`
- [x] POS screen map and offline client note in `pos-desktop`

## Phase 2 — Environment

- [ ] `pos-backend` TypeScript project, lint, Vitest, Supertest
- [ ] Express app with health routes and standard error envelope
- [x] `migrate-mongo` wired to `schema_migrations`, scripts `migrate:create`, `migrate:up`, `migrate:down`, `migrate:status`
- [x] Initial collections and indexes applied to `pos-db` (`20261104194900-create-initial-collections.js`)
- [ ] Boot refuses to serve when the applied migration is behind `EXPECTED_MIGRATION`
- [x] Local database recorded: `mongodb://localhost:27017`, database `pos-db`, tests on `pos-db-test`
- [ ] Replica set on that same mongod before transactional tests, or those tests stay skipped
- [ ] `pos-admin-frontend` workspaces, both Vite apps, shared packages
- [ ] `pos-desktop` Vite PWA shell
- [ ] README setup steps that match the scripts

## Phase 3 — Tenancy

- [ ] Migrations: platform users, roles, sessions, tenants, plans, subscriptions, module definitions, tenant modules, branches, users, roles, sessions, audit logs, login history
- [ ] Argon2id, access token, rotating refresh, password reset
- [ ] Tenant status transitions and soft delete
- [ ] Module assignment rejects broken dependency graphs
- [ ] Preset roles and custom roles limited to enabled modules
- [ ] Tests: cross-tenant read, disabled module, suspended tenant, refresh reuse
- [ ] Super Admin screens for tenants and modules
- [ ] Business Admin and POS login plus bootstrap

## Phase 4 — POS core

- [ ] Migrations: categories, products, barcodes, orders, payments, shifts, terminals, sequences, tax configs
- [ ] Server-side price, discount, GST inclusive and exclusive
- [ ] Cash tender, split tender, hold and resume, cancel, receipt
- [ ] Idempotency on order create
- [ ] Admin catalog screens
- [ ] POS billing screen
- [ ] Tests for tax rounding and idempotent retry

## Phase 5 — Inventory and recipes

- [ ] Migrations: stock items, balances, movements, recipes, suppliers, purchases
- [ ] Sale transaction posts movements once
- [ ] Recipe consumption integer math, wastage basis points, substitutions stored on the line
- [ ] Cancel before preparation reverses or releases; cancel after preparation does not restock
- [ ] Purchase receive updates latest cost and balance
- [ ] Unit test: 100 kg onion, 100 g per sandwich, one sale, one hundred sales
- [ ] Admin inventory and recipe screens

## Phase 6 — Admin operations

- [ ] Migrations: expenses, expense categories, files, invoices
- [ ] Dashboard metrics and charts data from the report routes
- [ ] Profit definitions match the architecture document
- [ ] PDF, XLSX, CSV export with filters and `report.export`
- [ ] Employees, roles, branches, settings
- [ ] Expense approval

## Phase 7 — Offline

- [ ] Sync batch, catalog pull, conflicts
- [ ] Two-delta test and duplicate-key test
- [ ] Negative on-hand creates `sync_conflicts` and keeps the sale
- [ ] Absolute on-hand payload is rejected
- [ ] Desktop outbox and conflict UI
- [ ] Admin conflict list

## Phase 8 — Razorpay and adapters

- [ ] Razorpay order, verify, webhook signature, event id uniqueness, refund
- [ ] Secret stays in the environment
- [ ] Swiggy, Zomato, Porter documented `partner_only` and return `integration_unavailable`
- [ ] No adapter that fabricates orders
- [ ] Reconciliation screen

## Phase 9 — Electron

- [ ] Electron main process and preload bridge
- [ ] SQLite outbox using the same protocol as IndexedDB
- [ ] Receipt printer
- [ ] Auto-update strategy documented and implemented
- [ ] Renderer has no direct Node import

## Phase 10 — Release

- [ ] GitHub Actions on each repository
- [ ] Playwright cafe journey
- [ ] Security pass: tenant isolation, webhook signature, rate limit
- [ ] Backup and restore note exercised on a staging dump
- [ ] Production migration runbook

## Feature change record

Copy this into the pull request before writing the feature.

```text
Repository:
Module:
New files:
Edited files:
API catalog change:
Migration (up and down):
Other repositories that must change:
Tests:
```

A backend contract change is incomplete while the matching client repository still calls the old shape, unless the change is purely additive and the client can ignore the new field.
