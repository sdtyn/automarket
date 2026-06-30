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
    action submitOffer(vehicleId: String,
                       offeredPrice: Decimal,
                       currency: String,
                       desiredPickupDate: Date,
                       notes: String)          returns String;

    // approveOffer: transitions offer to APPROVED and creates an APPROVED
    // Reservation for the same vehicle/customer. Only Manager and Admin.
    @requires: [
        'Manager',
        'Admin'
    ]
    action approveOffer(offerId: String)       returns Boolean;

    // rejectOffer: transitions offer to REJECTED. Customer may resubmit (T3).
    @requires: [
        'Manager',
        'Admin'
    ]
    action rejectOffer(offerId: String,
                       rejectionNotes: String) returns Boolean;

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
}
