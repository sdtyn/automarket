# EPIC04 — Pricing & Favorites

Sprint 4. Goal: price history tracking, price-drop event emission, offer price comparison, and customer favorites management.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC04-T1 | Pricing Domain Model — `PriceHistory` entity (vehicle, oldPrice, newPrice, currency, changedAt, changedBy), CDS schema + db module | Done |
| EPIC04-T2 | Pricing Service — `updatePrice` action (updates vehicle price + records history + emits `VehiclePriceDropped`), `getPriceHistory` function; lock direct price PATCH in VehicleService | Done |
| EPIC04-T3 | Offer Price Comparison — `compareToListPrice(vehicleId, offerAmount)` function in PricingService; returns diff vs. current list price and vs. lowest historical price | Done |
| EPIC04-T4 | Favorites Domain Model — `Favorites` entity, unique constraint on `(customer_ID, vehicle_ID)`, CDS schema + db module | Done |
| EPIC04-T5 | Favorites Service — `FavoritesService`, `addFavorite` / `removeFavorite` / `listFavorites` actions; `Customer` role only; authentication required (no guest path) | Done |
| EPIC04-T6 | Customer Portal Extension — Favorites projection + `getFavoriteVehicles` function; `getPriceHistory` read-only function on CustomerPortalService (sparkline data for Vehicle Detail) | Done |

### Sprint Backlog DoD mapping

- "Pricing Module" → EPIC04-T1, T2, T3
- "Favorites Module" → EPIC04-T4, T5
- "Customer Portal Extensions" → EPIC04-T6

### Sign-off

Signed off by: Sedat Yeni  Date: 2026-06-29

---

## T1 — Pricing Domain Model

**What & Why:** `PriceHistory` records every price change on a vehicle as an append-only row. `changedBy` is stored explicitly (not relying on `managed.modifiedBy`) because `modifiedBy` reflects the last OData write actor, which may differ from the user who triggered the business price-change action.

### Create `modules/pricing/db/pricing.cds`

```cds
namespace automarket;

using {BaseEntity}          from '../../../shared/types/common';
using {automarket.Vehicles} from '../../vehicle/db/vehicle';

// PriceHistory records every price change on a Vehicle so that:
//  - VehiclePriceDropped can be emitted with the correct delta,
//  - the Offer module can compare a bid against historical prices, and
//  - Managers have an audit trail of pricing decisions.
// Rows are append-only — never updated or deleted.
entity PriceHistory : BaseEntity {
    vehicle   : Association to Vehicles;
    oldPrice  : Decimal(15, 2);
    newPrice  : Decimal(15, 2);
    currency  : String(3) default 'TRY';
    // changedBy is stored explicitly rather than relying on managed.modifiedBy
    // because modifiedBy reflects the last OData write, which may differ from
    // the user who triggered the price-change business action.
    changedBy : String(255);
}
```

### Modify `db/index.cds` — add pricing import

```diff
 using from '../modules/vehicle/db/vehicle';
+
+using from '../modules/pricing/db/pricing';
```

### Create `docs/epic-04-pricing-favorites.md`

Create the sprint tracking table for EPIC04 (see the actual file for the full table).

---

## T2 — Pricing Service

**What & Why:** `PricingService` is the **only** authorised path for changing a vehicle's list price. To enforce this, `VehicleService`'s `before UPDATE` guard is extended to reject any PATCH that includes `price` or `currency`. `PricingService` uses `cds.entities('automarket')` to update `Vehicles` directly, bypassing the VehicleService handler layer (which would reject the write).

### Create `modules/pricing/api/pricing-service.cds`

```cds
using {automarket} from '../db/pricing';

// PricingService owns all price mutations. Going through this service instead
// of a direct PATCH on Vehicles guarantees that every price change is audited
// and the VehiclePriceDropped event is emitted when applicable.
service PricingService @(path: '/pricing') {

    // PriceHistory is read-only here — writes happen only via updatePrice.
    // Internal-tier data: visible to Admin/Manager/Operator, not Customer or guest.
    @requires: ['Admin', 'Manager', 'Operator']
    entity PriceHistory as projection on automarket.PriceHistory;

    // updatePrice: the single authorised path for changing a vehicle's list price.
    // Records a PriceHistory row and emits VehiclePriceDropped when newPrice < current.
    @requires: ['Admin', 'Manager']
    action updatePrice(vehicleId: String, newPrice: Decimal, currency: String) returns Boolean;

    // getPriceHistory: returns the full price-change log for a vehicle,
    // ordered by changedAt descending (most recent first).
    @requires: ['Admin', 'Manager', 'Operator']
    function getPriceHistory(vehicleId: String) returns array of PriceHistory;

    // Emitted when updatePrice detects a decrease. Consumed by the Favorites
    // module in a later sprint to trigger price-drop notifications.
    event VehiclePriceDropped {
        vehicleId : String;
        oldPrice  : Decimal;
        newPrice  : Decimal;
    }

    // compareToListPrice: compares an offer amount against the vehicle's current
    // list price and its all-time lowest recorded price.
    @requires: ['Admin', 'Manager']
    function compareToListPrice(vehicleId: String, offerAmount: Decimal) returns {
        currentPrice    : Decimal;
        lowestPrice     : Decimal;
        diffFromCurrent : Decimal;
        diffFromLowest  : Decimal;
        belowCurrentPct : Decimal;
        belowLowestPct  : Decimal;
    }
}
```

### Create `modules/pricing/application/pricing-service.js`

```js
'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { PriceHistory } = cds.entities('automarket');

  // updatePrice: reads the current price, persists the new one, appends a
  // PriceHistory row, and emits VehiclePriceDropped when the price decreased.
  // Uses cds.entities to reach Vehicles directly so the update is not routed
  // through VehicleService's before-UPDATE guard (which blocks price changes).
  srv.on('updatePrice', async (req) => {
    const { vehicleId, newPrice, currency } = req.data;
    const { Vehicles } = cds.entities('automarket');

    const vehicle = await SELECT.one.from(Vehicles).where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');

    const oldPrice = vehicle.price;
    const effectiveCurrency = currency || vehicle.currency;

    await UPDATE(Vehicles)
      .set({ price: newPrice, currency: effectiveCurrency })
      .where({ ID: vehicleId });

    await INSERT.into(PriceHistory).entries({
      vehicle_ID: vehicleId,
      oldPrice,
      newPrice,
      currency: effectiveCurrency,
      changedBy: req.user.id,
    });

    if (newPrice < oldPrice) {
      await srv.emit('VehiclePriceDropped', { vehicleId, oldPrice, newPrice });
    }

    return true;
  });

  // getPriceHistory: returns all price changes for a vehicle, newest first.
  srv.on('getPriceHistory', async (req) => {
    const { vehicleId } = req.data;
    return SELECT.from(PriceHistory)
      .where({ vehicle_ID: vehicleId })
      .orderBy({ changedAt: 'desc' });
  });

  // compareToListPrice: computes how far the offer sits below the current list
  // price and below the all-time lowest recorded price for the same vehicle.
  srv.on('compareToListPrice', async (req) => {
    const { vehicleId, offerAmount } = req.data;
    const { Vehicles } = cds.entities('automarket');

    const vehicle = await SELECT.one.from(Vehicles).columns('price').where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');

    const history = await SELECT.from(PriceHistory).columns('newPrice').where({ vehicle_ID: vehicleId });

    const allPrices = [vehicle.price, ...history.map((r) => r.newPrice)];
    const lowestPrice = Math.min(...allPrices);
    const currentPrice = vehicle.price;

    const diffFromCurrent = currentPrice - offerAmount;
    const diffFromLowest  = lowestPrice  - offerAmount;

    return {
      currentPrice,
      lowestPrice,
      diffFromCurrent,
      diffFromLowest,
      belowCurrentPct: currentPrice > 0 ? (diffFromCurrent / currentPrice) * 100 : 0,
      belowLowestPct:  lowestPrice  > 0 ? (diffFromLowest  / lowestPrice)  * 100 : 0,
    };
  });
});
```

### Modify `modules/vehicle/application/vehicle-service.js` — extend before UPDATE guard to block price changes

```diff
   srv.before('UPDATE', 'Vehicles', (req) => {
     if (req.data.status) {
       return req.error(400, 'Status cannot be changed directly. Use publish or archive actions.');
     }
+    // Price changes must go through PricingService.updatePrice so that every
+    // change is audited and VehiclePriceDropped is emitted when applicable.
+    if (req.data.price !== undefined || req.data.currency !== undefined) {
+      return req.error(400, 'Price cannot be changed directly. Use PricingService.updatePrice.');
+    }
   });
```

### Modify `srv/index.cds` — add pricing-service import

```diff
 using from '../modules/vehicle/api/customer-portal';
+
+using from '../modules/pricing/api/pricing-service';
```

### Modify `package.json` — register PricingService

```diff
   "CustomerPortalService": { "impl": "modules/vehicle/application/customer-portal.js" },
+  "PricingService":         { "impl": "modules/pricing/application/pricing-service.js" }
```

---

## T3 — Offer Price Comparison

`compareToListPrice` was included directly in the PricingService definition during T2. No additional files are created in T3 — the function implementation was part of `pricing-service.cds` and `pricing-service.js` above.

---

## T4 — Favorites Domain Model

**What & Why:** `Favorites` links a customer (stored as a plain string ID, not a foreign key to `Users`) to a vehicle. Using a string rather than a foreign key avoids a hard dependency on the Identity module. `@assert.unique` on `(customer_ID, vehicle_ID)` prevents duplicate favorites at the DB level without any handler-level duplicate check.

### Create `modules/favorites/db/favorites.cds`

```cds
namespace automarket;

using {BaseEntity}          from '../../../shared/types/common';
using {automarket.Vehicles} from '../../vehicle/db/vehicle';

// Favorites links a customer (by user ID string) to a Vehicle.
// The unique constraint prevents a customer from adding the same
// vehicle twice without requiring a handler-level duplicate check.
@assert.unique: {customerVehicle: [
    customer_ID,
    vehicle_ID
]}
entity Favorites : BaseEntity {
    // customer_ID stores req.user.id — a string rather than a foreign key
    // to avoid a hard dependency on the Identity module's Users entity.
    customer_ID : String(255);
    vehicle     : Association to Vehicles;
}
```

### Modify `db/index.cds` — add favorites import

```diff
 using from '../modules/pricing/db/pricing';
+
+using from '../modules/favorites/db/favorites';
```

---

## T5 — Favorites Service

**What & Why:** `FavoritesService` exposes three operations to authenticated Customers only. Guests are excluded because Favorites drives notification subscriptions which require a durable identity (email address). `customer_ID` is always taken from `req.user.id` — never from the request body — so a customer cannot manipulate another customer's favorites. The `Favorites` entity is exposed with `@restrict where: 'customer_ID = $user'` so the OData read path is also row-filtered automatically.

### Create `modules/favorites/api/favorites-service.cds`

```cds
using {automarket} from '../db/favorites';

// FavoritesService is restricted to authenticated Customers only.
// Guests are excluded because Favorites drives notification subscriptions
// which require a durable identity (email address) to deliver to.
service FavoritesService @(path: '/favorites') {

    // Favorites is exposed read-only with a row-level filter so each Customer
    // sees only their own rows. The $user predicate maps to req.user.id at
    // runtime — no handler code needed for the read path.
    // addFavorite/removeFavorite are explicit actions so customer_ID is always
    // taken from the token, never from the request body.
    @restrict: [{
        grant: 'READ',
        to   : 'Customer',
        where: 'customer_ID = $user'
    }]
    entity Favorites as projection on automarket.Favorites;

    // addFavorite: records a customer–vehicle link.
    // Duplicate entries are rejected by the @assert.unique constraint on the entity.
    @requires: 'Customer'
    action   addFavorite(vehicleId: String)    returns String;

    // removeFavorite: deletes the customer–vehicle link.
    // No-ops silently if the favorite does not exist.
    @requires: 'Customer'
    action   removeFavorite(vehicleId: String) returns Boolean;

    // listFavorites: convenience function that returns the same row set as
    // GET /favorites/Favorites for clients that prefer a function call.
    @requires: 'Customer'
    function listFavorites()                   returns array of Favorites;
}
```

### Create `modules/favorites/application/favorites-service.js`

```js
'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { Favorites } = cds.entities('automarket');

  // addFavorite: inserts a Favorites row keyed by the caller's user ID.
  // The @assert.unique constraint on the entity rejects duplicates at the DB level.
  srv.on('addFavorite', async (req) => {
    const { vehicleId } = req.data;
    const customer_ID = req.user.id;
    const result = await INSERT.into(Favorites).entries({ customer_ID, vehicle_ID: vehicleId });
    return result.ID;
  });

  // removeFavorite: deletes the row matching the caller's user ID and vehicleId.
  // Returns false (not an error) when the row does not exist — idempotent removal.
  srv.on('removeFavorite', async (req) => {
    const { vehicleId } = req.data;
    const customer_ID = req.user.id;
    const favorite = await SELECT.one.from(Favorites).where({ customer_ID, vehicle_ID: vehicleId });
    if (!favorite) return false;
    await DELETE.from(Favorites).where({ customer_ID, vehicle_ID: vehicleId });
    return true;
  });

  // listFavorites: returns every Favorites row belonging to the calling customer.
  // customer_ID comes from the token — clients cannot request another user's list.
  srv.on('listFavorites', async (req) => {
    return SELECT.from(Favorites).where({ customer_ID: req.user.id });
  });
});
```

### Modify `srv/index.cds` — add favorites-service import

```diff
 using from '../modules/pricing/api/pricing-service';
+
+using from '../modules/favorites/api/favorites-service';
```

### Modify `package.json` — register FavoritesService

```diff
   "PricingService":   { "impl": "modules/pricing/application/pricing-service.js" },
+  "FavoritesService": { "impl": "modules/favorites/application/favorites-service.js" }
```

---

## T6 — Customer Portal Extension

**What & Why:** `CustomerPortalService` gets two new functions. `getFavoriteVehicles` returns a customer's favorited vehicles, filtered to `FOR_SALE`. `getPriceHistory` exposes a trimmed price-change log (3 fields only: `newPrice`, `currency`, `changedAt`) for the sparkline widget on the Vehicle Detail page — cost-basis (`oldPrice`) and actor (`changedBy`) are internal-tier data and must not be exposed to customers or guests.

### Modify `modules/vehicle/api/customer-portal.cds` — add two functions

```diff
     @requires: 'any'
     entity VehicleImages as projection on automarket.VehicleImages;

+    // getFavoriteVehicles: returns the FOR_SALE vehicles the calling customer
+    // has favorited. Authentication required — guests have no favorites.
+    @requires: 'Customer'
+    function getFavoriteVehicles()              returns array of Vehicles;
+
+    // getPriceHistory: exposes price-history data for the sparkline on the
+    // Vehicle Detail page. Read-only and guest-accessible; only FOR_SALE
+    // vehicles are reachable via this portal so no status filter is needed here.
+    @requires: 'any'
+    function getPriceHistory(vehicleId: String) returns array of {
+        newPrice  : Decimal;
+        currency  : String;
+        changedAt : Timestamp;
+    };
 }
```

### Modify `modules/vehicle/application/customer-portal.js` — add two handlers

```diff
 module.exports = cds.service.impl(async function (srv) {
   srv.before('READ', 'Vehicles', (req) => {
     req.query.where({ status: 'FOR_SALE' });
   });

+  const { Favorites, PriceHistory } = cds.entities('automarket');
+
+  // getFavoriteVehicles: joins the customer's Favorites against the Vehicles
+  // entity and applies the same FOR_SALE filter that guards the entity projection.
+  srv.on('getFavoriteVehicles', async (req) => {
+    const customer_ID = req.user.id;
+    const favorites = await SELECT.from(Favorites).columns('vehicle_ID').where({ customer_ID });
+    if (!favorites.length) return [];
+    const vehicleIds = favorites.map((f) => f.vehicle_ID);
+    const { Vehicles } = cds.entities('automarket');
+    return SELECT.from(Vehicles).where({ ID: { in: vehicleIds }, status: 'FOR_SALE' });
+  });
+
+  // getPriceHistory: returns price-change rows for sparkline rendering.
+  // Only newPrice, currency, and changedAt are exposed — cost basis and
+  // who changed the price are internal-tier data, not shown to customers.
+  srv.on('getPriceHistory', async (req) => {
+    const { vehicleId } = req.data;
+    return SELECT.from(PriceHistory)
+      .columns('newPrice', 'currency', 'changedAt')
+      .where({ vehicle_ID: vehicleId })
+      .orderBy({ changedAt: 'asc' });
+  });
 });
```

---

## Final `srv/index.cds` state after EPIC04

```cds
// Central entry point for CAP service discovery across all modules.
using from '../modules/identity/api/identity-service';

using from '../modules/branch/api/branch-service';

using from '../modules/vehicle/api/vehicle-service';

using from '../modules/vehicle/api/operator-portal';

using from '../modules/vehicle/api/customer-portal';

using from '../modules/pricing/api/pricing-service';

using from '../modules/favorites/api/favorites-service';
```

## Final `db/index.cds` state after EPIC04

```cds
// Single entry point for CDS entity discovery.
using from '../modules/identity/db/identity';

using from '../modules/branch/db/branch';

using from '../modules/vehicle/db/vehicle';

using from '../modules/pricing/db/pricing';

using from '../modules/favorites/db/favorites';
```
