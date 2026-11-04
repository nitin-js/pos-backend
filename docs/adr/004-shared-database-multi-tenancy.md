# ADR 004 — Shared database, tenant-scoped collections

## Status

Accepted

## Context

Every business document must be invisible to every other business. The platform also needs cross-tenant operations: module assignment, usage analytics, and health.

A database per tenant isolates data strongly and makes migrations, backups, and platform analytics operationally expensive at the expected tenant count. A collection per tenant duplicates indexes and application code.

## Decision

One MongoDB database. Every business collection carries `tenantId`. Every business repository method takes a `TenantScope` and includes `tenantId` in the filter. There is no unscoped finder for business data.

`tenantId` on a write comes from the verified access token. Body, query, and header values with the same name are ignored.

Platform collections (`platform_users`, `platform_roles`, `platform_sessions`, `tenants`, `plans`, `module_definitions`, `system_settings`) have no `tenantId`. Platform routes require `aud = platform`. Tenant routes require `aud = tenant`.

Compound indexes on business collections start with `tenantId`.

## Consequences

- Isolation is an application and index invariant. A missing `tenantId` predicate is a defect, and tenant-isolation tests must cover every business repository.
- A noisy neighbour can load the shared cluster. Enterprise isolation, if a customer requires it, is a later ADR that moves one tenant to a dedicated database behind the same repositories.
- Super Admin reads a named tenant by an explicit, authorized id. That id is still applied as `tenantId` inside the repository call.
