using {automarket} from '../db/test-drive';

// TestDriveService manages test drive scheduling.
// Unlike Reservations, test drives do not gate vehicle status — a FOR_SALE
// vehicle can have multiple future slots queued at the same time.
// Guest requestTestDrive (contactEmail/contactPhone) is added in T3.
service TestDriveService @(path: '/test-drive') {

    // Customers see only their own rows. Operators/Managers see all branch rows
    // (branch filter is enforced in T6's Operator Portal projection).
    @restrict: [
        {
            grant: 'READ',
            to   : 'Customer',
            where: 'customer_ID = $user'
        },
        {
            grant: 'READ',
            to   : [
                'Operator',
                'Manager'
            ]
        }
    ]
    entity TestDrives as projection on automarket.TestDrives;

    // requestTestDrive: creates a REQUESTED slot for an authenticated customer.
    // Rejects if the same vehicle already has an active request for the same slot.
    @requires: 'Customer'
    action requestTestDrive(vehicleId: String,
                            branchId: String,
                            scheduledAt: Timestamp,
                            notes: String)            returns String;

    // approveTestDrive: confirms the slot; optionally adjusts duration.
    @requires: [
        'Operator',
        'Manager'
    ]
    action approveTestDrive(testDriveId: String,
                            durationMinutes: Integer) returns Boolean;

    // cancelTestDrive: Customer may cancel their own; Operator/Manager may cancel
    // any test drive in their branch. Role enforcement is in the handler.
    @requires: [
        'Customer',
        'Operator',
        'Manager'
    ]
    action cancelTestDrive(testDriveId: String)       returns Boolean;

    // completeTestDrive: marks the test drive as done. Only valid from APPROVED.
    @requires: [
        'Operator',
        'Manager'
    ]
    action completeTestDrive(testDriveId: String)     returns Boolean;

    // requestTestDriveAsGuest: open to anonymous callers — no account required.
    // contactEmail is mandatory so the Operator can follow up.
    // Rate-limiting must be enforced at the API gateway layer; CAP itself has no
    // built-in rate limiter, so a reverse proxy rule (e.g. nginx limit_req or
    // an Azure APIM policy) should cap submissions per IP per hour.
    action requestTestDriveAsGuest(vehicleId: String,
                                   branchId: String,
                                   scheduledAt: Timestamp,
                                   contactEmail: String,
                                   contactPhone: String,
                                   notes: String)     returns String;

    event TestDriveRequested {
        testDriveId : String;
        vehicleId   : String;
    }

    event TestDriveApproved {
        testDriveId : String;
        vehicleId   : String;
    }

    event TestDriveCancelled {
        testDriveId : String;
        vehicleId   : String;
    }

    event TestDriveCompleted {
        testDriveId : String;
        vehicleId   : String;
    }
}
