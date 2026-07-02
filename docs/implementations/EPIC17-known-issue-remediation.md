# EPIC17 — Known Issue Remediation

**Goal:** Fix the bugs discovered and deliberately deferred while writing EPIC15/EPIC16 tests and
while auditing `NotificationService`, all logged in `docs/error-log.md` — before building any new
feature (price-drop alerts, UI, production readiness) on top of them.

---

## Sprint Overview

### Ticket Table

| Ticket | Description | Status |
|--------|-------------|--------|
| EPIC17-T1 | `retryPayment` / Order `CANCELLED` design fix | Done |
| EPIC17-T2 | `NotificationService`: `VehiclePriceDropped` wired to the wrong service | Open |
| EPIC17-T3 | `NotificationService`: `resolveUserId` email/UUID mismatch | Open |
| EPIC17-T4 | Regression test | Open |

### Sprint Backlog DoD Mapping

| DoD Item | Satisfied by |
|----------|-------------|
| All three known issues fixed or a deliberate design decision recorded | Per ticket |
| Regression test proves notifications are actually created | EPIC17-T4 |
| CI pipeline stays green | Verified after each commit |

### Sign-off

_To be filled in at sprint end._

---

## EPIC17-T1: `retryPayment` / Order `CANCELLED` design fix

### What & Why

`docs/error-log.md` (`[2026-07-02] retryPayment is unreachable after failPayment`) documents a
contradiction between two epics: EPIC08-T3's `PaymentFailed` subscriber in `sales-service.js`
always drove the Order straight to `CANCELLED` and released the Vehicle, while EPIC09-T2's
`retryPayment` requires the Order to still be `PENDING_PAYMENT`. Since every `failPayment` call
cancelled the order first, `retryPayment` could never actually run.

Looking at what `retryPayment` itself does — it only inserts a new `Payment` row and never
touches `Orders` or `Vehicles` — the original design intent is clear: a single failed payment
attempt should **not** give up on the order. The vehicle should stay locked (`PENDING_PAYMENT`)
so the customer can retry with a different payment method. Only an explicit `cancelOrder` call
(by the customer or an Admin/Manager) should actually release the vehicle and cancel the order —
`cancelOrder` already implements exactly that release logic independently.

The fix removes the `PaymentFailed` subscriber's Order/Vehicle mutation entirely. `failPayment`
(in `payment-service.js`) already marks the `Payment` row `FAILED` — that is now the only
observable effect of a failed payment. `PaymentSucceeded` is untouched (that choreography was
never part of the contradiction).

### Step-by-step

#### 1. Modify `modules/sales/application/sales-service.js`

Remove the entire `PaymentSrv.on('PaymentFailed', ...)` block (previously between the
`PaymentSucceeded` subscriber and the `const { Orders, Vehicles, Reservations } = ...` line),
and replace it with a comment explaining why there is no handler:

```js
  // PaymentFailed: intentionally a no-op on Order/Vehicle state (EPIC17-T1 fix).
  // A single failed attempt must not release the vehicle or cancel the order,
  // otherwise retryPayment's PENDING_PAYMENT guard could never be satisfied —
  // see docs/error-log.md "retryPayment is unreachable after failPayment".
  // The customer (or Admin/Manager) must call cancelOrder explicitly to give up
  // and release the vehicle; failPayment itself only marks the Payment FAILED
  // (done in payment-service.js) so the customer can retry with a new attempt.
```

This sits directly above the existing `const { Orders, Vehicles, Reservations } = cds.entities('automarket');` line — no other line in the file changes.

#### 2. Update `tests/unit/services/payment-service.test.js`

- The `failPayment` happy-path test now asserts the order **stays** `PENDING_PAYMENT` and the
  vehicle **stays** `PENDING_PAYMENT` (previously asserted `CANCELLED` / `FOR_SALE`).
- The old "KNOWN ISSUE" test under `retryPayment` (which asserted a 409 after `failPayment`) is
  replaced with a happy-path test: initiate → fail → retry now succeeds and returns a new
  `PSP-SESSION-<id>`, with the order still `PENDING_PAYMENT` and a fresh `INITIATED` payment row.

#### 3. Update `docs/error-log.md`

Change the `retryPayment` entry's `**Status:**` line from `Open — documented, not fixed` to
`Fixed in EPIC17-T1` with a one-line summary of the fix (`PaymentFailed` no longer mutates
Order/Vehicle state; `cancelOrder` is the only real cancellation path).

#### 4. Verify

```sh
npm test
```

Expected: all suites still green, `retryPayment` happy-path test passes.

---
