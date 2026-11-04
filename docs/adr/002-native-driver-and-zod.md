# ADR 002 — MongoDB Node driver and Zod

## Status

Accepted

## Context

An ODM such as Mongoose can hide casts, default values, and middleware. Those hooks are dangerous for money and stock: a number field can become a float, and a middleware hook can write outside the transaction the service opened.

Indexes and collection validators must live in versioned migrations (`migrate-mongo`), not in model decorators that drift from what production has applied.

## Decision

Repositories use the official MongoDB Node driver. Request and document shapes are validated with Zod in the service layer before a write. Mongoose is not a dependency.

`migrate-mongo` owns collections, indexes, and JSON Schema validators. The history collection is `schema_migrations`. The process does not run migrations on startup. On boot it reads the latest applied migration and refuses to serve if that version is behind the version baked into the build.

## Consequences

- Repositories are more verbose and must pass `ClientSession` explicitly.
- There is one schema story: the migration file, the Zod type, and the OpenAPI schema must be updated in the same change.
- Drivers and Zod versions are pinned in `pos-backend` only.
