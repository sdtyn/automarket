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
| EPIC19-T3 | Operator vehicle management UI | Open |
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
