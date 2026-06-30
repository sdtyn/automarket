# EPIC08 — Sales

Sprint 8. Goal: online vehicle purchase flow — Order creation with vehicle checkout transition, cancellation, completion, and payment choreography (PaymentSucceeded/Failed → Order + Vehicle reactions). Payment provider integration is Sprint 9 (EPIC09); this epic owns the Order aggregate and its event subscribers.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC08-T1 | Sales Domain Model — `Orders` entity, `OrderStatus`/`DeliveryType` enums, partial unique constraint | Done |
| EPIC08-T2 | Sales Service — `createOrder` (→ vehicle PENDING_PAYMENT), `cancelOrder`, `completeOrder` | Open |
| EPIC08-T3 | Payment Choreography — `PaymentSucceeded` → order PAID + vehicle SOLD; `PaymentFailed` → order CANCELLED + vehicle released | Open |

### Sprint Backlog DoD mapping

- "Order Creation" → EPIC08-T1, T2
- "Order-level uniqueness constraint" → EPIC08-T1
- "Cross-aggregate choreography" → EPIC08-T2 (CheckoutStarted), T3 (PaymentSucceeded/Failed)

### Sign-off

_To be completed at sprint end._

---

## T1 — Sales Domain Model

**What & Why:** `Orders` tracks the customer's purchase intent from checkout through fulfilment. There is no guest path — `customer_ID` is always set. The `@sql.append` partial unique index enforces Domain Model Rule S-1 at the DB level: only one order per vehicle may be in CREATED, PENDING_PAYMENT, or PAID status simultaneously. This is defense-in-depth alongside the Vehicle state guard — relying on the application-level check alone leaves a race window under concurrent requests.

### Create `modules/sales/db/sales.cds`

```cds
namespace automarket;

using {BaseEntity}          from '../../../shared/types/common';
using {automarket.Vehicles} from '../../vehicle/db/vehicle';
using {automarket.Branches} from '../../branch/db/branch';

// Orders is the aggregate that represents a confirmed purchase intent.
// Unlike Reservations, an Order always has a customer — there is no guest path.
// The vehicle transitions to PENDING_PAYMENT when the Order is created;
// the Order itself moves through CREATED → PENDING_PAYMENT → PAID → COMPLETED.
//
// The partial unique index below enforces Domain Model Rule S-1: only one active
// order per vehicle. It is defense-in-depth alongside the Vehicle-level state
// guard — either one missing leaves a race window.
@sql.append: 'UNIQUE (vehicle_ID) WHERE status IN (''CREATED'', ''PENDING_PAYMENT'', ''PAID'')'
entity Orders : BaseEntity {
    vehicle      : Association to Vehicles;
    branch       : Association to Branches;
    // customer_ID is never null — Order always requires authentication.
    customer_ID  : String(255);
    orderDate    : DateTime;
    deliveryType : DeliveryType;
    status       : OrderStatus default 'CREATED';
}

type DeliveryType : String enum {
    CUSTOMER_PICKUP; // customer collects from branch
    HOME_DELIVERY;   // vehicle delivered to customer address
};

// OrderStatus lifecycle: CREATED → PENDING_PAYMENT → PAID → COMPLETED
//                                              ↘ CANCELLED (by customer, admin, or payment failure)
type OrderStatus : String enum {
    CREATED;         // order placed, awaiting payment initiation
    PENDING_PAYMENT; // payment flow started, vehicle locked
    PAID;            // payment captured; awaiting fulfilment
    COMPLETED;       // vehicle handed over
    CANCELLED;       // cancelled before payment, or payment failed
};
```

### Modify `db/index.cds` — add sales import

Add after the offer line:

```cds
using from '../modules/sales/db/sales';
```
