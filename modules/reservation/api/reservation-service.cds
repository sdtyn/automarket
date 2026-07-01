using {automarket} from '../db/reservation';


// ReservationService owns the full reservation lifecycle.
// Vehicle status transitions (FOR_SALE ↔ RESERVED) are driven here — the handler
// updates Vehicles directly via cds.entities to bypass VehicleService's UPDATE guard.
// Guest createReservation issues a signed guestToken instead of reading customer_ID.
// Guests read/cancel via getGuestReservation and cancelGuestReservation actions.
@impl: 'modules/reservation/application/reservation-service.js'
service ReservationService @(path: '/reservation') {

    // Customers see only their own rows; Operators/Managers see their branch.
    // Branch-scoped filter for staff is enforced in T7 (Operator Portal).
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
    entity Reservations as projection on automarket.Reservations;

    // createReservation: open to guests (@requires: 'any'). Identified customers
    // get back only reservationId; guests also receive a guestToken they must
    // store — it is the only credential that can read or cancel the reservation.
    @requires: 'any'
    action   createReservation(vehicleId: String, notes: String)     returns {
        reservationId : String;
        guestToken    : String;
    };

    // approveReservation: advances a REQUESTED reservation to APPROVED.
    // Vehicle stays RESERVED — no vehicle state change at this step.
    @requires: [
        'Operator',
        'Manager'
    ]
    action   approveReservation(reservationId: String)               returns Boolean;

    // rejectReservation: rejects a REQUESTED or APPROVED reservation.
    // Returns the vehicle to FOR_SALE via the VehicleStateMachine.
    @requires: [
        'Operator',
        'Manager'
    ]
    action   rejectReservation(reservationId: String, notes: String) returns Boolean;

    // cancelReservation: customer cancels their own reservation.
    // Returns the vehicle to FOR_SALE if the reservation was APPROVED.
    @requires: 'Customer'
    action   cancelReservation(reservationId: String)                returns Boolean;

    // completeReservation: marks the reservation as COMPLETED once the
    // Operator confirms the checkout handoff to Sales. Vehicle status is
    // driven by CheckoutStarted in the Sales flow, not here.
    @requires: [
        'Operator',
        'Manager'
    ]
    action   completeReservation(reservationId: String)              returns Boolean;

    event ReservationCreated {
        reservationId : String;
        vehicleId     : String;
    }

    event ReservationApproved {
        reservationId : String;
        vehicleId     : String;
    }

    event ReservationRejected {
        reservationId : String;
        vehicleId     : String;
    }

    event ReservationCancelled {
        reservationId : String;
        vehicleId     : String;
    }

    event ReservationCompleted {
        reservationId : String;
        vehicleId     : String;
    }

    // claimReservation: converts a guest reservation into an identified-customer
    // reservation. Caller must be authenticated (Customer role) and present the
    // original guestToken. Sets customer_ID and clears guestToken atomically.
    @requires: 'Customer'
    action   claimReservation(guestToken: String)                    returns Boolean;

    event ReservationClaimed {
        reservationId : String;
        vehicleId     : String;
        customerId    : String;
    }

    event ReservationExpired {
        reservationId : String;
        vehicleId     : String;
    }

    // getGuestReservation: allows a guest to fetch their reservation by token.
    // Token signature is verified in the handler — CAP auth cannot do this.
    @requires: 'any'
    function getGuestReservation(guestToken: String)                 returns Reservations;

    // cancelGuestReservation: allows a guest to cancel their reservation by token.
    @requires: 'any'
    action   cancelGuestReservation(guestToken: String)              returns Boolean;
}
