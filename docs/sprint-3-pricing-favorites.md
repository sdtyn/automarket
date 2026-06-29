# Sprint 3 — Pricing & Favorites (EPIC-04)

Local-only development scope (see CONTRIBUTING.md, "Deferred: BTP-Specific Work").

| # | Item | Status |
|---|---|---|
| EPIC04-T1 | Pricing Domain Model — `PriceHistory` entity (vehicle, oldPrice, newPrice, currency, changedAt, changedBy), CDS schema + db module | Open |
| EPIC04-T2 | Pricing Service — `updatePrice` action (updates vehicle price + records history + emits `VehiclePriceDropped`), `getPriceHistory` function; lock direct price PATCH in VehicleService | Open |
| EPIC04-T3 | Offer Price Comparison — `compareToListPrice(vehicleId, offerAmount)` function in PricingService; returns diff vs. current list price and vs. lowest historical price | Open |
| EPIC04-T4 | Favorites Domain Model — `Favorites` entity, unique constraint on `(customer_ID, vehicle_ID)`, CDS schema + db module | Open |
| EPIC04-T5 | Favorites Service — `FavoritesService`, `addFavorite` / `removeFavorite` / `listFavorites` actions; `Customer` role only; authentication required (no guest path) | Open |
| EPIC04-T6 | Customer Portal Extension — Favorites projection + `getFavoriteVehicles` function; `getPriceHistory` read-only function on CustomerPortalService (sparkline data for Vehicle Detail) | Open |

## Sprint Backlog DoD mapping

- "Pricing Module" → EPIC04-T1, T2, T3
- "Favorites Module" → EPIC04-T4, T5
- "Customer Portal Extensions" → EPIC04-T6

## Sign-off

_To be completed at sprint end._
