# Investments foundation contract

This document freezes the first Investments implementation boundary. The app
stores executed orders, then derives positions from them. It does not store a
separate investment, price, FX or settlement-currency record.

## Identifiers and currencies

- Broker IDs are exactly `xtb` and `banca_transilvania`.
- An instrument is an uppercase, stable listing code such as `VWCE.DE`,
  `AAPL.US` or `TLV.BX`. It identifies one security and listing.
- `currency` is the instrument's quoted currency and must be an uppercase
  three-letter code. The initial examples are `EUR`, `USD` and `RON`.
- `amount`, `unitPrice` and `quantity` are strings at TypeScript/API
  boundaries. `amount` is the positive total order value in the instrument
  currency; it is not the broker's cash-settlement amount.

## Orders and calculation

Every order has a `side`: `buy` adds quantity and amount to the position;
`sell` removes quantity using the weighted-average cost immediately before the
sale. A sell larger than the position available at that timestamp is invalid.
Orders are processed by `executedAt`, then by `id` when timestamps match.

Calculated output strings are rounded to 10 fractional places, half-up, to
match the database's `numeric(28,10)` scale. No different currencies are ever
summed together.

## Representative examples

| Broker | Instrument | Currency | Order history | Expected position |
| --- | --- | --- | --- | --- |
| XTB | `VWCE.DE` | EUR | Buy 1.5 for 150; buy 0.25 for 30; sell 0.5 for 70 | Quantity `1.25`; remaining cost `128.5714285714`; average cost `102.8571428571`; realized gain `18.5714285714` |
| XTB | `AAPL.US` | USD | Buy 0.5 for 250 | Quantity `0.5`; remaining cost `250`; average cost `500`; realized gain `0` |
| Banca Transilvania | `TLV.BX` | RON | Buy 100 for 8,750 | Quantity `100`; remaining cost `8750`; average cost `87.5`; realized gain `0` |

The executable cases live in
[`src/lib/investments/aggregate.test.ts`](../src/lib/investments/aggregate.test.ts).
