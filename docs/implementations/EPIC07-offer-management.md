# EPIC07 — Offer Management

Sprint 7. Goal: authenticated customers submit price offers on FOR_SALE vehicles; Managers approve (auto-creating a Reservation) or reject; customers may resubmit rejected offers; Manager Portal surfaces branch-scoped offer management.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC07-T1 | Offer Domain Model — `Offers` entity, `OfferStatus` enum, DB schema | Done |
| EPIC07-T2 | Offer Service — `submitOffer`, `approveOffer` (→ Reservation), `rejectOffer` actions | Open |
| EPIC07-T3 | Offer Resubmission — `resubmitOffer` action; valid only from REJECTED status | Open |
| EPIC07-T4 | Manager Portal Extension — branch-scoped `Offers` projection, approve/reject actions | Open |

### Sprint Backlog DoD mapping

- "Offer Submission" → EPIC07-T1, T2
- "Offer Approval (→ Reservation)" → EPIC07-T2
- "Offer Rejection" → EPIC07-T2
- "Resubmission of rejected offers" → EPIC07-T3
- "Manager Portal" → EPIC07-T4

### Sign-off

_To be completed at sprint end._

---

## T1 — Offer Domain Model

**What & Why:** `Offers` captures a customer's price proposal for a FOR_SALE vehicle. Unlike Reservations, there is no guest path — `customer_ID` is always set. `rejectionNotes` is stored on the Offer so Managers can explain why a price was refused, giving the customer context for a resubmission. The `UNDER_REVIEW` status is reserved for a future "Manager opened the offer" UI state and is not transitioned to by any handler in this epic. Approval triggers a Reservation in the service handler (T2), not via a DB constraint or event.

### Create `modules/offer/db/offer.cds`

```cds
namespace automarket;

using {BaseEntity}          from '../../../shared/types/common';
using {automarket.Vehicles} from '../../vehicle/db/vehicle';
using {automarket.Branches} from '../../branch/db/branch';

// Offers is a customer price proposal below the vehicle's list price.
// Unlike Reservations, there is no guest path — customer_ID is always set.
// On approval, a Reservation is created by the handler (not here); the Offer
// record itself transitions to APPROVED and becomes read-only.
entity Offers : BaseEntity {
    vehicle           : Association to Vehicles;
    branch            : Association to Branches;
    // customer_ID is never null — Offer requires an authenticated session.
    customer_ID       : String(255);
    offeredPrice      : Decimal(15, 2);
    currency          : String(3) default 'TRY';
    desiredPickupDate : Date;
    status            : OfferStatus default 'SUBMITTED';
    // rejectionNotes lets the Manager explain why an offer was rejected,
    // so the customer can make a better resubmission.
    rejectionNotes    : String(1000);
}

// OfferStatus lifecycle: SUBMITTED → UNDER_REVIEW → APPROVED
//                                               ↘ REJECTED (customer may resubmit)
//                                               ↘ EXPIRED  (system, 48h after approval)
type OfferStatus : String enum {
    SUBMITTED;    // customer submitted, awaiting Manager review
    UNDER_REVIEW; // Manager opened the offer — reserved for future UI state
    APPROVED;     // Manager approved; a Reservation has been created
    REJECTED;     // Manager rejected; customer may resubmit
    EXPIRED;      // 48h elapsed after approval without checkout
};
```

### Modify `db/index.cds` — add offer import

Add after the test-drive line:

```cds
using from '../modules/offer/db/offer';
```
