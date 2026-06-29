using {automarket} from '../db/pricing';

// PricingService owns all price mutations. Going through this service instead
// of a direct PATCH on Vehicles guarantees that every price change is audited
// and the VehiclePriceDropped event is emitted when applicable.
service PricingService @(path: '/pricing') {

    // PriceHistory is read-only here — writes happen only via updatePrice.
    // Internal-tier data: visible to Admin/Manager/Operator, not Customer or guest.
    @requires: [
        'Admin',
        'Manager',
        'Operator'
    ]
    entity PriceHistory as projection on automarket.PriceHistory;

    // updatePrice: the single authorised path for changing a vehicle's list price.
    // Records a PriceHistory row and emits VehiclePriceDropped when newPrice < current.
    @requires: [
        'Admin',
        'Manager'
    ]
    action   updatePrice(vehicleId: String,
                         newPrice: Decimal,
                         currency: String)            returns Boolean;

    // getPriceHistory: returns the full price-change log for a vehicle,
    // ordered by changedAt descending (most recent first).
    @requires: [
        'Admin',
        'Manager',
        'Operator'
    ]
    function getPriceHistory(vehicleId: String)       returns array of PriceHistory;

    // Emitted when updatePrice detects a decrease. Consumed by the Favorites
    // module in a later sprint to trigger price-drop notifications.
    event VehiclePriceDropped {
        vehicleId : String;
        oldPrice  : Decimal;
        newPrice  : Decimal;
    }

    // compareToListPrice: compares an offer amount against the vehicle's current
    // list price and its all-time lowest recorded price. Used by the Offer module
    // to give Managers context when approving or rejecting an offer.
    @requires: [
        'Admin',
        'Manager'
    ]
    function compareToListPrice(vehicleId: String,
                                offerAmount: Decimal) returns {
        currentPrice    : Decimal;
        lowestPrice     : Decimal;
        diffFromCurrent : Decimal;
        diffFromLowest  : Decimal;
        belowCurrentPct : Decimal;
        belowLowestPct  : Decimal;
    }
}
