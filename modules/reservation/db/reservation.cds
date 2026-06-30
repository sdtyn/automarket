namespace automarket;

using {BaseEntity} from '../../../shared/types/common';
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
    vehicle     : Association to Vehicles;
    branch      : Association to Branches;
    customer_ID : String(255);
    guestToken  : String(2000);
    status      : ReservationStatus default 'REQUESTED';
    // expiresAt is always createdAt + 48h, set once at creation and never
    // reset — even if a checkout attempt fails (Sprint Backlog §20).
    expiresAt   : Timestamp;
    notes       : String(1000);
}

// ReservationStatus mirrors the reservation lifecycle in Implementation
// Architecture §13. Transitions are enforced by ReservationService handlers.
type ReservationStatus : String enum {
    REQUESTED; // created, awaiting Operator/Manager approval
    APPROVED; // approved, vehicle is reserved
    REJECTED; // rejected by Operator/Manager; vehicle returns to FOR_SALE
    CANCELLED; // cancelled by customer or guest; vehicle returns to FOR_SALE
    EXPIRED; // not actioned within 48h; vehicle returns to FOR_SALE
    COMPLETED; // reservation fulfilled (checkout handed off to Sales)
};
