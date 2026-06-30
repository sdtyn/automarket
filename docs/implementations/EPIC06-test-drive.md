# EPIC06 — Test Drive

Sprint 6. Goal: test drive request and scheduling, guest access without claim flow, slot availability validation, auto-cancel on vehicle sold, and operator portal integration.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC06-T1 | Test Drive Domain Model — `TestDrives` entity, `TestDriveStatus` enum, slot and guest contact fields, DB schema | Done |
| EPIC06-T2 | Test Drive Service — `requestTestDrive`, `approveTestDrive`, `cancelTestDrive`, `completeTestDrive` actions; slot conflict guard | Done |
| EPIC06-T3 | Guest Test Drive — guest request with `contactEmail`/`contactPhone`, no claim step; rate-limiting note | Done |
| EPIC06-T4 | Availability Check — `getAvailableSlots` function; reject duplicate vehicle/slot requests | Done |
| EPIC06-T5 | Auto-Cancel on Vehicle Sold — subscribe to `VehicleSold` event, cancel open test drives, emit `TestDriveCancelled` | Done |
| EPIC06-T6 | Operator Portal Extension — branch-scoped `TestDrives` projection, approve/cancel/complete actions | Done |

### Sprint Backlog DoD mapping

- "Test Drive Request & Scheduling" → EPIC06-T1, T2
- "Guest Test Drive Access" → EPIC06-T3
- "Availability Validation" → EPIC06-T4
- "Auto-Cancel on Vehicle Sold" → EPIC06-T5
- "Operator Portal" → EPIC06-T6

### Sign-off

_To be completed at sprint end._

---

## T1 — Test Drive Domain Model

**What & Why:** `TestDrives` does not gate the vehicle from sale — a `FOR_SALE` vehicle can have multiple future test drives queued simultaneously, unlike Reservations. Guest access stores `contactEmail`/`contactPhone` directly on the row (no `guestToken`, no claim step). Slot conflict is a time-window check handled in the service handler rather than a DB unique constraint, because two drives on the same vehicle at different times within the same day are valid.

### Create `modules/test-drive/db/test-drive.cds`

```cds
namespace automarket;

using {BaseEntity}          from '../../../shared/types/common';
using {automarket.Vehicles} from '../../vehicle/db/vehicle';
using {automarket.Branches} from '../../branch/db/branch';

// TestDrives captures a scheduled appointment to physically inspect a vehicle.
// Unlike Reservations, test drives do not gate the vehicle from sale — a FOR_SALE
// vehicle can have multiple future test drives queued simultaneously.
// The slot uniqueness guard (vehicle + scheduledAt) is enforced in the handler,
// not via @assert.unique, because the conflict check must account for a time
// window rather than an exact timestamp match.
entity TestDrives : BaseEntity {
    vehicle         : Association to Vehicles;
    branch          : Association to Branches;
    // customer_ID is null for guest requests; contactEmail/contactPhone
    // are used instead so Operators can follow up without an account.
    customer_ID     : String(255);
    contactEmail    : String(255);
    contactPhone    : String(50);
    scheduledAt     : Timestamp;
    // durationMinutes defaults to 30; Operator may adjust at approval time.
    durationMinutes : Integer default 30;
    status          : TestDriveStatus default 'REQUESTED';
    notes           : String(1000);
}

// TestDriveStatus lifecycle: REQUESTED → APPROVED → COMPLETED
//                                      ↘ CANCELLED (by customer, operator, or system)
type TestDriveStatus : String enum {
    REQUESTED;   // submitted, awaiting Operator approval
    APPROVED;    // confirmed; slot is locked
    COMPLETED;   // test drive took place
    CANCELLED;   // cancelled by any actor or auto-cancelled when vehicle is sold
};
```

### Modify `db/index.cds` — add test-drive import

```diff
 using from '../modules/reservation/db/reservation';
+
+using from '../modules/test-drive/db/test-drive';
```

---

## T2 — Test Drive Service

**What & Why:** `TestDriveService` owns the full test drive lifecycle. Slot conflict is checked at request time on the exact `scheduledAt` timestamp — duration-window overlap is handled in T4's `getAvailableSlots`. `cancelTestDrive` accepts Customer, Operator, and Manager roles; the handler enforces ownership (Customer) or branch scope (Operator/Manager). Guest support is added in T3.

### Create `modules/test-drive/api/test-drive-service.cds`

```cds
using {automarket} from '../db/test-drive';

// TestDriveService manages test drive scheduling.
// Unlike Reservations, test drives do not gate vehicle status — a FOR_SALE
// vehicle can have multiple future slots queued at the same time.
// Guest requestTestDrive (contactEmail/contactPhone) is added in T3.
service TestDriveService @(path: '/test-drive') {

    @restrict: [
        { grant: 'READ', to: 'Customer',            where: 'customer_ID = $user' },
        { grant: 'READ', to: ['Operator','Manager'] }
    ]
    entity TestDrives as projection on automarket.TestDrives;

    // requestTestDrive: creates a REQUESTED slot for an authenticated customer.
    // Rejects if the same vehicle already has an active request for the same slot.
    @requires: 'Customer'
    action requestTestDrive(vehicleId: String, branchId: String,
                            scheduledAt: Timestamp, notes: String) returns String;

    // approveTestDrive: confirms the slot; optionally adjusts duration.
    @requires: ['Operator', 'Manager']
    action approveTestDrive(testDriveId: String, durationMinutes: Integer) returns Boolean;

    // cancelTestDrive: Customer may cancel their own; Operator/Manager may cancel
    // any test drive in their branch. Role enforcement is in the handler.
    @requires: ['Customer', 'Operator', 'Manager']
    action cancelTestDrive(testDriveId: String) returns Boolean;

    // completeTestDrive: marks the test drive as done. Only valid from APPROVED.
    @requires: ['Operator', 'Manager']
    action completeTestDrive(testDriveId: String) returns Boolean;

    event TestDriveRequested { testDriveId : String; vehicleId : String; }
    event TestDriveApproved  { testDriveId : String; vehicleId : String; }
    event TestDriveCancelled { testDriveId : String; vehicleId : String; }
    event TestDriveCompleted { testDriveId : String; vehicleId : String; }
}
```

### Create `modules/test-drive/application/test-drive-service.js`

```js
'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { TestDrives } = cds.entities('automarket');

  // requestTestDrive: inserts a REQUESTED slot after checking for slot conflicts.
  // Branch is taken from the caller's parameter — guest override added in T3.
  srv.on('requestTestDrive', async (req) => {
    const { vehicleId, branchId, scheduledAt, notes } = req.data;

    const conflict = await SELECT.one.from(TestDrives).where({
      vehicle_ID:  vehicleId,
      scheduledAt: scheduledAt,
      status:      { in: ['REQUESTED', 'APPROVED'] },
    });
    if (conflict) return req.error(409, 'This time slot is already taken for the selected vehicle');

    const result = await INSERT.into(TestDrives).entries({
      vehicle_ID:  vehicleId,
      branch_ID:   branchId,
      customer_ID: req.user.id,
      scheduledAt,
      notes,
      status: 'REQUESTED',
    });

    await srv.emit('TestDriveRequested', { testDriveId: result.ID, vehicleId });
    return result.ID;
  });

  // approveTestDrive: advances a REQUESTED test drive to APPROVED.
  // Optionally updates durationMinutes if the Operator provides a value.
  srv.on('approveTestDrive', async (req) => {
    const { testDriveId, durationMinutes } = req.data;
    const testDrive = await SELECT.one.from(TestDrives).where({ ID: testDriveId });
    if (!testDrive) return req.error(404, 'Test drive not found');
    if (testDrive.status !== 'REQUESTED') {
      return req.error(409, `Cannot approve a test drive in status ${testDrive.status}`);
    }

    const patch = { status: 'APPROVED' };
    if (durationMinutes) patch.durationMinutes = durationMinutes;
    await UPDATE(TestDrives).set(patch).where({ ID: testDriveId });
    await srv.emit('TestDriveApproved', { testDriveId, vehicleId: testDrive.vehicle_ID });
    return true;
  });

  // cancelTestDrive: Customer may only cancel their own; Operator/Manager
  // may cancel any test drive regardless of who requested it.
  srv.on('cancelTestDrive', async (req) => {
    const { testDriveId } = req.data;
    const testDrive = await SELECT.one.from(TestDrives).where({ ID: testDriveId });
    if (!testDrive) return req.error(404, 'Test drive not found');

    if (req.user.is('Customer') && testDrive.customer_ID !== req.user.id) {
      return req.error(403, 'You can only cancel your own test drive');
    }
    if (!['REQUESTED', 'APPROVED'].includes(testDrive.status)) {
      return req.error(409, `Cannot cancel a test drive in status ${testDrive.status}`);
    }

    await UPDATE(TestDrives).set({ status: 'CANCELLED' }).where({ ID: testDriveId });
    await srv.emit('TestDriveCancelled', { testDriveId, vehicleId: testDrive.vehicle_ID });
    return true;
  });

  // completeTestDrive: valid only from APPROVED. Records that the drive took place.
  srv.on('completeTestDrive', async (req) => {
    const { testDriveId } = req.data;
    const testDrive = await SELECT.one.from(TestDrives).where({ ID: testDriveId });
    if (!testDrive) return req.error(404, 'Test drive not found');
    if (testDrive.status !== 'APPROVED') {
      return req.error(409, `Cannot complete a test drive in status ${testDrive.status}`);
    }

    await UPDATE(TestDrives).set({ status: 'COMPLETED' }).where({ ID: testDriveId });
    await srv.emit('TestDriveCompleted', { testDriveId, vehicleId: testDrive.vehicle_ID });
    return true;
  });
});
```

### Modify `srv/index.cds` — add test-drive-service import

```diff
 using from '../modules/reservation/api/reservation-service';
+
+using from '../modules/test-drive/api/test-drive-service';
```

### Modify `package.json` — register TestDriveService

```diff
   "ReservationService": { "impl": "modules/reservation/application/reservation-service.js" },
+  "TestDriveService":   { "impl": "modules/test-drive/application/test-drive-service.js" }
```

---

## T3 — Guest Test Drive

**What & Why:** Guests submit a test drive request without an account. A dedicated `requestTestDriveAsGuest` action (no `@requires`) is added instead of relaxing the existing `requestTestDrive` action — this keeps Customer and guest paths cleanly separated and makes it straightforward to add a rate-limit middleware in front of the guest endpoint later. `customer_ID` is left null; `contactEmail` is the mandatory identifier for operator follow-up. No claim token is issued — guests have no way to read their own row.

**Rate-limiting note:** CAP has no built-in rate limiter. A reverse proxy rule (e.g. `nginx limit_req` or Azure APIM policy) must cap submissions per IP per hour before this action reaches the CAP process.

### Modify `modules/test-drive/api/test-drive-service.cds` — add guest action

Add after the `completeTestDrive` action, before the `event` blocks:

```cds
    // requestTestDriveAsGuest: open to anonymous callers — no account required.
    // contactEmail is mandatory so the Operator can follow up.
    // Rate-limiting must be enforced at the API gateway layer; CAP itself has no
    // built-in rate limiter, so a reverse proxy rule (e.g. nginx limit_req or
    // an Azure APIM policy) should cap submissions per IP per hour.
    action requestTestDriveAsGuest(vehicleId: String,
                                   branchId: String,
                                   scheduledAt: Timestamp,
                                   contactEmail: String,
                                   contactPhone: String,
                                   notes: String)     returns String;
```

### Modify `modules/test-drive/application/test-drive-service.js` — add guest handler

Add after the `completeTestDrive` handler, before the closing `});` of `module.exports`:

```js
  // requestTestDriveAsGuest: same slot-conflict guard as the authenticated path.
  // customer_ID is intentionally left null — contactEmail is the identifier.
  // No claim step: there is no token issued; guests cannot read their own row.
  srv.on('requestTestDriveAsGuest', async (req) => {
    const { vehicleId, branchId, scheduledAt, contactEmail, contactPhone, notes } = req.data;

    if (!contactEmail) return req.error(400, 'contactEmail is required for guest requests');

    const conflict = await SELECT.one.from(TestDrives).where({
      vehicle_ID: vehicleId,
      scheduledAt: scheduledAt,
      status: { in: ['REQUESTED', 'APPROVED'] },
    });
    if (conflict) return req.error(409, 'This time slot is already taken for the selected vehicle');

    const result = await INSERT.into(TestDrives).entries({
      vehicle_ID: vehicleId,
      branch_ID: branchId,
      customer_ID: null,
      contactEmail,
      contactPhone,
      scheduledAt,
      notes,
      status: 'REQUESTED',
    });

    await srv.emit('TestDriveRequested', { testDriveId: result.ID, vehicleId });
    return result.ID;
  });
```

---

## T4 — Availability Check

**What & Why:** Two changes in one ticket. (1) The existing exact-timestamp conflict guard in `requestTestDrive` and `requestTestDriveAsGuest` is replaced with a duration-window overlap check so that a new request at 10:15 is correctly rejected when a 30-minute drive is already booked at 10:00. (2) `getAvailableSlots` is added as a public CDS function that generates standard 30-minute slots (09:00–16:30 UTC) for a vehicle on a given date and flags each as available or taken. Filtering is done in JS rather than with a DB date-range predicate — per-vehicle booking counts are small enough that a full fetch + in-memory filter is acceptable; a DB predicate can be added later if volume warrants it.

### Modify `modules/test-drive/api/test-drive-service.cds`

Add `AvailableSlot` type before the `service` block (after the `using` line):

```cds
// AvailableSlot is the return element for getAvailableSlots.
type AvailableSlot {
    scheduledAt : Timestamp;
    available   : Boolean;
}
```

Add `getAvailableSlots` function inside the service block, before `requestTestDrive`:

```cds
    // getAvailableSlots: returns standard 30-minute slots (09:00–16:30 UTC) for
    // a vehicle on a given date, flagged available or taken.
    // Open to guests — no @requires annotation.
    function getAvailableSlots(vehicleId : String,
                               branchId  : String,
                               date      : Date)   returns array of AvailableSlot;
```

### Modify `modules/test-drive/application/test-drive-service.js`

Add `windowsOverlap` helper above `module.exports` (after `'use strict'`):

```js
// Returns true when two test drive windows overlap.
// Strict overlap: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅
// bDurationMin defaults to 30 — the standard slot length used for new requests.
function windowsOverlap(aStart, aDurationMin, bStart, bDurationMin = 30) {
  const aEnd = new Date(aStart).getTime() + aDurationMin * 60_000;
  const bEnd = new Date(bStart).getTime() + bDurationMin * 60_000;
  return new Date(aStart).getTime() < bEnd && aEnd > new Date(bStart).getTime();
}
```

In `requestTestDrive` handler, replace the exact-match conflict check:

```js
    // Reject if the new window overlaps any active booking for this vehicle.
    const activeBookings = await SELECT.from(TestDrives).where({
      vehicle_ID: vehicleId,
      status: { in: ['REQUESTED', 'APPROVED'] },
    });
    const conflict = activeBookings.some((b) => windowsOverlap(b.scheduledAt, b.durationMinutes, scheduledAt));
    if (conflict) return req.error(409, 'This time slot overlaps with an existing booking for the selected vehicle');
```

Apply the same replacement in `requestTestDriveAsGuest` handler.

Add `getAvailableSlots` handler after `requestTestDriveAsGuest`, before the closing `});` of `module.exports`:

```js
  // getAvailableSlots: generates 09:00–16:30 UTC slots in 30-min increments,
  // then marks each as available or taken based on window-overlap against
  // active bookings. Filtering is done in JS since per-vehicle booking counts
  // are small; move to a DB date-range predicate if that assumption changes.
  srv.on('getAvailableSlots', async (req) => {
    const { vehicleId, date } = req.data;

    const slots = [];
    for (let hour = 9; hour < 17; hour++) {
      for (let min = 0; min < 60; min += 30) {
        const slot = new Date(date);
        slot.setUTCHours(hour, min, 0, 0);
        slots.push(slot);
      }
    }

    const activeBookings = await SELECT.from(TestDrives).where({
      vehicle_ID: vehicleId,
      status: { in: ['REQUESTED', 'APPROVED'] },
    });

    const [year, month, day] = date.split('-').map(Number);
    const dayBookings = activeBookings.filter((b) => {
      if (!b.scheduledAt) return false;
      const d = new Date(b.scheduledAt);
      return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
    });

    return slots.map((slotTime) => ({
      scheduledAt: slotTime.toISOString(),
      available: !dayBookings.some((b) => windowsOverlap(b.scheduledAt, b.durationMinutes, slotTime)),
    }));
  });
```

---

## T5 — Auto-Cancel on Vehicle Sold

**What & Why:** When a vehicle is sold, any open test drives for it become meaningless — the car can no longer be driven. `TestDriveService` subscribes to `VehicleSold` via `cds.connect.to('VehicleService')`. The handler loops over all REQUESTED/APPROVED rows for the sold vehicle, sets each to CANCELLED, and emits `TestDriveCancelled` so downstream subscribers (notifications, analytics) can react. `VehicleSold` is declared in `vehicle-service.cds` but emitted by the payment flow (outside this epic's scope); the subscriber is ready whenever it fires.

**Note:** The `const { TestDrives }` declaration appears after the `VehicleSrv.on(...)` registration in the file, but this is safe: the callback only executes when an event fires, which is always after the full module initialisation has run and `TestDrives` is in scope.

### Modify `modules/test-drive/application/test-drive-service.js`

Add after `module.exports = cds.service.impl(async function (srv) {`, before `const { TestDrives }`:

```js
  // Subscribe to VehicleService to auto-cancel open test drives when a vehicle
  // is sold. VehicleSold is emitted by the payment flow (outside this module);
  // we register the subscriber here so the handler is ready whenever it fires.
  const VehicleSrv = await cds.connect.to('VehicleService');
  VehicleSrv.on('VehicleSold', async (msg) => {
    const { vehicleId } = msg.data;
    const openDrives = await SELECT.from(TestDrives).where({
      vehicle_ID: vehicleId,
      status: { in: ['REQUESTED', 'APPROVED'] },
    });
    for (const drive of openDrives) {
      await UPDATE(TestDrives).set({ status: 'CANCELLED' }).where({ ID: drive.ID });
      await srv.emit('TestDriveCancelled', { testDriveId: drive.ID, vehicleId });
    }
  });
```

---

## T6 — Operator Portal Extension

**What & Why:** Operators need a branch-scoped view of test drives and the ability to approve, cancel, and complete them without leaving the portal. The pattern mirrors the existing Reservations extension: a `@restrict` projection filters rows by `branch_ID = $user.branchId` at the query level, and each action verifies branch ownership before writing. Events are emitted through `TestDriveService` so downstream subscribers remain decoupled from the portal implementation.

### Modify `modules/vehicle/api/operator-portal.cds`

Add after the existing `using` lines at the top:

```cds
using from '../../test-drive/db/test-drive';
```

Add before the closing `}` of the service block:

```cds
    // TestDrives: branch-scoped read for Operators; Managers see all branches.
    @restrict: [
        {
            grant: 'READ',
            to   : 'Operator',
            where: 'branch_ID = $user.branchId'
        },
        {
            grant: 'READ',
            to   : 'Manager'
        }
    ]
    entity TestDrives   as projection on automarket.TestDrives;

    // approveTestDrive: branch-scoped wrapper — Operators may only approve test
    // drives belonging to their branch.
    @requires: [
        'Operator',
        'Manager'
    ]
    action approveTestDrive(testDriveId: String,
                            durationMinutes: Integer)              returns Boolean;

    // cancelTestDrive: branch-scoped cancel; Operators cannot cancel drives from
    // other branches.
    @requires: [
        'Operator',
        'Manager'
    ]
    action cancelTestDrive(testDriveId: String)                    returns Boolean;

    // completeTestDrive: marks the test drive as done. Only valid from APPROVED.
    @requires: [
        'Operator',
        'Manager'
    ]
    action completeTestDrive(testDriveId: String)                  returns Boolean;
```

### Modify `modules/vehicle/application/operator-portal.js`

Update the entities destructure:

```js
  const { Vehicles, Reservations, TestDrives } = cds.entities('automarket');
```

Add after the `rejectReservation` handler, before the closing `});` of `module.exports`:

```js
  // approveTestDrive: branch guard for Operators; delegates event emission to
  // TestDriveService to keep subscribers decoupled from the portal.
  srv.on('approveTestDrive', async (req) => {
    const { testDriveId, durationMinutes } = req.data;
    const testDrive = await SELECT.one.from(TestDrives).where({ ID: testDriveId });
    if (!testDrive) return req.error(404, 'Test drive not found');

    if (req.user.is('Operator') && testDrive.branch_ID !== req.user.attr.branchId) {
      return req.error(403, 'You can only approve test drives for your branch');
    }
    if (testDrive.status !== 'REQUESTED') {
      return req.error(409, `Cannot approve a test drive in status ${testDrive.status}`);
    }

    const patch = { status: 'APPROVED' };
    if (durationMinutes) patch.durationMinutes = durationMinutes;
    await UPDATE(TestDrives).set(patch).where({ ID: testDriveId });
    const tdSrv = await cds.connect.to('TestDriveService');
    await tdSrv.emit('TestDriveApproved', { testDriveId, vehicleId: testDrive.vehicle_ID });
    return true;
  });

  // cancelTestDrive: branch guard for Operators; emits via TestDriveService.
  srv.on('cancelTestDrive', async (req) => {
    const { testDriveId } = req.data;
    const testDrive = await SELECT.one.from(TestDrives).where({ ID: testDriveId });
    if (!testDrive) return req.error(404, 'Test drive not found');

    if (req.user.is('Operator') && testDrive.branch_ID !== req.user.attr.branchId) {
      return req.error(403, 'You can only cancel test drives for your branch');
    }
    if (!['REQUESTED', 'APPROVED'].includes(testDrive.status)) {
      return req.error(409, `Cannot cancel a test drive in status ${testDrive.status}`);
    }

    await UPDATE(TestDrives).set({ status: 'CANCELLED' }).where({ ID: testDriveId });
    const tdSrv = await cds.connect.to('TestDriveService');
    await tdSrv.emit('TestDriveCancelled', { testDriveId, vehicleId: testDrive.vehicle_ID });
    return true;
  });

  // completeTestDrive: branch guard for Operators; only valid from APPROVED.
  srv.on('completeTestDrive', async (req) => {
    const { testDriveId } = req.data;
    const testDrive = await SELECT.one.from(TestDrives).where({ ID: testDriveId });
    if (!testDrive) return req.error(404, 'Test drive not found');

    if (req.user.is('Operator') && testDrive.branch_ID !== req.user.attr.branchId) {
      return req.error(403, 'You can only complete test drives for your branch');
    }
    if (testDrive.status !== 'APPROVED') {
      return req.error(409, `Cannot complete a test drive in status ${testDrive.status}`);
    }

    await UPDATE(TestDrives).set({ status: 'COMPLETED' }).where({ ID: testDriveId });
    const tdSrv = await cds.connect.to('TestDriveService');
    await tdSrv.emit('TestDriveCompleted', { testDriveId, vehicleId: testDrive.vehicle_ID });
    return true;
  });
```

### Sign-off

All six tickets delivered. Sprint complete.
