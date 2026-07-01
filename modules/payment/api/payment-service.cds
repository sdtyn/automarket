using {automarket} from '../db/payment';

// PaymentService manages the payment lifecycle for Orders.
// Card data never passes through this service (PCI-DSS SAQ-A / AD-4).
// capturePayment and failPayment simulate PSP webhook callbacks —
// in production these would be triggered by the PSP, not by a user action.
@impl: 'modules/payment/application/payment-service.js'
service PaymentService @(path: '/payments') {

    // Customers see only payments linked to their own orders.
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
    entity Payments as projection on automarket.Payments;

    // initiatePayment: creates a payment session and returns a PSP redirect reference.
    // Requires a client-generated idempotencyKey; rejects if absent.
    @requires: 'Customer'
    action   initiatePayment(orderId: String,
                             provider: String,
                             idempotencyKey: String,
                             amount: Decimal,
                             currency: String)            returns String;

    // retryPayment: opens a new payment attempt after a FAILED payment.
    // Copies provider/amount/currency from the last failed attempt.
    @requires: 'Customer'
    action   retryPayment(orderId: String,
                          idempotencyKey: String)         returns String;

    // capturePayment: records a successful PSP capture (Admin-only / PSP webhook sim).
    // Emits PaymentSucceeded, which SalesService reacts to.
    @requires: 'Admin'
    action   capturePayment(paymentId: String,
                            transactionReference: String) returns Boolean;

    // failPayment: records a PSP decline or timeout (Admin-only / PSP webhook sim).
    // Emits PaymentFailed, which SalesService reacts to.
    @requires: 'Admin'
    action   failPayment(paymentId: String)               returns Boolean;

    // refundPayment: reverses a CAPTURED payment. Manager/Admin only.
    @requires: [
        'Admin',
        'Manager'
    ]
    action   refundPayment(paymentId: String)             returns Boolean;

    // getPaymentStatus: returns the most recent payment status for an order.
    @requires: [
        'Customer',
        'Admin',
        'Manager'
    ]
    function getPaymentStatus(orderId: String)            returns String;

    event PaymentSucceeded {
        orderId   : String;
        vehicleId : String;
    }

    event PaymentFailed {
        orderId   : String;
        vehicleId : String;
    }

    event PaymentRefunded {
        orderId   : String;
        vehicleId : String;
    }
}
