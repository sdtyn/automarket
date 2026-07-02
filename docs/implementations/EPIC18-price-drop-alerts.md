# EPIC18 — Price-Drop Alerts

**Goal:** Complete the `VehiclePriceDropped` notification flow. The event is already emitted by
`PricingService`, and the `NotificationService` subscriber is already reachable (the wiring bug
and the `resolveUserId` bug that blocked it were fixed in EPIC17). This EPIC fills in the
remaining spec (EMAIL channel, German content), adds a per-user opt-out preference, and covers
the flow with an integration test.

---

## Sprint Overview

### Ticket Table

| Ticket | Description | Status |
|--------|-------------|--------|
| EPIC18-T1 | NotificationService price-drop handler | Done |
| EPIC18-T2 | Notification preference field | Done |
| EPIC18-T3 | Integration test | Open |

### Sprint Backlog DoD Mapping

| DoD Item | Satisfied by |
|----------|-------------|
| Setting a vehicle price lower than its current price triggers a Notification row for each user who favorited it and has `notifyOnPriceDrop=true` | EPIC18-T1, T2 |
| Verified via integration test | EPIC18-T3 |

### Sign-off

_To be filled in at sprint end._

---

## EPIC18-T1: NotificationService price-drop handler

### What & Why

The `VehiclePriceDropped` handler in `notification-service.js` currently reuses the shared
`createNotificationsForFavorites` helper with its hardcoded `channel: 'PUSH'` and English content
— this predates EPIC17's wiring fix and was never actually reachable until now, so nobody caught
the spec mismatch. Per the Post-MVP Backlog (`docs/11. AutoMarket Post-MVP Backlog.md`, EPIC18-T1),
price-drop notifications must go out as EMAIL with German subject/content — AutoMarket is a
German-market product, and a price drop is exactly the kind of alert a customer expects as an
email rather than an in-app push.

`VehicleSold` and `SimilarVehicleListed` are untouched — they were not specified to change, and
changing them was never part of any ticket. `createNotificationsForFavorites` gets a `channel`
parameter (default `'PUSH'`, preserving the other two subscribers' behavior unchanged) so the
price-drop subscriber alone can opt into `'EMAIL'` without duplicating the favorites-lookup loop.

### Step-by-step

#### 1. Modify `modules/notification/application/notification-service.js`

Add a `channel` parameter (default `'PUSH'`) to `createNotificationsForFavorites` — this is a
direct child of the `cds.service.impl` callback, the function sits right after `resolveUserId`:

```js
  // createNotificationsForFavorites: inserts a PENDING notification for every user
  // who has favorited the given vehicle. channel defaults to PUSH (VehicleSold,
  // SimilarVehicleListed); VehiclePriceDropped overrides it to EMAIL (EPIC18-T1 spec).
  async function createNotificationsForFavorites(vehicleId, subject, content, channel = 'PUSH') {
    const favorites = await SELECT.from(Favorites).where({ vehicle_ID: vehicleId });
    for (const fav of favorites) {
      const recipientId = await resolveUserId(fav.customer_ID);
      if (!recipientId) continue;
      await INSERT.into(Notifications).entries({
        recipient_ID: recipientId,
        channel,
        subject,
        content,
        status: 'PENDING',
      });
    }
  }
```

Replace the `VehiclePriceDropped` subscriber body (still connected to `PricingService` per
EPIC17-T2 — only the subject/content/channel change here) with:

```js
  PricingSrv.on('VehiclePriceDropped', async (msg) => {
    const { vehicleId, newPrice } = msg.data;
    await createNotificationsForFavorites(
      vehicleId,
      'Preissenkung bei einem gespeicherten Fahrzeug',
      `Der Preis des Fahrzeugs ${vehicleId} wurde auf ${newPrice} gesenkt.`,
      'EMAIL'
    );
  });
```

#### 2. Verify

```sh
npm test
```

Expected: all suites still green, once `tests/unit/services/notification-service.test.js`'s
price-drop assertion (previously `findNotification('Price drop')`, an English substring) is
updated to match the new German subject and to assert `channel === 'EMAIL'`.

---

## EPIC18-T2: Notification preference field

### What & Why

Per the Post-MVP Backlog (EPIC18-T2), price-drop alerts must be opt-out: `Users` gets a
`notifyOnPriceDrop: Boolean default true` field, the `VehiclePriceDropped` handler skips users
who set it to `false`, and `IdentityService` gets a self-service `updateNotificationPreference`
action so a customer can flip it — following the exact same pattern as the existing
`updateProfile` action (`@requires: 'authenticated-user'`, scoped to `req.user.id`, body fields
cannot spoof another user's row).

`createNotificationsForFavorites` (shared by all three subscribers) gets an optional `filter`
parameter — an `async (userId) => boolean` predicate — rather than hardcoding the preference
check into the function body. This keeps `VehicleSold` and `SimilarVehicleListed` unaffected
(they pass no filter) while `VehiclePriceDropped` passes `notifyOnPriceDropEnabled`, a small
helper that treats a missing/undefined value as enabled (matches the CDS `default true`).

### Step-by-step

#### 1. Modify `modules/identity/db/identity.cds`

Add after the `lockedUntil` field inside `entity Users : BaseEntity { ... }`:

```cds
  // Opt-out switch for VehiclePriceDropped EMAIL alerts (EPIC18-T2). Defaults to
  // true so existing customers keep receiving alerts unless they turn them off.
  notifyOnPriceDrop : Boolean default true;
```

#### 2. Modify `modules/identity/api/identity-service.cds`

Add directly after the `updateProfile` action declaration:

```cds
    // updateNotificationPreference: lets the authenticated user opt in/out of
    // VehiclePriceDropped EMAIL alerts (EPIC18-T2). One field today; extend the
    // signature rather than adding a new action if more preferences are added.
    @requires: 'authenticated-user'
    action   updateNotificationPreference(notifyOnPriceDrop: Boolean)                returns Boolean;
```

#### 3. Modify `modules/identity/application/identity-service.js`

Add directly after the `srv.on('updateProfile', ...)` handler, still inside the
`cds.service.impl` callback:

```js
  // updateNotificationPreference: lets the caller opt in/out of VehiclePriceDropped
  // EMAIL alerts. Same self-service pattern as updateProfile — scoped to req.user.id.
  srv.on('updateNotificationPreference', async (req) => {
    const { notifyOnPriceDrop } = req.data;
    await UPDATE(Users).set({ notifyOnPriceDrop }).where({ ID: req.user.id });
    return true;
  });
```

#### 4. Modify `modules/notification/application/notification-service.js`

Replace `createNotificationsForFavorites` (added in EPIC18-T1) with the filter-aware version,
and add `notifyOnPriceDropEnabled` directly below it:

```js
  // createNotificationsForFavorites: inserts a PENDING notification for every user
  // who has favorited the given vehicle. channel defaults to PUSH (VehicleSold,
  // SimilarVehicleListed); VehiclePriceDropped overrides it to EMAIL (EPIC18-T1 spec).
  // filter is an optional async (userId) => boolean predicate — VehiclePriceDropped
  // uses it to honor Users.notifyOnPriceDrop (EPIC18-T2); other subscribers pass none.
  async function createNotificationsForFavorites(
    vehicleId,
    subject,
    content,
    channel = 'PUSH',
    filter = null
  ) {
    const favorites = await SELECT.from(Favorites).where({ vehicle_ID: vehicleId });
    for (const fav of favorites) {
      const recipientId = await resolveUserId(fav.customer_ID);
      if (!recipientId) continue;
      if (filter && !(await filter(recipientId))) continue;
      await INSERT.into(Notifications).entries({
        recipient_ID: recipientId,
        channel,
        subject,
        content,
        status: 'PENDING',
      });
    }
  }

  // notifyOnPriceDropEnabled: Users.notifyOnPriceDrop defaults to true, so only an
  // explicit false opts the user out — this treats a missing/undefined value as enabled.
  async function notifyOnPriceDropEnabled(userId) {
    const user = await SELECT.one.from(Users).columns('notifyOnPriceDrop').where({ ID: userId });
    return user?.notifyOnPriceDrop !== false;
  }
```

In the `VehiclePriceDropped` subscriber, add `notifyOnPriceDropEnabled` as the 5th argument to
`createNotificationsForFavorites`:

```js
    await createNotificationsForFavorites(
      vehicleId,
      'Preissenkung bei einem gespeicherten Fahrzeug',
      `Der Preis des Fahrzeugs ${vehicleId} wurde auf ${newPrice} gesenkt.`,
      'EMAIL',
      notifyOnPriceDropEnabled
    );
```

#### 5. Extend `tests/unit/services/identity-service.test.js`

Add a new top-level `describe('updateNotificationPreference', ...)` block, sibling to
`listUsers — Admin only`, right before the file's closing `});`:

```js
  // ── updateNotificationPreference (EPIC18-T2) ────────────────────────────────

  describe('updateNotificationPreference', () => {
    const CUSTOMER_ID = 'ccc00000-0000-0000-0000-000000000004'; // customer.bauer

    afterEach(async () => {
      const { Users } = cds.entities('automarket');
      await UPDATE(Users).set({ notifyOnPriceDrop: true }).where({ ID: CUSTOMER_ID });
    });

    it('flips notifyOnPriceDrop to false for the calling user only', async () => {
      const res = await POST(
        '/identity/updateNotificationPreference',
        { notifyOnPriceDrop: false },
        { auth: { username: 'customer.bauer@automarkt.de', password: 'Test@1234' } }
      );
      expect(res.data.value ?? res.data).toBe(true);

      const { Users } = cds.entities('automarket');
      const user = await SELECT.one.from(Users).where({ ID: CUSTOMER_ID });
      expect(user.notifyOnPriceDrop).toBe(false);
    });

    it('rejects an unauthenticated caller', async () => {
      const err = await POST('/identity/updateNotificationPreference', {
        notifyOnPriceDrop: false,
      }).catch((e) => e);
      expect(err.status).toBe(401);
    });
  });
```

#### 6. Extend `tests/unit/services/notification-service.test.js`

Add `customerHoffmannAuth`, `HOFFMANN_ID`, and `VEHICLE_PRICE_DROP_OPT_OUT` to the top-of-file
constants (siblings of the existing `customerBauerAuth`/`BAUER_ID`/vehicle constants), then add
a new test directly after the EPIC18-T1 price-drop test, inside the same top-level `describe`:

```js
  // EPIC18-T2: an opted-out user must not receive the alert, even though they
  // favorited the vehicle and the price genuinely dropped.
  it('does not notify a user who opted out via notifyOnPriceDrop=false', async () => {
    await POST(
      '/identity/updateNotificationPreference',
      { notifyOnPriceDrop: false },
      { auth: customerHoffmannAuth }
    );
    await POST(
      '/favorites/addFavorite',
      { vehicleId: VEHICLE_PRICE_DROP_OPT_OUT },
      { auth: customerHoffmannAuth }
    );

    await POST(
      '/pricing/updatePrice',
      { vehicleId: VEHICLE_PRICE_DROP_OPT_OUT, newPrice: 1000, currency: 'EUR' },
      { auth: adminAuth }
    );

    const { Notifications } = cds.entities('automarket');
    const rows = await SELECT.from(Notifications).where({ recipient_ID: HOFFMANN_ID });
    expect(rows.find((r) => r.subject.includes('Preissenkung'))).toBeUndefined();
  });
```

#### 7. Verify

```sh
npm test
```

Expected: `Test Suites: 10 passed, 10 total`, `Tests: 116 passed, 116 total`.

---
