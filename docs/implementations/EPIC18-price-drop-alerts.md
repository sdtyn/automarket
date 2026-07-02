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
| EPIC18-T2 | Notification preference field | Open |
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
