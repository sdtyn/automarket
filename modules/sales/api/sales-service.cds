using {automarket} from '../db/sales';

// SalesService manages the online purchase lifecycle.
// There is no guest path — createOrder requires an authenticated Customer.
// The vehicle transitions to PENDING_PAYMENT immediately on order creation
// (CheckoutStarted event); payment reactions are wired in T3.
@impl: 'modules/sales/application/sales-service.js'
service SalesService @(path: '/sales') {

    // Customers see only their own orders. Admins/Managers see all.
    @restrict: [
        {
            grant: 'READ',
            to   : 'Customer',
            where: 'customer_ID = $user'
        },
        {
            grant: 'READ',
            to   : [
                'Admin',
                'Manager'
            ]
        }
    ]
    entity Orders as projection on automarket.Orders;

    // createOrder: places a purchase order and locks the vehicle for payment.
    // Vehicle must be FOR_SALE (direct purchase) or RESERVED by this customer.
    @requires: 'Customer'
    action createOrder(vehicleId: String,
                       deliveryType: String) returns String;

    // cancelOrder: cancels an order before payment capture.
    // Customer may only cancel their own; Admin/Manager may cancel any.
    @requires: [
        'Customer',
        'Admin',
        'Manager'
    ]
    action cancelOrder(orderId: String)      returns Boolean;

    // completeOrder: marks a PAID order as fulfilled. Admin/Manager only.
    @requires: [
        'Admin',
        'Manager'
    ]
    action completeOrder(orderId: String)    returns Boolean;

    event OrderCreated {
        orderId   : String;
        vehicleId : String;
    }

    event OrderCancelled {
        orderId   : String;
        vehicleId : String;
    }

    event OrderCompleted {
        orderId   : String;
        vehicleId : String;
    }
}
