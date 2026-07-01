# Error Log

Running log of bugs encountered during development, their root causes, and resolutions.
New entries go at the top (newest first).

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
