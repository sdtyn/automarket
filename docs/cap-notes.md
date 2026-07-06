# CAP Technical Notes

Running notes on non-obvious CAP behaviour, constraints, and decisions encountered
during development. Updated as new findings emerge — check here before debugging
something that looks like a CAP quirk.

---

## 1. Service Discovery in a Modular Folder Structure

**Context:** CAP automatically scans `srv/`, `app/`, and `db/` for `.cds` files.
If you move service definitions outside these folders (e.g. into `modules/<name>/api/`),
CAP will not find them and will silently start with "No service definitions found."

**Solution:** Use central index files as aggregators:

- `srv/index.cds` — imports every module's service definition
- `db/index.cds` — imports every module's entity definitions

Each new module must be registered in both files manually. This is the deliberate
trade-off for the modular folder structure: CAP's auto-discovery is sacrificed in
exchange for per-module isolation.

```cds
// srv/index.cds
using from '../modules/identity/api/identity-service';
using from '../modules/branch/api/branch-service';   // add each new module here
```

**Symptom if forgotten:** `cds watch` starts cleanly but prints:
```
No service definitions found in loaded models. Waiting for some to arrive...
```

---

## 2. `action` vs `function` in CDS Service Definitions

**Rule:** Use `action` for operations with side effects, `function` for read-only queries.

- CAP maps `action` → HTTP POST
- CAP maps `function` → HTTP GET

HTTP GET requests can be cached by browsers and intermediaries. Any operation that
writes data, issues a token, or changes state must be an `action` — using `function`
would allow the request to be served from cache, silently skipping the handler.

**Example:** `login` is an `action` because it resets `failedLoginCount`, updates
`lockedUntil`, and issues a JWT — all side effects.

---

## 3. Handler-to-Service Binding in a Modular Layout

**Context:** CAP's automatic `.cds` ↔ `.js` binding relies on co-location — the
definition and handler must share the same folder and base name:

```
srv/
  identity-service.cds   ← definition
  identity-service.js    ← handler (auto-detected)
```

In a modular layout the two files are in different folders, so auto-detection fails.

**⚠️ `cds.services` in `package.json` does NOT work.** CAP's `factory.js` resolves impl
via the priority chain: `o.with → def['@impl'] → _sibling(def) → o.impl → _kind()`.
The `cds.services` key is never read during service construction — it is silently ignored.
Entity CRUD still works because CAP's default `app-service` provides it, but custom
actions return 501 "no handler".

**Correct fix: add `@impl` annotation directly in the CDS service definition.**
The path is resolved from the project root.

```cds
@impl: 'modules/identity/application/identity-service.js'
service IdentityService @(path: '/identity') { ... }
```

Each new module service needs its own `@impl` annotation in the `.cds` file.

---

## 4. CAP Runtime Globals and ESLint

**Context:** CAP injects query keywords (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `UPSERT`)
into JavaScript's global scope at runtime. This means you can use them in any handler
file without `require`-ing anything — CAP puts them there automatically when the server starts.

**Problem:** ESLint performs static analysis and never sees the runtime. It flags these
as `'SELECT' is not defined`, causing CI to fail even though the code works correctly.

**Solution:** Declare them as known globals in `eslint.config.js`:

```js
globals: {
  ...globals.node,
  ...globals.jest,
  // CAP injects these as globals at runtime; ESLint must be told they exist.
  SELECT: 'readonly',
  INSERT: 'readonly',
  UPDATE: 'readonly',
  DELETE: 'readonly',
  UPSERT: 'readonly',
},
```

**Symptom if forgotten:** ESLint passes locally if you never run it, but CI fails with
`'SELECT' is not defined` errors on any file that uses CAP query syntax.

---

## 5. XSUAA Role Structure and CAP Mapping

**Three-layer model:**
```
Scope           → atomic permission unit  ($XSAPPNAME.Admin)
Role Template   → groups scopes; this is what CAP @requires maps to  (Admin)
Role Collection → assigned to BTP users; references role templates  (AutoMarket_Admin)
```

CAP `@requires: 'Admin'` matches the **role-template name**, not the scope or collection.
Users are assigned **role-collections** in BTP cockpit — never directly to role-templates.

**Production vs. local switch:** Use the `[production]` profile in `package.json` so
the same codebase uses mocked auth in dev and real XSUAA in production without any
code change — only the deployment environment differs:

```json
"requires": {
  "auth": { "kind": "mocked", "users": { ... } },
  "[production]": {
    "auth": { "kind": "xsuaa" }
  }
}
```

CAP activates the `[production]` block automatically when `NODE_ENV=production`.

---

## 6. Partial Unique Index on Reservations Cannot Be Expressed in CDS

**Context:** EPIC05-T3. The business rule "only one active reservation per vehicle" requires
a `UNIQUE(vehicle_ID) WHERE status IN ('REQUESTED', 'APPROVED')` partial index. A full
`@assert.unique` on `vehicle_ID` alone would block all historical rows for the same vehicle.

**Why CDS can't express it:** CDS `@assert.unique` does not support WHERE-clause conditions.
There is no annotation equivalent to a SQL partial index.

**Solution:** Apply the index manually after deployment via a post-deploy SQL script:

```sql
-- For HANA:
CREATE UNIQUE INDEX reservation_one_active_per_vehicle
  ON automarket_Reservations (vehicle_ID)
  WHERE status IN ('REQUESTED', 'APPROVED');

-- For PostgreSQL:
CREATE UNIQUE INDEX reservation_one_active_per_vehicle
  ON "automarket_Reservations" ("vehicle_ID")
  WHERE status IN ('REQUESTED', 'APPROVED');
```

Place this script in `db/migrations/` before the first production deployment.
The application-layer guard (SELECT FOR UPDATE + active-reservation check in
`createReservation`) is the primary protection in local dev where this index is absent.

---

## 7. `@sql.append` Partial Index Breaks SQLite

**Context:** EPIC10 (Orders). To enforce "only one active order per vehicle" at the DB level,
`@sql.append` was used to append `UNIQUE (vehicle_ID) WHERE status IN (...)` to the
`CREATE TABLE` statement.

**Problem:** SQLite does not support inline `UNIQUE ... WHERE` in `CREATE TABLE`. The clause
must be a separate `CREATE UNIQUE INDEX` DDL statement. `@sql.append` appends after the
closing `)` of `CREATE TABLE`, producing invalid SQL that crashes the SQLite adapter on startup.

**Solution:** Remove `@sql.append` for dev/SQLite. The Vehicle state machine (which transitions
the vehicle out of `FOR_SALE` when an order is created) is the primary guard and prevents
double-ordering at the application layer. The DB-level partial index is defense-in-depth for
production; create it via a post-deploy migration script (same approach as note 6).

```cds
// Do NOT use this pattern — breaks SQLite:
@sql.append: 'UNIQUE (vehicle_ID) WHERE status IN (''CREATED'', ''PENDING_PAYMENT'', ''PAID'')'
entity Orders : BaseEntity { ... }
```

```sql
-- Post-deploy migration for production (HANA / PostgreSQL):
CREATE UNIQUE INDEX orders_one_active_per_vehicle
  ON automarket_Orders (vehicle_ID)
  WHERE status IN ('CREATED', 'PENDING_PAYMENT', 'PAID');
```

---

## 9. `req.error()` Rolls Back the Request Transaction — DB Updates Before It Are Lost

**Context:** Discovered during EPIC16-T4 (IdentityService integration tests).
In a CAP `on()` action handler, calling `req.error()` throws a `cds.error`, which
propagates up the call stack. CAP's request middleware catches it, rolls back the
current database transaction, and sends the HTTP error response. Any `INSERT`/`UPDATE`
executed inside the same handler before `req.error()` is therefore rolled back too.

**Impact:** The `login` handler updates `failedLoginCount` and potentially sets
`status = 'LOCKED'` before returning `req.error(401)`. In production (HANA / PostgreSQL),
an autonomous transaction (`cds.tx()`) can be used to commit these updates independently
of the request transaction. In SQLite (local dev), `cds.tx()` causes a deadlock because
SQLite's single-writer lock is already held by the request transaction — any new
transaction waits indefinitely (60 s timeout).

**Current state:** The `failedLoginCount` update is left in the main request transaction.
It commits on successful login (tx succeeds) but is rolled back on wrong password (tx rolls
back via `req.error()`). The lockout feature therefore does not accumulate failure counts
in SQLite (local dev). It will work correctly once deployed with a multi-writer DB.

**Workaround for production:** Replace the plain `UPDATE` with `cds.tx(async () => { ... })`
before adding HANA/PG as the production database. The `shouldLock` domain logic is already
tested at the unit level (`lockout.test.js`) independently of the transaction behaviour.

---

## 8. Guest Rate Limiting Is an Approuter Concern, Not CAP

**Context:** EPIC05-T4. The product backlog requires guest reservation writes to be
rate-limited at 20 req/min per IP. CAP services have no built-in IP-level rate limiter.

**Solution:** Rate limiting at the IP level belongs in the Approuter (`xs-app.json` route
config or a custom middleware in the Approuter layer). CAP's `@requires: 'any'` route
should not attempt to implement its own IP counter — the Approuter sits in front and
is the right place for network-level policies.

**Local dev:** No rate limiting applies. The restriction only takes effect when the
Approuter is deployed (EPIC01-T6 scope).

---

## 10. `cds watch` Silently Drops `UI.Identification` from Served `$metadata` — `cds-serve` Doesn't

**Context:** EPIC20-T1. Added `@UI.Identification` (bound-action header buttons — `reserve`,
`addToFavorites`, `removeFromFavorites`, `cancel`) to `customer-portal-ui.cds`. `cds compile
srv/index.cds --to edmx` and a direct `cds.compile.to.edmx(await cds.load(...))` call both
produced the annotation correctly in the EDMX. But `GET /catalog/$metadata` against a running
`cds watch` instance never contained `UI.Identification` at all — zero occurrences, no compiler
warning, no server error. Every other `UI.*` term used so far in this project (`LineItem`,
`FieldGroup`, `Facets`, `SelectionFields`, `PresentationVariant`, `IsImageURL`, `Criticality`)
served correctly through `cds watch` in EPIC19 — this is not a general "cds watch drops UI
annotations" problem, just this one term.

**Root cause (not fully traced):** Something in `cds watch`'s dev-mode model handling (likely
related to `@sap/cds-fiori`'s Fiori-preview/launchpad plugin, which the CLI-only `cds compile`
path never loads) strips `UI.Identification` specifically before serving `$metadata`. Not
investigated further than isolating which layer causes it — see **Solution** below, which made
further tracing unnecessary for this ticket.

**Solution:** Verified against `node_modules/.bin/cds-serve` (the same binary `npm start` runs —
no watch/reload wrapper, no dev-only Fiori-preview plugin) instead of `cds watch`.
`UI.Identification` appears correctly there. **When verifying `UI.Identification` /
`@UI.DataFieldForAction` header-button annotations, use `cds-serve` (or `npm start`), not `cds
watch`.** All other annotation terms can still be checked with either — this quirk is narrow to
this one term.

```sh
# Wrong verification path for this specific term — will show 0 matches even when the CDS is correct:
node_modules/.bin/cds watch
curl -s http://localhost:4004/catalog/\$metadata | grep -c "UI.Identification"   # → 0

# Correct verification path:
node_modules/.bin/cds-serve
curl -s http://localhost:4004/catalog/\$metadata | grep -c "UI.Identification"   # → 2
```

---

## 11. `srv.emit(...)` Only Reaches Subscribers Bound to That Exact Service Instance

**Context:** EPIC20-T5. `AdminService` needed new bound actions (`capture`/`fail`/`refund` on a new
`Payments` projection) to PSP-simulate `PaymentService.capturePayment`/`failPayment`/`refundPayment`.
Every other "portal wraps a domain service" action written so far in this project (EPIC03's
`OperatorPortalService.approve*`/`reject*`, EPIC20-T1–T4) reimplements the domain logic directly in
the wrapper's own handler and calls `<DomainService>.emit(...)` on a `cds.connect.to(...)` handle —
that pattern works fine for those, because nothing downstream actually depends on *which* service
instance emitted the event, only that `<DomainService>.emit('SomeEvent', ...)` fires eventually.

**The difference here:** `SalesService` subscribes with
`cds.connect.to('PaymentService').on('PaymentSucceeded', async (msg) => { ... })` — a subscription
bound to that specific connected service instance. `srv.emit(...)` called from inside
`AdminService`'s own handler emits on *`AdminService`'s* instance, not `PaymentService`'s, even
though the event name (`PaymentSucceeded`) and payload shape are identical. `SalesService`'s
handler never fires — no error, no warning, the bound action itself still returns `true`, and the
only symptom is that `Orders.status`/`Vehicles.status` silently never transition.

**Solution:** When a wrapper action's *sole purpose* is to trigger a state transition that another
service's `.on(eventName, ...)` subscriber depends on, delegate with
`(await cds.connect.to('TargetService')).send('originalActionName', { ...params })` instead of
reimplementing the body and emitting locally. This is the same delegation pattern EPIC20-T1–T3's
`customer-portal.js` already uses for its own reasons (avoiding validation/state-machine
duplication) — the PSP-simulation case makes it a hard requirement, not just a style preference.

```js
// Wrong — event fires on AdminService's own instance, SalesService's
// cds.connect.to('PaymentService').on('PaymentSucceeded', ...) never sees it:
srv.on('capture', 'Payments', async (req) => {
  const [{ ID: paymentId }] = req.params;
  await UPDATE(Payments).set({ status: 'CAPTURED' }).where({ ID: paymentId });
  await srv.emit('PaymentSucceeded', { orderId, vehicleId });   // wrong srv
});

// Correct — delegates to the real PaymentService instance, which emits from itself:
srv.on('capture', 'Payments', async (req) => {
  const [{ ID: paymentId }] = req.params;
  const { transactionReference } = req.data;
  const paymentSrv = await cds.connect.to('PaymentService');
  return paymentSrv.send('capturePayment', { paymentId, transactionReference });
});
```
