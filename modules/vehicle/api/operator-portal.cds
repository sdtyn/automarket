using {automarket} from '../db/vehicle';
using {automarket as automarketReservation} from '../../reservation/db/reservation';

// OperatorPortalService is the branch-scoped read/create surface for internal
// staff. Operators are restricted to their own branch via the @restrict where
// clause — CAP injects it as a SQL predicate, so Operators cannot enumerate
// vehicles from other branches even by guessing IDs.
// Managers see all branches and may create vehicles for any branch.
service OperatorPortalService @(path: '/operator') {

    // Operator READ is filtered to branch_ID = req.user.attr.branchId at the
    // query level. Manager READ is unrestricted. No WRITE on the projection —
    // creation goes through the explicit createVehicle action so status and
    // branch enforcement cannot be bypassed.
    @restrict: [
        {
            grant: 'READ',
            to   : 'Operator',
            where: 'branch_ID = $user.branchId'
        },
        {
            grant: 'READ',
            to   : 'Manager'
        }
    ]
    entity Vehicles     as
        projection on automarket.Vehicles
        excluding {
            images
        };

    // createVehicle: registers a new DRAFT vehicle.
    // For Operators the branch is taken from the user attribute —
    // they cannot target a different branch by passing a branchId.
    // Managers must supply an explicit branchId.
    @requires: [
        'Operator',
        'Manager'
    ]
    action createVehicle(vin: String,
                         plateNumber: String,
                         brand: String,
                         model: String,
                         year: Integer,
                         mileage: Integer,
                         fuelType: automarket.FuelType,
                         transmission: automarket.Transmission,
                         color: String,
                         price: Decimal,
                         currency: String,
                         branchId: String)                         returns String;

    // Reservations: Operators see only their branch's reservations via the
    // $user.branchId attribute. Managers see all branches.
    @restrict: [
        {
            grant: 'READ',
            to   : 'Operator',
            where: 'branch_ID = $user.branchId'
        },
        {
            grant: 'READ',
            to   : 'Manager'
        }
    ]
    entity Reservations as projection on automarket.Reservations;

    // approveReservation: branch-scoped wrapper around the ReservationService
    // action. Operators may only approve reservations belonging to their branch.
    @requires: [
        'Operator',
        'Manager'
    ]
    action approveReservation(reservationId: String)               returns Boolean;

    // rejectReservation: branch-scoped wrapper with the same guard.
    @requires: [
        'Operator',
        'Manager'
    ]
    action rejectReservation(reservationId: String, notes: String) returns Boolean;
}
