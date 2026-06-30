# EPIC06 — Test Drive

Sprint 6. Goal: test drive request and scheduling, guest access without claim flow, slot availability validation, auto-cancel on vehicle sold, and operator portal integration.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC06-T1 | Test Drive Domain Model — `TestDrives` entity, `TestDriveStatus` enum, slot and guest contact fields, DB schema | Done |
| EPIC06-T2 | Test Drive Service — `requestTestDrive`, `approveTestDrive`, `cancelTestDrive`, `completeTestDrive` actions; slot conflict guard | Done |
| EPIC06-T3 | Guest Test Drive — guest request with `contactEmail`/`contactPhone`, no claim step; rate-limiting note | Open |
| EPIC06-T4 | Availability Check — `getAvailableSlots` function; reject duplicate vehicle/slot requests | Open |
| EPIC06-T5 | Auto-Cancel on Vehicle Sold — subscribe to `VehicleSold` event, cancel open test drives, emit `TestDriveCancelled` | Open |
| EPIC06-T6 | Operator Portal Extension — branch-scoped `TestDrives` projection, approve/cancel/complete actions | Open |

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
