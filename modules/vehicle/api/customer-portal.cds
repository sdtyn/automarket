using {automarket} from '../db/vehicle';
using {automarket.Orders as SalesOrders} from '../../sales/db/sales';
using {automarket.Payments as SalesPayments} from '../../payment/db/payment';

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
    // isFavorited/isNotFavorited: read-only calculated fields (populated in
    // customer-portal.js, srv.after('READ'), one query against Favorites per
    // page) — mutually exclusive booleans, not a single field, because
    // @UI.Hidden path bindings can only reference a field directly, with no
    // negation operator available in CDS annotation syntax. Drive the
    // addToFavorites/removeFromFavorites button visibility (customer-portal-ui.cds)
    // so a customer never sees (or can click) the button for the state
    // they're already in — previously both buttons always showed, and
    // clicking "Add" on an already-favorited vehicle leaked a raw SQLite
    // UNIQUE-constraint error to the UI.
    @requires: 'any'
    entity Vehicles      as
        projection on automarket.Vehicles {
            *,
            virtual null as primaryImageUrl  : String,
            virtual null as isFavorited      : Boolean,
            virtual null as isNotFavorited   : Boolean
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

            // submitOffer/requestTestDrive (EPIC20-T2), same delegation
            // pattern as reserve above. branchId is not a parameter here —
            // it is auto-derived from the bound Vehicle's own branch_ID in
            // the handler (customer-portal.js), sparing the customer a field
            // they have no reason to type in themselves.
            @requires: 'Customer'
            action submitOffer(offeredPrice : Decimal,
                               currency : String,
                               desiredPickupDate : Date,
                               notes : String)   returns String;

            @requires: 'Customer'
            action requestTestDrive(scheduledAt : Timestamp,
                                    notes : String) returns String;

            // checkout (EPIC20-T3): places a purchase order for this vehicle.
            // Delegates to SalesService.createOrder — vehicleId comes from the
            // bound entity, not a parameter. Returns the new orderId so the
            // customer lands on "My Orders" to complete payment.
            @requires: 'Customer'
            action checkout(deliveryType : String) returns String;
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

    // Offers (EPIC20-T2): customer-scoped "My Offers" view — same restrict
    // shape as Reservations above. resubmit is only valid on a REJECTED offer
    // (enforced in the delegated OfferService.resubmitOffer handler, not
    // re-checked here).
    @restrict: [
        {
            grant: 'READ',
            to   : 'Customer',
            where: 'customer_ID = $user'
        },
        {
            grant: 'resubmit',
            to   : 'Customer',
            where: 'customer_ID = $user'
        }
    ]
    entity Offers        as
        projection on automarket.Offers
        actions {
            @requires: 'Customer'
            action resubmit(offeredPrice : Decimal, desiredPickupDate : Date) returns Boolean;
        };

    // TestDrives (EPIC20-T2): customer-scoped "My Test Drives" view. cancel
    // here always means "cancel my own" — the Operator/Manager cancel path
    // (any test drive, any customer) is EPIC20-T4's OperatorPortalService job,
    // not this one.
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
    entity TestDrives    as
        projection on automarket.TestDrives
        actions {
            @requires: 'Customer'
            action cancel() returns Boolean;
        };

    // Orders (EPIC20-T3): customer-scoped "My Orders" view — the critical
    // browse→reserve/offer→buy→pay demo path lands here. pay/retryPay omit
    // provider defaults and all PSP-plumbing parameters (amount, currency,
    // idempotencyKey) that the customer has no reason to supply — the handler
    // (customer-portal.js) derives amount/currency from the order's own
    // vehicle price and auto-generates the idempotencyKey server-side.
    @restrict: [
        {
            grant: 'READ',
            to   : 'Customer',
            where: 'customer_ID = $user'
        },
        {
            grant: [
                'cancel',
                'pay',
                'retryPay'
            ],
            to   : 'Customer',
            where: 'customer_ID = $user'
        }
    ]
    entity Orders        as
        projection on SalesOrders
        actions {
            @requires: 'Customer'
            action cancel()                returns Boolean;

            @requires: 'Customer'
            action pay(provider : String)  returns String;

            @requires: 'Customer'
            action retryPay()              returns String;
        };

    // Payments (EPIC20-T3): read-only payment history for the customer's own
    // orders. No bound actions — capture/fail/refund are Admin/Manager-only
    // PSP-simulation actions, EPIC20-T5's job, not this one.
    @restrict: [{
        grant: 'READ',
        to   : 'Customer',
        where: 'order.customer_ID = $user'
    }]
    entity Payments      as projection on SalesPayments;

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
