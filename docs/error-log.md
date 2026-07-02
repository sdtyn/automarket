# Error Log

Running log of bugs encountered during development, their root causes, and resolutions.
New entries go at the top (newest first).

---

## [2026-07-02] `NotificationService.resolveUserId` always returns `null` — looks up `Users.email` with a UUID

**Status:** Open — documented, not fixed. Found while auditing `NotificationService` before starting
EPIC17 (Price-Drop Alerts).

**Symptom:** None of the three existing `NotificationService` subscribers (`VehicleSold`,
`VehiclePriceDropped`, `SimilarVehicleListed`) ever create a `Notification` row for a favoriting
customer, even when the vehicle is genuinely in that customer's `Favorites`.

**Root cause:** `resolveUserId(customerID)` (`modules/notification/application/notification-service.js`)
does `SELECT.one.from(Users).where({ email: customerID })`, on the assumption that `customerID` is
the JWT subject (an email address). But everywhere `customer_ID` is written in this codebase
(`Favorites`, `Orders`, `Reservations`, ...) it is set to `req.user.id`, which under the current
`mocked` auth (and presumably `xsuaa` in production) is the `Users.ID` UUID, not the email.
Verified directly: after `addFavorite`, `Favorites.customer_ID === Users.ID` is `true` and
`Favorites.customer_ID === Users.email` is `false`. Since `resolveUserId` always returns `null`,
`createNotificationsForFavorites` silently inserts zero rows for every caller.

**Not fixed here** — left for EPIC17-T3 (Known Issue Remediation), together with the related
`VehiclePriceDropped` wiring bug below, since both block any notification-based feature.

**Files involved:**
- `modules/notification/application/notification-service.js` — `resolveUserId`, all three subscribers

---

## [2026-07-02] `VehiclePriceDropped` listener registered on the wrong service — never fires

**Status:** Open — documented, not fixed. Found while auditing `NotificationService` before starting
EPIC17 (Price-Drop Alerts).

**Symptom:** `NotificationService`'s `VehiclePriceDropped` handler never runs, even when
`PricingService.updatePrice` genuinely lowers a vehicle's price.

**Root cause:** In `modules/notification/application/notification-service.js`, the subscription is
registered as `VehicleSrv.on('VehiclePriceDropped', ...)`, where `VehicleSrv = await
cds.connect.to('VehicleService')`. But `VehiclePriceDropped` is declared and emitted only by
`PricingService` (`modules/pricing/api/pricing-service.cds` — `event VehiclePriceDropped`;
`modules/pricing/application/pricing-service.js` — `await srv.emit('VehiclePriceDropped', ...)`
where `srv` is `PricingService`). `VehicleService` never declares or emits this event, so a
listener attached to `VehicleService` can never receive it.

**Not fixed here** — left for EPIC17-T2 (Known Issue Remediation). The fix is to connect to
`PricingService` instead of `VehicleService` for this one subscription.

**Files involved:**
- `modules/notification/application/notification-service.js` — `VehiclePriceDropped` subscription
- `modules/pricing/application/pricing-service.js` — emits the event on `PricingService`

---

## [2026-07-02] `retryPayment` is unreachable after `failPayment` — Order is already CANCELLED

**Status:** Fixed in EPIC17-T1. Found while writing EPIC16-T5 integration tests
(`tests/unit/services/payment-service.test.js`).

**Symptom:** Calling `PaymentService.retryPayment` after any `failPayment` call always returns
`409 Cannot retry payment for order in status CANCELLED`, even though the action's own doc
comment says it exists specifically "to open a new payment attempt after a FAILED payment".

**Root cause:** Two epics built contradictory assumptions about `Orders.status` around a failed
payment:

- EPIC08-T3 (`modules/sales/application/sales-service.js`, `PaymentFailed` subscriber) sets the
  Order straight to `CANCELLED` and releases the Vehicle back to `FOR_SALE`/`RESERVED`.
- EPIC09-T2 (`modules/payment/application/payment-service.js`, `retryPayment`) requires the Order
  to still be `PENDING_PAYMENT` before it will open a new payment attempt.

Since `failPayment` always drives the Order to `CANCELLED` before a caller can invoke
`retryPayment`, the `PENDING_PAYMENT` guard in `retryPayment` can never be satisfied. The two
behaviours were never reconciled because there was no automated test exercising the full
initiate → fail → retry sequence — only manual `.http` requests with independent placeholder IDs.

**Fix:** The original design intent (confirmed by `retryPayment` itself never touching
`Orders`/`Vehicles`) was that a single failed attempt should not give up on the order — the
vehicle should stay locked so the customer can retry. EPIC17-T1 removes the `PaymentFailed`
subscriber's Order/Vehicle mutation entirely; `failPayment` now only marks the `Payment` row
`FAILED`. `cancelOrder` remains the only path that actually releases the vehicle and cancels the
order — the customer or an Admin/Manager must call it explicitly to give up.

**Files involved:**
- `modules/sales/application/sales-service.js` — `PaymentFailed` subscriber sets `CANCELLED`
- `modules/payment/application/payment-service.js` — `retryPayment` requires `PENDING_PAYMENT`
- `tests/unit/services/payment-service.test.js` — test documenting the actual 409 behaviour

---

## [2026-07-01] All INSERT-based actions return 204 — `INSERT.into().entries()` does not expose the generated ID

**Error message:**  
No error message. The action returned `HTTP 204 No Content` instead of the expected UUID string.

**Symptom:** Any action that creates a new entity and returns its ID (e.g. `createOrder`, `createReservation`, `createBranch`, `requestTestDrive`, `submitOffer`, etc.) returned 204 with an empty body after the `@impl` fix made handlers callable.

**Root cause:** All handler files used the pattern:

```js
const result = await INSERT.into(Entity).entries({ field1, field2, ... });
return result.ID;
```

`INSERT.into().entries()` in CAP does not return the inserted record. The result object is an `InsertResult` (a rowcount/key container), and `result.ID` is always `undefined`. When a CAP action handler returns `undefined`, the framework sends `204 No Content`.

This was a systematic bug present across all modules because the pattern was copied from early scaffold code that assumed CAP would behave like an ORM and expose the auto-generated ID.

**Fix:** Pre-generate the UUID with `cds.utils.uuid()` before the INSERT, pass it as `ID` in the entries object, then return the pre-generated value:

```js
// Before (broken — result.ID is always undefined):
const result = await INSERT.into(Entity).entries({ field1, field2 });
return result.ID;

// After (correct):
const id = cds.utils.uuid();
await INSERT.into(Entity).entries({ ID: id, field1, field2 });
return id;
```

**Files changed (11 files):**
- `modules/sales/application/sales-service.js` ← `createOrder`
- `modules/delivery/application/delivery-service.js` ← `scheduleDelivery`
- `modules/favorites/application/favorites-service.js` ← `addToFavorites`
- `modules/offer/application/offer-service.js` ← `submitOffer`
- `modules/branch/application/branch-service.js` ← `createBranch`
- `modules/test-drive/application/test-drive-service.js` ← `requestTestDrive`, `requestTestDriveAsGuest`
- `modules/payment/application/payment-service.js` ← `initiatePayment`, `retryPayment`
- `modules/vehicle/application/operator-portal.js` ← `createVehicle`, `approveOffer` (Reservation INSERT)
- `modules/reservation/application/reservation-service.js` ← `createReservation`
- `modules/vehicle/application/vehicle-service.js` ← `addImage`

---

## [2026-07-01] `getPriceHistory` returns 500 — `changedAt` not found in `PriceHistory`

**Error message:**
```
500 - "changedAt" not found in the elements of "automarket.PriceHistory"
```

**Symptom:** `GET /catalog/getPriceHistory(...)` and `GET /pricing/getPriceHistory(...)` returned 500.

**Root cause:** Both `customer-portal.js` and `pricing-service.js` referenced `changedAt` in `.columns()` and `.orderBy()` calls, but the `PriceHistory` entity has no such field. The entity extends `BaseEntity` which provides `createdAt` — since PriceHistory rows are append-only (never updated), `createdAt` is the correct timestamp for when the price was changed.

**Fix:** Replaced all `changedAt` references with `createdAt` in both handlers.

**Files changed:**
- `modules/pricing/application/pricing-service.js` ← `orderBy({ changedAt })` → `orderBy({ createdAt })`
- `modules/vehicle/application/customer-portal.js` ← `.columns('changedAt')`, `orderBy({ changedAt })` → `createdAt`

---

## [2026-07-01] `JWT_SECRET` env var not set — `identity/login` returns 500

**Error message:**
```
500 - Error: JWT_SECRET env var is not set
    at issueToken (modules/identity/infrastructure/jwt.js:16:22)
```

**Symptom:** `POST /identity/login` returned 500 immediately after the `@impl` fix made custom handlers callable for the first time.

**Root cause:** `modules/identity/infrastructure/jwt.js` deliberately throws if `JWT_SECRET` is not set in the environment (`process.env.JWT_SECRET`). The env var was never configured for local development because this was the first time the login handler was actually reached.

**Fix:** Created `default-env.json` in the project root — CAP's `cds watch` loads this file automatically on startup, injecting its keys into `process.env`.

```json
{
  "JWT_SECRET": "dev-secret-change-before-production"
}
```

Added `default-env.json` to `.gitignore` so the dev secret is never committed.

**Files changed:**
- `default-env.json` ← created (gitignored)
- `.gitignore` ← added `default-env.json` entry

---

## [2026-07-01] All custom actions return 501 — `cds.services` in `package.json` silently ignored by CAP

**Error message:**
```json
{
  "error": {
    "message": "Service \"AdminService\" has no handler for \"createBranch\".",
    "code": "501"
  }
}
```

**Symptom:** Entity CRUD (`GET /admin/Users`) returned 200, but every custom action (`POST /admin/createBranch`, `POST /identity/login`, `POST /pricing/updatePrice`, etc.) returned 501 across ALL services.

**Root cause:** CAP's `factory.js` resolves the service implementation via this priority chain:

```
o.with → def['@impl'] → _sibling(def) → o.impl → _kind()
```

The project was using `"cds.services"` in `package.json` to declare impl paths:

```json
"cds": {
  "services": {
    "IdentityService": { "impl": "modules/identity/application/identity-service.js" }
  }
}
```

**This key is never read by CAP's factory or serve pipeline.** CAP does not consult `cds.env.services` during service construction — it is silently ignored. All services fell back to `_kind()`, which loaded the default `app-service.js`. That class provides CRUD but has no custom action handlers.

The `_sibling()` lookup also failed because the `.cds` definition files are in `api/` and the `.js` handlers are in `application/` — different directories, so no co-location match.

**Fix:** Added `@impl` annotation to every CDS service definition file. CAP reads `def['@impl']` directly from the compiled model, so this approach is reliable regardless of directory structure.

```cds
@impl: 'modules/identity/application/identity-service.js'
service IdentityService @(path: '/identity') { ... }
```

The path is resolved from the project root (no `./` prefix needed).

Also removed the dead `"cds.services"` block from `package.json` and updated `docs/cap-notes.md` §3 to document the correct approach.

**Files changed:**
- `modules/*/api/*.cds` (16 files) ← added `@impl` annotation
- `package.json` ← removed dead `cds.services` block
- `docs/cap-notes.md` ← corrected §3 (was documenting the wrong approach)

---

## [2026-07-01] SQLite crash on startup — `@sql.append` partial index invalid in `CREATE TABLE`

**Error message:**
```
SqliteError: near "UNIQUE": syntax error in:
CREATE TABLE automarket_Orders (
  ...
  PRIMARY KEY(ID)
) UNIQUE (vehicle_ID) WHERE status IN ('CREATED', 'PENDING_PAYMENT', 'PAID');
```

**Symptom:** `cds watch` crashed during DB deployment. Server never started.

**Root cause:** `modules/sales/db/sales.cds` used `@sql.append` to attach a partial unique index constraint to the `Orders` table:

```cds
@sql.append: 'UNIQUE (vehicle_ID) WHERE status IN (''CREATED'', ''PENDING_PAYMENT'', ''PAID'')'
entity Orders : BaseEntity { ... }
```

CAP appends this text **after the closing `)` of `CREATE TABLE`**, producing:

```sql
CREATE TABLE automarket_Orders (..., PRIMARY KEY(ID))
UNIQUE (vehicle_ID) WHERE status IN (...);
```

SQLite does not support `UNIQUE ... WHERE` as a table-level constraint. Partial indexes in SQLite must be created as a separate `CREATE UNIQUE INDEX ... WHERE` statement. HANA supports this syntax, which is why the bug was not caught earlier.

**Fix:** Removed the `@sql.append` annotation. The Vehicle state machine (which transitions the vehicle out of `FOR_SALE` when an order is created) is the primary guard against double-ordering. The DB-level partial index is defense-in-depth for production and must be applied via a post-deploy migration script (see `docs/cap-notes.md` §7).

**Files changed:**
- `modules/sales/db/sales.cds` ← removed `@sql.append` line

---

## [2026-07-01] SQLite crash on startup — `@assert.unique` cannot resolve implicit FK `vehicle_ID` in `Favorites`

**Error message:**
```
[ERROR] modules/favorites/db/favorites.cds:13:8:
"@assert.unique.customerVehicle": "vehicle_ID" has not been found
(in entity:"automarket.Favorites")
```

**Symptom:** `cds watch` failed to start. The error appeared before any DB deployment.

**Root cause:** The `Favorites` entity used a managed association and referenced the implicit foreign key `vehicle_ID` in `@assert.unique`:

```cds
@assert.unique: { customerVehicle: [ customer_ID, vehicle_ID ] }
entity Favorites : BaseEntity {
    customer_ID : String(255);
    vehicle     : Association to Vehicles;  // generates vehicle_ID implicitly
}
```

CAP's `@assert.unique` annotation resolves field names against **explicitly declared elements** only. Implicitly generated foreign keys (like `vehicle_ID` from a managed association) are not visible to the annotation processor.

**Fix:** Declared `vehicle_ID` explicitly as a UUID field and switched to an unmanaged association:

```cds
@assert.unique: { customerVehicle: [ customer_ID, vehicle_ID ] }
entity Favorites : BaseEntity {
    customer_ID : String(255);
    // Explicit FK so @assert.unique can reference it — managed associations
    // generate vehicle_ID implicitly, which @assert.unique cannot resolve.
    vehicle_ID  : UUID not null;
    vehicle     : Association to Vehicles on vehicle.ID = vehicle_ID;
}
```

**Files changed:**
- `modules/favorites/db/favorites.cds` ← explicit FK + unmanaged association
