using {automarket} from '../db/offer';

// OfferService manages the customer price-offer lifecycle.
// There is no guest path — all actions require an authenticated session.
@impl: 'modules/offer/application/offer-service.js'
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
    action submitOffer(vehicleId: String,
                       offeredPrice: Decimal,
                       currency: String,
                       desiredPickupDate: Date,
                       notes: String)             returns String;

    // approveOffer: transitions offer to APPROVED and creates an APPROVED
    // Reservation for the same vehicle/customer. Only Manager and Admin.
    @requires: [
        'Manager',
        'Admin'
    ]
    action approveOffer(offerId: String)          returns Boolean;

    // rejectOffer: transitions offer to REJECTED. Customer may resubmit (T3).
    @requires: [
        'Manager',
        'Admin'
    ]
    action rejectOffer(offerId: String,
                       rejectionNotes: String)    returns Boolean;

    // resubmitOffer: allows a Customer to revise and resubmit a REJECTED offer.
    // Updates the existing row rather than opening a new one so the Manager
    // sees the full revision history in a single record.
    @requires: 'Customer'
    action resubmitOffer(offerId: String,
                         offeredPrice: Decimal,
                         desiredPickupDate: Date) returns Boolean;

    // withdrawOffer (EPIC22-T1): a Customer voluntarily withdraws their own
    // still-pending offer. Only SUBMITTED/UNDER_REVIEW may be withdrawn —
    // once a Manager has decided (APPROVED/REJECTED), the row is negotiation
    // history and stays (REJECTED remains resubmit-able via resubmitOffer
    // above). Unlike rejection, withdrawal actually deletes the row: the
    // customer chose to retract it before anyone reviewed it, so there is no
    // decision to keep a record of. Also used (unchanged) by EPIC22-T2 for a
    // Customer declining a Manager's counter-offer — same "delete a still-
    // pending offer its own customer_ID owns" semantics apply regardless of
    // who (customer or staff) most recently set the price.
    @requires: 'Customer'
    action withdrawOffer(offerId: String)         returns Boolean;

    // counterOffer (EPIC22-T2): a Manager proposes a different price on an
    // existing SUBMITTED/UNDER_REVIEW offer instead of approving/rejecting
    // outright. Updates the same row (offeredPrice, proposedBy = 'STAFF') —
    // same one-row negotiation-history philosophy as resubmitOffer — rather
    // than opening a second Offers record for the same negotiation.
    @requires: [
        'Manager',
        'Admin'
    ]
    action counterOffer(offerId: String,
                        offeredPrice: Decimal)     returns Boolean;

    // acceptCounterOffer (EPIC22-T2): the Customer accepts the Manager's
    // counter-price. Mirrors approveOffer's own effect (APPROVED + a
    // Reservation created) since accepting is functionally the same outcome
    // as a Manager approving the customer's own offer — only who clicked
    // the button differs. Reservation creation still uses the vehicle's own
    // price at checkout (system-wide limitation, unchanged by this ticket —
    // see docs/implementations/EPIC22-customer-portal-ux-fixes.md, T2).
    @requires: 'Customer'
    action acceptCounterOffer(offerId: String)     returns {
        reservationId : String
    };

    event OfferSubmitted {
        offerId   : String;
        vehicleId : String;
    }

    event OfferApproved {
        offerId   : String;
        vehicleId : String;
    }

    event OfferRejected {
        offerId   : String;
        vehicleId : String;
    }

    // OfferCountered (EPIC22-T2): fired when a Manager counters, mirroring
    // OfferSubmitted/OfferApproved/OfferRejected above so any future
    // notification subscriber has the same event to hook into.
    event OfferCountered {
        offerId   : String;
        vehicleId : String;
    }
}
