# pos-backend

HTTP API for the multi-tenant POS platform. This repository holds authentication, tenant isolation, the module registry, catalog, inventory, recipes, orders, payments, expenses, reports, sync, and integrations.

Business Admin, Super Admin, and the POS client are other repositories. They call this API. They do not share this codebase, and this codebase does not contain their UI.

## Design

Phase 1 is the design. Implementation starts at Phase 2.

- [Architecture](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [Offline sync](docs/OFFLINE-SYNC.md)
- [API catalog](docs/API.md)
- [Roadmap](docs/ROADMAP.md)
- [Checklist](docs/CHECKLIST.md)
- [Decision records](docs/adr/)

## Boundaries

- MongoDB is the only server database. Migrations live in this repository and run as a deploy step, not on process startup.
- Money and stock quantities are integers. The rules are in the database document.
- `tenantId` on a tenant request comes from the access token.
- Disabled modules fail in the API even when a client hides the screen.
- Swiggy, Zomato, and Porter are not implemented as simulated providers. Razorpay is the first live payment integration, in Phase 8.

## Local test accounts

`npm run seed:admins` writes the super admin and the Morning Cafe business admin. It refuses to run when `MONGODB_URI` is not localhost, `127.0.0.1`, or `::1`, and it refuses `NODE_ENV=production`.

```text
npm run seed:admins
```

`npm run seed` uses the same guard, then adds the cashier and the sandwich catalog when they are missing.

Swagger UI is served at http://127.0.0.1:4000/api/docs. The document is also at `/api/docs/openapi.json`.

## Local database

The API uses the MongoDB already running on this machine. Copy `.env.example` to `.env`.

| Variable | Local value |
| --- | --- |
| `MONGODB_URI` | `mongodb://localhost:27017` |
| `MONGODB_DB_NAME` | `pos-db` |
| `MONGODB_DB_NAME_TEST` | `pos-db-test` |

`pos-db` has the 42 application collections from the initial migration, plus `schema_migrations`. The server is a standalone node, so multi-document transactions are unavailable until it is a replica set. See [docs/DATABASE.md](docs/DATABASE.md).

## Migrations

```text
npm run migrate:status
npm run migrate:up
npm run migrate:down
```

`npm run migrate:up` creates the collections in `pos-db`. The first migration has been applied on this machine.

## Status

The API listens on port 4000 after `npm run dev`. Migrations stay a separate `npm run migrate:up` step.
