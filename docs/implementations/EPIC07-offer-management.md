# EPIC07 — Offer Management

Sprint 7. Goal: authenticated customers submit price offers on FOR_SALE vehicles; Managers approve (auto-creating a Reservation) or reject; customers may resubmit rejected offers; Manager Portal surfaces branch-scoped offer management.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC07-T1 | Offer Domain Model — `Offers` entity, `OfferStatus` enum, DB schema | Done |
| EPIC07-T2 | Offer Service — `submitOffer`, `approveOffer` (→ Reservation), `rejectOffer` actions | Done |
| EPIC07-T3 | Offer Resubmission — `resubmitOffer` action; valid only from REJECTED status | Done |
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

---

## T2 — Offer Service

**What & Why:** `OfferService` owns the full offer lifecycle. `submitOffer` reads the vehicle's `branch_ID` from the DB so customers cannot forge it. `approveOffer` writes two rows atomically in the same CAP transaction: it flips the Offer to APPROVED and inserts an APPROVED Reservation with `expiresAt = now + 48h` — the same validity window as a normal Reservation. Connecting through ReservationService was avoided to prevent a circular service dependency. `rejectOffer` stores `rejectionNotes` so the customer has context for a resubmission (T3).

### Create `modules/offer/api/offer-service.cds`

```cds
using {automarket} from '../db/offer';

// OfferService manages the customer price-offer lifecycle.
// There is no guest path — all actions require an authenticated session.
service OfferService @(path: '/offer') {

    // Customers see only their own offers. Managers and Admins see all.
    @restrict: [
        {
            grant: 'READ',
            to   : 'Customer',
            where: 'customer_ID = $user'
        },
        {
            grant: 'READ',
            to   : [
                'Manager',
                'Admin'
            ]
        }
    ]
    entity Offers as projection on automarket.Offers;

    // submitOffer: creates a SUBMITTED offer for a FOR_SALE vehicle.
    // Branch is taken from the vehicle row — customers cannot specify it.
    @requires: 'Customer'
    action submitOffer(vehicleId:         String,
                       offeredPrice:      Decimal,
                       currency:          String,
                       desiredPickupDate: Date,
                       notes:             String)  returns String;

    // approveOffer: transitions offer to APPROVED and creates an APPROVED
    // Reservation for the same vehicle/customer. Only Manager and Admin.
    @requires: [
        'Manager',
        'Admin'
    ]
    action approveOffer(offerId: String)            returns Boolean;

    // rejectOffer: transitions offer to REJECTED. Customer may resubmit (T3).
    @requires: [
        'Manager',
        'Admin'
    ]
    action rejectOffer(offerId:         String,
                       rejectionNotes:  String)    returns Boolean;

    event OfferSubmitted { offerId : String; vehicleId : String; }
    event OfferApproved  { offerId : String; vehicleId : String; }
    event OfferRejected  { offerId : String; vehicleId : String; }
}
```

### Create `modules/offer/application/offer-service.js`

```js
'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { Offers, Reservations, Vehicles } = cds.entities('automarket');

  // submitOffer: verifies the vehicle is FOR_SALE, then inserts a SUBMITTED offer.
  // Branch is read from the vehicle row so the customer cannot spoof it.
  srv.on('submitOffer', async (req) => {
    const { vehicleId, offeredPrice, currency, desiredPickupDate, notes } = req.data;

    const vehicle = await SELECT.one.from(Vehicles).columns('ID', 'status', 'branch_ID').where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');
    if (vehicle.status !== 'FOR_SALE') return req.error(409, 'Offers can only be submitted for FOR_SALE vehicles');

    const result = await INSERT.into(Offers).entries({
      vehicle_ID:       vehicleId,
      branch_ID:        vehicle.branch_ID,
      customer_ID:      req.user.id,
      offeredPrice,
      currency:         currency ?? 'TRY',
      desiredPickupDate,
      status:           'SUBMITTED',
    });

    await srv.emit('OfferSubmitted', { offerId: result.ID, vehicleId });
    return result.ID;
  });

  // approveOffer: transitions offer to APPROVED, then creates an APPROVED
  // Reservation so the vehicle is immediately held for the customer.
  // expiresAt is set to 48h from now — same window as a normal reservation.
  srv.on('approveOffer', async (req) => {
    const { offerId } = req.data;
    const offer = await SELECT.one.from(Offers).where({ ID: offerId });
    if (!offer) return req.error(404, 'Offer not found');
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(offer.status)) {
      return req.error(409, `Cannot approve an offer in status ${offer.status}`);
    }

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    await UPDATE(Offers).set({ status: 'APPROVED' }).where({ ID: offerId });
    await INSERT.into(Reservations).entries({
      vehicle_ID:  offer.vehicle_ID,
      branch_ID:   offer.branch_ID,
      customer_ID: offer.customer_ID,
      guestToken:  null,
      status:      'APPROVED',
      expiresAt,
    });

    await srv.emit('OfferApproved', { offerId, vehicleId: offer.vehicle_ID });
    return true;
  });

  // rejectOffer: transitions offer to REJECTED and stores the Manager's reason.
  // The customer may resubmit with a revised price (handled in T3).
  srv.on('rejectOffer', async (req) => {
    const { offerId, rejectionNotes } = req.data;
    const offer = await SELECT.one.from(Offers).where({ ID: offerId });
    if (!offer) return req.error(404, 'Offer not found');
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(offer.status)) {
      return req.error(409, `Cannot reject an offer in status ${offer.status}`);
    }

    await UPDATE(Offers).set({ status: 'REJECTED', rejectionNotes }).where({ ID: offerId });
    await srv.emit('OfferRejected', { offerId, vehicleId: offer.vehicle_ID });
    return true;
  });
});
```

### Modify `srv/index.cds` — add offer-service import

```cds
using from '../modules/offer/api/offer-service';
```

### Modify `package.json` — register OfferService

```json
"OfferService": { "impl": "modules/offer/application/offer-service.js" }
```

---

## T3 — Offer Resubmission

**What & Why:** A REJECTED offer is updated in-place rather than replaced with a new row. This keeps the Manager's `rejectionNotes` visible in the same record until the resubmit clears them, and avoids duplicate offer rows for the same vehicle. Ownership is re-verified at resubmit time (`customer_ID === req.user.id`) even though the action is `@requires: 'Customer'`, because CAP's role check confirms the role but not the row's owner.

### Modify `modules/offer/api/offer-service.cds` — add resubmitOffer action

Add after `rejectOffer`, before the `event` blocks:

```cds
    // resubmitOffer: allows a Customer to revise and resubmit a REJECTED offer.
    // Updates the existing row rather than opening a new one so the Manager
    // sees the full revision history in a single record.
    @requires: 'Customer'
    action resubmitOffer(offerId:           String,
                         offeredPrice:      Decimal,
                         desiredPickupDate: Date)   returns Boolean;
```

### Modify `modules/offer/application/offer-service.js` — add resubmitOffer handler

Add after the `rejectOffer` handler, before the closing `});` of `module.exports`:

```js
  // resubmitOffer: resets a REJECTED offer to SUBMITTED with a revised price.
  // Only the offer's original customer may resubmit — enforced by checking
  // customer_ID against req.user.id before any write.
  srv.on('resubmitOffer', async (req) => {
    const { offerId, offeredPrice, desiredPickupDate } = req.data;
    const offer = await SELECT.one.from(Offers).where({ ID: offerId });
    if (!offer) return req.error(404, 'Offer not found');

    if (offer.customer_ID !== req.user.id) {
      return req.error(403, 'You can only resubmit your own offers');
    }
    if (offer.status !== 'REJECTED') {
      return req.error(409, `Only REJECTED offers can be resubmitted; current status: ${offer.status}`);
    }

    await UPDATE(Offers)
      .set({ status: 'SUBMITTED', offeredPrice, desiredPickupDate, rejectionNotes: null })
      .where({ ID: offerId });

    await srv.emit('OfferSubmitted', { offerId, vehicleId: offer.vehicle_ID });
    return true;
  });
```
