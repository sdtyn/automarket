namespace automarket;

using {BaseEntity} from '../../../shared/types/common';
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
    REQUESTED; // submitted, awaiting Operator approval
    APPROVED; // confirmed; slot is locked
    COMPLETED; // test drive took place
    CANCELLED; // cancelled by any actor or auto-cancelled when vehicle is sold
};
