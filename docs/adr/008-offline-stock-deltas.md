# ADR 008 — Offline stock sync applies deltas

## Status

Accepted

## Context

Three terminals can sell while disconnected and share one ingredient pool. If each terminal posts the on-hand quantity it believes is correct, the last sync overwrites the other sales. If the server rejects the sale because stock would go negative, revenue disappears for goods the customer already received.

Absolute compare-and-swap on a cached balance fails for the same reason: both terminals read the same version while offline and only one write can win.

## Decision

Stock sync is append-only. Each offline sale carries stock movements with a signed base-unit quantity and an idempotency key. The server applies unseen movements inside a transaction and adjusts `inventory_balances` by that delta.

The server never writes a client-supplied on-hand figure.

If the resulting on-hand quantity is negative, the movement still commits and a `sync_conflicts` document records an oversell. A manager reconciles it with a count adjustment. The sale remains.

Catalog and price edits are online-only. The order stores the price, tax, recipe version, and unit cost it sold, so a later catalog change does not rewrite the ticket.

## Consequences

- Negative stock is a business signal, not a failed sync.
- Idempotency keys are mandatory on order, payment, and movement writes. The unique index is `(tenantId, idempotencyKey)`.
- The full protocol is [../OFFLINE-SYNC.md](../OFFLINE-SYNC.md).
