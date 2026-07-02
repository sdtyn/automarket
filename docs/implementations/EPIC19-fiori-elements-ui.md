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
| EPIC19-T2 | Vehicle list & detail annotations | Open |
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
