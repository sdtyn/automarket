namespace automarket;

using {BaseEntity} from '../../../shared/types/common';
using {automarket.Orders} from '../../sales/db/sales';

// Deliveries tracks the physical handover of a vehicle for HOME_DELIVERY orders.
// A Delivery record is created only when scheduleDelivery is called —
// CUSTOMER_PICKUP orders never have a corresponding row here.
// deliveredDate is null until completeDelivery sets it.
entity Deliveries : BaseEntity {
    order         : Association to Orders;
    plannedDate   : Date;
    // deliveredDate is populated by completeDelivery; null while in progress.
    deliveredDate : Date;
    status        : DeliveryStatus default 'PLANNED';
}

// DeliveryStatus lifecycle: PLANNED → IN_PROGRESS → DELIVERED
//                                    ↘ FAILED (terminal — delivery could not be completed)
type DeliveryStatus : String enum {
    PLANNED; // scheduled but not yet started
    IN_PROGRESS; // vehicle is en route
    DELIVERED; // vehicle handed over to customer
    FAILED; // delivery could not be completed
};
