# EPIC09 — Payments

Sprint 9. Goal: payment lifecycle — initiation with idempotency, PSP-simulated capture/failure webhooks, refund, and retry. No card data ever touches AutoMarket servers (PCI-DSS SAQ-A scope). PaymentSucceeded/Failed events bridge back to EPIC08-T3 subscribers in SalesService.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC09-T1 | Payment Domain Model — `Payments` entity, `PaymentStatus` enum, idempotencyKey unique constraint | Done |
| EPIC09-T2 | Payment Service — `initiatePayment`, `capturePayment`, `failPayment`, `refundPayment`, `retryPayment`, `getPaymentStatus` | Open |

### Sprint Backlog DoD mapping

- "Payment Provider Integration" → EPIC09-T2 (`initiatePayment`, capture/fail simulation)
- "Idempotency Handling" → EPIC09-T2 (`idempotencyKey` guard in `initiatePayment`)
- "Payment Status Tracking" → EPIC09-T1 (entity + enum), T2 (`getPaymentStatus`)

### Sign-off

_To be completed at sprint end._

---

## T1 — Payment Domain Model

**What & Why:** `Payments` tracks individual payment attempts for an Order. A single Order can have more than one Payment row (initial attempt + retry via `retryPayment`), but only one may be in INITIATED or AUTHORIZED status at a time — enforced at the application level in T2. `idempotencyKey` has a `@assert.unique` constraint: if the PSP client retries the same HTTP request with an identical key, the handler returns the existing `paymentId` rather than creating a second charge. The unique constraint is the hard guard; the handler's duplicate-check gives a clean 409 before the DB raises a constraint error. No card data is modeled (`transactionReference` is the PSP's opaque reference), keeping AutoMarket in PCI-DSS SAQ-A scope (AD-4).

### Create `modules/payment/db/payment.cds`

```cds
namespace automarket;

using {BaseEntity}        from '../../../shared/types/common';
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
@assert.unique: { idempotencyKey: [idempotencyKey] }
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
    INITIATED;   // payment session created, awaiting PSP response
    AUTHORIZED;  // PSP pre-authorised; not yet captured
    CAPTURED;    // funds captured; triggers PaymentSucceeded
    FAILED;      // PSP declined or timeout; triggers PaymentFailed
    REFUNDED;    // funds returned to customer
};
```

### Modify `db/index.cds`

Add after the sales line:

```cds
using from '../modules/payment/db/payment';
```
