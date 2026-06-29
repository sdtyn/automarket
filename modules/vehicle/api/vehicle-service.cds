using {automarket} from '../db/vehicle';

// VehicleService is scoped to /vehicle. Status transitions are only
// possible through the publish and archive actions — never via a direct
// PATCH on the entity — so the state machine cannot be bypassed.
service VehicleService @(path: '/vehicle') {

    // @odata.etag on modifiedAt: CAP returns the etag on every GET and
    // validates the If-Match header on PATCH/PUT, giving us optimistic
    // locking without any manual version-counter code.
    @restrict: [
        {
            grant: 'READ',
            to   : 'authenticated-user'
        },
        {
            grant: [
                'CREATE',
                'UPDATE'
            ],
            to   : [
                'Operator',
                'Manager'
            ]
        },
        {
            grant: 'DELETE',
            to   : 'Admin'
        }
    ]
    entity Vehicles as
        projection on automarket.Vehicles {
            *,
            @odata.etag modifiedAt
        };

    // publish: transitions a DRAFT vehicle to FOR_SALE.
    // The state machine guard requires price, branch, and at least one image.
    @requires: 'Manager'
    action   publish(vehicleId: String)       returns String;

    // archive: transitions a DRAFT or FOR_SALE vehicle to ARCHIVED.
    // Used when a vehicle is pulled from the catalog permanently.
    @requires: [
        'Manager',
        'Admin'
    ]
    action   archive(vehicleId: String)       returns String;

    // searchVehicles: open to guests but the handler silently locks the
    // status filter to FOR_SALE for unauthenticated callers so they cannot
    // enumerate vehicles in internal statuses (DRAFT, RESERVED, etc.).
    @requires: 'any'
    function searchVehicles(brand: String,
                            model: String,
                            priceMin: Decimal,
                            priceMax: Decimal,
                            status: automarket.VehicleStatus,
                            branchId: String) returns array of Vehicles;
}
