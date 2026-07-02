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
| EPIC17-T4 | Regression test | Done |

### Sprint Backlog DoD Mapping

| DoD Item | Satisfied by |
|----------|-------------|
| All three known issues fixed or a deliberate design decision recorded | Per ticket |
| Regression test proves notifications are actually created | EPIC17-T4 |
| CI pipeline stays green | Verified after each commit |

### Sign-off

All four tickets delivered and CI green. 10 test suites, 113 tests. Sprint completed 2026-07-02.

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

## EPIC17-T4: Regression test

### What & Why

EPIC17-T2 and EPIC17-T3 fixed two bugs that, combined, meant `NotificationService` never created
a single `Notification` row for any of its three subscribers. This ticket adds the test that
proves both fixes actually work together, end to end, through the real HTTP surface (not by
calling internal functions directly).

`VehicleSold` and `VehiclePriceDropped` are exercised through their real production triggers:
`capturePayment` (via the `PaymentSucceeded` choreography) and `updatePrice` respectively.
`SimilarVehicleListed` has no producer at all yet — `VehicleService` does not even declare it in
`vehicle-service.cds` — so it is simulated with a direct `cds.connect.to('VehicleService').emit(...)`
call. That still exercises the real subscriber and the real `resolveUserId`/`createNotificationsForFavorites`
code path; it just cannot exercise a caller trigger that does not exist in the system yet.

The test file also covers `getMyNotifications` and `getUnreadCount`, since both call
`resolveUserId(req.user.id)` directly and were silently broken by the same EPIC17-T3 bug,
independent of which event created the underlying rows.

While reviewing the file, the top-of-service comment in `notification-service.cds` also repeated
the stale "req.user.id is a string that must be resolved" assumption that caused the original
bug — corrected as part of this ticket since it directly documents the fixed behavior.

### Step-by-step

#### 1. Modify `modules/notification/api/notification-service.cds`

Replace the top-of-service comment block with:

```cds
// NotificationService is read-only — no action creates a Notification directly.
// All rows originate from domain event subscribers wired below the service block.
// Customers access their notifications via functions (not the entity projection)
// so the handler can scope the result to the caller (req.user.id, which is
// already the Users.ID UUID — see EPIC17-T3) without exposing recipient_ID
// as a queryable/filterable field on the entity.
```

#### 2. Create `tests/unit/services/notification-service.test.js`

```js
'use strict';

const path = require('path');
const cds = require('@sap/cds');

const ROOT = path.join(__dirname, '../../..');

// EPIC17-T4 regression test: proves the two bugs fixed in EPIC17-T2 (wrong-service
// subscription) and EPIC17-T3 (resolveUserId email/UUID mismatch) actually unblock
// notification creation for a favoriting customer — before this ticket, none of
// these three subscribers ever inserted a Notification row (see docs/error-log.md).

// Credentials for the mocked auth users defined in package.json cds.requires.auth.users.
const customerBauerAuth = { username: 'customer.bauer@automarkt.de', password: 'Test@1234' };
const adminAuth = { username: 'admin.mueller@automarkt.de', password: 'Test@1234' };

const BAUER_ID = 'ccc00000-0000-0000-0000-000000000004';

// FOR_SALE vehicles seeded in db/data/automarket.Vehicles.csv, none with a pre-seeded
// PriceHistory row (see db/data/automarket.PriceHistory.csv) — this test file has its
// own in-memory DB, so IDs do not need to avoid other test files, only each other.
const VEHICLE_SOLD = '40000000-4000-4000-4000-400000000006';
const VEHICLE_PRICE_DROP = '40000000-4000-4000-4000-400000000007';
const VEHICLE_SIMILAR = '40000000-4000-4000-4000-400000000008';
const VEHICLE_READ_API = '40000000-4000-4000-4000-400000000009';

describe('NotificationService — integration (EPIC17-T4 regression)', () => {
  // CAP server startup takes time.
  jest.setTimeout(60000);

  // cds.test() registers beforeAll/afterAll to start/stop an in-process CAP server
  // with in-memory SQLite. CSV files in db/data/ are auto-loaded as seed data.
  const { POST, GET } = cds.test(ROOT).silent();

  async function findNotification(subjectSubstring) {
    const { Notifications } = cds.entities('automarket');
    const rows = await SELECT.from(Notifications).where({ recipient_ID: BAUER_ID });
    return rows.find((r) => r.subject.includes(subjectSubstring));
  }

  // ── VehicleSold ──────────────────────────────────────────────────────────────
  // Real end-to-end flow: createOrder → initiatePayment → capturePayment triggers
  // PaymentSucceeded (SalesService) → Vehicle SOLD → VehicleSold (VehicleService)
  // → NotificationService subscriber (unaffected by EPIC17-T2, but blocked until
  // EPIC17-T3 fixed resolveUserId).

  it('creates a Notification when a favorited vehicle is sold', async () => {
    await POST(
      '/favorites/addFavorite',
      { vehicleId: VEHICLE_SOLD },
      { auth: customerBauerAuth },
    );

    const orderRes = await POST(
      '/sales/createOrder',
      { vehicleId: VEHICLE_SOLD, deliveryType: 'CUSTOMER_PICKUP' },
      { auth: customerBauerAuth },
    );
    const orderId = orderRes.data.value ?? orderRes.data;

    const payRes = await POST(
      '/payments/initiatePayment',
      { orderId, provider: 'StripeDE', idempotencyKey: 'notif-sold-001', amount: 1, currency: 'EUR' },
      { auth: customerBauerAuth },
    );
    const paymentId = (payRes.data.value ?? payRes.data).replace('PSP-SESSION-', '');

    await POST(
      '/payments/capturePayment',
      { paymentId, transactionReference: 'TXN-notif-sold' },
      { auth: adminAuth },
    );

    const notification = await findNotification('sold');
    expect(notification).toBeDefined();
    expect(notification.channel).toBe('PUSH');
    expect(notification.content).toContain(VEHICLE_SOLD);
  });

  // ── VehiclePriceDropped ──────────────────────────────────────────────────────
  // Real end-to-end flow: updatePrice (decrease) → PricingService emits
  // VehiclePriceDropped → NotificationService subscriber, now correctly connected
  // to PricingService instead of VehicleService (EPIC17-T2).

  it('creates a Notification when a favorited vehicle drops in price', async () => {
    await POST(
      '/favorites/addFavorite',
      { vehicleId: VEHICLE_PRICE_DROP },
      { auth: customerBauerAuth },
    );

    await POST(
      '/pricing/updatePrice',
      { vehicleId: VEHICLE_PRICE_DROP, newPrice: 1000, currency: 'EUR' },
      { auth: adminAuth },
    );

    const notification = await findNotification('Price drop');
    expect(notification).toBeDefined();
    expect(notification.content).toContain(VEHICLE_PRICE_DROP);
  });

  // ── SimilarVehicleListed ─────────────────────────────────────────────────────
  // No producer emits this event yet — VehicleService does not even declare it
  // (see modules/vehicle/api/vehicle-service.cds). The subscriber itself was never
  // part of the EPIC17-T2 wiring bug (it was already attached to VehicleService,
  // where a future producer would live), only the EPIC17-T3 resolveUserId bug
  // blocked it. Simulated here via a direct emit to cover the subscriber logic.

  it('creates a Notification when SimilarVehicleListed fires (simulated — no producer yet)', async () => {
    await POST(
      '/favorites/addFavorite',
      { vehicleId: VEHICLE_SIMILAR },
      { auth: customerBauerAuth },
    );

    const vehicleSrv = await cds.connect.to('VehicleService');
    await vehicleSrv.emit('SimilarVehicleListed', {
      newVehicleId: '40000000-4000-4000-4000-400000000099',
      similarToVehicleId: VEHICLE_SIMILAR,
    });

    const notification = await findNotification('similar vehicle');
    expect(notification).toBeDefined();
    expect(notification.content).toContain(VEHICLE_SIMILAR);
  });

  // ── Read side: getMyNotifications / getUnreadCount ──────────────────────────
  // Both call resolveUserId(req.user.id) directly — also blocked by the
  // EPIC17-T3 bug regardless of which event created the row.

  describe('getMyNotifications / getUnreadCount', () => {
    it('returns the notifications created above for the same customer', async () => {
      const res = await GET('/notifications/getMyNotifications()', { auth: customerBauerAuth });
      const rows = res.data.value ?? res.data;
      expect(rows.length).toBeGreaterThanOrEqual(3);
    });

    it('counts PENDING notifications for a fresh favorite/price-drop', async () => {
      await POST(
        '/favorites/addFavorite',
        { vehicleId: VEHICLE_READ_API },
        { auth: customerBauerAuth },
      );
      const before = await GET('/notifications/getUnreadCount()', { auth: customerBauerAuth });
      const beforeCount = before.data.value ?? before.data;

      await POST(
        '/pricing/updatePrice',
        { vehicleId: VEHICLE_READ_API, newPrice: 500, currency: 'EUR' },
        { auth: adminAuth },
      );

      const after = await GET('/notifications/getUnreadCount()', { auth: customerBauerAuth });
      const afterCount = after.data.value ?? after.data;
      expect(afterCount).toBe(beforeCount + 1);
    });
  });
});
```

#### 3. Verify

```sh
npm test
```

Expected: `Test Suites: 10 passed, 10 total`, `Tests: 113 passed, 113 total`.

---
