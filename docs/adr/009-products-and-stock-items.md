# ADR 009 — Sellable products are separate from stock items

## Status

Accepted

## Context

A cafe sells a sandwich and stocks onions. A trader sells a boxed item and stocks that same boxed item. One product collection with a quantity field cannot represent both a recipe explosion and a one-to-one retail deduction without conditionals spread through billing.

## Decision

`products` are what a cashier sells. `stock_items` are what a branch counts.

- A retail product or variant holds `stockItemId`. A sale writes one movement for that item, quantity times units sold.
- A prepared product holds an active `recipes` document. A sale explodes each recipe line into movements from `qtyMilli` and the line wastage basis points. The formula is in [../DATABASE.md](../DATABASE.md).
- A service product has neither, and a sale writes no stock movement.
- The same `stock_movements` ledger and `inventory_balances` projection serve every business type. Restaurant screens are modules on top of this ledger, not a second inventory.

## Consequences

- Creating a tracked retail product also creates or links a stock item. The catalog service does this in one transaction when `inventory.stock` is enabled.
- Recipe management cannot be enabled unless `inventory.stock` and `catalog.products` are enabled.
- Reporting COGS reads the unit cost snapshotted on the order line, which came from the stock item's latest purchase cost at sale time.
