# EPIC05 — Reservations & Guest Checkout

Sprint 5. Goal: reservation lifecycle, concurrency enforcement, guest checkout with token-based access, claim flow, and expiry job.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC05-T1 | Reservation Domain Model — `Reservations` entity, `ReservationStatus` enum, `guestToken` field, DB schema | Done |
| EPIC05-T2 | Reservation Service — `createReservation`, `approveReservation`, `rejectReservation`, `cancelReservation`, `completeReservation` actions; VehicleStateMachine integration | Open |
| EPIC05-T3 | Concurrency Guard — `SELECT FOR UPDATE` row lock on Vehicle before guard evaluation; partial unique index on active reservations | Open |
| EPIC05-T4 | Guest Checkout — guest `createReservation` without auth, signed `guestToken` issuance, guest read/cancel via token | Open |
| EPIC05-T5 | Claim Flow — `claimReservation` action, `ReservationClaimed` event, `customer_ID` set + `guestToken` cleared | Open |
| EPIC05-T6 | Reservation Expiry Job — periodic scan past `createdAt + 48h`, emit `ReservationExpired`, trigger `VehicleReleased` | Open |
| EPIC05-T7 | Operator Portal Extension — reservation list/approve/reject, branch-scoped ABAC | Open |

### Sprint Backlog DoD mapping

- "Reservation Lifecycle" → EPIC05-T1, T2
- "Concurrency & Uniqueness Enforcement" → EPIC05-T3
- "Guest Checkout & Claim Flow" → EPIC05-T4, T5
- "Reservation Expiry" → EPIC05-T6
- "Operator Portal" → EPIC05-T7

### Sign-off

_To be completed at sprint end._

---

## T1 — Reservation Domain Model

**What & Why:** `Reservations` is the aggregate that gates a vehicle out of the `FOR_SALE` pool. `customer_ID` and `guestToken` are mutually exclusive fields — only one is set at a time, enforced by convention and documented in the entity comment. `expiresAt` is set once at creation (`createdAt + 48h`) and is never reset by failed checkout attempts (Sprint Backlog §20 rule). The full uniqueness constraint (one active reservation per vehicle) is deferred to T3 where the partial unique index and row lock are added.

### Create `modules/reservation/db/reservation.cds`

```cds
namespace automarket;

using {BaseEntity}          from '../../../shared/types/common';
using {automarket.Vehicles} from '../../vehicle/db/vehicle';
using {automarket.Branches} from '../../branch/db/branch';

// Reservations is the aggregate that gates a vehicle from the FOR_SALE pool.
// Exactly one reservation per vehicle may be in REQUESTED or APPROVED status
// at any time — enforced by a partial unique index (see T3) AND a SELECT FOR
// UPDATE lock taken before the guard runs.
//
// customer_ID and guestToken are mutually exclusive:
//   - Identified customer: customer_ID = req.user.id, guestToken = null
//   - Guest: customer_ID = null, guestToken = signed JWT issued at creation
//   - Claimed: customer_ID set, guestToken cleared (see claimReservation, T5)
entity Reservations : BaseEntity {
    vehicle      : Association to Vehicles;
    branch       : Association to Branches;
    customer_ID  : String(255);
    guestToken   : String(2000);
    status       : ReservationStatus default 'REQUESTED';
    // expiresAt is always createdAt + 48h, set once at creation and never
    // reset — even if a checkout attempt fails (Sprint Backlog §20).
    expiresAt    : Timestamp;
    notes        : String(1000);
}

// ReservationStatus mirrors the reservation lifecycle in Implementation
// Architecture §13. Transitions are enforced by ReservationService handlers.
type ReservationStatus : String enum {
    REQUESTED;  // created, awaiting Operator/Manager approval
    APPROVED;   // approved, vehicle is reserved
    REJECTED;   // rejected by Operator/Manager; vehicle returns to FOR_SALE
    CANCELLED;  // cancelled by customer or guest; vehicle returns to FOR_SALE
    EXPIRED;    // not actioned within 48h; vehicle returns to FOR_SALE
    COMPLETED;  // reservation fulfilled (checkout handed off to Sales)
};
```

### Modify `db/index.cds` — add reservation import

```diff
 using from '../modules/favorites/db/favorites';
+
+using from '../modules/reservation/db/reservation';
```
