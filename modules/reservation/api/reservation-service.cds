using {automarket} from '../db/reservation';

// ReservationService owns the full reservation lifecycle.
// Vehicle status transitions (FOR_SALE ↔ RESERVED) are driven here — the handler
// updates Vehicles directly via cds.entities to bypass VehicleService's UPDATE guard.
// Guest createReservation is handled in T4 (guestToken issuance); this service
// currently requires identified-customer auth.
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

    // createReservation: creates a REQUESTED reservation and immediately moves
    // the vehicle to RESERVED. Branch is derived from the vehicle — not taken
    // from the caller — so the association is always consistent.
    @requires: 'Customer'
    action createReservation(vehicleId: String, notes: String)     returns String;

    // approveReservation: advances a REQUESTED reservation to APPROVED.
    // Vehicle stays RESERVED — no vehicle state change at this step.
    @requires: [
        'Operator',
        'Manager'
    ]
    action approveReservation(reservationId: String)               returns Boolean;

    // rejectReservation: rejects a REQUESTED or APPROVED reservation.
    // Returns the vehicle to FOR_SALE via the VehicleStateMachine.
    @requires: [
        'Operator',
        'Manager'
    ]
    action rejectReservation(reservationId: String, notes: String) returns Boolean;

    // cancelReservation: customer cancels their own reservation.
    // Returns the vehicle to FOR_SALE if the reservation was APPROVED.
    @requires: 'Customer'
    action cancelReservation(reservationId: String)                returns Boolean;

    // completeReservation: marks the reservation as COMPLETED once the
    // Operator confirms the checkout handoff to Sales. Vehicle status is
    // driven by CheckoutStarted in the Sales flow, not here.
    @requires: [
        'Operator',
        'Manager'
    ]
    action completeReservation(reservationId: String)              returns Boolean;

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
}
