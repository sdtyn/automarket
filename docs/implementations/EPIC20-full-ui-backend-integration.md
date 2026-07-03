# EPIC20 — Full UI & Backend Integration

**Goal:** EPIC19 only wired browse/view screens (Vehicles, Users, Branches, AuditLogs) — every
actual business workflow (reserve, offer, test-drive, checkout, pay, approve, admin actions) is
still API-only, because almost every write operation in this system is an *unbound* OData action
(service-level, not bound to an entity type), and `@UI.DataFieldForAction` — Fiori Elements' native
toolbar-button mechanism — only targets actions bound to an entity type. This epic converts the
~20 unbound actions that matter for a real end-to-end demo into bound actions (backend) and wires
each one onto the relevant List Report/Object Page as a native button (UI), ticket by ticket,
verified with the same rigor as EPIC19 (live backend + live `ui5 serve`, not just annotations read
for plausibility). Backend and UI land together in every ticket — no ticket is "just the refactor"
or "just the button."

---

## Sprint Overview

### Ticket Table

| Ticket | Description | Status |
|--------|-------------|--------|
| EPIC20-T1 | Customer — Reservations & Favorites | Done |
| EPIC20-T2 | Customer — Offers & Test Drives | Done |
| EPIC20-T3 | Customer — Checkout & Payment | Open |
| EPIC20-T4 | Operator — Vehicle & approval workflows | Open |
| EPIC20-T5 | Manager & Admin — Offer approval and PSP simulation | Open |
| EPIC20-T6 | Admin — User & Branch management actions | Open |

### Sprint Backlog DoD Mapping

| DoD Item | Satisfied by |
|----------|-------------|
| Customer: browse → reserve or offer → checkout → pay is clickable end to end, no `.http` file needed | EPIC20-T1, T2, T3 |
| Operator can approve/reject a reservation/test drive from the UI | EPIC20-T4 |
| Manager can approve/reject an offer from the UI | EPIC20-T5 |
| Admin can disable a user, assign a role, and disable a branch from the UI | EPIC20-T6 |
| Every button verified against a live backend + live `ui5 serve` (proxy, auth, metadata, real data) | Per ticket |

### Sign-off

_To be filled in at sprint end._

---

## EPIC20-T1: Customer — Reservations & Favorites

### What & Why

`ReservationService.createReservation`/`cancelReservation` and `FavoritesService.addFavorite`/
`removeFavorite` stay exactly as they were (unbound, still used by guests and any non-UI API
consumer) — this ticket does **not** touch them. Instead, `CustomerPortalService` (the service
`app/customer-portal` is built against) gets its own **new bound actions**: `reserve`,
`addToFavorites`, `removeFromFavorites` on `Vehicles`, and `cancel` on a new `Reservations`
projection. Each handler in `customer-portal.js` delegates to the real domain service via
`cds.connect.to(...).send(...)` rather than reimplementing validation or state-machine logic —
this mirrors the existing wrapper pattern already used by `OperatorPortalService.approveReservation`
(EPIC03), just via `.send()` instead of reimplementing-then-emitting.

Why a *new* service-level action instead of somehow reusing `ReservationService`'s unbound one
directly: Fiori Elements binds all actions/buttons within **one service's** OData metadata
document. A bound action must be declared inside the same service whose entity type it targets —
there's no way to make a foreign service's action appear as a button on `CustomerPortalService.Vehicles`'s
Object Page without declaring it there.

**Two real bugs found and fixed while verifying, not guessed at:**

1. **`req.params` for a bound action is an array of key objects, not scalars** — `req.params[0]`
   for `Vehicles(ID)/reserve` is `{ ID: '...' }`, not the raw UUID string. Passing it straight
   through to `ReservationService.createReservation`'s `vehicleId: String` parameter threw
   `ASSERT_DATA_TYPE`. Fixed by destructuring `const [{ ID: vehicleId }] = req.params`.
2. **`@restrict` is a grant whitelist — bound actions need their own grant entry.** `Reservations`'
   `@restrict` only listed `grant: 'READ'`. The `cancel` action has its own `@requires: 'Customer'`,
   but that alone wasn't enough — every call (even as Admin) returned `403`, because CAP's
   `@restrict` denies any operation not explicitly granted, and `cancel` wasn't in the list. Fixed
   by adding a second grant entry for `cancel` with the same `customer_ID = $user` predicate as
   `READ`.

**A third finding, environmental rather than a code bug:** `cds watch` silently drops
`UI.Identification` from the served `$metadata` (button annotations never appeared, no error) —
`cds compile --to edmx` and `cds-serve` (the production binary `npm start` runs) both produce it
correctly. Logged in `docs/cap-notes.md` §10. All EPIC20 verification from this point on uses
`cds-serve`, not `cds watch`, whenever `UI.Identification` is involved.

**Verified end to end**, against `cds-serve` (not `cds watch` — see above) + a live `ui5 serve`
instance: reserve → vehicle becomes `RESERVED` with the correct `customer_ID` and no `guestToken`
→ cancel → vehicle back to `FOR_SALE`, reservation `CANCELLED`; a double-reservation attempt
propagates the real `409` from `ReservationService` (not a generic `500`); a customer cannot see
or cancel another customer's reservation (`403`, both at the list-filter and action-grant layers);
`addToFavorites`/`removeFromFavorites` round-trip through the real `Favorites` table. The UI5 dev
server's proxy serves the updated `manifest.json` (four routes: `VehiclesList`, `VehiclesObjectPage`,
`ReservationsList`, `ReservationsObjectPage`) and the live `$metadata` with `UI.Identification`
intact, and a `reserve` call through the proxy succeeds. Same caveat as every EPIC19/EPIC20
ticket: pixel-level button rendering was not, and cannot be, visually confirmed in this
environment.

### Step-by-step

#### 1. Modify `modules/vehicle/api/customer-portal.cds`

Add bound actions to the `Vehicles` projection (`actions { ... }` block after the element list),
and a new customer-scoped `Reservations` projection with its own bound `cancel` action:

```cds
    @requires: 'any'
    entity Vehicles      as
        projection on automarket.Vehicles {
            *,
            virtual null as primaryImageUrl : String
        }
        actions {
            // reserve/addToFavorites/removeFromFavorites (EPIC20-T1) are bound
            // to Vehicles so Fiori Elements can wire them onto the Object Page
            // via @UI.DataFieldForAction (see customer-portal-ui.cds) — unlike
            // the unbound actions this same UI need hit a wall on in EPIC19-T3.
            // Handlers delegate to ReservationService/FavoritesService (below)
            // rather than reimplementing their validation/state-machine logic.
            @requires: 'Customer'
            action reserve(notes : String)  returns {
                reservationId : String
            };

            @requires: 'Customer'
            action addToFavorites()         returns String;

            @requires: 'Customer'
            action removeFromFavorites()    returns Boolean;
        };

    // VehicleImages is needed for the detail page image gallery.
    @requires: 'any'
    entity VehicleImages as projection on automarket.VehicleImages;

    // Reservations (EPIC20-T1): customer-scoped "My Reservations" view, so a
    // logged-in customer can see and cancel their own reservations without
    // leaving the catalog app. Same row-level restriction as ReservationService
    // itself — this is a second, UI-facing exposure of the same underlying
    // entity, not a relaxation of who can see what.
    // @restrict is a grant whitelist — unlike Vehicles' scalar @requires:'any',
    // any operation not explicitly listed here is denied by default, including
    // bound actions. cancel needs its own grant entry (same ownership
    // predicate as READ) or every caller gets 403 regardless of the action's
    // own @requires — verified directly: without this grant, cancel returned
    // 403 even for Admin.
    @restrict: [
        {
            grant: 'READ',
            to   : 'Customer',
            where: 'customer_ID = $user'
        },
        {
            grant: 'cancel',
            to   : 'Customer',
            where: 'customer_ID = $user'
        }
    ]
    entity Reservations  as
        projection on automarket.Reservations
        actions {
            @requires: 'Customer'
            action cancel() returns Boolean;
        };
```

#### 2. Modify `modules/vehicle/application/customer-portal.js`

Add the four bound-action handlers, after the existing `getPriceHistory` handler:

```js
  // reserve/addToFavorites/removeFromFavorites (EPIC20-T1) are bound actions
  // on Vehicles so Fiori Elements can wire them onto the Object Page as native
  // buttons (@UI.DataFieldForAction only targets bound actions — see
  // customer-portal-ui.cds). Each delegates to the real domain service via
  // cds.connect.to(...).send(...) instead of reimplementing validation/state
  // logic — req.user propagates to the delegated call automatically because
  // it runs inside the same request context.

  // req.params for a bound action is an array of key objects (e.g. [{ ID: '...' }]),
  // not raw scalar values — verified directly against a live request.
  srv.on('reserve', 'Vehicles', async (req) => {
    const [{ ID: vehicleId }] = req.params;
    const { notes } = req.data;
    const resSrv = await cds.connect.to('ReservationService');
    const { reservationId } = await resSrv.send('createReservation', { vehicleId, notes });
    return { reservationId };
  });

  srv.on('addToFavorites', 'Vehicles', async (req) => {
    const [{ ID: vehicleId }] = req.params;
    const favSrv = await cds.connect.to('FavoritesService');
    return favSrv.send('addFavorite', { vehicleId });
  });

  srv.on('removeFromFavorites', 'Vehicles', async (req) => {
    const [{ ID: vehicleId }] = req.params;
    const favSrv = await cds.connect.to('FavoritesService');
    return favSrv.send('removeFavorite', { vehicleId });
  });

  // cancel (EPIC20-T1): bound to Reservations so a customer can cancel their
  // own reservation from the "My Reservations" Object Page. Delegates to
  // ReservationService.cancelReservation, which already enforces ownership.
  srv.on('cancel', 'Reservations', async (req) => {
    const [{ ID: reservationId }] = req.params;
    const resSrv = await cds.connect.to('ReservationService');
    return resSrv.send('cancelReservation', { reservationId });
  });
```

#### 3. Modify `modules/vehicle/api/customer-portal-ui.cds`

Add `UI.Identification` (header buttons) to the existing `Vehicles` annotate block, and a new
`annotate CustomerPortalService.Reservations with @(...)` block. See the file for full content —
key additions:

```cds
    UI.Identification          : [
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.reserve',
            Label : 'Reserve This Vehicle'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.addToFavorites',
            Label : 'Add to Favorites'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.removeFromFavorites',
            Label : 'Remove from Favorites'
        }
    ]
```

```cds
annotate CustomerPortalService.Reservations with @(
    UI.LineItem                       : [
        {Value: vehicle_ID, Label: 'Vehicle'},
        {Value: status},
        {Value: expiresAt},
        {Value: createdAt, Label: 'Requested'}
    ],
    UI.FieldGroup #ReservationDetails : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {Value: vehicle_ID, Label: 'Vehicle'},
            {Value: status},
            {Value: expiresAt},
            {Value: notes},
            {Value: createdAt, Label: 'Requested'}
        ]
    },
    UI.Facets                         : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Reservation Details',
            Target: '@UI.FieldGroup#ReservationDetails'
        }
    ],
    UI.Identification                 : [
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.cancel',
            Label : 'Cancel Reservation'
        }
    ]
);
```

#### 4. Create `tests/unit/services/customer-portal-actions.test.js`

Five tests: `reserve` happy path (ownership, `guestToken: null`, `notes` passed through, vehicle
→ `RESERVED`); `reserve` 409 propagation on double-reservation; `cancel` happy path (vehicle →
`FOR_SALE`, reservation → `CANCELLED`); `cancel` ownership (403 + hidden from another customer's
list); `addToFavorites`/`removeFromFavorites` round trip.

#### 5. Extend `app/customer-portal/webapp/manifest.json` by hand

Same manual-merge approach as EPIC19-T5/T6 — add a second route pair (prefixed
`ReservationsList/...`) and target pair for `Reservations`, entitySet `"Reservations"`, same
shape as `Vehicles`.

#### 6. Extend `app/customer-portal/webapp/test/flpSandbox.html`

Add a second tile:

```js
"automarketcustomerportalreservations-tile": {
    title: "My Reservations",
    description: "View and cancel your reservations",
    additionalInformation: "SAPUI5.Component=automarket.customerportal",
    applicationType: "URL",
    url: "../#ReservationsList"
}
```

#### 7. Refresh the local metadata snapshot

```sh
node_modules/.bin/cds-serve &   # NOT cds watch — see docs/cap-notes.md §10
curl -s http://localhost:4004/catalog/\$metadata -o app/customer-portal/webapp/localService/mainService/metadata.xml
```

#### 8. Verify

```sh
node_modules/.bin/cds-serve                                  # backend, port 4004 — NOT cds watch
(cd app/customer-portal && node_modules/.bin/ui5 serve --port 8084)
```

```sh
curl -s http://localhost:8084/manifest.json | python3 -c "import json,sys; print([r['name'] for r in json.load(sys.stdin)['sap.ui5']['routing']['routes']])"
curl -s http://localhost:8084/catalog/\$metadata | grep -c "UI.Identification"
curl -s -u "customer.bauer@automarkt.de:Test@1234" -X POST "http://localhost:8084/catalog/Vehicles(<id>)/reserve" -H "Content-Type: application/json" -d '{"notes":"test"}'
```

Expected: all four route names; `UI.Identification` count `2`; a real `reservationId` back.

```sh
npm run lint && npm run format:check && npm test
```

Expected: `Test Suites: 14 passed, 14 total`, `Tests: 130 passed, 130 total`.

---

## EPIC20-T2: Customer — Offers & Test Drives

### What & Why

Same pattern as EPIC20-T1: new bound actions on `CustomerPortalService.Vehicles`
(`submitOffer`, `requestTestDrive`) plus two new customer-scoped projections (`Offers` with a
bound `resubmit`, `TestDrives` with a bound `cancel`), each handler delegating to
`OfferService`/`TestDriveService` via `cds.connect.to(...).send(...)`. `OfferService.submitOffer`
and `TestDriveService.requestTestDrive`/`cancelTestDrive` (the underlying unbound actions) are
untouched — same reasoning as T1: guests and non-UI API consumers keep using them directly.

**One UX simplification made deliberately, not just mechanically wired through:**
`requestTestDrive` requires a `branchId` parameter at the `TestDriveService` level, but a
customer looking at one specific vehicle has no reason to know or supply a branch ID — it's an
implementation detail. The bound action on `Vehicles` omits `branchId` from its own signature
entirely; the handler reads it from the bound vehicle's own `branch_ID` before delegating. This
mirrors how `OfferService.submitOffer` already derives branch server-side (confirmed by reading
its handler before writing the delegate — no need to replicate that logic, it already does the
right thing).

**Two same-named bound actions, resolved as OData overloads, verified not just assumed:**
`cancel` is bound to both `Reservations` (T1) and `TestDrives` (this ticket); `Action:
'CustomerPortalService.cancel'` appears in two different `UI.Identification` blocks, one per
entity. Checked the actual served `$metadata`: two separate `<Action Name="cancel"
IsBound="true">` elements, each with a different `<Parameter Name="in"
Type="...Reservations"/>` vs `Type="...TestDrives"/>` — a standard, correctly-resolved OData V4
action overload, not a naming collision.

**Verified end to end** against `cds-serve` (per the `cds watch` / `UI.Identification` quirk
found in T1 — `docs/cap-notes.md` §10) + a live `ui5 serve` instance: `submitOffer` creates an
offer with the vehicle's own `branch_ID` (not client-supplied); `resubmit` 409s on a
non-`REJECTED` offer and succeeds once rejected; `requestTestDrive` auto-derives the correct
`branch_ID`; the `cancel` overload on `TestDrives` behaves independently of the one on
`Reservations`. `app/customer-portal`'s `manifest.json` now routes all four entities
(`VehiclesList/ObjectPage`, `ReservationsList/ObjectPage`, `OffersList/ObjectPage`,
`TestDrivesList/ObjectPage`), each with its own FLP tile. Same caveat as every ticket so far:
pixel-level rendering not verified, only data/metadata/routing/auth.

### Step-by-step

#### 1. Modify `modules/vehicle/api/customer-portal.cds`

Add `submitOffer`/`requestTestDrive` to the `Vehicles` `actions {}` block (after
`removeFromFavorites`), and two new customer-scoped projections with their own bound actions —
see the file for full content. Key shape:

```cds
            @requires: 'Customer'
            action submitOffer(offeredPrice : Decimal,
                               currency : String,
                               desiredPickupDate : Date,
                               notes : String)   returns String;

            @requires: 'Customer'
            action requestTestDrive(scheduledAt : Timestamp,
                                    notes : String) returns String;
```

```cds
    @restrict: [
        { grant: 'READ', to: 'Customer', where: 'customer_ID = $user' },
        { grant: 'resubmit', to: 'Customer', where: 'customer_ID = $user' }
    ]
    entity Offers as projection on automarket.Offers actions {
        @requires: 'Customer'
        action resubmit(offeredPrice : Decimal, desiredPickupDate : Date) returns Boolean;
    };

    @restrict: [
        { grant: 'READ', to: 'Customer', where: 'customer_ID = $user' },
        { grant: 'cancel', to: 'Customer', where: 'customer_ID = $user' }
    ]
    entity TestDrives as projection on automarket.TestDrives actions {
        @requires: 'Customer'
        action cancel() returns Boolean;
    };
```

#### 2. Modify `modules/vehicle/application/customer-portal.js`

Add four handlers after the T1 ones:

```js
  srv.on('submitOffer', 'Vehicles', async (req) => {
    const [{ ID: vehicleId }] = req.params;
    const { offeredPrice, currency, desiredPickupDate, notes } = req.data;
    const offerSrv = await cds.connect.to('OfferService');
    return offerSrv.send('submitOffer', { vehicleId, offeredPrice, currency, desiredPickupDate, notes });
  });

  // requestTestDrive needs branchId, which TestDriveService.requestTestDrive
  // takes as a plain parameter (unlike submitOffer, which derives branch_ID
  // from the vehicle row itself internally). Read it here from the bound
  // vehicle so the customer never has to type a branch ID they have no
  // reason to know.
  srv.on('requestTestDrive', 'Vehicles', async (req) => {
    const [{ ID: vehicleId }] = req.params;
    const { scheduledAt, notes } = req.data;
    const { Vehicles } = cds.entities('automarket');
    const vehicle = await SELECT.one.from(Vehicles).columns('branch_ID').where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');

    const tdSrv = await cds.connect.to('TestDriveService');
    return tdSrv.send('requestTestDrive', { vehicleId, branchId: vehicle.branch_ID, scheduledAt, notes });
  });

  srv.on('resubmit', 'Offers', async (req) => {
    const [{ ID: offerId }] = req.params;
    const { offeredPrice, desiredPickupDate } = req.data;
    const offerSrv = await cds.connect.to('OfferService');
    return offerSrv.send('resubmitOffer', { offerId, offeredPrice, desiredPickupDate });
  });

  srv.on('cancel', 'TestDrives', async (req) => {
    const [{ ID: testDriveId }] = req.params;
    const tdSrv = await cds.connect.to('TestDriveService');
    return tdSrv.send('cancelTestDrive', { testDriveId });
  });
```

#### 3. Modify `modules/vehicle/api/customer-portal-ui.cds`

Add two `UI.DataFieldForAction` entries (`submitOffer`, `requestTestDrive`) to the existing
`Vehicles` `UI.Identification` array, and two new `annotate` blocks for `Offers`/`TestDrives`
(`UI.LineItem`, `UI.FieldGroup`, `UI.Facets`, `UI.Identification` with `resubmit`/`cancel`
respectively) — see the file for full content.

#### 4. Extend `tests/unit/services/customer-portal-actions.test.js`

Four new tests in the same file: `submitOffer` derives `branch_ID` from the vehicle, not a
caller-supplied value; `resubmit` 409s while `SUBMITTED`, succeeds once `REJECTED`;
`requestTestDrive` auto-derives `branch_ID`; the `TestDrives`-bound `cancel` behaves as an
independent overload from the `Reservations`-bound one.

#### 5. Extend `app/customer-portal/webapp/manifest.json` by hand

Same manual-merge approach as EPIC19-T5/T6 and EPIC20-T1 — two more route pairs + target pairs
(`OffersList/...`, `TestDrivesList/...`), entitySets `"Offers"`/`"TestDrives"`.

#### 6. Extend `app/customer-portal/webapp/test/flpSandbox.html`

Two more tiles, pointing at `../#OffersList` and `../#TestDrivesList`.

#### 7. Refresh the local metadata snapshot

```sh
node_modules/.bin/cds-serve &   # NOT cds watch
curl -s http://localhost:4004/catalog/\$metadata -o app/customer-portal/webapp/localService/mainService/metadata.xml
```

#### 8. Verify

```sh
node_modules/.bin/cds-serve                                  # backend, port 4004 — NOT cds watch
(cd app/customer-portal && node_modules/.bin/ui5 serve --port 8085)
```

```sh
curl -s http://localhost:8085/manifest.json | python3 -c "import json,sys; print([r['name'] for r in json.load(sys.stdin)['sap.ui5']['routing']['routes']])"
curl -s http://localhost:8085/catalog/\$metadata | grep -c "UI.Identification"
curl -s -u "customer.bauer@automarkt.de:Test@1234" -X POST "http://localhost:8085/catalog/Vehicles(<id>)/submitOffer" -H "Content-Type: application/json" -d '{"offeredPrice":30000,"currency":"EUR","desiredPickupDate":"2026-09-01","notes":"test"}'
```

Expected: eight route names; `UI.Identification` count `4`; a real offer ID back.

```sh
npm run lint && npm run format:check && npm test
```

Expected: `Test Suites: 14 passed, 14 total`, `Tests: 134 passed, 134 total`.

---
