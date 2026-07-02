using {automarket} from '../db/vehicle';

// CustomerPortalService is the public-facing vehicle catalog.
// @requires: 'any' opens it to unauthenticated guests. The status = FOR_SALE
// restriction is enforced in the handler so it cannot be lifted by a future
// annotation change without also touching the handler.
@impl: 'modules/vehicle/application/customer-portal.js'
service CustomerPortalService @(path: '/catalog') {

    // images is included in the projection. Composition navigation properties
    // are never inlined into a plain list response — only an explicit
    // $expand=images would return them (verified directly: GET .../Vehicles
    // omits images entirely without $expand) — so keeping it here costs
    // nothing on the catalog list, and gives the Object Page a real
    // composition to navigate for the @UI.Facets image gallery (EPIC19-T4,
    // customer-portal-ui.cds). VehicleImages below remains available too.
    // primaryImageUrl is a read-only calculated field (populated in
    // customer-portal.js, srv.after('READ')) — the first VehicleImages row by
    // sortOrder, or null. Annotated @UI.IsImageURL (customer-portal-ui.cds) so
    // the List Report renders it as a thumbnail instead of a text column
    // (EPIC19-T4).
    @requires: 'any'
    entity Vehicles      as
        projection on automarket.Vehicles {
            *,
            virtual null as primaryImageUrl : String
        };

    // VehicleImages is needed for the detail page image gallery.
    @requires: 'any'
    entity VehicleImages as projection on automarket.VehicleImages;

    // getFavoriteVehicles: returns the FOR_SALE vehicles the calling customer
    // has favorited. Authentication required — guests have no favorites.
    @requires: 'Customer'
    function getFavoriteVehicles()              returns array of Vehicles;

    // getPriceHistory: exposes price-history data for the sparkline on the
    // Vehicle Detail page. Read-only and guest-accessible; only FOR_SALE
    // vehicles are reachable via this portal so no status filter is needed here.
    @requires: 'any'
    function getPriceHistory(vehicleId: String) returns array of {
        newPrice  : Decimal;
        currency  : String;
        changedAt : Timestamp;
    };
}
