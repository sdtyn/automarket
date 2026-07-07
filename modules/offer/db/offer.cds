namespace automarket;

using {BaseEntity} from '../../../shared/types/common';
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
    // It stays the SAME customer even when proposedBy = STAFF (EPIC22-T2,
    // Manager counter-offer) — customer_ID always identifies whose
    // negotiation this is, proposedBy identifies who set the current price.
    customer_ID       : String(255);
    offeredPrice      : Decimal(15, 2);
    currency          : String(3) default 'TRY';
    desiredPickupDate : Date;
    status            : OfferStatus default 'SUBMITTED';
    // proposedBy (EPIC22-T2): whoever set the CURRENT offeredPrice. Flips to
    // STAFF when a Manager counter-offers (OfferService.counterOffer), back
    // to CUSTOMER if the customer then submits a fresh price over that
    // counter (OfferService via Vehicles.makeNewOffer) — same row, same
    // negotiation-history-in-one-record philosophy as resubmitOffer.
    proposedBy        : String(20) enum {
        CUSTOMER;
        STAFF;
    } default 'CUSTOMER';
    // rejectionNotes lets the Manager explain why an offer was rejected,
    // so the customer can make a better resubmission.
    rejectionNotes    : String(1000);
}

// OfferStatus lifecycle: SUBMITTED → UNDER_REVIEW → APPROVED
//                                               ↘ REJECTED (customer may resubmit)
//                                               ↘ EXPIRED  (system, 48h after approval)
type OfferStatus : String enum {
    SUBMITTED; // customer submitted, awaiting Manager review
    UNDER_REVIEW; // Manager opened the offer — reserved for future UI state
    APPROVED; // Manager approved; a Reservation has been created
    REJECTED; // Manager rejected; customer may resubmit
    EXPIRED; // 48h elapsed after approval without checkout
};
