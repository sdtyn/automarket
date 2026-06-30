namespace automarket;

using {BaseEntity} from '../../../shared/types/common';
using {automarket.Orders} from '../../sales/db/sales';

// Payments tracks a single payment attempt for an Order.
// One Order may have multiple Payment rows (e.g. initial attempt + retry),
// but only one should be in INITIATED or AUTHORIZED status at a time.
//
// idempotencyKey is client-generated and unique — a retried HTTP request
// carrying the same key returns the existing paymentId rather than
// creating a duplicate charge. The unique constraint is the hard guard;
// the handler checks first to return a clean error before the DB raises.
//
// No card data is ever stored here (AD-4 / PCI-DSS SAQ-A):
// transactionReference is the PSP's opaque reference, not a card number.
@assert.unique: {idempotencyKey: [idempotencyKey]}
entity Payments : BaseEntity {
    order                : Association to Orders;
    provider             : String(50);
    amount               : Decimal(15, 2);
    currency             : String(3) default 'TRY';
    // transactionReference is set by the PSP on capture; null until then.
    transactionReference : String(255);
    idempotencyKey       : String(255);
    status               : PaymentStatus default 'INITIATED';
}

// PaymentStatus lifecycle: INITIATED → AUTHORIZED → CAPTURED
//                                    ↘ FAILED   (terminal — from INITIATED or AUTHORIZED)
//                          CAPTURED  → REFUNDED  (terminal — only from CAPTURED)
type PaymentStatus : String enum {
    INITIATED; // payment session created, awaiting PSP response
    AUTHORIZED; // PSP pre-authorised; not yet captured
    CAPTURED; // funds captured; triggers PaymentSucceeded
    FAILED; // PSP declined or timeout; triggers PaymentFailed
    REFUNDED; // funds returned to customer
};
