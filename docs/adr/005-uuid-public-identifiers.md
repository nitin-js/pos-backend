# ADR 005 — UUID strings as public identifiers

## Status

Accepted

## Context

Offline terminals create orders, payments, and stock movements before the server has seen them. If the server mints `ObjectId` values, the terminal must remap every local id after sync, and retries can duplicate rows.

## Decision

`_id` on every collection is a MongoDB ObjectId. The API and clients use the 24-character hex string. Idempotency keys stay client-generated strings and are separate from `_id`.

MongoDB `ObjectId` is not used as an external identifier.

## Consequences

- Indexes on `_id` remain unique. UUID strings are larger than ObjectIds and that cost is accepted.
- Foreign keys are plain strings. The driver does not cast them.
- Receipt numbers are separate from ids. They are gap-tolerant branch sequences assigned when the server accepts the order. Offline receipts print a local reference until sync returns the official number.
