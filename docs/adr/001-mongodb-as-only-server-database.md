# ADR 001 — MongoDB is the only server database

## Status

Accepted

## Context

The platform stores tenants, a dynamic module registry, product catalogs with embedded variants, orders with price snapshots, an inventory ledger, expenses, and sync metadata. Some of these records are document-shaped and change as modules are added. Sales, stock movements, and payments still need to commit together.

PostgreSQL is stronger for fixed relational ledgers. Running it beside MongoDB would split the catalog from the ledger and add a second migration system, a second backup path, and cross-database transactions the application would have to invent.

## Decision

MongoDB is the only database on the server. Operations that must succeed or fail together run inside a replica-set transaction.

Local development uses the MongoDB already running on this machine:

- `MONGODB_URI=mongodb://localhost:27017`
- `MONGODB_DB_NAME=pos-db`
- `MONGODB_DB_NAME_TEST=pos-db-test`

Tests must not write to `pos-db`. Production reads the URI and database name from the environment and does not inherit the local host.

SQLite exists only inside `pos-desktop` as the terminal's offline store. The desktop application has no MongoDB credentials and no direct database route to production.

## Consequences

- The local server is a standalone node. Ordinary reads and writes work. Multi-document transactions fail until that mongod is a replica set. The database name stays `pos-db` either way. Docker is not required while this local server is the development database.
- Money and quantities use integer fields so the lack of a decimal SQL type does not affect correctness. See ADR 003.
- A future regulated ledger can add PostgreSQL under a new ADR. Until that requirement exists, no server code opens a second database.
