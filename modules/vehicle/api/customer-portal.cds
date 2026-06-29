using {automarket} from '../db/vehicle';

// CustomerPortalService is the public-facing vehicle catalog.
// @requires: 'any' opens it to unauthenticated guests. The status = FOR_SALE
// restriction is enforced in the handler so it cannot be lifted by a future
// annotation change without also touching the handler.
service CustomerPortalService @(path: '/catalog') {

    // images excluded from the list projection — the detail page fetches
    // VehicleImages separately so the list query stays lightweight.
    @requires: 'any'
    entity Vehicles      as
        projection on automarket.Vehicles
        excluding {
            images
        };

    // VehicleImages is needed for the detail page image gallery.
    @requires: 'any'
    entity VehicleImages as projection on automarket.VehicleImages;
}
