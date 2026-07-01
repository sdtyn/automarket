# EPIC12 — Reporting

Sprint 12. Goal: read-model reporting layer for Admin/Manager dashboards. Report entities are CDS views over operational tables — in a production system they would be populated asynchronously from EventOutbox, but CDS views give the same service interface without extra infrastructure for this tutorial. Aggregation and funnel logic live in the service-layer functions.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC12-T1 | Reporting Domain — CDS view entities: `VehicleSalesReport`, `ReservationReport`, `OfferConversionReport`, `BranchPerformanceReport` | Done |
| EPIC12-T2 | Reporting Service — entity projections + `getSalesDashboard`, `getBranchPerformance`, `getConversionRates` | Open |

### Sprint Backlog DoD mapping

- "VehicleSalesReport / ReservationReport / OfferConversionReport / BranchPerformanceReport" → EPIC12-T1
- "getSalesDashboard / getBranchPerformance / getConversionRates(funnelType)" → EPIC12-T2

### Sign-off

_To be completed at sprint end._

---

## T1 — Reporting Domain

**What & Why:** Report entities are CDS views over operational tables. Two non-obvious decisions: (1) `vehicle_ID` is not a valid CDS element name in a view projection — the CDS element is the association `vehicle`, so FKs must be accessed via `vehicle.ID`; (2) Vehicles uses `brand` not `make` — using `vehicle.make` causes a compile error. Aggregation is intentionally left to the service-layer functions so the views stay database-agnostic (no GROUP BY in CDS views required).

### Create `modules/reporting/db/reporting.cds`

_(full content as written above)_

### Modify `db/index.cds`

```cds
using from '../modules/reporting/db/reporting';
```
