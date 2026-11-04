# ADR 006 — OpenAPI in pos-backend is the only shared contract

## Status

Accepted

## Context

`pos-desktop`, `pos-admin-frontend`, and `pos-backend` are separate Git repositories. A fourth repository for shared TypeScript types would need its own release train and would be easy to bypass. Copying types by hand with no version will drift.

## Decision

`pos-backend` owns the HTTP contract as OpenAPI. The Phase 1 catalog is [../API.md](../API.md). From Phase 3 onward the running server serves the generated spec, and each frontend copies or generates its client against a pinned spec version.

Breaking changes bump `/api/v1` only when the resource cannot be extended in a compatible way. Additive fields are allowed. Removing or retyping a field requires a new version prefix and a note in the changelog of all three repositories.

## Consequences

- Frontend repositories duplicate generated types on purpose. The duplication is versioned and replaceable.
- A backend change that alters the contract is not done until the spec and the affected client repositories are identified in the same change record. See [../CHECKLIST.md](../CHECKLIST.md).
- No package is published from one repo into another during Phase 1 or Phase 2.
