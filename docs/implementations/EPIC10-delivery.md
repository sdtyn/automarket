# EPIC10 — Delivery

Sprint 10. Goal: home-delivery lifecycle for completed orders — scheduling, progress tracking, completion, and failure recording. CUSTOMER_PICKUP orders are explicitly rejected at the service layer; only HOME_DELIVERY orders get a Delivery record.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC10-T1 | Delivery Domain Model — `Deliveries` entity, `DeliveryStatus` enum | Done |
| EPIC10-T2 | Delivery Service — `scheduleDelivery`, `updateDelivery`, `completeDelivery` | Done |

### Sprint Backlog DoD mapping

- "Delivery scheduling" → EPIC10-T2 (`scheduleDelivery`)
- "Delivery status tracking" → EPIC10-T1 (entity + enum), T2 (`updateDelivery`)
- "Delivery completion" → EPIC10-T2 (`completeDelivery`)

### Sign-off

All two tickets delivered and CI green. Sprint completed 2026-06-30.

---

## T2 — Delivery Service

**What & Why:** `DeliveryService` enforces that only HOME_DELIVERY orders get a Delivery record — `scheduleDelivery` rejects CUSTOMER_PICKUP orders with a 409. The duplicate-active-delivery check prevents a second scheduling call from creating a parallel record while the first is still PLANNED or IN_PROGRESS. `updateDelivery` accepts both `plannedDate` and `status` as optional fields, but requires at least one to avoid a no-op call. DELIVERED and FAILED are terminal statuses; `updateDelivery` rejects any attempt to modify them. `completeDelivery` accepts both PLANNED and IN_PROGRESS so that a branch operator who skipped the IN_PROGRESS step can still complete the delivery directly.

### Create `modules/delivery/api/delivery-service.cds`

_(full content as written above)_

### Create `modules/delivery/application/delivery-service.js`

_(full content as written above)_

### Modify `srv/index.cds`

```cds
using from '../modules/delivery/api/delivery-service';
```

### Modify `package.json`

```json
"DeliveryService": { "impl": "modules/delivery/application/delivery-service.js" }
```

---

## T1 — Delivery Domain Model

**What & Why:** `Deliveries` tracks the physical vehicle handover for HOME_DELIVERY orders only. The domain model itself is neutral — it has no guard against CUSTOMER_PICKUP orders. That guard lives in the service layer (T2) so the entity stays a plain data record. `deliveredDate` is null until `completeDelivery` populates it, keeping the timeline auditable.

### Create `modules/delivery/db/delivery.cds`

```cds
namespace automarket;

using {BaseEntity}        from '../../../shared/types/common';
using {automarket.Orders} from '../../sales/db/sales';

// Deliveries tracks the physical handover of a vehicle for HOME_DELIVERY orders.
// A Delivery record is created only when scheduleDelivery is called —
// CUSTOMER_PICKUP orders never have a corresponding row here.
// deliveredDate is null until completeDelivery sets it.
entity Deliveries : BaseEntity {
    order         : Association to Orders;
    plannedDate   : Date;
    // deliveredDate is populated by completeDelivery; null while in progress.
    deliveredDate : Date;
    status        : DeliveryStatus default 'PLANNED';
}

// DeliveryStatus lifecycle: PLANNED → IN_PROGRESS → DELIVERED
//                                    ↘ FAILED (terminal — delivery could not be completed)
type DeliveryStatus : String enum {
    PLANNED;      // scheduled but not yet started
    IN_PROGRESS;  // vehicle is en route
    DELIVERED;    // vehicle handed over to customer
    FAILED;       // delivery could not be completed
};
```

### Modify `db/index.cds`

```cds
using from '../modules/delivery/db/delivery';
```
