using {automarket} from '../db/vehicle';
using {automarket as automarketReservation} from '../../reservation/db/reservation';
using from '../../test-drive/db/test-drive';
using from '../../offer/db/offer';

// OperatorPortalService is the branch-scoped read/create surface for internal
// staff. Operators are restricted to their own branch via the @restrict where
// clause — CAP injects it as a SQL predicate, so Operators cannot enumerate
// vehicles from other branches even by guessing IDs.
// Managers see all branches and may create vehicles for any branch.
@impl: 'modules/vehicle/application/operator-portal.js'
service OperatorPortalService @(path: '/operator') {

    // Operator READ is filtered to branch_ID = req.user.attr.branchId at the
    // query level. Manager READ is unrestricted. No WRITE on the projection —
    // creation goes through the explicit createVehicle action so status and
    // branch enforcement cannot be bypassed.
    // images is included (unlike CustomerPortalService's list-performance
    // exclusion — see customer-portal.cds) so the @UI.Facets image gallery on
    // the Object Page (EPIC19-T2, operator-portal-ui.cds) has a composition to
    // navigate to. This entity set is opened one record at a time in the
    // Fiori app, not listed in bulk with images inlined, so the cost is fine.
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
    // statusCriticality is a read-only calculated field (populated in
    // operator-portal.js, srv.after('READ')) — not persisted. It maps
    // VehicleStatus to an OData UI.CriticalityType so the Fiori status badge
    // (EPIC19-T3, operator-portal-ui.cds) can color-code rows without the
    // client needing its own copy of the status→color mapping.
    entity Vehicles     as
        projection on automarket.Vehicles {
            *,
            virtual null as statusCriticality : Integer
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

    // TestDrives: branch-scoped read for Operators; Managers see all branches.
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
    entity TestDrives   as projection on automarket.TestDrives;

    // approveTestDrive: branch-scoped wrapper — Operators may only approve test
    // drives belonging to their branch.
    @requires: [
        'Operator',
        'Manager'
    ]
    action approveTestDrive(testDriveId: String,
                            durationMinutes: Integer)              returns Boolean;

    // cancelTestDrive: branch-scoped cancel; Operators cannot cancel drives from
    // other branches.
    @requires: [
        'Operator',
        'Manager'
    ]
    action cancelTestDrive(testDriveId: String)                    returns Boolean;

    // completeTestDrive: marks the test drive as done. Only valid from APPROVED.
    @requires: [
        'Operator',
        'Manager'
    ]
    action completeTestDrive(testDriveId: String)                  returns Boolean;

    // Offers: branch-scoped read for Managers and Admins only.
    // Operators do not have offer approval authority.
    @restrict: [
        {
            grant: 'READ',
            to   : 'Manager',
            where: 'branch_ID = $user.branchId'
        },
        {
            grant: 'READ',
            to   : 'Admin'
        }
    ]
    entity Offers       as projection on automarket.Offers;

    // approveOffer: branch-scoped wrapper — Managers may only approve offers
    // belonging to their branch. Creates a Reservation via OfferService.
    @requires: [
        'Manager',
        'Admin'
    ]
    action approveOffer(offerId: String)                           returns Boolean;

    // rejectOffer: branch-scoped wrapper with the same guard.
    @requires: [
        'Manager',
        'Admin'
    ]
    action rejectOffer(offerId: String,
                       rejectionNotes: String)                     returns Boolean;
}
