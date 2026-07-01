using {automarket} from '../db/delivery';

// DeliveryService handles the physical handover lifecycle for HOME_DELIVERY orders.
// All write actions are Admin/Manager only — customers have read-only access
// to their own delivery records via the @restrict clause.
@impl: 'modules/delivery/application/delivery-service.js'
service DeliveryService @(path: '/deliveries') {

    // Customers see only deliveries linked to their own orders.
    @restrict: [
        {
            grant: 'READ',
            to   : 'Customer',
            where: 'order.customer_ID = $user'
        },
        {
            grant: 'READ',
            to   : [
                'Admin',
                'Manager'
            ]
        }
    ]
    entity Deliveries as projection on automarket.Deliveries;

    // scheduleDelivery: creates a Delivery record for a HOME_DELIVERY order.
    // Rejected for CUSTOMER_PICKUP orders and for orders not yet PAID.
    @requires: [
        'Admin',
        'Manager'
    ]
    action scheduleDelivery(orderId: String,
                            plannedDate: Date)  returns String;

    // updateDelivery: changes plannedDate and/or status for a non-terminal delivery.
    // Use status 'FAILED' to mark an unsuccessful attempt.
    @requires: [
        'Admin',
        'Manager'
    ]
    action updateDelivery(deliveryId: String,
                          plannedDate: Date,
                          status: String)       returns Boolean;

    // completeDelivery: marks delivery as DELIVERED and records deliveredDate = today.
    @requires: [
        'Admin',
        'Manager'
    ]
    action completeDelivery(deliveryId: String) returns Boolean;
}
