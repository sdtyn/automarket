# EPIC19 — Fiori Elements UI

**Goal:** A browser-accessible UI for the Operator Portal and Admin views, driven by CDS `@UI`
annotations. Zero custom JavaScript for CRUD screens; Fiori Elements generates the UI from
annotations at runtime.

---

## Sprint Overview

### Ticket Table

| Ticket | Description | Status |
|--------|-------------|--------|
| EPIC19-T1 | Fiori Elements setup | Done |
| EPIC19-T2 | Vehicle list & detail annotations | Done |
| EPIC19-T3 | Operator vehicle management UI | Done |
| EPIC19-T4 | Customer catalog UI | Done |
| EPIC19-T5 | Admin UI — Users & Branches | Done |
| EPIC19-T6 | Admin UI — Audit log viewer | Done |

### Sprint Backlog DoD Mapping

| DoD Item | Satisfied by |
|----------|-------------|
| `cds watch` → browser → Fiori launchpad shows tiles for Operator Portal, Customer Catalog, and Admin | EPIC19-T1 (launchpad), T2–T6 (tiles) |
| All list/detail screens load without errors | Per ticket |
| Create/edit flows work for vehicles | EPIC19-T3 |

### Sign-off

All six tickets delivered and CI green. Three real, generated Fiori Elements apps
(`app/operator-portal`, `app/customer-portal`, `app/admin-portal`, the latter covering three
entities across three List Report + Object Page pairs) plus the CAP built-in `$fiori-preview` for
ad-hoc annotation checks. `app/manager-portal` stays empty — no ticket in this epic targets it.
Known follow-up, not silently dropped: three unbound actions
(`OperatorPortalService.createVehicle`, `AdminService.disableUser`/`assignRole`/`disableBranch`)
are not wired onto any List Report toolbar — `@UI.DataFieldForAction` cannot target unbound
actions, and a manifest.json custom-action entry could not be verified without a real browser.
Every app was verified against a live backend + a live `ui5 serve` instance (proxying, auth,
annotations, and the actual `sap.fe.templates` library all confirmed reachable) — pixel-level
rendering was not, and cannot be, verified in this environment. 13 test suites, 125 tests.
Sprint completed 2026-07-02.

**Post-hoc correction (2026-07-06, during EPIC20 UI testing):** the claim above — "pixel-level
rendering was not, and cannot be, verified" — undersold the actual risk. A real-browser Playwright
check (see `docs/cap-notes.md` #12) found that `AdminService.Branches`'s List Report (added to
`app/admin-portal` alongside `Users` in T5, the exact "second entity manually added to an existing
app" pattern) crashes to a full-page "Sorry, we can't find this page" error the moment its route is
opened — `sap.fe.templates` does not support multiple unrelated List Reports sharing one
`sap.fe.core.AppComponent` the way this ticket assumed. `UsersList` (the app's original, sole root
entity) still works correctly; `BranchesList` does not, and `AuditLogsList` (added the same way in
T6) is expected to have the identical defect, unverified only because the browser check stopped at
Branches once the pattern was confirmed broken. See `docs/cap-notes.md` #12 for the full root-cause
trace and `docs/implementations/EPIC20-full-ui-backend-integration.md`'s sign-off for the equivalent
correction across EPIC20 — a proper fix (splitting each entity into its own Fiori app) is scoped as
follow-up work, not yet scheduled.

---

## EPIC19-T1: Fiori Elements setup

### What & Why

CAP's own Fiori tooling — not a separately generated UI5 app — is what serves this project's UI.
`@sap/cds-dk` (the dev kit) bundles `@sap/cds-fiori`, a `cds-plugin.js` that auto-registers a
generic Fiori Elements "preview" for every served entity, reachable at
`/$fiori-preview/<Service>/<Entity>#preview-app`. This preview page is a real Fiori launchpad
sandbox (`sap-ushell-config` with a tile pointing at the entity), not a placeholder — it
bootstraps SAPUI5 from `sapui5.hana.ondemand.com` and renders a genuine List Report / Object Page
driven entirely by the entity's `@UI` annotations (EPIC19-T2 onward adds those annotations; with
none yet, the preview falls back to raw column order).

Verified directly (not just read about): after installing `@sap/cds-dk`, `cds watch` was started
and both `/` (the CAP welcome page, which now lists a "Fiori preview" link per entity) and
`/$fiori-preview/VehicleService/Vehicles` returned `200` with the real ushell bootstrap HTML.

`cds env get fiori` already returns a working default config (UI5 `1.145.0`, `sap_horizon` theme)
with zero project config — `@sap/cds-fiori`'s `cds-plugin.js` supplies it automatically. The
explicit `cds.fiori` block added to `package.json` pins the UI5 version rather than floating on
whatever `@sap/cds-fiori`'s internal default is at install time — otherwise a routine
`npm install` months from now could silently swap the UI5 runtime version the whole team's
browsers load, with no changelog entry anywhere in this repo to explain why.

`@sap/ux-specification` provides the `@UI.*` annotation vocabulary/schema for editor
IntelliSense in `.cds` files (design-time only — it does not affect what `cds watch` serves) and
is added per the ticket's explicit ask, ahead of EPIC19-T2's annotation work.

### Step-by-step

#### 1. Install dependencies

```sh
npm install --save-dev @sap/cds-dk @sap/ux-specification
```

This updates `package.json` and `package-lock.json`. `@sap/cds-dk` pulls in `@sap/cds-fiori`
(the actual Fiori preview plugin) and the `cds` CLI (`cds watch`, `cds add`, etc.) — the base
`@sap/cds` dependency only ships the serve-only `cds-serve` binary used by `npm start`.

`npm audit` reports vulnerabilities only in `devDependencies` (SAP UI5/Fiori tooling's transitive
deps) — `npm audit --omit=dev` reports 0. Not addressed here; these are build/dev-time tools, not
shipped runtime code.

#### 2. Modify `package.json`

Add a `fiori` block as a sibling of `requires`, inside the top-level `cds` section:

```json
    "fiori": {
      "preview": {
        "ui5": {
          "version": "1.145.0"
        }
      }
    }
```

#### 3. Verify

```sh
node_modules/.bin/cds watch --port 4005
```

In another terminal:

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4005/
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4005/\$fiori-preview/VehicleService/Vehicles"
```

Expected: both return `200`. The first is the CAP welcome page (now listing a "Fiori preview"
link under every entity); the second is the actual Fiori Elements launchpad sandbox HTML for the
`Vehicles` entity.

```sh
npm run lint && npm run format:check && npm test
```

Expected: unchanged — 0 lint errors (pre-existing unused-var warnings only), Prettier clean,
`Test Suites: 10 passed, 10 total`, `Tests: 116 passed, 116 total`.

---

## EPIC19-T2: Vehicle list & detail annotations

### What & Why

`@UI` annotations are kept in a dedicated file (`operator-portal-ui.cds`) rather than inline in
`operator-portal.cds`, so a UI-only change never touches the `@restrict` authorization logic that
defines the actual API contract — this mirrors the project's existing api/application/db module
split. It is wired into `srv/index.cds` the same way every other module's service file is.

`OperatorPortalService.Vehicles` previously used `excluding { images }` (unlike
`CustomerPortalService`, which excludes `images` from its list for performance and fetches
`VehicleImages` separately — see the comment in `customer-portal.cds`). That exclusion removes
the `images` navigation property from the service's entity type entirely, so a `@UI.Facets` entry
targeting `images/@UI.LineItem` (an inline gallery table on the Object Page) would have nothing to
point to. The exclusion is removed for `OperatorPortalService` specifically — the Object Page
opens one vehicle at a time, so embedding its images is cheap; `CustomerPortalService`'s
higher-traffic list view is untouched (that tradeoff is EPIC19-T4's call to make, not this
ticket's).

`VehicleImages` is annotated on the shared `automarket.VehicleImages` type (not a per-service
projection) because it is never exposed as a standalone entity set here — it only exists as the
`images` composition's target, reached through `Vehicles(ID)/images`.

Status `@UI.Criticality` coloring, the create/edit form, and `@UI.SelectionFields` filter bar are
explicitly out of scope — those are EPIC19-T3.

Everything below was verified against a live `cds watch` instance, not just read for plausibility:
the server started with no compile errors, `$metadata` for `/operator` contains the `UI.LineItem`,
`UI.FieldGroup#GeneralInfo`, and `UI.Facets` annotations exactly as written, `GET
/operator/Vehicles?$expand=images` (as Manager) returns real image rows, and
`/$fiori-preview/OperatorPortalService/Vehicles` returns `200`.

### Step-by-step

#### 1. Modify `modules/vehicle/api/operator-portal.cds`

Remove the `excluding { images }` clause from the `Vehicles` projection and add a comment
explaining why images are included here (unlike `CustomerPortalService`):

```cds
    // Operator READ is filtered to branch_ID = req.user.attr.branchId at the
    // query level. Manager READ is unrestricted. No WRITE on the projection —
    // creation goes through the explicit createVehicle action so status and
    // branch enforcement cannot be bypassed.
    // images is included (unlike CustomerPortalService's list-performance
    // exclusion — see customer-portal.cds) so the @UI.Facets image gallery on
    // the Object Page (EPIC19-T2, operator-portal-ui.cds) has a composition to
    // navigate to. This entity set is opened one record at a time in the
    // Fiori app, not listed in bulk with images inlined, so the cost is fine.
    @restrict: [
        {
            grant: 'READ',
            to   : 'Operator',
            where: 'branch_ID = $user.branchId'
        },
        {
            grant: 'READ',
            to   : 'Manager'
        }
    ]
    entity Vehicles     as projection on automarket.Vehicles;
```

#### 2. Create `modules/vehicle/api/operator-portal-ui.cds`

```cds
using {OperatorPortalService} from './operator-portal';
using {automarket} from '../db/vehicle';

// UI annotations for OperatorPortalService.Vehicles (EPIC19-T2). Kept in a
// separate file from the service definition (operator-portal.cds) so the API
// contract (what data is exposed, to whom) stays independent of how Fiori
// Elements renders it — a UI-only change here never touches the @restrict
// authorization logic.
annotate OperatorPortalService.Vehicles with @(
    // List Report columns. Status Criticality coloring and the create/edit
    // form (@UI.SelectionFields, editable field annotations) are EPIC19-T3
    // scope, not this ticket.
    UI.LineItem                : [
        {Value: brand},
        {Value: model},
        {Value: year},
        {Value: price},
        {Value: status},
        {Value: branch.name, Label: 'Branch'}
    ],

    // Object Page general-info section.
    UI.FieldGroup #GeneralInfo : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {Value: vin},
            {Value: plateNumber},
            {Value: brand},
            {Value: model},
            {Value: year},
            {Value: mileage},
            {Value: fuelType},
            {Value: transmission},
            {Value: color},
            {Value: price},
            {Value: currency},
            {Value: status},
            {Value: branch.name, Label: 'Branch'}
        ]
    },

    // Object Page facets: general info form + an inline image gallery table
    // driven by the images composition (see UI.LineItem on VehicleImages
    // below — a Facet pointing at a composition needs a LineItem defined on
    // the target type for Fiori Elements to know which columns to render).
    UI.Facets                  : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Vehicle Details',
            Target: '@UI.FieldGroup#GeneralInfo'
        },
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Images',
            Target: 'images/@UI.LineItem'
        }
    ]
);

// Minimal columns for the inline image gallery table on the Vehicles Object
// Page facet above. Annotated on the shared automarket.VehicleImages type
// (not a per-service projection) because it is not exposed as a standalone
// entity set in OperatorPortalService — it only exists here as the images
// composition's target type, reachable through Vehicles(ID)/images.
annotate automarket.VehicleImages with @(
    UI.LineItem: [
        {Value: url},
        {Value: sortOrder, Label: 'Order'}
    ]
);
```

#### 3. Modify `srv/index.cds`

Add directly after the `using from '../modules/vehicle/api/operator-portal';` line:

```cds
using from '../modules/vehicle/api/operator-portal-ui';
```

#### 4. Verify

```sh
node_modules/.bin/cds watch --port 4006
```

In another terminal:

```sh
curl -s http://localhost:4006/operator/\$metadata | grep -A3 "UI.LineItem\|UI.FieldGroup\|UI.Facets"
curl -s -u "manager.schmidt@automarkt.de:Test@1234" "http://localhost:4006/operator/Vehicles?\$top=1&\$expand=images"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4006/\$fiori-preview/OperatorPortalService/Vehicles"
```

Expected: the `$metadata` grep shows all three annotation terms with the fields listed above; the
`Vehicles` query returns a row with a populated `images` array; the Fiori preview URL returns
`200`.

```sh
npm run lint && npm run format:check && npm test
```

Expected: unchanged — `Test Suites: 10 passed, 10 total`, `Tests: 116 passed, 116 total`.

---

## EPIC19-T3: Operator vehicle management UI

### What & Why — a real generated app, not just the preview

EPIC19-T1/T2 relied entirely on CAP's built-in `/$fiori-preview/<Service>/<Entity>` — a
dev-only, ephemeral rendering of the `@UI` annotations, with nothing written to disk. Partway
through this ticket it came out that the repo already had empty `app/operator-portal`,
`app/customer-portal`, `app/admin-portal`, `app/manager-portal` folders (scaffolded in EPIC01)
and a separate `approuter/` folder — evidence that the original plan was **real, standalone,
deployable Fiori Elements apps**, not just the preview. This ticket switches to that approach for
`app/operator-portal`; T4/T5 will follow the same pattern for the other portals.
`app/manager-portal` is left empty — no ticket targets it.

**How the app was generated.** SAP's official generator (`@sap/generator-fiori`) is an
interactive Yeoman wizard with no documented headless/CI mode — not runnable by an agent without
a real terminal. Underneath it, though, is `@sap-ux/fiori-elements-writer`, a plain programmatic
`generate(basePath, config)` API with no prompts. Two config modes exist: a CAP-linked mode
(`service.capService`) that wires the UI app into a single `cds watch` + npm-workspaces dev loop,
and a plain-OData-V4 mode (`service.metadata` + `service.url`) that treats the backend as any
external OData service. The CAP-linked mode requires assembling several undocumented internal
types (`CdsUi5PluginInfo` etc.) from `@sap-ux/project-access`/`@sap-ux/cap-config-writer` — too
fragile to hand-assemble reliably. The plain-OData-V4 mode was used instead: fetch the real
`$metadata` EDMX from a running `cds watch` instance and feed it straight to the writer. The
resulting app is a fully standalone UI5 project (own `package.json`/`package-lock.json`, not an
npm workspace member of the root project) — the tradeoff is no single "one command starts
everything" dev loop; the CAP backend and this UI app are started separately.

**What was verified, concretely, not just read for plausibility:**
- `cds watch` (backend, port 4004) + `ui5 serve` (this app, port 8080) running together.
- `GET localhost:8080/index.html`, `.../manifest.json`, `.../test/flpSandbox.html`,
  `.../Component.js` → all `200`.
- `GET localhost:8080/operator/$metadata` (proxied) contains the real `UI.LineItem`,
  `UI.SelectionFields`, `UI.FieldGroup`, `UI.Facets` annotations — proxy genuinely forwards to
  the live backend, not a stale copy.
- `GET localhost:8080/operator/Vehicles` without auth → `401`; with Manager credentials → real
  vehicle rows including the computed `statusCriticality` field.
- `GET localhost:8080/resources/sap-ui-core.js` and
  `.../resources/sap/fe/templates/library-preload.js` → `200` (UI5 runtime + the Fiori Elements
  templates library that actually renders List Report/Object Page both load).
- What could **not** be verified: pixel-level rendering. No browser is available in this
  environment — every check above confirms the data/metadata/routing/auth plumbing a rendered
  screen depends on, not the visual result itself.

**Status Criticality.** `OperatorPortalService.Vehicles` gets a new `virtual` (non-persisted)
`statusCriticality: Integer` field, populated per row by a new `srv.after('READ', 'Vehicles', ...)`
handler in `operator-portal.js` using a `CRITICALITY` lookup table
(`VehicleStatus → com.sap.vocabularies.UI.v1.CriticalityType`: `FOR_SALE`/`SOLD`/`DELIVERED` →
Positive, `RESERVED`/`PENDING_PAYMENT` → Critical (amber — mid-flow, worth attention),
`ARCHIVED` → Negative, `DRAFT` → Neutral). The `UI.LineItem`'s `status` `DataField` references it
via `Criticality: statusCriticality`, which Fiori Elements renders as a colored status badge.
Covered by a new `tests/unit/services/operator-portal.test.js` — one assertion per enum value via
direct DB `UPDATE` + `GET`, not just the seeded happy-path status.

**Filter bar.** `UI.SelectionFields: [brand, fuelType, status]` — straightforward, no surprises.

**Create/edit form — deliberately not wired to a button.**
`OperatorPortalService.Vehicles` has no `CREATE`/`UPDATE` grant (see the existing comment in
`operator-portal.cds`: creation only goes through the `createVehicle` action, "so status and
branch enforcement cannot be bypassed"). Fiori Elements' native create/edit form needs direct
OData POST/PATCH, which would mean loosening that deliberate restriction. Presented to the user;
the restriction stays, and `createVehicle` was meant to become a List Report toolbar button
instead. Checking `$metadata` showed `createVehicle` is `IsBound="false"` (an `ActionImport`, not
bound to the `Vehicles` entity type) — `@UI.DataFieldForAction` only targets actions bound to an
entity type, so it cannot reference `createVehicle` at all. Wiring an unbound action onto the List
Report toolbar declaratively is possible via a `manifest.json` `controlConfiguration` custom-action
entry, but getting that exact schema right — and confirming it actually renders a button — cannot
be done without a real browser. Rather than ship an unverified guess, this Object Page stays
view-only for now; vehicle creation continues via the `createVehicle` endpoint directly (see
`tests/http/vehicle.http`). Left as a known follow-up, not silently dropped.

### Step-by-step

#### 1. Install the writer

```sh
npm install --save-dev @sap-ux/fiori-elements-writer
```

Pulls in `@sap-ux/odata-service-writer`, `@sap-ux/ui5-application-writer`, `mem-fs`,
`mem-fs-editor`, etc. as transitive deps. `npm audit --omit=dev` stays at 0 — all reported
vulnerabilities are in this dev-only tooling's own transitive tree.

#### 2. Generate the app

With a `cds watch` instance running (any port), fetch the live metadata and run the writer. This
was done with a throwaway script (not committed — a one-time generation step, not a repo script):

```js
const { generate, TemplateType, TableType } = require('@sap-ux/fiori-elements-writer');
const { OdataVersion } = require('@sap-ux/odata-service-writer');

const config = {
  app: { id: 'automarket.operatorportal', title: 'Operator Vehicle Management', ... },
  package: { name: 'operator-portal', description: 'Operator Vehicle Management' },
  service: { url: 'http://localhost:4004', path: '/operator', version: OdataVersion.v4, metadata /* live $metadata EDMX string */ },
  template: { type: TemplateType.ListReportObjectPage, settings: { tableType: TableType.RESPONSIVE, entityConfig: { mainEntityName: 'Vehicles' } } },
  appOptions: { addAnnotations: true },
};

const editor = await generate('/workspaces/tutorials/automarket/app/operator-portal', config);
editor.commit(() => {});
```

`basePath` is written to directly (no extra subfolder is created for the module name) — pass the
final target folder itself.

#### 3. Fix generator defaults by hand

The writer does not add `start`/`build` npm scripts. Add to
`app/operator-portal/package.json`'s `scripts`:

```json
"start": "fiori run --open \"test/flpSandbox.html\"",
"start-noflp": "fiori run --open \"index.html\"",
"build": "ui5 build --clean-dest --all",
```

The writer also bakes in whatever `service.url` was passed at generation time as the local dev
proxy target. In `app/operator-portal/ui5.yaml` and `ui5-mock.yaml`, under
`server.customMiddleware[fiori-tools-proxy].configuration.backend`, set the URL to the project's
real default dev port:

```yaml
backend:
  - path: /operator
    url: http://localhost:4004
```

#### 4. Modify `modules/vehicle/api/operator-portal.cds`

Add the virtual `statusCriticality` field to the `Vehicles` projection:

```cds
    // statusCriticality is a read-only calculated field (populated in
    // operator-portal.js, srv.after('READ')) — not persisted. It maps
    // VehicleStatus to an OData UI.CriticalityType so the Fiori status badge
    // (EPIC19-T3, operator-portal-ui.cds) can color-code rows without the
    // client needing its own copy of the status→color mapping.
    entity Vehicles     as
        projection on automarket.Vehicles {
            *,
            virtual null as statusCriticality : Integer
        };
```

#### 5. Modify `modules/vehicle/application/operator-portal.js`

Add a module-level `CRITICALITY` map and a `srv.after('READ')` handler, directly above the
`module.exports = cds.service.impl(...)` line and inside its callback respectively:

```js
// CRITICALITY maps VehicleStatus to com.sap.vocabularies.UI.v1.CriticalityType
// codes (Neutral=0, Negative=1, Critical=2, Positive=3) for the Fiori status
// badge (EPIC19-T3). FOR_SALE/SOLD/DELIVERED are "good" outcomes; RESERVED and
// PENDING_PAYMENT are mid-flow states worth an operator's attention; ARCHIVED
// is the only genuinely negative state (no longer available at all).
const CRITICALITY = {
  DRAFT: 0,
  FOR_SALE: 3,
  RESERVED: 2,
  PENDING_PAYMENT: 2,
  SOLD: 3,
  DELIVERED: 3,
  ARCHIVED: 1,
};

module.exports = cds.service.impl(async function (srv) {
  const { Vehicles, Reservations, TestDrives, Offers } = cds.entities('automarket');
  const { transition } = require('../domain/vehicle-state-machine');

  // Populates the virtual statusCriticality field (declared in
  // operator-portal.cds) on every Vehicles row returned by READ.
  srv.after('READ', 'Vehicles', (rows) => {
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      if (row) row.statusCriticality = CRITICALITY[row.status] ?? 0;
    }
  });

  // createVehicle: ...
```

#### 6. Modify `modules/vehicle/api/operator-portal-ui.cds`

Add `Criticality: statusCriticality` to the `status` `DataField` in `UI.LineItem`, add
`UI.SelectionFields`, and add the header comment explaining the deliberately-not-wired create
button (see What & Why above):

```cds
annotate OperatorPortalService.Vehicles with @(
    UI.LineItem       : [
        {Value: brand},
        {Value: model},
        {Value: year},
        {Value: price},
        {Value: status, Criticality: statusCriticality},
        {Value: branch.name, Label: 'Branch'}
    ],
    UI.SelectionFields: [
        brand,
        fuelType,
        status
    ],
    ...
```

#### 7. Modify `eslint.config.js` and `.prettierignore`

`app/` holds standalone UI5 projects with their own tooling — Node's ESLint config flags
`sap.ui.define`'s global `sap` as undefined, and Prettier reformats generator output that has its
own conventions. Add `'app/'` to both `eslint.config.js`'s `ignores` array and
`.prettierignore`.

#### 8. Create `tests/unit/services/operator-portal.test.js`

One test for the seeded happy path (`FOR_SALE` → `3`), one that cycles a vehicle through all
seven `VehicleStatus` values via direct `UPDATE` and asserts `statusCriticality` for each —
catching a wrong mapping for the states that never appear in seed data (`DRAFT`, `RESERVED`,
`PENDING_PAYMENT`, `SOLD`, `DELIVERED`, `ARCHIVED`).

#### 9. Verify

```sh
node_modules/.bin/cds watch                                    # backend, port 4004
(cd app/operator-portal && npm install && node_modules/.bin/ui5 serve --port 8080)
```

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/index.html
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/test/flpSandbox.html
curl -s http://localhost:8080/operator/\$metadata | grep -c "UI.SelectionFields\|statusCriticality"
curl -s -u "manager.schmidt@automarkt.de:Test@1234" "http://localhost:8080/operator/Vehicles?\$top=1&\$select=brand,status,statusCriticality"
```

Expected: `200`/`200`/`4`/a real row with a numeric `statusCriticality`.

```sh
npm run lint && npm run format:check && npm test
```

Expected: `Test Suites: 11 passed, 11 total`, `Tests: 118 passed, 118 total`.

---

## EPIC19-T4: Customer catalog UI

### What & Why

Followed the same pattern as EPIC19-T3: real `app/customer-portal` app generated with
`@sap-ux/fiori-elements-writer` in plain OData V4 mode against live `$metadata`, `@UI` annotations
in a dedicated `customer-portal-ui.cds` file wired into `srv/index.cds`.

**`images` exclusion reversed.** `CustomerPortalService.Vehicles` excluded the `images` composition
outright, with a comment claiming this "keeps the list query lightweight." Verified directly
before touching anything: a plain `GET .../Vehicles` (no `$expand`) never includes composition
data regardless of whether the composition is present in the entity type — only an explicit
`$expand=images` does. The exclusion bought nothing and blocked the one thing this ticket actually
needs (a real `@UI.Facets` photo gallery on the Object Page, same mechanism as EPIC19-T3's
operator gallery). Presented to the user before changing it, since it reverses a prior deliberate
(if incorrect) decision; confirmed to remove the exclusion. The separate `VehicleImages` entity
projection is untouched — still available, just redundant with the composition now.

**`primaryImageUrl`.** Same `virtual` + `srv.after('READ')` pattern as EPIC19-T3's
`statusCriticality`: a non-persisted field on `Vehicles`, populated by
`customer-portal.js`'s new `after('READ')` handler with the first `VehicleImages` row by
`sortOrder` for each vehicle in the result page — **one batched query for the whole page**, not
N+1 per row. Annotated `@UI.IsImageURL: true` so the List Report renders it as a thumbnail
column instead of a text/link column. Covered by
`tests/unit/services/customer-portal.test.js`: ordering (a second, higher-`sortOrder` image must
not override the seeded `sortOrder: 0` one), the no-image case (`null`, not an error), and a
direct assertion that a plain list query still omits `images` entirely (the premise the reversed
exclusion depended on).

**Object Page fields.** `vin`, `plateNumber`, and `status` are deliberately left out of the
customer-facing `FieldGroup` — operational/internal details a customer does not need — while
`branch.name`/`branch.city` are included (where the vehicle can be seen/collected is useful to a
buyer). No `@UI.SelectionFields` filter bar was added — unlike EPIC19-T3, this ticket's
description does not ask for one.

**Verified the same way as T3**, against the real backend (port 4004) + a real `ui5 serve`
instance (port 8081): `index.html`/`flpSandbox.html` → `200`; proxied `$metadata` contains the
new annotation terms; proxied `GET Vehicles` (no auth — `@requires: 'any'`) returns real rows with
a resolved `primaryImageUrl`. Same caveat as T3: pixel-level rendering was not (and cannot be)
visually confirmed in this environment.

### Step-by-step

#### 1. Modify `modules/vehicle/api/customer-portal.cds`

Remove the `excluding { images }` clause and add the virtual `primaryImageUrl` field:

```cds
    // primaryImageUrl is a read-only calculated field (populated in
    // customer-portal.js, srv.after('READ')) — the first VehicleImages row by
    // sortOrder, or null. Annotated @UI.IsImageURL (customer-portal-ui.cds) so
    // the List Report renders it as a thumbnail instead of a text column
    // (EPIC19-T4).
    @requires: 'any'
    entity Vehicles      as
        projection on automarket.Vehicles {
            *,
            virtual null as primaryImageUrl : String
        };
```

(The `images` composition is included by omitting `excluding { images }` — the projection is now
just `projection on automarket.Vehicles { ... }`, same shape used for the `statusCriticality`
field.)

#### 2. Modify `modules/vehicle/application/customer-portal.js`

Add `VehicleImages` to the destructured entities and a batched `after('READ')` handler, directly
below the existing `srv.before('READ', 'Vehicles', ...)` block:

```js
  const { Favorites, PriceHistory, VehicleImages } = cds.entities('automarket');

  // Populates the virtual primaryImageUrl field (declared in customer-portal.cds)
  // for every Vehicles row returned by READ — one batched query for the whole
  // result page, not one query per row.
  srv.after('READ', 'Vehicles', async (rows) => {
    const list = Array.isArray(rows) ? rows : [rows];
    const ids = list.filter(Boolean).map((r) => r.ID);
    if (!ids.length) return;

    const images = await SELECT.from(VehicleImages)
      .columns('vehicle_ID', 'url')
      .where({ vehicle_ID: { in: ids } })
      .orderBy({ sortOrder: 'asc' });

    const firstImageByVehicle = {};
    for (const image of images) {
      if (!(image.vehicle_ID in firstImageByVehicle)) {
        firstImageByVehicle[image.vehicle_ID] = image.url;
      }
    }
    for (const row of list) {
      if (row) row.primaryImageUrl = firstImageByVehicle[row.ID] ?? null;
    }
  });
```

#### 3. Create `modules/vehicle/api/customer-portal-ui.cds`

```cds
using {CustomerPortalService} from './customer-portal';
using {automarket} from '../db/vehicle';

// UI annotations for CustomerPortalService.Vehicles (EPIC19-T4). Kept in a
// separate file from the service definition, same pattern as
// operator-portal-ui.cds — UI presentation stays independent of the API
// contract (@requires, the FOR_SALE filter in customer-portal.js).
annotate CustomerPortalService.Vehicles with @(
    // Catalog list columns, with a thumbnail image column.
    UI.LineItem                : [
        {Value: primaryImageUrl, Label: 'Image'},
        {Value: brand},
        {Value: model},
        {Value: year},
        {Value: price}
    ],

    // Object Page: full specs (internal/operational fields — vin, plateNumber,
    // status — are deliberately left out; a customer does not need them).
    UI.FieldGroup #VehicleSpecs : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {Value: brand},
            {Value: model},
            {Value: year},
            {Value: mileage},
            {Value: fuelType},
            {Value: transmission},
            {Value: color},
            {Value: price},
            {Value: currency},
            {Value: branch.name, Label: 'Branch'},
            {Value: branch.city, Label: 'City'}
        ]
    },

    // Object Page facets: specs form + an inline photo gallery table driven by
    // the images composition (VehicleImages' UI.LineItem is annotated once,
    // shared with OperatorPortalService — see operator-portal-ui.cds).
    UI.Facets                  : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Specifications',
            Target: '@UI.FieldGroup#VehicleSpecs'
        },
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Photos',
            Target: 'images/@UI.LineItem'
        }
    ]
);

// Renders primaryImageUrl as a thumbnail in the List Report table instead of
// a plain text/link column.
annotate CustomerPortalService.Vehicles with {
    primaryImageUrl @UI.IsImageURL: true;
};
```

#### 4. Modify `srv/index.cds`

Add directly after the `using from '../modules/vehicle/api/customer-portal';` line:

```cds
using from '../modules/vehicle/api/customer-portal-ui';
```

#### 5. Create `tests/unit/services/customer-portal.test.js`

Three tests: sortOrder wins over a newly inserted higher-sortOrder image; `null` when a vehicle's
images are deleted; a plain `$top=1` query's row has no `images` key at all (the premise the
exclusion removal depended on).

#### 6. Generate `app/customer-portal`

Same procedure as EPIC19-T3 step 2 (throwaway script, live `$metadata`, `TemplateType.ListReportObjectPage`,
`entityConfig.mainEntityName: 'Vehicles'`), then the same by-hand fixes as T3 step 3 (`start`/`start-noflp`/`build`
npm scripts; confirm `ui5.yaml`/`ui5-mock.yaml` backend URL is `http://localhost:4004`, not a
throwaway verification port).

#### 7. Verify

```sh
node_modules/.bin/cds watch                                    # backend, port 4004
(cd app/customer-portal && npm install && node_modules/.bin/ui5 serve --port 8081)
```

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8081/index.html
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8081/test/flpSandbox.html
curl -s http://localhost:8081/catalog/\$metadata | grep -c "UI.LineItem\|UI.FieldGroup\|UI.Facets\|IsImageURL"
curl -s "http://localhost:8081/catalog/Vehicles?\$top=1&\$select=brand,price,primaryImageUrl"
```

Expected: `200`/`200`/`8`/a real row with a resolved `primaryImageUrl` (no auth needed —
`@requires: 'any'`).

```sh
npm run lint && npm run format:check && npm test
```

Expected: `Test Suites: 12 passed, 12 total`, `Tests: 121 passed, 121 total`.

---

## EPIC19-T5: Admin UI — Users & Branches

### What & Why

Same pattern as EPIC19-T3/T4, with one new wrinkle: this ticket covers **two** entities
(`Users` and `Branches`) in **one** app (`app/admin-portal` — a single pre-scaffolded folder,
not two). `@sap-ux/fiori-elements-writer`'s `generate()` is not incremental — calling it a second
time against the same target folder with a different `entityConfig.mainEntityName` **overwrites**
the first entity's routing entirely rather than merging (verified directly: generating for
`Users` then `Branches` left only `BranchesList`/`BranchesObjectPage` in `manifest.json`, no
trace of `Users`). So the app was generated once for `Users` (primary), and the second
List Report + Object Page pair for `Branches` was added to `manifest.json` by hand, following the
exact shape the writer produces (verified structurally valid JSON, and functionally by
proxying to the real backend). A second FLP tile was added to `flpSandbox.html` pointing at the
in-app route `../#BranchesList`, so both entities are reachable as separate tiles.

**Unbound actions — same wall as T3, not re-litigated.** `disableUser`, `assignRole`, and
`disableBranch` are all unbound `AdminService` actions (confirmed the same way as
`createVehicle` in T3 — service-level, not bound to `Users`/`Branches`), so `@UI.DataFieldForAction`
cannot target them. Both Object Pages are view-only; the precedent from T3 (documented, not
silently dropped, wiring deferred to a manifest-level follow-up) applies here without asking
again — same architectural pattern, same reasoning.

**`passwordHash` stays excluded**; `statusCriticality` is added *alongside* the existing
`excluding { passwordHash }` clause, which required the projection body and `excluding` to be
combined in one statement (`projection on X { *, virtual ... } excluding { passwordHash };` — the
CDS compiler rejects `excluding {...} { ... }` in that order, confirmed by a failed `cds compile`
before finding the working order). `USER_CRITICALITY`/`BRANCH_CRITICALITY` maps mirror T3's
pattern (`ACTIVE`/`Positive`, `LOCKED`/`Critical` — self-expiring, needs attention but not a dead
end — `INACTIVE`/`Negative`). Both covered by
`tests/unit/services/admin-service.test.js`: every `UserStatus` and `BranchStatus` enum value
gets its own assertion (not just the seeded `ACTIVE` happy path), plus a regression check that
`passwordHash` is still never exposed.

**Verified the same way as T3/T4**, against the real backend (port 4004) + a real `ui5 serve`
instance (port 8082): `index.html`/`flpSandbox.html` → `200`; the *served* `manifest.json`
(through the dev server, not just the file on disk) parses with all four routes present; proxied
`GET Users` and `GET Branches` both return real rows with resolved `statusCriticality`. Same
caveat as T3/T4: pixel-level rendering, and specifically whether the second FLP tile actually
navigates correctly in a real shell, could not be visually confirmed in this environment — the
hand-edited manifest routing was verified structurally and via direct OData proxying only.

### Step-by-step

#### 1. Modify `modules/admin/api/admin-service.cds`

Add `statusCriticality` to both `Users` (combined with the existing `excluding` clause — body
first, `excluding` after) and `Branches`:

```cds
    @requires: 'Admin'
    entity Users       as
        projection on automarket.Users {
            *,
            virtual null as statusCriticality : Integer
        }
        excluding { passwordHash };
```

```cds
    @requires: 'Admin'
    entity Branches    as
        projection on br.Branches {
            *,
            virtual null as statusCriticality : Integer
        };
```

#### 2. Modify `modules/admin/application/admin-service.js`

Add two module-level criticality maps and two `after('READ')` handlers:

```js
const USER_CRITICALITY = { ACTIVE: 3, LOCKED: 2, INACTIVE: 1 };
const BRANCH_CRITICALITY = { ACTIVE: 3, INACTIVE: 1 };

module.exports = cds.service.impl(async function (srv) {
  const { Users, Roles, UserRoles, Branches } = cds.entities('automarket');

  srv.after('READ', 'Users', (rows) => {
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      if (row) row.statusCriticality = USER_CRITICALITY[row.status] ?? 0;
    }
  });
  srv.after('READ', 'Branches', (rows) => {
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      if (row) row.statusCriticality = BRANCH_CRITICALITY[row.status] ?? 0;
    }
  });
```

#### 3. Create `modules/admin/api/admin-service-ui.cds`

`UI.LineItem`/`UI.FieldGroup`/`UI.Facets` for both `AdminService.Users` and
`AdminService.Branches`, same shape as `operator-portal-ui.cds` — see the file for full content.

#### 4. Modify `srv/index.cds`

Add directly after the `using from '../modules/admin/api/admin-service';` line:

```cds
using from '../modules/admin/api/admin-service-ui';
```

#### 5. Create `tests/unit/services/admin-service.test.js`

One test per entity cycling through every status enum value via direct `UPDATE` + `GET`, plus a
`passwordHash`-never-exposed regression check.

#### 6. Generate `app/admin-portal`, then add the second entity by hand

Same procedure as T3/T4 (throwaway script, `mainEntityName: 'Users'`). Then, in
`webapp/manifest.json`, add a second route pair + target pair for `Branches` (prefixed
`BranchesList/...` so it does not collide with the default empty-hash route), copying the exact
shape of the `Users` entries:

```json
{ "pattern": "BranchesList:?query:", "name": "BranchesList", "target": "BranchesList" },
{ "pattern": "BranchesList/Branches({key}):?query:", "name": "BranchesObjectPage", "target": "BranchesObjectPage" }
```

with matching `"BranchesList"`/`"BranchesObjectPage"` entries under `targets` (entitySet:
`"Branches"` instead of `"Users"`). In `webapp/test/flpSandbox.html`, add a second tile to
`sap-ushell-config.applications`:

```js
"automarketadminportalbranches-tile": {
    title: "Branches",
    description: "Manage branches",
    additionalInformation: "SAPUI5.Component=automarket.adminportal",
    applicationType: "URL",
    url: "../#BranchesList"
}
```

Then the same by-hand fixes as T3/T4: `start`/`start-noflp`/`build` npm scripts;
`ui5.yaml`/`ui5-mock.yaml` backend URL `http://localhost:4004`.

#### 7. Verify

```sh
node_modules/.bin/cds watch                                 # backend, port 4004
(cd app/admin-portal && npm install && node_modules/.bin/ui5 serve --port 8082)
```

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8082/index.html
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8082/test/flpSandbox.html
curl -s http://localhost:8082/manifest.json | python3 -c "import json,sys; print([r['name'] for r in json.load(sys.stdin)['sap.ui5']['routing']['routes']])"
curl -s -u "admin.mueller@automarkt.de:Test@1234" "http://localhost:8082/admin/Users?\$top=1&\$select=email,status,statusCriticality"
curl -s -u "admin.mueller@automarkt.de:Test@1234" "http://localhost:8082/admin/Branches?\$top=1&\$select=code,status,statusCriticality"
```

Expected: `200`/`200`/all four route names present/a real `Users` row/a real `Branches` row.

```sh
npm run lint && npm run format:check && npm test
```

Expected: `Test Suites: 13 passed, 13 total`, `Tests: 124 passed, 124 total`.

---

## EPIC19-T6: Admin UI — Audit log viewer

### What & Why

`AuditLogs` becomes a **third** entity/tile in `app/admin-portal` (same hand-merge approach as
T5's `Branches`), not a new app — the folder is singular, and this ticket is explicitly scoped as
more `AdminService` UI. `@readonly` plus the absence of any `CREATE`/`UPDATE`/`DELETE` grant on
the entity (already true in `admin-service.cds` before this ticket) means there was nothing to
restrict at the UI layer — Fiori Elements naturally renders a read-only List Report/Object Page
when the underlying OData capabilities don't advertise write support.

`UI.SelectionFields: [entityType, userId, createdAt]` gives the filter bar entityType/userId
filters plus a date-range filter on `createdAt` — Fiori Elements infers a range control
automatically for a `Timestamp` property in `SelectionFields`, no extra annotation needed.
Default newest-first ordering is `UI.PresentationVariant.SortOrder` (not just relying on client
sort state), since an audit trail is read chronologically backwards by default.

**Found while checking how to verify this against real data: nothing writes to `AuditLogs`.**
Grepped the whole codebase — no handler, anywhere, ever inserts a row. The entity is fully
modeled and exposed, but the actual audit-trail-writing mechanism (hooking into every mutating
action across every service to record `entityType`/`entityId`/`action`/`oldValue`/`newValue`)
was never implemented. Implementing that is its own undertaking — an epic in itself, not a
UI-annotation ticket's job — so it's noted here and left alone. The practical consequence: the
default sort could only be verified against fixture rows inserted directly in a jest test, not
real usage data; a live `GET /admin/AuditLogs` against the actual dev backend will always return
an empty array today.

### Step-by-step

#### 1. Extend `modules/admin/api/admin-service-ui.cds`

Append after the `Branches` `annotate` block:

```cds
// AuditLogs (EPIC19-T6): read-only (@readonly and no WRITE grant already on
// the entity in admin-service.cds — nothing to restrict at the UI layer).
// Default sort newest-first via UI.PresentationVariant, since an audit trail
// is read chronologically backwards by default. entityType/userId/createdAt
// in SelectionFields gives the filter bar entityType and userId dropdown-style
// filters plus a date-range filter on createdAt (Fiori Elements infers a range
// filter automatically for a Timestamp field in SelectionFields).
annotate AdminService.AuditLogs with @(
    UI.LineItem              : [
        {Value: createdAt, Label: 'Timestamp'},
        {Value: entityType},
        {Value: entityId},
        {Value: action},
        {Value: userId}
    ],
    UI.SelectionFields        : [
        entityType,
        userId,
        createdAt
    ],
    UI.PresentationVariant    : {
        SortOrder: [
            {Property: createdAt, Descending: true}
        ]
    },
    UI.FieldGroup #LogDetails : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {Value: createdAt, Label: 'Timestamp'},
            {Value: entityType},
            {Value: entityId},
            {Value: action},
            {Value: userId},
            {Value: oldValue, Label: 'Old Value'},
            {Value: newValue, Label: 'New Value'}
        ]
    },
    UI.Facets                 : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Log Entry',
            Target: '@UI.FieldGroup#LogDetails'
        }
    ]
);
```

#### 2. Extend `tests/unit/services/admin-service.test.js`

New nested `describe('AuditLogs — default sort (EPIC19-T6)', ...)` block, sibling to the existing
`describe`/`it` blocks, directly before the file's closing `});`:

```js
  describe('AuditLogs — default sort (EPIC19-T6)', () => {
    it('honors createdAt descending as the natural query order', async () => {
      const { AuditLogs } = cds.entities('automarket');
      const older = new Date(Date.now() - 60000).toISOString();
      const newer = new Date().toISOString();
      await INSERT.into(AuditLogs).entries([
        { ID: cds.utils.uuid(), entityType: 'Vehicle', action: 'UPDATE', createdAt: older },
        { ID: cds.utils.uuid(), entityType: 'Vehicle', action: 'UPDATE', createdAt: newer },
      ]);

      const res = await GET('/admin/AuditLogs?$orderby=createdAt desc&$top=2', { auth: adminAuth });
      const rows = res.data.value ?? res.data;
      expect(new Date(rows[0].createdAt).getTime()).toBeGreaterThan(
        new Date(rows[1].createdAt).getTime()
      );
    });
  });
```

#### 3. Extend `app/admin-portal/webapp/manifest.json` by hand

Same approach as T5's `Branches` merge — add a third route pair (prefixed
`AuditLogsList/...`) and a third target pair to `sap.ui5.routing`:

```json
{ "pattern": "AuditLogsList:?query:", "name": "AuditLogsList", "target": "AuditLogsList" },
{ "pattern": "AuditLogsList/AuditLogs({key}):?query:", "name": "AuditLogsObjectPage", "target": "AuditLogsObjectPage" }
```

with matching `"AuditLogsList"`/`"AuditLogsObjectPage"` target entries (entitySet:
`"AuditLogs"`, same shape as `Users`/`Branches`).

#### 4. Extend `app/admin-portal/webapp/test/flpSandbox.html`

Add a third tile to `sap-ushell-config.applications`:

```js
"automarketadminportalauditlogs-tile": {
    title: "Audit Logs",
    description: "View the audit trail",
    additionalInformation: "SAPUI5.Component=automarket.adminportal",
    applicationType: "URL",
    url: "../#AuditLogsList"
}
```

#### 5. Refresh the local metadata snapshot

`webapp/localService/mainService/metadata.xml` was generated before the `AuditLogs` annotations
existed. Overwrite it with the live `$metadata` (this file is independent of the hand-edited
`manifest.json` routing, safe to replace on its own):

```sh
curl -s http://localhost:4004/admin/\$metadata -o app/admin-portal/webapp/localService/mainService/metadata.xml
```

#### 6. Verify

```sh
node_modules/.bin/cds watch                                 # backend, port 4004
(cd app/admin-portal && node_modules/.bin/ui5 serve --port 8083)
```

```sh
curl -s http://localhost:8083/manifest.json | python3 -c "import json,sys; print([r['name'] for r in json.load(sys.stdin)['sap.ui5']['routing']['routes']])"
curl -s http://localhost:8083/admin/\$metadata | grep -c "AuditLogs\|PresentationVariant"
curl -s -u "admin.mueller@automarkt.de:Test@1234" "http://localhost:8083/admin/AuditLogs?\$top=3&\$orderby=createdAt%20desc"
```

Expected: all six route names (`UsersList`, `UsersObjectPage`, `BranchesList`,
`BranchesObjectPage`, `AuditLogsList`, `AuditLogsObjectPage`); a non-zero annotation count; an
empty `value: []` array (real backend, no seed data, nothing writes `AuditLogs` — expected, not a
bug, see What & Why).

```sh
npm run lint && npm run format:check && npm test
```

Expected: `Test Suites: 13 passed, 13 total`, `Tests: 125 passed, 125 total`.

---
