namespace automarket;

using {BaseEntity} from '../../../shared/types/common';
using {automarket.Vehicles} from '../../vehicle/db/vehicle';
using {automarket.Branches} from '../../branch/db/branch';

// Orders is the aggregate that represents a confirmed purchase intent.
// Unlike Reservations, an Order always has a customer — there is no guest path.
// The vehicle transitions to PENDING_PAYMENT when the Order is created;
// the Order itself moves through CREATED → PENDING_PAYMENT → PAID → COMPLETED.
//
// The partial unique index below enforces Domain Model Rule S-1: only one active
// order per vehicle. It is defense-in-depth alongside the Vehicle-level state
// guard — either one missing leaves a race window.
@sql.append: 'UNIQUE (vehicle_ID) WHERE status IN (''CREATED'', ''PENDING_PAYMENT'', ''PAID'')'
entity Orders : BaseEntity {
    vehicle      : Association to Vehicles;
    branch       : Association to Branches;
    // customer_ID is never null — Order always requires authentication.
    customer_ID  : String(255);
    orderDate    : DateTime;
    deliveryType : DeliveryType;
    status       : OrderStatus default 'CREATED';
}

type DeliveryType : String enum {
    CUSTOMER_PICKUP; // customer collects from branch
    HOME_DELIVERY; // vehicle delivered to customer address
};

// OrderStatus lifecycle: CREATED → PENDING_PAYMENT → PAID → COMPLETED
//                                              ↘ CANCELLED (by customer, admin, or payment failure)
type OrderStatus  : String enum {
    CREATED; // order placed, awaiting payment initiation
    PENDING_PAYMENT; // payment flow started, vehicle locked
    PAID; // payment captured; awaiting fulfilment
    COMPLETED; // vehicle handed over
    CANCELLED; // cancelled before payment, or payment failed
};
