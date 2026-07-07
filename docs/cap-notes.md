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

---

## 12. `sap.fe.templates` Does Not Support Multiple Unrelated List Reports in One App — the EPIC19-T5/T6 and EPIC20 "Manually Merge Nth Entity" Pattern Is Broken

**Context:** First real-browser verification of the UI work (all prior "Verified end to end" claims in
EPIC19-T5/T6 and EPIC20-T1–T6 were backend curl calls + `$metadata` grep counts + static-file `200`
checks — never an actual rendered page). Using Playwright against a live `cds-serve` + `ui5 serve`,
navigating to any "Nth entity manually added to an existing app" List Report (`#ReservationsList`,
`#TestDrivesList`, `#OffersList` in `app/operator-portal`; `#PaymentsList` in `app/admin-portal`;
`#OrdersList` in `app/customer-portal`, and by the same construction `#BranchesList`/`#AuditLogsList`
from EPIC19-T5/T6) crashes to a full-page "Sorry, we can't find this page" error. Only the app's
*first* (default, empty-hash) entity ever renders.

**Root cause, traced via `?sap-ui-log-level=DEBUG`:** The named route *does* match
(`sap.ui.core.routing.Route`: "did match with its pattern") and the `sap.fe.templates.ListReport`
component *does* get placed into the page aggregation. But a separate, unrelated FE mechanism —
the "related apps" / `GetLinks` shell-service probe that normally populates the "Related Apps"
smart-link menu under a real Fiori Launchpad — fires for every List Report and tries to resolve a
path built from **the route/target name itself**, not the entity set configured in
`options.settings.entitySet`:

```
[warning] Unknown child ReservationsList of OperatorPortalService.EntityContainer - /ReservationsList/
[error]   Failed to read path /ReservationsList - Invalid resource path "OperatorPortalService.ReservationsList"
[error]   Cannot retrieve the links from the shell service - Error: Invalid resource path "..."
```

That failure's error handler calls `sap.m.NavContainer#appContent`'s navigation to the framework's
built-in "Page Not Found" illustration page, **replacing the already-correctly-rendered List Report**.
This is because the default root view here is a plain `sap.m.NavContainer` (no `rootView` override in
`manifest.json` → `sap.ui5`), and pushing more than one independent `sap.fe.templates.ListReport`
Component target onto that stack is not something `sap.fe.core` expects — the "related apps" probe
assumption (that the container hosts exactly one List Report, "the app") only holds for the first one.

**Attempted fix, also insufficient:** Configuring `sap.fe.core.rootView.Fcl` (the officially documented
way to enable `sap.f.routing.Router` / Flexible Column Layout — `rootView.viewName:
"sap.fe.core.rootView.Fcl"`, `routing.config.routerClass: "sap.f.routing.Router"`, `sap.f` library
dependency, `controlAggregation: "beginColumnPages"`/`"midColumnPages"` on List/Object Page targets)
**does** stop the crash — the page renders with the right columns and no console error. But it
introduces a new failure: the FilterBar's "Go" button click reaches the right control
(`...ReservationsList--fe::FilterBar::Reservations-btnSearch`, confirmed via debug log event trace)
but triggers **no OData request at all** for any entity other than the app's original root — the
search action itself is never wired up for the second-and-later List Report. FCL's
`beginColumnPages`/`midColumnPages` aggregations are designed for **one entity's own List → Object
Page → sub-Object-Page drill-down**, not for hosting several *unrelated* entities' own independent
List Reports side by side. Neither the plain-NavContainer default nor the FCL rootView is the right
tool for that.

**Conclusion:** there is no supported `sap.fe.templates` configuration found (through this
investigation) for genuinely independent, unrelated List Report/Object Page pairs sharing one
`sap.fe.core.AppComponent`. The only pattern actually proven to work end to end in this project is
one entity's List Report as the sole root of its own app (`VehiclesList` in `app/operator-portal`,
`UsersList` in `app/admin-portal`, `VehiclesList` in `app/customer-portal` — each verified with real
data, real search, and a real Object Page). **Every "Nth entity manually added to an existing app"
across EPIC19-T5, EPIC19-T6, and EPIC20-T1 through T6 needs to become its own separate Fiori
Elements application** (its own `manifest.json`, `Component.js`, `index.html`, `i18n`, `ui5.yaml`,
`flpSandbox.html`) to actually work when clicked through by a user — see the EPIC19/EPIC20
implementation logs for the flagged-affected ticket list. Not attempted in this session; scoped as
`docs/implementations/EPIC21-fiori-multi-app-remediation.md`.

**Verification commands used, for whoever picks this up:**

```sh
node_modules/.bin/cds-serve &
(cd app/operator-portal && node_modules/.bin/ui5 serve --port 8080)
# then, with Playwright/chromium-cli against a manager.schmidt-authenticated context:
#   nav http://localhost:8080/index.html#ReservationsList
#   nav http://localhost:8080/index.html?sap-ui-log-level=DEBUG#ReservationsList   # for the trace above
```

---

## 13. `@Capabilities.InsertRestrictions.Insertable: true` Does Not Make a Native "Create" Button Appear (CAP + `sap.fe.templates.ListReport`, Non-Draft Entity)

**Context:** EPIC21-T4, chasing EPIC20-T4's original goal (a native Fiori Elements "Create" toolbar
button on `OperatorPortalService.Vehicles`, which already has an unconditional `CREATE` `@restrict`
grant and works via direct `POST` — curl-verified in EPIC20-T4). The button never renders. Confirmed
via DOM inspection (not a visual miss): a `...LineItem::StandardAction::Delete` button element
exists; no `StandardAction::Create` equivalent exists at all, with or without data loaded.

**What was tried and ruled out:** added
`@Capabilities.InsertRestrictions.Insertable: true` directly on the `Vehicles` projection in
`modules/vehicle/api/operator-portal.cds`, on the hypothesis that CAP doesn't auto-emit the OData
Capabilities vocabulary annotation Fiori Elements needs to decide whether to show Create, even
though the entity is genuinely insertable per `@restrict`. Verified the annotation reaches the
served `$metadata` correctly and unambiguously — a single `Capabilities.InsertRestrictions` record
with `Insertable: true`, no conflicting second annotation elsewhere for the same target — confirmed
both directly against `cds-serve` (`curl http://localhost:4004/operator/\$metadata`) and through the
`ui5 serve` fiori-tools-proxy (`curl http://localhost:8080/operator/\$metadata`). Refreshed the
app's local metadata snapshot to rule out a stale-cache false negative. **The Create button still
does not appear.** This annotation is not sufficient on its own (and, based on this evidence, might
not be a factor at all).

**Second attempt, also ruled out:** added `"creationMode": {"name": "NewPage"}` to the `VehiclesList`
target's `tableSettings` in `app/operator-portal/webapp/manifest.json` (the manifest-level knob
several SAP docs cite for enabling List Report creation). Compiled fine, no console errors, no
`UI.CreateHidden` annotation present anywhere in the served `$metadata` to explain a suppression —
**the Create button still does not appear.** Reverted (no diff left behind).

**Conclusion — accepted as Won't Fix:** two independent, otherwise-correct configuration paths
(the OData Capabilities vocabulary annotation, and the manifest-level `creationMode` knob) both
fail to surface a native Create button on this non-draft entity. Combined with the contradictory
research (some sources say CAP + Fiori Elements V4 requires draft mode — `@odata.draft.enabled` —
for any native Create/Update UX on an entity; official CAP documentation says non-draft Create
should work out of the box with a plain `@restrict` grant), the practical conclusion is that draft
mode is genuinely required here, and no annotation-only fix exists. Enabling full draft mode on
`Vehicles` was evaluated and explicitly rejected as disproportionate: it changes an entity's
key/identity semantics (`IsActiveEntity`, `DraftAdministrativeData`, a save/discard lifecycle) and
would touch every existing Vehicles read/write handler across all three portals and every EPIC20
bound action built on top of it — a materially bigger and riskier change than one toolbar button
justifies.

**Status:** `@Capabilities.InsertRestrictions.Insertable: true` left in place in
`operator-portal.cds` — it is accurate metadata (Vehicles is genuinely insertable) and harmless even
though it didn't solve the visibility problem. `POST /operator/Vehicles` is unaffected and still
works; only the native toolbar button is missing. See
`docs/implementations/EPIC21-fiori-multi-app-remediation.md`, EPIC21-T4 — closed **Won't Fix**.

---

## 14. Conditional Object Page Header Buttons: Wrong `Hidden` Syntax, Then Missing `SideEffects`

**Context:** A user reported clicking "Add to Favorites" on an already-favorited vehicle in
`app/customer-portal` threw a raw `SQLITE_CONSTRAINT_UNIQUE` error, and that both "Add to
Favorites" and "Remove from Favorites" buttons always showed regardless of the vehicle's actual
favorite state. Three distinct problems stacked on top of each other; all three now fixed.

**Fix 1 — raw SQL error:** `FavoritesService.addFavorite`
(`modules/favorites/application/favorites-service.js`) now checks for an existing row first and
returns its `ID` idempotently, instead of relying on the `@assert.unique` DB constraint to reject
the duplicate insert — same pattern `removeFavorite` already used.

**Fix 2 — wrong `Hidden` syntax.** Added `virtual null as isFavorited : Boolean` and
`virtual null as isNotFavorited : Boolean` to `CustomerPortalService.Vehicles` (`customer-portal.cds`),
populated per-row in `srv.after('READ', 'Vehicles', ...)` (`customer-portal.js`) via a batched query
against `Favorites`. The first attempt set `Hidden: isFavorited` as a plain struct field inside the
`UI.DataFieldForAction` record — this compiles to a `PropertyValue Property="Hidden"` on the record,
which is spec-correct per the `UI.DataFieldAbstract` vocabulary type but **`sap.fe.templates`
silently ignores it for Object Page header actions** (`UI.Identification`), confirmed via network
trace that the underlying field had the correct value the whole time — the button just never
reacted to it. The fix is a *nested annotation* on the record instead, using `@` prefix syntax:

```cds
// Wrong — compiles, does nothing for header actions:
{
    $Type : 'UI.DataFieldForAction',
    Action: 'CustomerPortalService.addToFavorites',
    Label : 'Add to Favorites',
    Hidden: isFavorited
}

// Correct — compiles to a nested <Annotation Term="UI.Hidden" Path="..."/>
// instead of a <PropertyValue>, and sap.fe.templates actually honors it:
{
    $Type : 'UI.DataFieldForAction',
    Action: 'CustomerPortalService.addToFavorites',
    Label : 'Add to Favorites',
    @UI.Hidden: isFavorited
}
```

**Fix 3 — missing `@Common.SideEffects`.** With fix 2 alone, the button correctly hid/showed based
on the *initial* page load's data, but clicking the action never flipped it — `isFavorited`/
`isNotFavorited` are calculated fields (not part of what `addToFavorites`/`removeFromFavorites`
themselves return), so Fiori Elements has no way to know they changed as a side effect of the
action and never refetches them; the buttons kept showing stale pre-action visibility until a full
page reload. Declaring the side effect on the action itself (`customer-portal.cds`, where the
action is declared — annotating it from a separate file via
`annotate CustomerPortalService.Vehicles.actions { addToFavorites @(...) }` produced a silent
`[WARNING] ... Artifact "CustomerPortalService.Vehicles.actions" has not been found` and the
annotation was dropped; annotate actions declared inside an entity's `actions {}` block at their
declaration site, not via a separate `.actions` path) fixed it:

```cds
@requires: 'Customer'
@Common.SideEffects: {TargetProperties: ['in/isFavorited', 'in/isNotFavorited']}
action addToFavorites() returns String;
```

`'in'` is the bound-parameter name CAP generates for these actions (confirmed in the served
`$metadata`: `<Parameter Name="in" Type="CustomerPortalService.Vehicles"/>`) — use it to reference
properties on the same bound entity instance the action was called on.

**Verified end to end** with a live browser (not just curl/metadata): loading a non-favorited
vehicle's Object Page shows only "Add to Favorites"; clicking it hides "Add" and shows "Remove"
immediately, no reload; clicking "Remove" flips it back — the full toggle cycle works.
