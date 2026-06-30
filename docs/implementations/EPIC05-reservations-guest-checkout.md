# EPIC05 — Reservations & Guest Checkout

Sprint 5. Goal: reservation lifecycle, concurrency enforcement, guest checkout with token-based access, claim flow, and expiry job.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC05-T1 | Reservation Domain Model — `Reservations` entity, `ReservationStatus` enum, `guestToken` field, DB schema | Done |
| EPIC05-T2 | Reservation Service — `createReservation`, `approveReservation`, `rejectReservation`, `cancelReservation`, `completeReservation` actions; VehicleStateMachine integration | Done |
| EPIC05-T3 | Concurrency Guard — `SELECT FOR UPDATE` row lock on Vehicle before guard evaluation; partial unique index on active reservations | Done |
| EPIC05-T4 | Guest Checkout — guest `createReservation` without auth, signed `guestToken` issuance, guest read/cancel via token | Done |
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

---

## T2 — Reservation Service

**What & Why:** `ReservationService` drives the full reservation lifecycle. `createReservation` moves the vehicle immediately to `RESERVED` via the state machine — Operator approval changes only the reservation row, not the vehicle status. Vehicle status is updated directly via `cds.entities` (same pattern as PricingService) to bypass `VehicleService`'s `before UPDATE` guard. The SELECT FOR UPDATE lock is intentionally deferred to T3 so concurrency concerns are isolated in one ticket.

### Create `modules/reservation/api/reservation-service.cds`

```cds
using {automarket} from '../db/reservation';

// ReservationService owns the full reservation lifecycle.
// Vehicle status transitions (FOR_SALE ↔ RESERVED) are driven here — the handler
// updates Vehicles directly via cds.entities to bypass VehicleService's UPDATE guard.
// Guest createReservation is handled in T4 (guestToken issuance); this service
// currently requires identified-customer auth.
service ReservationService @(path: '/reservation') {

    // Customers see only their own rows; Operators/Managers see their branch.
    // Branch-scoped filter for staff is enforced in T7 (Operator Portal).
    @restrict: [
        { grant: 'READ', to: 'Customer',            where: 'customer_ID = $user' },
        { grant: 'READ', to: ['Operator','Manager'] }
    ]
    entity Reservations as projection on automarket.Reservations;

    // createReservation: creates a REQUESTED reservation and immediately moves
    // the vehicle to RESERVED. Branch is derived from the vehicle — not taken
    // from the caller — so the association is always consistent.
    @requires: 'Customer'
    action createReservation(vehicleId: String, notes: String) returns String;

    // approveReservation: advances a REQUESTED reservation to APPROVED.
    // Vehicle stays RESERVED — no vehicle state change at this step.
    @requires: ['Operator', 'Manager']
    action approveReservation(reservationId: String) returns Boolean;

    // rejectReservation: rejects a REQUESTED or APPROVED reservation.
    // Returns the vehicle to FOR_SALE via the VehicleStateMachine.
    @requires: ['Operator', 'Manager']
    action rejectReservation(reservationId: String, notes: String) returns Boolean;

    // cancelReservation: customer cancels their own reservation.
    // Returns the vehicle to FOR_SALE if the reservation was REQUESTED or APPROVED.
    @requires: 'Customer'
    action cancelReservation(reservationId: String) returns Boolean;

    // completeReservation: marks the reservation as COMPLETED once the
    // Operator confirms the checkout handoff to Sales. Vehicle status is
    // driven by CheckoutStarted in the Sales flow, not here.
    @requires: ['Operator', 'Manager']
    action completeReservation(reservationId: String) returns Boolean;

    event ReservationCreated   { reservationId : String; vehicleId : String; }
    event ReservationApproved  { reservationId : String; vehicleId : String; }
    event ReservationRejected  { reservationId : String; vehicleId : String; }
    event ReservationCancelled { reservationId : String; vehicleId : String; }
    event ReservationCompleted { reservationId : String; vehicleId : String; }
}
```

### Create `modules/reservation/application/reservation-service.js`

```js
'use strict';

const cds = require('@sap/cds');
const { transition } = require('../../vehicle/domain/vehicle-state-machine');

module.exports = cds.service.impl(async function (srv) {
  const { Reservations } = cds.entities('automarket');

  // createReservation: validates the vehicle is FOR_SALE, moves it to RESERVED
  // via the state machine, then inserts the Reservations row.
  // The SELECT FOR UPDATE lock is added in T3 — for now the guard is optimistic.
  srv.on('createReservation', async (req) => {
    const { vehicleId, notes } = req.data;
    const { Vehicles } = cds.entities('automarket');

    const vehicle = await SELECT.one.from(Vehicles)
      .columns('ID', 'status', 'branch_ID', 'price', 'images')
      .where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');

    let newVehicleStatus;
    try { newVehicleStatus = transition(vehicle, 'ReservationCreated'); }
    catch (e) { return req.error(409, e.message); }

    // Compute expiresAt once at creation — never reset later.
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    await UPDATE(Vehicles).set({ status: newVehicleStatus }).where({ ID: vehicleId });

    const result = await INSERT.into(Reservations).entries({
      vehicle_ID:  vehicleId,
      branch_ID:   vehicle.branch_ID,
      customer_ID: req.user.id,
      status:      'REQUESTED',
      expiresAt,
      notes,
    });

    await srv.emit('ReservationCreated', { reservationId: result.ID, vehicleId });
    return result.ID;
  });

  // approveReservation: only valid from REQUESTED status.
  // Vehicle stays RESERVED — no state machine call needed here.
  srv.on('approveReservation', async (req) => {
    const { reservationId } = req.data;
    const reservation = await SELECT.one.from(Reservations).where({ ID: reservationId });
    if (!reservation) return req.error(404, 'Reservation not found');
    if (reservation.status !== 'REQUESTED') {
      return req.error(409, `Cannot approve a reservation in status ${reservation.status}`);
    }
    await UPDATE(Reservations).set({ status: 'APPROVED' }).where({ ID: reservationId });
    await srv.emit('ReservationApproved', { reservationId, vehicleId: reservation.vehicle_ID });
    return true;
  });

  // rejectReservation: valid from REQUESTED or APPROVED.
  // Returns the vehicle to FOR_SALE via ReservationCancelled event on the state machine.
  srv.on('rejectReservation', async (req) => {
    const { reservationId, notes } = req.data;
    const { Vehicles } = cds.entities('automarket');
    const reservation = await SELECT.one.from(Reservations).where({ ID: reservationId });
    if (!reservation) return req.error(404, 'Reservation not found');
    if (!['REQUESTED', 'APPROVED'].includes(reservation.status)) {
      return req.error(409, `Cannot reject a reservation in status ${reservation.status}`);
    }

    const vehicle = await SELECT.one.from(Vehicles).columns('ID', 'status').where({ ID: reservation.vehicle_ID });
    let newVehicleStatus;
    try { newVehicleStatus = transition(vehicle, 'ReservationCancelled'); }
    catch (e) { return req.error(409, e.message); }

    await UPDATE(Vehicles).set({ status: newVehicleStatus }).where({ ID: reservation.vehicle_ID });
    await UPDATE(Reservations).set({ status: 'REJECTED', notes }).where({ ID: reservationId });
    await srv.emit('ReservationRejected', { reservationId, vehicleId: reservation.vehicle_ID });
    return true;
  });

  // cancelReservation: customer may only cancel their own reservation.
  // Returns the vehicle to FOR_SALE if the reservation was REQUESTED or APPROVED.
  srv.on('cancelReservation', async (req) => {
    const { reservationId } = req.data;
    const { Vehicles } = cds.entities('automarket');
    const reservation = await SELECT.one.from(Reservations).where({ ID: reservationId });
    if (!reservation) return req.error(404, 'Reservation not found');
    if (reservation.customer_ID !== req.user.id) {
      return req.error(403, 'You can only cancel your own reservation');
    }
    if (!['REQUESTED', 'APPROVED'].includes(reservation.status)) {
      return req.error(409, `Cannot cancel a reservation in status ${reservation.status}`);
    }

    const vehicle = await SELECT.one.from(Vehicles).columns('ID', 'status').where({ ID: reservation.vehicle_ID });
    let newVehicleStatus;
    try { newVehicleStatus = transition(vehicle, 'ReservationCancelled'); }
    catch (e) { return req.error(409, e.message); }

    await UPDATE(Vehicles).set({ status: newVehicleStatus }).where({ ID: reservation.vehicle_ID });
    await UPDATE(Reservations).set({ status: 'CANCELLED' }).where({ ID: reservationId });
    await srv.emit('ReservationCancelled', { reservationId, vehicleId: reservation.vehicle_ID });
    return true;
  });

  // completeReservation: valid only from APPROVED. Marks the reservation done;
  // vehicle status is advanced to PENDING_PAYMENT by the Sales flow, not here.
  srv.on('completeReservation', async (req) => {
    const { reservationId } = req.data;
    const reservation = await SELECT.one.from(Reservations).where({ ID: reservationId });
    if (!reservation) return req.error(404, 'Reservation not found');
    if (reservation.status !== 'APPROVED') {
      return req.error(409, `Cannot complete a reservation in status ${reservation.status}`);
    }
    await UPDATE(Reservations).set({ status: 'COMPLETED' }).where({ ID: reservationId });
    await srv.emit('ReservationCompleted', { reservationId, vehicleId: reservation.vehicle_ID });
    return true;
  });
});
```

### Modify `srv/index.cds` — add reservation-service import

```diff
 using from '../modules/favorites/api/favorites-service';
+
+using from '../modules/reservation/api/reservation-service';
```

### Modify `package.json` — register ReservationService

```diff
   "FavoritesService":   { "impl": "modules/favorites/application/favorites-service.js" },
+  "ReservationService": { "impl": "modules/reservation/application/reservation-service.js" }
```

---

## T3 — Concurrency Guard

**What & Why:** Two-layer protection against duplicate active reservations. Application layer: `.forUpdate()` on the vehicle SELECT takes a row-level lock for the transaction duration, preventing two concurrent `createReservation` calls from both reading `FOR_SALE` before either commits. SQLite (local dev) silently ignores `FOR UPDATE` — the state machine and the active-reservation check are the effective guards there. DB layer: a partial unique index `UNIQUE(vehicle_ID) WHERE status IN ('REQUESTED','APPROVED')` is the last line of defence, but CDS cannot express it — see `docs/cap-notes.md` §6 for the post-deploy SQL script.

### Modify `modules/reservation/application/reservation-service.js` — add lock and active-reservation check to `createReservation`

Remove these lines:
```
const vehicle = await SELECT.one.from(Vehicles)
  .columns('ID', 'status', 'branch_ID', 'price', 'images')
  .where({ ID: vehicleId });
if (!vehicle) return req.error(404, 'Vehicle not found');
```

Replace with:
```js
// forUpdate() takes a row-level lock on the vehicle for the duration of
// this transaction, preventing a second concurrent createReservation from
// reading the same FOR_SALE snapshot before either write commits.
// SQLite (local dev) silently ignores FOR UPDATE — the state machine guard
// is the only protection there. HANA/PG enforce the lock.
const vehicle = await SELECT.one.from(Vehicles)
  .columns('ID', 'status', 'branch_ID', 'price', 'images')
  .where({ ID: vehicleId })
  .forUpdate();
if (!vehicle) return req.error(404, 'Vehicle not found');

// Explicit active-reservation check as belt-and-suspenders.
// The state machine catches this too (vehicle would not be FOR_SALE),
// but this guard fires before the state machine and gives a clearer error.
const activeReservation = await SELECT.one.from(Reservations)
  .where({ vehicle_ID: vehicleId, status: { in: ['REQUESTED', 'APPROVED'] } });
if (activeReservation) {
  return req.error(409, 'This vehicle already has an active reservation');
}
```

### Update `docs/cap-notes.md` — add §6 (applied automatically)

See `docs/cap-notes.md` §6: "Partial Unique Index on Reservations Cannot Be Expressed in CDS".

---

## T4 — Guest Checkout

**What & Why:** `createReservation` is opened to `@requires: 'any'` so unauthenticated guests can reserve a vehicle. Guest identity is replaced by a signed 48h JWT (`guestToken`) issued at creation and stored on the row. The token is the only credential that grants read/cancel access — no session, no cookie. Rate limiting at 20 req/min per IP is an Approuter concern, not CAP's (see `cap-notes.md` §7).

### Create `modules/reservation/infrastructure/guest-token.js`

```js
'use strict';

const jwt = require('jsonwebtoken');

// Secret is loaded from env so it can be rotated without a code change.
// The dev fallback must never be used in production — the missing env var
// will produce tokens that any developer with this repo can forge.
const GUEST_TOKEN_SECRET = process.env.GUEST_TOKEN_SECRET || 'guest-token-dev-secret-CHANGE-IN-PROD';

// issueGuestToken: signs a short-lived JWT embedding the reservationId.
// Expiry is 48h to match the reservation expiry window — a guest cannot
// use a token to access an already-expired reservation.
function issueGuestToken(reservationId) {
  return jwt.sign(
    { reservationId, type: 'guest-reservation' },
    GUEST_TOKEN_SECRET,
    { expiresIn: '48h' }
  );
}

// verifyGuestToken: verifies signature and expiry; throws on failure.
// Callers must catch and convert to a 401 error.
function verifyGuestToken(token) {
  return jwt.verify(token, GUEST_TOKEN_SECRET);
}

module.exports = { issueGuestToken, verifyGuestToken };
```

### Modify `modules/reservation/api/reservation-service.cds`

Change `createReservation` from `@requires: 'Customer'` returning `String` to:
```cds
@requires: 'any'
action createReservation(vehicleId: String, notes: String) returns {
    reservationId : String;
    guestToken    : String;
};
```

Add before closing `}`:
```cds
@requires: 'any'
function getGuestReservation(guestToken: String) returns Reservations;

@requires: 'any'
action cancelGuestReservation(guestToken: String) returns Boolean;
```

### Modify `modules/reservation/application/reservation-service.js`

Add require at top:
```js
const { issueGuestToken, verifyGuestToken } = require('../infrastructure/guest-token');
```

In `createReservation`, replace the INSERT + emit + return block with guest-aware version (detects `!req.user.is('authenticated-user')`, issues token, persists it, returns `{ reservationId, guestToken }`).

Add `getGuestReservation` and `cancelGuestReservation` handlers that verify token signature before acting.

### Update `docs/cap-notes.md` — add §7 (applied automatically)

See `docs/cap-notes.md` §7: "Guest Rate Limiting Is an Approuter Concern, Not CAP".
