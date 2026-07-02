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
| EPIC17-T2 | `NotificationService`: `VehiclePriceDropped` wired to the wrong service | Done |
| EPIC17-T3 | `NotificationService`: `resolveUserId` email/UUID mismatch | Done |
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

## EPIC17-T2: `NotificationService`: `VehiclePriceDropped` wired to the wrong service

### What & Why

`docs/error-log.md` (`[2026-07-02] VehiclePriceDropped listener registered on the wrong service`)
documents that `notification-service.js` subscribed to `VehiclePriceDropped` via
`cds.connect.to('VehicleService')`, but the event is declared and emitted only by
`PricingService` (`modules/pricing/api/pricing-service.cds`, `modules/pricing/application/pricing-service.js`).
`VehicleService` never emits it, so the listener could never fire — no price-drop notification
was ever created, regardless of the `resolveUserId` bug fixed in EPIC17-T3.

The fix is a one-line wiring change: connect to `PricingService` instead of `VehicleService` for
this one subscription. `VehicleSold` and `SimilarVehicleListed` stay on `VehicleService`, since
those events genuinely are declared there.

The event payload only carries `{ vehicleId, oldPrice, newPrice }` (no `currency`), so the old
handler's `currency ?? 'TRY'` fallback was already dead code — removed along with the fix.
Rewriting the notification content to spec (EMAIL channel, German text) is EPIC18-T1's job, not
this ticket's — this ticket only makes the handler reachable.

### Step-by-step

#### 1. Modify `modules/notification/application/notification-service.js`

Replace the `VehiclePriceDropped` subscription block (the one currently registered on
`VehicleSrv`, between the `VehicleSold` subscriber and the `SimilarVehicleListed` subscriber)
with:

```js
  // VehiclePriceDropped: notify favoriting users of a price reduction.
  // EPIC17-T2 fix: this event is declared and emitted only by PricingService
  // (modules/pricing/api/pricing-service.cds), never by VehicleService — a
  // listener attached to VehicleService could never receive it. See
  // docs/error-log.md "VehiclePriceDropped listener registered on the wrong
  // service — never fires". Content/channel (EMAIL, German) is EPIC18-T1 scope.
  const PricingSrv = await cds.connect.to('PricingService');
  PricingSrv.on('VehiclePriceDropped', async (msg) => {
    const { vehicleId, newPrice } = msg.data;
    await createNotificationsForFavorites(
      vehicleId,
      'Price drop on a vehicle you saved',
      `The price of vehicle ${vehicleId} has dropped to ${newPrice}.`
    );
  });
```

Also update the comment directly above `const VehicleSrv = await cds.connect.to('VehicleService');`
(a few lines earlier in the same file) — it previously said "VehiclePriceDropped and
SimilarVehicleListed subscribers are registered now"; change it to:

```js
  // Subscribe to VehicleService events that concern favorited vehicles.
  // SimilarVehicleListed subscriber is registered now; it will fire automatically
  // once VehicleService adds that event.
```

#### 2. Update `docs/error-log.md`

Change the `VehiclePriceDropped` entry's `**Status:**` line from `Open — documented, not fixed`
to `Fixed in EPIC17-T2`, and replace the `**Not fixed here**` paragraph with a `**Fix:**`
paragraph describing the wiring change.

#### 3. Verify

```sh
npm test
```

Expected: all 9 suites still green (this ticket has no dedicated test yet — EPIC17-T4 covers
the full choreography for all three subscribers).

---

## EPIC17-T3: `NotificationService`: `resolveUserId` email/UUID mismatch

### What & Why

`docs/error-log.md` (`[2026-07-02] NotificationService.resolveUserId always returns null`)
documents that `resolveUserId` looked up `Users` by `email` using an input that is actually
`req.user.id` — the `Users.ID` UUID, as written everywhere `customer_ID` fields are set
(`Favorites`, `Orders`, `Reservations`, ...). Verified directly with a throwaway test:
`Favorites.customer_ID === Users.ID` is `true`, `=== Users.email` is `false`. Because of this,
`resolveUserId` always returned `null`, and `createNotificationsForFavorites` — used by all three
subscribers (`VehicleSold`, `VehiclePriceDropped`, `SimilarVehicleListed`) — silently inserted
zero `Notification` rows for every caller. The same bug also broke `getMyNotifications` and
`getUnreadCount`, which call `resolveUserId(req.user.id)` directly.

The fix is a one-line lookup change: match on `ID` instead of `email`. `resolveUserId` keeps its
purpose as a defensive existence check (customer_ID has no DB-level FK to Users in this schema),
it just checks the right column now. The stale "JWT subject = email" comments on `resolveUserId`
and `getMyNotifications` were also corrected — they were the reason the bug went unnoticed.

### Step-by-step

#### 1. Modify `modules/notification/application/notification-service.js`

Replace the `resolveUserId` function (near the top of the `cds.service.impl` callback, right
after the `const { Notifications, Favorites, Users } = ...` line) with:

```js
  // resolveUserId: confirms customerID (== req.user.id, already the Users.ID UUID
  // everywhere it is written — see Favorites/Orders/Reservations.customer_ID)
  // still refers to an existing user before it is used as a Notification's
  // recipient_ID. EPIC17-T3 fix: this used to look up Users by `email` with a
  // UUID input, which never matched — see docs/error-log.md
  // "resolveUserId always returns null — looks up Users.email with a UUID".
  // Returns null if no matching user exists — callers must handle the null case.
  async function resolveUserId(customerID) {
    const user = await SELECT.one.from(Users).columns('ID').where({ ID: customerID });
    return user?.ID ?? null;
  }
```

Further down, above the `srv.on('getMyNotifications', ...)` handler, replace the comment line
`// Resolves req.user.id (email) to Users.ID (UUID) before querying.` with:

```js
  // getMyNotifications: returns the caller's notifications ordered by newest first.
  // Confirms req.user.id still refers to an existing user before querying.
```

#### 2. Update `docs/error-log.md`

Change the `resolveUserId` entry's `**Status:**` line from `Open — documented, not fixed` to
`Fixed in EPIC17-T3`, and replace the `**Not fixed here**` paragraph with a `**Fix:**` paragraph
describing the lookup change.

#### 3. Verify

```sh
npm test
```

Expected: all 9 suites still green (EPIC17-T4 adds the dedicated regression test proving
notifications are now actually created).

---
