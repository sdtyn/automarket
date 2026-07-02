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
| EPIC19-T4 | Customer catalog UI | Open |
| EPIC19-T5 | Admin UI — Users & Branches | Open |
| EPIC19-T6 | Admin UI — Audit log viewer | Open |

### Sprint Backlog DoD Mapping

| DoD Item | Satisfied by |
|----------|-------------|
| `cds watch` → browser → Fiori launchpad shows tiles for Operator Portal, Customer Catalog, and Admin | EPIC19-T1 (launchpad), T2–T6 (tiles) |
| All list/detail screens load without errors | Per ticket |
| Create/edit flows work for vehicles | EPIC19-T3 |

### Sign-off

_To be filled in at sprint end._

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
