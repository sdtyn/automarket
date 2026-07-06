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
| EPIC20-T3 | Customer — Checkout & Payment | Done |
| EPIC20-T4 | Operator — Vehicle & approval workflows | Done |
| EPIC20-T5 | Manager & Admin — Offer approval and PSP simulation | Done |
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

## EPIC20-T3: Customer — Checkout & Payment

### What & Why

The critical demo path: `checkout` (bound to `Vehicles`, delegates to `SalesService.createOrder`)
lands the customer on a new "My Orders" view (`Orders` + `Payments`, both new customer-scoped
projections in `CustomerPortalService`), with `pay`/`retryPay`/`cancel` bound to `Orders`. Same
delegation pattern as T1/T2 throughout — no business logic reimplemented, just
`cds.connect.to(...).send(...)` calls into `SalesService`/`PaymentService`.

**Every PSP-plumbing parameter is deliberately kept off the customer-facing action signatures —
not because Fiori Elements requires it, but because the customer has no reason to supply them
and doing so would be a real UX/security downgrade:**
- `pay(provider: String)` — that's the *only* parameter. `amount`/`currency` are read server-side
  from the order's own vehicle (`SELECT ... Vehicles WHERE ID = order.vehicle_ID`), not typed
  into a form. Verified directly: `Orders(id)/pay` for a vehicle seeded at `119900.00 EUR`
  produces a `Payment` row with exactly `amount: 119900, currency: 'EUR'` — there was never a
  code path where a client could submit a different number.
- `retryPay()` — no parameters at all. `PaymentService.retryPayment` already copies
  `provider`/`amount`/`currency` from the last `FAILED` payment; the bound action only needs to
  supply `orderId` (from the bound key) and a fresh `idempotencyKey`.
- `idempotencyKey` is never a parameter on either action — generated with `cds.utils.uuid()` in
  the handler. The customer has no reason to manage one, and `PaymentService`'s own "one active
  payment per order" guard is what actually protects against duplicate submission, not the key.

**This ticket is also the first end-to-end proof that EPIC17-T1's fix (`PaymentFailed` no longer
cancels the order — see `docs/error-log.md`) actually delivers what it was fixed for.** The
`retryPay` test does the full cycle for real: `checkout` → `pay` → admin `failPayment` →
`retryPay` → new `INITIATED` payment with the same `provider`, order back to `PENDING_PAYMENT`
(not stuck `CANCELLED`). Before EPIC17-T1, this sequence was structurally impossible.

**Verified end to end** against `cds-serve` (per T1's `cds watch` / `UI.Identification` finding —
`docs/cap-notes.md` §10) + a live `ui5 serve` instance: full `checkout → pay` cycle through the
proxy with a real vehicle price; ownership enforcement (another customer's order is invisible and
un-cancellable, `403`); `cancel` transitions `CREATED` → `CANCELLED`. `app/customer-portal` now
routes six entities (`Vehicles`, `Reservations`, `Offers`, `TestDrives`, `Orders`, `Payments`),
each with its own FLP tile. Same caveat as every ticket: pixel-level rendering not verified.

### Step-by-step

#### 1. Modify `modules/vehicle/api/customer-portal.cds`

Import `Orders`/`Payments` from their owning modules, add `checkout` to the `Vehicles`
`actions {}` block, and add two new customer-scoped projections:

```cds
using {automarket} from '../db/vehicle';
using {automarket.Orders as SalesOrders} from '../../sales/db/sales';
using {automarket.Payments as SalesPayments} from '../../payment/db/payment';
```

```cds
            // checkout (EPIC20-T3): places a purchase order for this vehicle.
            // Delegates to SalesService.createOrder — vehicleId comes from the
            // bound entity, not a parameter. Returns the new orderId so the
            // customer lands on "My Orders" to complete payment.
            @requires: 'Customer'
            action checkout(deliveryType : String) returns String;
```

```cds
    @restrict: [
        { grant: 'READ', to: 'Customer', where: 'customer_ID = $user' },
        { grant: ['cancel', 'pay', 'retryPay'], to: 'Customer', where: 'customer_ID = $user' }
    ]
    entity Orders as
        projection on SalesOrders
        actions {
            @requires: 'Customer'
            action cancel()                returns Boolean;
            @requires: 'Customer'
            action pay(provider : String)  returns String;
            @requires: 'Customer'
            action retryPay()              returns String;
        };

    @restrict: [{
        grant: 'READ',
        to   : 'Customer',
        where: 'order.customer_ID = $user'
    }]
    entity Payments as projection on SalesPayments;
```

#### 2. Modify `modules/vehicle/application/customer-portal.js`

Add four handlers — see the file for full content. `pay`'s key line, reading the price server-side
instead of trusting a client-supplied amount:

```js
  srv.on('pay', 'Orders', async (req) => {
    const [{ ID: orderId }] = req.params;
    const { provider } = req.data;
    const { Orders: OrdersEntity, Vehicles } = cds.entities('automarket');
    const order = await SELECT.one.from(OrdersEntity).columns('vehicle_ID').where({ ID: orderId });
    if (!order) return req.error(404, 'Order not found');
    const vehicle = await SELECT.one.from(Vehicles).columns('price', 'currency').where({ ID: order.vehicle_ID });

    const paymentSrv = await cds.connect.to('PaymentService');
    return paymentSrv.send('initiatePayment', {
      orderId, provider, idempotencyKey: cds.utils.uuid(),
      amount: vehicle.price, currency: vehicle.currency,
    });
  });
```

#### 3. Modify `modules/vehicle/api/customer-portal-ui.cds`

Add a `checkout` `UI.DataFieldForAction` to the existing `Vehicles` `UI.Identification`, and two
new `annotate` blocks for `Orders` (`pay`/`retryPay`/`cancel` buttons) and `Payments` (read-only,
no `UI.Identification`) — see the file for full content.

#### 4. Extend `tests/unit/services/customer-portal-actions.test.js`

Four new tests: `checkout` + `pay` with price auto-derivation asserted against the vehicle's real
seeded price; ownership (403 + hidden from list); `cancel` happy path; `retryPay` full cycle
(`checkout → pay → admin failPayment → retryPay`), proving EPIC17-T1's fix end to end.

#### 5. Extend `app/customer-portal/webapp/manifest.json` by hand

Two more route pairs + target pairs (`OrdersList/...`, `PaymentsList/...`).

#### 6. Extend `app/customer-portal/webapp/test/flpSandbox.html`

Two more tiles, `../#OrdersList` and `../#PaymentsList`.

#### 7. Refresh the local metadata snapshot

```sh
node_modules/.bin/cds-serve &   # NOT cds watch
curl -s http://localhost:4004/catalog/\$metadata -o app/customer-portal/webapp/localService/mainService/metadata.xml
```

#### 8. Verify

```sh
node_modules/.bin/cds-serve                                  # backend, port 4004 — NOT cds watch
(cd app/customer-portal && node_modules/.bin/ui5 serve --port 8086)
```

```sh
curl -s http://localhost:8086/manifest.json | python3 -c "import json,sys; print([r['name'] for r in json.load(sys.stdin)['sap.ui5']['routing']['routes']])"
curl -s http://localhost:8086/catalog/\$metadata | grep -c "UI.Identification"
curl -s -u "customer.bauer@automarkt.de:Test@1234" -X POST "http://localhost:8086/catalog/Vehicles(<id>)/checkout" -H "Content-Type: application/json" -d '{"deliveryType":"CUSTOMER_PICKUP"}'
curl -s -u "customer.bauer@automarkt.de:Test@1234" -X POST "http://localhost:8086/catalog/Orders(<orderId>)/pay" -H "Content-Type: application/json" -d '{"provider":"StripeDE"}'
```

Expected: twelve route names; `UI.Identification` count `5`; a real `orderId`, then a real
`PSP-SESSION-...` back.

```sh
npm run lint && npm run format:check && npm test
```

Expected: `Test Suites: 14 passed, 14 total`, `Tests: 138 passed, 138 total`.

---

## EPIC20-T4: Operator — Vehicle & approval workflows

### What & Why

`OperatorPortalService`'s five unbound actions (`createVehicle`, `approveReservation`,
`rejectReservation`, `approveTestDrive`, `cancelTestDrive`, `completeTestDrive`) are converted the
same way as EPIC20-T1/T2/T3's customer-facing actions: `createVehicle` becomes a native OData
`CREATE` on `Vehicles` (branch/status enforcement moves into a `srv.before('CREATE', ...)` handler
instead of an action body), and `approveReservation`/`rejectReservation`/`approveTestDrive`/
`cancelTestDrive`/`completeTestDrive` become bound actions (`approve`/`reject` on `Reservations`,
`approve`/`cancel`/`complete` on `TestDrives`) so `@UI.DataFieldForAction` can target them.

`ReservationService`/`TestDriveService`'s own unbound actions (`/reservation/approveReservation`,
`/test-drive/approveTestDrive`, etc.) are untouched — same reasoning as EPIC20-T1: those are the
domain services other API consumers (guests, external integrations) still call directly.
`OperatorPortalService`'s handlers keep delegating to them via `.send()`, just reading the bound
key from `req.params` instead of an action parameter.

Two design points carried over from earlier tickets:

1. **`@restrict` needs its own grant entry per bound action**, same as EPIC20-T1's `Reservations.cancel`
   finding — `Reservations`/`TestDrives` each got a new `@restrict` grant entry listing their bound
   action names (`approve`, `reject` / `approve`, `cancel`, `complete`) for `Operator`/`Manager`,
   in addition to the existing branch-scoped `READ` grant.
2. **CREATE needs an unconditional grant** (no `where`), unlike `READ`'s `branch_ID = $user.branchId`
   predicate — the branch/status enforcement that used to live in the `createVehicle` action body
   moves into `srv.before('CREATE', 'Vehicles', ...)`, which overwrites `req.data.branch_ID`/`status`
   unconditionally so a client cannot create directly into `FOR_SALE` or another branch by simply
   including those fields in the create payload (verified below).

`app/operator-portal` only had a `Vehicles` List Report/Object Page (EPIC19-T2/T3) — `Reservations`
and `TestDrives` are new entities in that app, added by hand the same way EPIC19-T5 added
`Branches` to `app/admin-portal`: a second (and third) route pair + target pair in `manifest.json`,
plus a Launchpad tile each in `flpSandbox.html`. No `ui5.yaml`/`ui5-mock.yaml`/`package.json`
changes were needed — both new entities live on the same `OperatorPortalService` already proxied
at `/operator`.

### Step-by-step instructions

#### 1. Modify `modules/vehicle/api/operator-portal.cds`

- Add a `CREATE` grant (`to: ['Operator', 'Manager']`, no `where`) to the existing `Vehicles`
  `@restrict`, and delete the `createVehicle` action declaration.
- Convert `Reservations`/`TestDrives` from plain projections into projections with an `actions { }`
  block declaring `approve`/`reject` (Reservations) and `approve`/`cancel`/`complete` (TestDrives),
  each keeping its original `@requires: ['Operator', 'Manager']`. Add a grant entry for those action
  names to each entity's `@restrict`. Delete the five old unbound action declarations
  (`approveReservation`, `rejectReservation`, `approveTestDrive`, `cancelTestDrive`,
  `completeTestDrive`).

See the file for full content — the diff is mechanical (unbound action → bound `actions {}` block,
one new `@restrict` grant entry per entity).

#### 2. Modify `modules/vehicle/application/operator-portal.js`

Replace `srv.on('createVehicle', ...)` with:

```js
srv.before('CREATE', 'Vehicles', (req) => {
  if (req.user.is('Operator')) {
    req.data.branch_ID = req.user.attr.branchId;
  } else if (!req.data.branch_ID) {
    return req.error(400, 'branch_ID is required for Manager role.');
  }
  req.data.status = 'DRAFT';
});
```

Replace `srv.on('approveReservation', ...)` / `srv.on('rejectReservation', ...)` /
`srv.on('approveTestDrive', ...)` / `srv.on('cancelTestDrive', ...)` / `srv.on('completeTestDrive', ...)`
with `srv.on('approve', 'Reservations', ...)` / `srv.on('reject', 'Reservations', ...)` /
`srv.on('approve', 'TestDrives', ...)` / `srv.on('cancel', 'TestDrives', ...)` /
`srv.on('complete', 'TestDrives', ...)` — same handler bodies, just destructuring the key from
`req.params` (`const [{ ID: reservationId }] = req.params`) instead of `req.data`.

#### 3. Modify `modules/vehicle/api/operator-portal-ui.cds`

Replace the stale EPIC19-T3 "Object Page is view-only" comment on `Vehicles` (creation now goes
through native `CREATE`, no annotation needed for the toolbar button to appear), and add two new
`annotate` blocks — `OperatorPortalService.Reservations` (`UI.LineItem`, `UI.FieldGroup`,
`UI.Facets`, `UI.Identification` with `approve`/`reject`) and `OperatorPortalService.TestDrives`
(same shape, `approve`/`cancel`/`complete`) — same pattern as `customer-portal-ui.cds`'s
`Reservations`/`Offers`/`TestDrives` blocks. See the file for full content.

#### 4. Modify `app/operator-portal/webapp/manifest.json` by hand

Two more route pairs + target pairs, same shape as the existing `Vehicles` entries:

```json
{ "pattern": "ReservationsList:?query:", "name": "ReservationsList", "target": "ReservationsList" },
{ "pattern": "ReservationsList/Reservations({key}):?query:", "name": "ReservationsObjectPage", "target": "ReservationsObjectPage" },
{ "pattern": "TestDrivesList:?query:", "name": "TestDrivesList", "target": "TestDrivesList" },
{ "pattern": "TestDrivesList/TestDrives({key}):?query:", "name": "TestDrivesObjectPage", "target": "TestDrivesObjectPage" }
```

with matching `ReservationsList`/`ReservationsObjectPage`/`TestDrivesList`/`TestDrivesObjectPage`
target entries (`entitySet: "Reservations"` / `"TestDrives"`).

#### 5. Modify `app/operator-portal/webapp/test/flpSandbox.html`

Two more tiles, `../#ReservationsList` and `../#TestDrivesList`.

#### 6. Modify `tests/http/vehicle.http`

`POST /operator/createVehicle` → `POST /operator/Vehicles` (native create), `branchId` field →
`branch_ID`.

#### 7. Refresh the local metadata snapshot

```sh
node_modules/.bin/cds-serve &   # NOT cds watch — see docs/cap-notes.md §10
curl -s http://localhost:4004/operator/\$metadata -o app/operator-portal/webapp/localService/mainService/metadata.xml
```

#### 8. Verify

```sh
node_modules/.bin/cds-serve                                  # backend, port 4004 — NOT cds watch
(cd app/operator-portal && node_modules/.bin/ui5 serve --port 8080)
```

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/index.html
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/test/flpSandbox.html
curl -s http://localhost:8080/operator/\$metadata | grep -c "UI.Identification"

# Operator smuggling another branch + FOR_SALE into a native create — both silently overwritten
curl -s -u "operator.weber@automarkt.de:Test@1234" -X POST http://localhost:4004/operator/Vehicles \
  -H "Content-Type: application/json" \
  -d '{"vin":"...","branch_ID":"<other-branch>","status":"FOR_SALE", ...}'

# Reservation/test-drive approval cycle, created via CustomerPortalService then actioned as Operator
curl -s -u "customer.bauer@automarkt.de:Test@1234" -X POST "http://localhost:4004/catalog/Vehicles(<id>)/reserve" -d '{}'
curl -s -u "operator.weber@automarkt.de:Test@1234" -X POST "http://localhost:4004/operator/Reservations(<id>)/OperatorPortalService.approve" -d '{}'
curl -s -u "operator.weber@automarkt.de:Test@1234" -X POST "http://localhost:4004/operator/TestDrives(<id>)/OperatorPortalService.approve" -d '{"durationMinutes":45}'
curl -s -u "operator.weber@automarkt.de:Test@1234" -X POST "http://localhost:4004/operator/TestDrives(<id>)/OperatorPortalService.complete" -d '{}'
curl -s -u "operator.weber@automarkt.de:Test@1234" -X POST "http://localhost:4004/operator/TestDrives(<id>)/OperatorPortalService.cancel" -d '{}'
curl -s -u "operator.weber@automarkt.de:Test@1234" -X POST "http://localhost:4004/operator/Reservations(<id>)/OperatorPortalService.reject" -d '{"notes":"..."}'
```

**Verified end to end** against `cds-serve` (per T1's `cds watch` / `UI.Identification` finding):
`index.html`/`flpSandbox.html`/proxied `$metadata` all `200`; `UI.Identification` count `2`; a
native create with a smuggled `branch_ID`/`status` came back `DRAFT` in the Operator's own branch;
`approve`/`reject` (Reservations) and `approve`/`complete`/`cancel` (TestDrives) all returned `true`
against reservations/test drives created fresh through `CustomerPortalService`.

```sh
npm run lint && npm run format:check && npm test
```

---

## EPIC20-T5: Manager & Admin — Offer approval and PSP simulation

### What & Why

Two independent halves, wired into two different apps:

1. **Offer approval** (`OperatorPortalService.approveOffer`/`rejectOffer` → bound `Offers.approve`/
   `reject`), the same mechanical conversion as EPIC20-T4's Reservations/TestDrives — the existing
   reimplement-then-emit handler body in `operator-portal.js` is untouched, only the binding and
   parameter source (`req.params` instead of `req.data`) change. Wired as a fourth entity in
   `app/operator-portal`, visible only to Manager/Admin per the existing `@restrict` (Operators have
   no offer authority).

2. **PSP simulation** (`PaymentService.capturePayment`/`failPayment`/`refundPayment`) is a genuinely
   different shape from every conversion so far: these actions already live on `PaymentService`
   directly (not behind a portal wrapper), Admin-only per the system's "AdminService is Admin-only"
   invariant (`admin-service.cds`). Rather than adding bound actions to `PaymentService` itself
   (which would need a brand-new dedicated app), a new `AdminService.Payments` projection with
   `capture`/`fail`/`refund` bound actions was added, wired as a fourth entity into the existing
   `app/admin-portal`.

   **Critical constraint, unlike every other T4/T5 wrapper action**: `AdminService`'s handlers for
   `capture`/`fail`/`refund` must delegate to `PaymentService` via
   `cds.connect.to('PaymentService').send(...)` rather than reimplementing the status update and
   calling `srv.emit(...)` on `AdminService`'s own instance. `SalesService` subscribes with
   `cds.connect.to('PaymentService').on('PaymentSucceeded', ...)` — an event emitted from any other
   service instance never reaches that handler. Reimplementing here (the pattern every other
   wrapper in this codebase uses) would silently break the Order → PAID / Vehicle → SOLD transition
   with no error at all. Verified below by checking the vehicle's status actually flips after a
   `capture` call through `AdminService`, not just that the call returns `true`.

**A real bug found and fixed while verifying, not guessed at:** `manager.schmidt`'s mock user
(`package.json`, `cds.requires.auth.users`) had no `attr.branchId` — unlike `operator.weber`.
`Offers`' `@restrict` branch-scopes Manager's `READ` with `where: 'branch_ID = $user.branchId'`
(unlike Reservations/TestDrives, where Manager's grant has no `where` — Managers see all branches
there). With `attr.branchId` undefined, `GET /operator/Offers` returned empty for Manager and
`approve`/`reject` 403'd unconditionally (`offer.branch_ID !== undefined` is always true) — this
ticket's own DoD item ("Manager can approve/reject an offer from the UI") was undemonstrable. This
predates T5 — the old unbound `approveOffer`/`rejectOffer` had the same `req.user.attr.branchId`
check, but no unit test ever called it and `tests/http/offer.http` calls it with `operatorAuth`
(itself wrong — `OfferService.approveOffer` requires `Manager`/`Admin`, not `Operator`), so it was
never exercised end-to-end. Fixed by adding `attr: { branchId: "aaa...001" }` (München, matching
`operator.weber` and all the seeded test vehicles) to `manager.schmidt` in `package.json`.

### Step-by-step instructions

#### 1. Modify `modules/vehicle/api/operator-portal.cds`

Convert `Offers` from a plain projection into one with an `actions {}` block declaring `approve()`/
`reject(rejectionNotes: String)`, both `@requires: ['Manager', 'Admin']`. Add a grant entry
`{ grant: ['approve', 'reject'], to: ['Manager', 'Admin'] }` to the existing `@restrict`. Delete the
old unbound `approveOffer`/`rejectOffer` action declarations.

#### 2. Modify `modules/vehicle/application/operator-portal.js`

Replace `srv.on('approveOffer', ...)` / `srv.on('rejectOffer', ...)` with `srv.on('approve', 'Offers', ...)`
/ `srv.on('reject', 'Offers', ...)` — same handler bodies (still reimplement-then-emit via
`OfferService.emit(...)`, not `.send()` — this file's established pattern, untouched), just
destructuring `offerId` from `req.params` instead of `req.data`.

#### 3. Modify `modules/vehicle/api/operator-portal-ui.cds`

Add a fourth `annotate` block, `OperatorPortalService.Offers` (`UI.LineItem`, `UI.FieldGroup`,
`UI.Facets`, `UI.Identification` with `approve`/`reject`) — same shape as Reservations/TestDrives.

#### 4. Extend `app/operator-portal/webapp/manifest.json` and `test/flpSandbox.html` by hand

One more route pair + target pair (`OffersList/...`, `entitySet: "Offers"`) and one more Launchpad
tile (`../#OffersList`).

#### 5. Modify `modules/admin/api/admin-service.cds`

Add `using {automarket as pay} from '../../payment/db/payment';`, then a new
`@requires: 'Admin' entity Payments as projection on pay.Payments actions { capture(transactionReference: String); fail(); refund(); }`
(all returning `Boolean`) at the end of the service, after `assignRole`.

#### 6. Modify `modules/admin/application/admin-service.js`

Add three new handlers, `srv.on('capture', 'Payments', ...)` / `srv.on('fail', 'Payments', ...)` /
`srv.on('refund', 'Payments', ...)`, each destructuring `paymentId` from `req.params` and
delegating: `return (await cds.connect.to('PaymentService')).send('capturePayment', { paymentId, transactionReference })`
(and the `fail`/`refund` equivalents). No direct `SELECT`/`UPDATE` on `Payments` here — validation
and state transition stay in `PaymentService`, per the event-subscription constraint above.

#### 7. Modify `modules/admin/api/admin-service-ui.cds`

Add a fourth `annotate` block, `AdminService.Payments` (`UI.LineItem`, `UI.FieldGroup`, `UI.Facets`,
`UI.Identification` with `capture`/`fail`/`refund`) — read-only field layout, no create/edit form
since these are PSP-webhook simulations, not manual data entry.

#### 8. Extend `app/admin-portal/webapp/manifest.json` and `test/flpSandbox.html` by hand

One more route pair + target pair (`PaymentsList/...`, `entitySet: "Payments"`) and one more
Launchpad tile (`../#PaymentsList`).

#### 9. Modify `package.json`

Add `"attr": { "branchId": "aaa00000-0000-0000-0000-000000000001" }` to the `manager.schmidt`
mock user entry under `cds.requires.auth.users` — see the bug finding above.

#### 10. Refresh local metadata snapshots

```sh
node_modules/.bin/cds-serve &   # NOT cds watch
curl -s http://localhost:4004/operator/\$metadata -o app/operator-portal/webapp/localService/mainService/metadata.xml
curl -s http://localhost:4004/admin/\$metadata -o app/admin-portal/webapp/localService/mainService/metadata.xml
```

#### 11. Verify

```sh
node_modules/.bin/cds-serve                                  # backend, port 4004 — NOT cds watch
(cd app/operator-portal && node_modules/.bin/ui5 serve --port 8080)
(cd app/admin-portal && node_modules/.bin/ui5 serve --port 8082)
```

```sh
curl -s http://localhost:8080/manifest.json | python3 -c "import json,sys; print([r['name'] for r in json.load(sys.stdin)['sap.ui5']['routing']['routes']])"
curl -s http://localhost:8080/operator/\$metadata | grep -c "UI.Identification"
curl -s http://localhost:8082/manifest.json | python3 -c "import json,sys; print([r['name'] for r in json.load(sys.stdin)['sap.ui5']['routing']['routes']])"
curl -s http://localhost:8082/admin/\$metadata | grep -c "UI.Identification"

# Manager approves/rejects an offer created via CustomerPortalService.submitOffer
curl -s -u "manager.schmidt@automarkt.de:Test@1234" -X POST "http://localhost:4004/operator/Offers(<id>)/OperatorPortalService.approve" -d '{}'

# Admin captures a payment created via CustomerPortalService.checkout + pay,
# then checks the vehicle actually flipped to SOLD — proving the delegation
# to the real PaymentService instance, not just that the call returned true.
curl -s -u "admin.mueller@automarkt.de:Test@1234" -X POST "http://localhost:4004/admin/Payments(<id>)/AdminService.capture" -d '{"transactionReference":"TXN-TEST-001"}'
curl -s -u "admin.mueller@automarkt.de:Test@1234" "http://localhost:4004/vehicle/Vehicles?\$filter=ID eq <vehicleId>&\$select=status"
```

**Verified end to end** against `cds-serve`: eight route names in each app; `UI.Identification`
count `3` (operator-portal: Reservations/TestDrives/Offers) and `1` (admin-portal: Payments);
Manager `approve`/`reject` on a fresh offer both returned `true`; Admin `capture` on a fresh payment
returned `true` **and** the underlying vehicle flipped to `SOLD` (confirming `SalesService`'s
`PaymentSucceeded` subscription fired from the delegated call); `fail` and `refund` also verified
against separate fresh payments.

```sh
npm run lint && npm run format:check && npm test
```

---
