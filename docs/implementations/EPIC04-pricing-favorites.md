# EPIC04 — Pricing & Favorites

Sprint 3. Goal: price history tracking, price-drop event emission, offer price comparison, and customer favorites management.

---

## T1 — Pricing Domain Model

**What:** `PriceHistory` entity created to record every price change on a vehicle. `changedBy` stored explicitly (not from `managed.modifiedBy`) to capture the business actor who triggered the price-change action.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/pricing/db/pricing.cds` | Created | `PriceHistory` entity: vehicle association, oldPrice, newPrice, currency, changedBy |
| `db/index.cds` | Modified | `pricing.cds` import added |
| `docs/epic-04-pricing-favorites.md` | Created | EPIC-04 ticket tracking table |

---

## T2 — Pricing Service

**What:** `PricingService` created as the single authorised path for changing a vehicle's list price. `updatePrice` updates the vehicle, appends a `PriceHistory` row, and emits `VehiclePriceDropped` when the new price is lower. `getPriceHistory` returns the full audit trail. VehicleService's `before UPDATE` guard extended to block direct `price` / `currency` PATCH, routing all price changes through PricingService.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/pricing/api/pricing-service.cds` | Created | `PricingService @(path: '/pricing')`; `PriceHistory` read-only projection; `updatePrice` action; `getPriceHistory` function; `VehiclePriceDropped` event |
| `modules/pricing/application/pricing-service.js` | Created | `updatePrice` and `getPriceHistory` handlers |
| `modules/vehicle/application/vehicle-service.js` | Modified | `before UPDATE` guard extended to reject direct `price`/`currency` changes |
| `srv/index.cds` | Modified | `pricing-service` import added |
| `package.json` | Modified | `PricingService` impl path added to services section |

---

## T3 — Offer Price Comparison

**What:** `compareToListPrice` function added to `PricingService`. Returns current price, all-time lowest price, absolute diffs, and percentage diffs so Managers can assess an incoming offer against both the list price and the price history. Designed for use by the Offer module in Sprint 6.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/pricing/api/pricing-service.cds` | Modified | `compareToListPrice` function with inline return type |
| `modules/pricing/application/pricing-service.js` | Modified | `compareToListPrice` handler: computes diffs against current and all-time lowest price |

---

## T4 — Favorites Domain Model

**What:** `Favorites` entity created linking a customer (by `req.user.id` string) to a vehicle. `@assert.unique` on `(customer_ID, vehicle_ID)` prevents duplicate favorites at the DB level without handler code. No foreign key to `Users` entity — avoids hard coupling to the Identity module.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/favorites/db/favorites.cds` | Created | `Favorites` entity: `customer_ID` string, `vehicle` association; `@assert.unique` constraint |
| `db/index.cds` | Modified | `favorites.cds` import added |

---

## T5 — Favorites Service

**What:** `FavoritesService` created with three operations: `addFavorite`, `removeFavorite`, `listFavorites`. Customer-only — guests excluded because Favorites drives notification subscriptions requiring a durable identity. `customer_ID` always taken from `req.user.id`; never accepted from the client. `Favorites` entity exposed as a read-only projection with `@restrict where: 'customer_ID = $user'` so each customer sees only their own rows.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/favorites/api/favorites-service.cds` | Created | `FavoritesService @(path: '/favorites')`; `Favorites` read-only projection with row-level filter; `addFavorite`, `removeFavorite` actions; `listFavorites` function |
| `modules/favorites/application/favorites-service.js` | Created | Three handlers: add (DB unique constraint guards duplicates), remove (idempotent), list (filtered by `req.user.id`) |
| `srv/index.cds` | Modified | `favorites-service` import added |
| `package.json` | Modified | `FavoritesService` impl path added to services section |

---

## T6 — Customer Portal Extension

**What:** `CustomerPortalService` extended with two new functions. `getFavoriteVehicles` returns a customer's favorited vehicles filtered to `FOR_SALE` status. `getPriceHistory` exposes a trimmed price-change log (newPrice, currency, changedAt only — no cost-basis or actor data) for the sparkline on the Vehicle Detail page; guest-accessible.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/vehicle/api/customer-portal.cds` | Modified | `getFavoriteVehicles` (`@requires: 'Customer'`) and `getPriceHistory` (`@requires: 'any'`) functions added |
| `modules/vehicle/application/customer-portal.js` | Modified | Two new handlers: favorites lookup with FOR_SALE filter; price history with column restriction |
