# ADR 010 — Redis and BullMQ wait for asynchronous work

## Status

Accepted

## Context

The target stack includes Redis and BullMQ for cache and background jobs. Phase 2 and Phase 3 are authentication, tenancy, and the module registry. Those paths are request-scoped MongoDB reads and writes. Adding Redis in the first bootstrapped environment creates a service that nothing calls.

Webhooks, report exports, and partner retries do need a queue. Those features arrive in Phases 6 and 8.

## Decision

Phase 2 uses the local MongoDB at `mongodb://localhost:27017`, database `pos-db`. Redis and BullMQ are introduced with the first feature that has a retrying background job: report generation, Razorpay webhook processing, or an integration retry. Until then, work runs in the request or is stored as a document the API can resume (`sync_inbox`, `integration_logs`).

Permission and module lookups use a short in-process cache keyed by role and tenant. That cache is per process and is safe to drop.

## Consequences

- The Phase 2 setup stays small enough to run and test.
- When Redis arrives, the ADR trail gets a follow-up that names the first queue and the failure mode if Redis is down. Payment capture state remains in MongoDB either way, so a queue outage cannot be the only record of a payment.
