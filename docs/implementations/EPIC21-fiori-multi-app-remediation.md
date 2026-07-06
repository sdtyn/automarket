# EPIC21 — Fiori Elements Multi-App Remediation

**Goal:** Fix a defect discovered via real-browser (Playwright) testing during EPIC20 sign-off,
documented in `docs/cap-notes.md` #12: `sap.fe.templates` does not support hosting multiple
unrelated List Report/Object Page pairs in one `sap.fe.core.AppComponent` the way EPIC19-T5/T6 and
EPIC20-T1 through T6 assumed ("manually merge the Nth entity into an existing app via extra
`manifest.json` routes"). Every entity beyond an app's original root (`Vehicles` in
`app/operator-portal`/`app/customer-portal`, `Users` in `app/admin-portal`) crashes to a full-page
"Sorry, we can't find this page" error the instant its route is opened — confirmed for
`ReservationsList`/`TestDrivesList`/`OffersList` (operator), `PaymentsList` (admin), `OrdersList`
(customer), and expected identically for `BranchesList`/`AuditLogsList` (admin, EPIC19-T5/T6) and
every remaining customer-portal entity by the same construction. An attempted
`sap.fe.core.rootView.Fcl` fix stops the crash but breaks the List Report's search/"Go" action for
every non-root entity instead — not a real fix; it was reverted, not shipped. The only pattern
proven to work end to end is one entity's List Report as the sole root of its own app. This epic
splits every affected entity into its own dedicated Fiori Elements application (T1–T3), gives every
role a way to reach all of theirs again (T5), and separately investigates the native "Create"
toolbar button (EPIC20-T4's core deliverable) never appearing on `Vehicles` despite the `CREATE`
grant (T4) — the root cause turned out to be less understood than initially assumed; see T4's
section below. The backend (CDS bound actions, JS handlers, `@UI` annotations) built in EPIC19-T5/T6
and EPIC20-T1–T6 is correct and unaffected — T1, T2, T3, and T5 are UI-hosting-structure only, no
backend/CDS changes.

Root-cause trace, the rejected FCL attempt, and verification commands: `docs/cap-notes.md` #12.

---

## Sprint Overview

### Ticket Table

| Ticket | Description | Status |
|--------|-------------|--------|
| EPIC21-T1 | Operator Portal — split into separate apps | Done |
| EPIC21-T2 | Admin Portal — split into separate apps | Done |
| EPIC21-T3 | Customer Portal — split into separate apps | Done |
| EPIC21-T4 | Native Create button fix | Open |
| EPIC21-T5 | Per-role navigation | Done |

### Sprint Backlog DoD Mapping

| DoD Item | Satisfied by |
|----------|-------------|
| Every EPIC19-T5/T6 and EPIC20-T1–T6 List Report/Object Page is reachable and functional (real data on "Go", buttons work) in a real browser | EPIC21-T1, T2, T3 |
| Native "Create" button visible and functional on `Vehicles` | EPIC21-T4 |
| Every role can actually reach all of their apps, not just the one at each app's root hash | EPIC21-T5 |
| Verified with Playwright/`chromium-cli` against a live backend + live `ui5 serve`, not just backend curl + `$metadata` grep | Per ticket |

### Sign-off

_To be filled in at sprint end (T4 still open)._

---

## EPIC21-T1/T2/T3: Split Every Affected Entity Into Its Own Fiori App

### What & Why

Every entity that was "manually merged into an existing app" in EPIC19-T5/T6 or EPIC20-T1–T6 gets
pulled out into its own dedicated Fiori Elements application, mirroring the one proven-working
shape: a single `sap.fe.templates.ListReport` as the app's root (empty-hash) route, with its
`sap.fe.templates.ObjectPage` as the only other route. No backend change — every new app points at
the *same* CDS service (`OperatorPortalService` / `AdminService` / `CustomerPortalService`) the
entity already lived in, so the existing `@UI` annotations, `@restrict` grants, and bound actions
from EPIC19/EPIC20 are reused as-is.

11 new apps, all built from one mechanical template (only `entitySet`, `svcPath` (`/operator`,
`/admin`, or `/catalog`), `svcName`, component id, title/description, and dev port differ):

| App folder | Entity | Service | Port | Ticket |
|---|---|---|---|---|
| `app/operator-reservations` | `Reservations` | `/operator` (`OperatorPortalService`) | 8090 | T1 |
| `app/operator-testdrives` | `TestDrives` | `/operator` | 8091 | T1 |
| `app/operator-offers` | `Offers` | `/operator` | 8092 | T1 |
| `app/admin-branches` | `Branches` | `/admin` (`AdminService`) | 8093 | T2 |
| `app/admin-auditlogs` | `AuditLogs` | `/admin` | 8094 | T2 |
| `app/admin-payments` | `Payments` | `/admin` | 8095 | T2 |
| `app/customer-reservations` | `Reservations` | `/catalog` (`CustomerPortalService`) | 8096 | T3 |
| `app/customer-offers` | `Offers` | `/catalog` | 8097 | T3 |
| `app/customer-testdrives` | `TestDrives` | `/catalog` | 8098 | T3 |
| `app/customer-orders` | `Orders` | `/catalog` | 8099 | T3 |
| `app/customer-payments` | `Payments` | `/catalog` | 8100 | T3 |

`app/operator-portal`, `app/admin-portal`, and `app/customer-portal` keep only their original root
entity (`Vehicles`, `Users`, `Vehicles` respectively) — the now-redundant (and broken, per
`docs/cap-notes.md` #12) routes/targets for the extracted entities were deleted from each app's
`manifest.json`.

### Step-by-step instructions

#### 1. Scaffold each new app

Each app gets the same nine files, one dev-server `node_modules` copy (identical `package.json`
deps across all apps in this repo, so `cp -r app/operator-portal/node_modules app/<new>/node_modules`
instead of a fresh `npm install`):

- `package.json` — `name`/`description` = app folder/title; scripts identical to every other app
  in this repo (`fiori run`, `ui5 build`, etc.)
- `ui5.yaml` / `ui5-mock.yaml` — `metadata.name` = component id; `backend.path` = the service path
  (`/operator`, `/admin`, or `/catalog`); `fiori-tools-appreload` port unique per app (35730–35740,
  avoiding collision with the three original apps' shared 35729) so multiple apps can run
  simultaneously during verification
- `webapp/Component.js` — `sap.fe.core.AppComponent` extension, component id only
- `webapp/index.html` — same `ComponentSupport` bootstrap shape as every existing app, component id
  swapped in
- `webapp/i18n/i18n.properties` — `appTitle`/`appDescription` only
- `webapp/annotations/annotation.xml` — same vocabulary references as every existing app; the
  `<edmx:Reference Uri="...">` and `Namespace` point at the entity's own service
- `webapp/manifest.json` — single List Report + Object Page route/target pair (see
  `app/operator-reservations/webapp/manifest.json` for the full, representative example — every
  other app is identical in shape, differing only in `entitySet`, ids, and `mainService.uri`)
- `webapp/test/flpSandbox.html` — one tile, `SAPUI5.Component` = the app's own component id
- `webapp/localService/mainService/metadata.xml` — fetched from the live backend once `cds-serve`
  is running: `curl -s http://localhost:4004/<svcPath>/\$metadata -o webapp/localService/mainService/metadata.xml`

#### 2. Clean up the three original apps

In `app/operator-portal/webapp/manifest.json`, `app/admin-portal/webapp/manifest.json`, and
`app/customer-portal/webapp/manifest.json`: delete every route/target pair except the app's
original root entity (`Vehicles`/`Users`/`Vehicles`). No other changes — the root entity's own
config is untouched.

### Verify

```sh
node_modules/.bin/cds-serve   # NOT cds watch
# one ui5 serve per app, unique ports (see table above), e.g.:
(cd app/operator-reservations && node_modules/.bin/ui5 serve --port 8090)
```

Create test data through the existing customer-facing actions (`reserve`, `requestTestDrive`,
`submitOffer`, `checkout` + `pay`), then drive each new app with Playwright: navigate to
`http://localhost:<port>/index.html`, click "Go", confirm real rows load, click a row, confirm the
Object Page renders with its `@UI.DataFieldForAction` buttons from EPIC19/EPIC20 actually visible.

**Verified end to end**, all 11 apps, no crash on any of them (the EPIC19/EPIC20-era "Sorry, we
can't find this page" defect is gone because each entity is now the sole root of its own
`sap.fe.core.AppComponent`): real data loaded and a real row opened an Object Page with working
buttons for `operator-reservations` (**Approve Reservation**, **Reject Reservation** — clicking
Approve through the real confirmation dialog flipped status `REQUESTED` → `APPROVED`, confirmed via
`operator/$batch` network trace), `operator-testdrives` (**Approve/Cancel/Complete Test Drive**),
`admin-branches` (**Disable Branch**), `admin-payments` (**Capture/Fail/Refund Payment**),
`customer-reservations` (**Cancel Reservation**), `customer-offers` (**Resubmit Offer**),
`customer-testdrives` (**Cancel Test Drive**), `customer-orders` (**Pay Now/Retry Payment/Cancel
Order**). `operator-offers` and `admin-auditlogs` loaded correctly with zero rows — confirmed
against the backend directly (not a UI defect): the test offer's branch didn't match the querying
Manager's branch (branch-scoped `@restrict` working as designed), and no audit-log-triggering event
had fired yet in this session, respectively.

```sh
npm run lint && npm run format:check && npm test
```

---

## EPIC21-T5: Per-Role Navigation

### What & Why

Once T1–T3 split every entity into its own app on its own port, a role that used to have "many
tiles inside one Launchpad" (per EPIC19/EPIC20's `flpSandbox.html` tiles) needed those tiles
repointed at the new, separate apps instead of dead in-app hash routes. `app/operator-portal`,
`app/admin-portal`, and `app/customer-portal`'s `test/flpSandbox.html` already had one Launchpad
tile per (now-extracted) entity from EPIC19/EPIC20 — only the `url`/`SAPUI5.Component` values needed
to change, from `../#<Entity>List` (a dead in-app hash) to the new app's own absolute dev URL
(`http://localhost:<port>/`).

**Local-dev-only caveat, called out here so it isn't mistaken for the final architecture:** pointing
tiles at `http://localhost:<port>/` only works because every app currently runs as its own
`ui5 serve` process on its own port. In a real deployment (EPIC22's Approuter/XSUAA territory,
`sample.env` per EPIC22-T6), these would be reverse-proxied under one origin with distinct *paths*
instead of distinct *ports*, and the tile URLs would change accordingly — not a concern for this
epic.

### Step-by-step instructions

In each of the three original apps' `webapp/test/flpSandbox.html`, for every tile besides the app's
own (self-)tile: change `additionalInformation: "SAPUI5.Component=automarket.<oldapp>"` to the new
app's component id, and `url: "../#<Entity>List"` to `url: "http://localhost:<port>/"` (see the
port table in T1/T2/T3 above).

### Verify

```sh
node_modules/.bin/cds-serve
(cd app/operator-portal && node_modules/.bin/ui5 serve --port 8080)
(cd app/operator-reservations && node_modules/.bin/ui5 serve --port 8090)
```

Open `http://localhost:8080/test/flpSandbox.html`, click the "Reservations" tile.

**Verified end to end**: the tile click loaded `operator-reservations` (title "Reservation
Approvals" in the shell header, real Reservations columns) inside the Launchpad shell frame, cross-
port, no crash — a user logged into one role's Launchpad can now actually reach every app that role
owns, not just the one at the root hash.

```sh
npm run lint && npm run format:check && npm test
```

---

## EPIC21-T4: Native Create Button Fix — Investigated, Not Resolved

### What & Why

EPIC20-T4's goal was a native Fiori Elements "Create" toolbar button on `OperatorPortalService.Vehicles`,
which already has an unconditional `CREATE` grant (`@restrict`) and works via direct `POST` (curl-
verified in EPIC20-T4). The button never renders — confirmed via DOM inspection, not just a visual
check: there is a `...LineItem::StandardAction::Delete` button element but no `StandardAction::Create`
equivalent at all.

### What was tried

Added `@Capabilities.InsertRestrictions.Insertable: true` to `Vehicles` in
`modules/vehicle/api/operator-portal.cds`, on the theory (from initial research) that CAP doesn't
auto-emit the OData Capabilities vocabulary annotation Fiori Elements needs to decide whether to
show Create, even though the entity is genuinely insertable via `@restrict`. Verified the annotation
*does* reach the served `$metadata` correctly and unambiguously (one `Capabilities.InsertRestrictions`
record, `Insertable: true`, no conflicting second annotation) — confirmed via `cds-serve` directly
*and* through the `ui5 serve` proxy. The Create button still does not appear. The local metadata
snapshot was refreshed to rule out a stale-cache false negative; no change.

Further research turned up contradictory claims: some sources say CAP + Fiori Elements V4 requires
`@odata.draft.enabled` (draft mode) for any native Create/Update UX on a non-draft entity; official
CAP documentation says non-draft Create should work out of the box with a plain `@restrict` grant,
no special annotation needed. Neither matches what's observed here. The actual root cause was not
identified in this session.

**Left as-is:** the `@Capabilities.InsertRestrictions.Insertable: true` annotation stays in
`operator-portal.cds` — it's accurate (Vehicles genuinely is insertable) and harmless even though it
didn't solve the button-visibility problem, and it's useful metadata for any other OData client.
Native `POST /operator/Vehicles` continues to work exactly as it did after EPIC20-T4 (verified via
`tests/http/vehicle.http`); only the *native toolbar button* is unresolved. Enabling full CAP draft
mode on `Vehicles` was considered but not attempted — it would touch the entity's key/identity
semantics and every existing read/write handler that assumes a non-draft `Vehicles`, a materially
bigger and riskier change than this ticket's scope, and was explicitly deferred to the user rather
than attempted blind.

---
