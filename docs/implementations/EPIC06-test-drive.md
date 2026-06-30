# EPIC06 — Test Drive

Sprint 6. Goal: test drive request and scheduling, guest access without claim flow, slot availability validation, auto-cancel on vehicle sold, and operator portal integration.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC06-T1 | Test Drive Domain Model — `TestDrives` entity, `TestDriveStatus` enum, slot and guest contact fields, DB schema | Done |
| EPIC06-T2 | Test Drive Service — `requestTestDrive`, `approveTestDrive`, `cancelTestDrive`, `completeTestDrive` actions; slot conflict guard | Open |
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
