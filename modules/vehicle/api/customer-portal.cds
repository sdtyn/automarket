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
        }
        actions {
            // reserve/addToFavorites/removeFromFavorites (EPIC20-T1) are bound
            // to Vehicles so Fiori Elements can wire them onto the Object Page
            // via @UI.DataFieldForAction (see customer-portal-ui.cds) — unlike
            // the unbound actions this same UI need hit a wall on in EPIC19-T3.
            // Handlers delegate to ReservationService/FavoritesService (below)
            // rather than reimplementing their validation/state-machine logic.
            @requires: 'Customer'
            action reserve(notes : String)  returns {
                reservationId : String
            };

            @requires: 'Customer'
            action addToFavorites()         returns String;

            @requires: 'Customer'
            action removeFromFavorites()    returns Boolean;
        };

    // VehicleImages is needed for the detail page image gallery.
    @requires: 'any'
    entity VehicleImages as projection on automarket.VehicleImages;

    // Reservations (EPIC20-T1): customer-scoped "My Reservations" view, so a
    // logged-in customer can see and cancel their own reservations without
    // leaving the catalog app. Same row-level restriction as ReservationService
    // itself — this is a second, UI-facing exposure of the same underlying
    // entity, not a relaxation of who can see what.
    // @restrict is a grant whitelist — unlike Vehicles' scalar @requires:'any',
    // any operation not explicitly listed here is denied by default, including
    // bound actions. cancel needs its own grant entry (same ownership
    // predicate as READ) or every caller gets 403 regardless of the action's
    // own @requires — verified directly: without this grant, cancel returned
    // 403 even for Admin.
    @restrict: [
        {
            grant: 'READ',
            to   : 'Customer',
            where: 'customer_ID = $user'
        },
        {
            grant: 'cancel',
            to   : 'Customer',
            where: 'customer_ID = $user'
        }
    ]
    entity Reservations  as
        projection on automarket.Reservations
        actions {
            @requires: 'Customer'
            action cancel() returns Boolean;
        };

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
