# Sprint 2 — Branch & Vehicle Management (EPIC-03)

Local-only development scope (see CONTRIBUTING.md, "Deferred: BTP-Specific Work").

| # | Item | Status |
|---|---|---|
| EPIC03-T1 | Branch Domain Model — `Branches` entity, `BranchStatus` enum, CDS schema + db module file | Done |
| EPIC03-T2 | Branch Service — Branch CRUD API, Admin/Manager role guards, handlers | Done |
| EPIC03-T3 | Vehicle Domain Model — `Vehicles` entity (all attributes), `VehicleStatus` enum (DRAFT→DELIVERED+ARCHIVED), `VehicleImages` entity, CDS schema + db file | Done |
| EPIC03-T4 | Vehicle State Machine — `VehicleStateMachine` domain class, full authoritative transition table, guards, domain events | In Progress |
| EPIC03-T5 | Vehicle Service — Vehicle CRUD, `publish`/`archive` actions, `@odata.etag` on `modifiedAt` optimistic locking | Open |
| EPIC03-T6 | Vehicle Search — Filter endpoint (brand/model/price/status/branch), guest-accessible for `FOR_SALE` vehicles | Open |
| EPIC03-T7 | Vehicle Images — `VehicleImage` CRUD handlers, URL + sortOrder management, linked to Vehicle aggregate | Open |
| EPIC03-T8 | Cache-Bust Event Wiring — Wire `VehiclePublished`, `VehicleSold`, `VehicleReserved`, `VehicleReleased`, `VehicleCheckoutStarted` to catalog cache invalidation | Open |
| EPIC03-T9 | Operator Portal — Vehicle List, Vehicle Detail, Create Vehicle service projections (branch-scoped ABAC) | Open |
| EPIC03-T10 | Customer Portal — Vehicle Catalog + Vehicle Detail service projections, guest-accessible for `FOR_SALE` | Open |

## Sprint Backlog DoD mapping

- "Branch Module" → EPIC03-T1, T2
- "Vehicle Module" → EPIC03-T3, T4, T5, T6, T7, T8
- "Vehicle Portal Screens" → EPIC03-T9, T10

## Sign-off

_To be completed at sprint end._
