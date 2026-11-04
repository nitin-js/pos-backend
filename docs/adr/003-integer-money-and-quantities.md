# ADR 003 — Integer money and integer quantities

## Status

Accepted

## Context

JavaScript numbers are IEEE-754 floats. A sandwich recipe that deducts 100 grams from 100 kilograms cannot be computed with binary floating point if the books are expected to reconcile. Currency has the same problem.

## Decision

- Money is an integer count of minor units. For INR, one unit is one paise. Field names end in `Minor`.
- Tax and discount rates are integer basis points. `1800` means 18 percent. Field names end in `Bps`.
- Quantities are integers in a base unit stored on the stock item:
  - `mg` for mass
  - `ml` for volume
  - `milli_each` for countable items, where 1000 equals one piece, slice, or other display unit
- Recipe consumption, tax, and margin use integer arithmetic with half-up rounding at the line.
- APIs accept and return decimal strings at the boundary (`"99.9"`, `"500.00"`) together with the unit code. The server converts to integers before any write. Clients never send a precomputed on-hand quantity that the server trusts.

## Consequences

- Display formatting is a UI concern. Persistence and domain math never see floats.
- Adding a currency with a different minor-unit scale is a tenant setting (`minorUnitScale`, default 2) applied at the API boundary. Stored values stay integers in that tenant's minor unit.
- Reports sum stored integers and format only in the exporter.
