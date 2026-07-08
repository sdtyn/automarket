# EPIC22 — Customer Portal Offer Negotiation & UX Fixes

**Goal:** Add a two-way offer negotiation workflow — today only the customer can submit an offer;
Operator/Manager can only approve or reject it, with no way to counter-offer — and fix a batch of
real UX defects found while manually driving the split-up customer-portal apps from EPIC21-T3:
missing cross-app navigation, no way back from an Object Page to its List Report, no logout, an
image column rendered as raw text instead of a thumbnail, unlabeled specification fields, and a
native "Delete" button visible to a role that can never actually delete a vehicle.

---

## Sprint Overview

### Ticket Table

| Ticket | Description | Status |
|--------|-------------|--------|
| EPIC22-T1 | Customer offer lifecycle | Done |
| EPIC22-T2 | Operator/Manager counter-offers | Done |
| EPIC22-T3 | Customer Portal navigation | Done |
| EPIC22-T4 | Vehicle Object Page polish | Done |
| EPIC22-T5 | Read-only Vehicles for Customers | Open |

### Sprint Backlog DoD Mapping

| DoD Item | Satisfied by |
|----------|-------------|
| Customer submits an offer → "Make an Offer" hides, a "My Offer" row appears with a working "Remove the Offer" action; removing it (or the offer being rejected) brings "Make an Offer" back | EPIC22-T1 |
| Operator/Manager can counter-offer; customer sees Accept (buys at that price) / Reject (deletes it, "Make an Offer" returns) / Make a New Offer (submits a new offer, discards the counter-offer) | EPIC22-T2 |
| Every customer-portal app has links to the customer's other apps, a working back-to-list button on every Object Page, and a logout button | EPIC22-T3 |
| Vehicle Object Page shows a real image (not a raw URL) and labeled specification fields | EPIC22-T4 |
| No "Delete" button visible to a Customer anywhere in customer-portal | EPIC22-T5 |

### Sign-off

_To be filled in at sprint end (T2–T5 still open)._

---

## EPIC22-T1: Customer Offer Lifecycle

### What & Why

`OfferService.submitOffer`/`resubmitOffer` (EPIC20-T2) already existed, but the Vehicle Object Page
gave no feedback about an offer once submitted — "Make an Offer" stayed visible, nothing showed the
offer itself, and there was no way to withdraw it short of navigating to the separate "My Offers"
app. Design tension resolved before writing any code (flagged to the user, not silently decided):
the requested "offer disappears and Make an Offer comes back" behavior on Manager rejection could
have conflicted with EPIC20-T2's deliberate "REJECTED offers stay and are resubmit-able" design —
resolved by scoping "active" (for this page's purposes) to `SUBMITTED`/`UNDER_REVIEW` only, computed
fresh on every read rather than a stored flag. A `REJECTED` offer stops being "active" (so
Make an Offer reappears here) without ever being deleted or touching the My Offers/resubmit flow.

Same for the customer's own voluntary withdrawal: rather than reusing `rejectOffer` (Manager-only)
or silently repurposing something else, a new `OfferService.withdrawOffer` action was added — this
one *does* delete the row (the customer retracted it before anyone reviewed it, so unlike a
Manager's rejection there's no decision worth preserving).

### Step-by-step instructions

#### 1. Modify `modules/offer/api/offer-service.cds`

Add `withdrawOffer(offerId: String) returns Boolean`, `@requires: 'Customer'`, after
`resubmitOffer`.

#### 2. Modify `modules/offer/application/offer-service.js`

Add the handler: same ownership check as `resubmitOffer` (`offer.customer_ID !== req.user.id` →
403), same status check as `approveOffer`/`rejectOffer` (`SUBMITTED`/`UNDER_REVIEW` only → 409
otherwise), then `DELETE.from(Offers).where({ ID: offerId })`.

#### 3. Modify `modules/vehicle/api/customer-portal.cds`

Add five virtual fields to `Vehicles`: `hasActiveOffer`/`hasNoActiveOffer` (Boolean pair — same
"CDS annotations can't express negation, so compute both" reasoning as `isFavorited`/
`isNotFavorited`, EPIC20-T1/cap-notes #14), and `myOfferId`/`myOfferPrice`/`myOfferCurrency`/
`myOfferStatus`/`myOfferDesiredPickupDate` mirroring the one active offer's fields. Add a new bound
action `removeOffer() returns Boolean` next to `submitOffer`. Both `submitOffer` and `removeOffer`
get `@Common.SideEffects: {TargetProperties: ['in/hasActiveOffer', 'in/hasNoActiveOffer', 'in/myOfferId', 'in/myOfferPrice', 'in/myOfferCurrency', 'in/myOfferStatus', 'in/myOfferDesiredPickupDate']}`
— without this, the fields don't refetch after the action and the buttons/facet show stale
visibility until a full reload (same lesson as `cap-notes.md` #14).

#### 4. Modify `modules/vehicle/application/customer-portal.js`

Import `Offers` alongside the existing `Favorites`/`PriceHistory`/`VehicleImages` destructuring.
Add `const ACTIVE_OFFER_STATUSES = ['SUBMITTED', 'UNDER_REVIEW'];`. Extend the existing
`srv.after('READ', 'Vehicles', ...)` handler: inside the `if (req.user.is('Customer'))` block
(alongside the Favorites lookup), batch-query `Offers` for `customer_ID`/`vehicle_ID in ids`/
`status in ACTIVE_OFFER_STATUSES`, build a `vehicle_ID → offer` map, then in the final per-row loop
set `hasActiveOffer`/`hasNoActiveOffer`/`myOfferId`/`myOfferPrice`/`myOfferCurrency`/`myOfferStatus`/
`myOfferDesiredPickupDate` from that map (all false/null when no active offer, or for guests). Add
`srv.on('removeOffer', 'Vehicles', ...)`: look up the customer's own active offer for the bound
vehicle (404 if none), delegate the actual deletion to
`(await cds.connect.to('OfferService')).send('withdrawOffer', { offerId })`.

#### 5. Modify `modules/vehicle/api/customer-portal-ui.cds`

Add a new `UI.FieldGroup #MyOffer` (offered price/currency/status/desired pickup date, all with
explicit `Label`s) and a new `UI.ReferenceFacet` targeting it, with `@UI.Hidden: hasNoActiveOffer`
(nested-annotation syntax — see below) so the whole "My Offer" facet only appears when there's
something to show. Add `@UI.Hidden: hasActiveOffer` to the existing "Make an Offer"
`UI.DataFieldForAction`, and a new `UI.DataFieldForAction` for `removeOffer` ("Remove the Offer")
with `@UI.Hidden: hasNoActiveOffer`.

**Reused, not rediscovered:** the nested `@UI.Hidden: <field>` syntax (not a plain `Hidden: <field>`
struct property, which compiles but is silently ignored for header actions — `cap-notes.md` #14)
works identically for `UI.ReferenceFacet` records, not just `UI.DataFieldForAction` — confirmed via
`$metadata` inspection (`<Annotation Term="UI.Hidden" Path="hasNoActiveOffer"/>` nested inside the
`My Offer` `Record`, not a `PropertyValue`).

### Verify

```sh
node_modules/.bin/cds-serve   # NOT cds watch
(cd app/customer-portal && node_modules/.bin/ui5 serve --port 8081)
```

**A real, unrelated environment problem found and worked around, not guessed at:** initial browser
verification gave inconsistent results — the same vehicle sometimes showed "Make an Offer" and
sometimes "Remove the Offer" with no code change in between. Traced to two independent causes, not
a bug in this ticket's code:

1. A `cds watch` process was already bound to port 4004 in another terminal (left over, not
   started by this session) — every one of this session's own `cds-serve` launches on port 4004
   silently failed with `EADDRINUSE` and exited, so **every test was actually hitting the stray
   `cds watch` instance**, not this session's backend. Worked around by running the verification
   backend on port 4005 instead (`PORT=4005 cds-serve`, with `app/customer-portal/ui5.yaml`'s
   backend URL temporarily pointed at 4005, reverted after). Always check `lsof -i :4004` /
   `ss -tlnp | grep 4004` before trusting a "backend started" log line.
2. `CustomerPortalService.Vehicles` is `@requires: 'any'` (guest-readable) — Playwright's
   `httpCredentials` context option only attaches Basic Auth in response to a `401` challenge,
   which this endpoint never issues (it happily serves guests). Some of the app's own near-
   simultaneous `$batch` sub-requests went out with no `Authorization` header at all and were
   served as anonymous, computing `hasActiveOffer: false` correctly *for a guest* — confirmed via a
   temporary server-side debug log showing `req.user.id: "anonymous"` for exactly those requests.
   Fixed the test (not the product) by using `context.setExtraHTTPHeaders({ Authorization: ... })`
   instead of `httpCredentials`, which attaches unconditionally to every request. **Any future
   Playwright test against a `@requires: 'any'` entity must use `setExtraHTTPHeaders`, not
   `httpCredentials`**, or it will intermittently and misleadingly look broken.

**Verified end to end** once testing against the correct backend with reliable auth: fresh Vehicle
Object Page load shows "Make an Offer", no "My Offer" facet; submitting an offer through the real
UI dialog immediately hides "Make an Offer" and shows "Remove the Offer"; a **fresh page reload**
(not just in-session reactive state) still shows "Remove the Offer" and a "My Offer" anchor-bar tab
that — once clicked (facet content is lazy-loaded, `sap.fe.app.enableLazyLoading`, a real UI5
behavior not a bug) — displays the correct offered price/currency/status/desired pickup date;
clicking "Remove the Offer" brings "Make an Offer" back; a Manager rejecting the offer via
`OfferService.rejectOffer` also flips `hasActiveOffer` back to `false` with no extra wiring
(confirmed via `curl`, matching the "recomputed fresh on every read" design).

```sh
npm run lint && npm run format:check && npm test
```

---

## EPIC22-T2: Operator/Manager Counter-Offers

### What & Why

Before this ticket, Manager/Admin could only approve or reject a `SUBMITTED`/`UNDER_REVIEW` offer —
there was no way to propose a different price back to the customer. Two design questions were
flagged to the user before writing any code (not decided unilaterally, per CLAUDE.md §8):

1. **What does "Accept" do?** Two options existed: (a) create a new `Order`/payment flow at the
   agreed price, or (b) reuse the existing `approveOffer` → `Reservation` path (EPIC20-T1/T2), the
   same outcome a normal approved offer already produces. The user picked (b) — no new
   `agreedPrice`/`Order` mechanism. This surfaced a **pre-existing, system-wide limitation** that
   this ticket does not fix: negotiated offer prices never flow into payment anywhere in the system
   — `SalesService.createOrder`/`Orders` never store a price, and `customer-portal.js`'s `pay`
   handler always reads `vehicle.price` (the list price), never any offer's `offeredPrice`. This was
   true before T2 and stays true after it; flagged to the user rather than silently patched in.
2. **Who can counter-offer?** Operator or Manager/Admin only? The user picked Manager/Admin only —
   unchanged from EPIC20-T5's existing approve/reject authority, no new Operator capability.

A new `proposedBy` enum field (`CUSTOMER` | `STAFF`, default `CUSTOMER`) on `Offers` is the single
source of truth for "whose price is this, right now" — every button's visibility is a function of
it, not a separate state machine. Same "CDS annotations can't express negation" reasoning as
`isFavorited`/`hasActiveOffer` (cap-notes.md #14) means two more Boolean-pair fields were needed on
the customer side: `hasCustomerOffer`/`hasNoCustomerOffer` (an active offer that's still the
customer's own price — shows "Remove the Offer") and `hasStaffOffer`/`hasNoStaffOffer` (an active
offer the staff most recently repriced — shows Accept/Reject/Make a New Offer instead).

### Step-by-step instructions

#### 1. Modify `modules/offer/db/offer.cds`

Add `proposedBy: String(20) enum { CUSTOMER; STAFF; } default 'CUSTOMER';` to `Offers`.

#### 2. Modify `modules/offer/api/offer-service.cds`

Add after `withdrawOffer`:

```cds
@requires: ['Manager', 'Admin']
action counterOffer(offerId: String, offeredPrice: Decimal) returns Boolean;

@requires: 'Customer'
action acceptCounterOffer(offerId: String) returns { reservationId: String };
```

Add `event OfferCountered { offerId: String; vehicleId: String; }` alongside the existing
`OfferSubmitted`/`OfferApproved`/`OfferRejected`.

#### 3. Modify `modules/offer/application/offer-service.js`

`submitOffer`'s `INSERT` and `resubmitOffer`'s `UPDATE.set(...)` both now explicitly set
`proposedBy: 'CUSTOMER'` — a resubmit always resets ownership of the price back to the customer,
even if the offer being resubmitted had previously been staff-countered. Add `srv.on('counterOffer', ...)`:
same offer lookup + `SUBMITTED`/`UNDER_REVIEW`-only guard as `approveOffer`, then
`UPDATE(Offers).set({ offeredPrice, proposedBy: 'STAFF', status: 'UNDER_REVIEW' })`, then
`srv.emit('OfferCountered', { offerId, vehicleId })`. Add `srv.on('acceptCounterOffer', ...)`: same
ownership check as `resubmitOffer` (`offer.customer_ID !== req.user.id` → 403), a `proposedBy !== 'STAFF'`
guard (409 — nothing to accept), same status guard, then mark the offer `APPROVED` and
`INSERT INTO Reservations` — copy of `approveOffer`'s existing reservation-creation logic (same
48-hour `expiresAt`, `guestToken: null`), reused rather than refactored into a shared helper since
`approveOffer` is Manager-initiated and this is Customer-initiated with a different ownership check.

#### 4. Modify `modules/vehicle/api/operator-portal.cds`

Add `'counter'` to the `Offers` `@restrict` grant list (alongside `'approve'`/`'reject'`). Add inside
the `Offers` `actions {}` block:

```cds
@requires: ['Manager', 'Admin']
@Common.SideEffects: {TargetProperties: ['in/offeredPrice', 'in/proposedBy', 'in/status']}
action counter(offeredPrice: Decimal) returns Boolean;
```

The `@Common.SideEffects` is not optional — see Verify below, it was initially omitted and caused a
real, confirmed bug.

#### 5. Modify `modules/vehicle/application/operator-portal.js`

Add `srv.on('counter', 'Offers', ...)` after `reject`: same branch-scoped Manager guard
(`offer.branch_ID !== req.user.attr.branchId` → 403) and status guard as `approve`/`reject`, then
`UPDATE(Offers).set({ offeredPrice, proposedBy: 'STAFF', status: 'UNDER_REVIEW' })`, then delegate
the event emission through `(await cds.connect.to('OfferService')).emit('OfferCountered', ...)` —
not `srv.emit(...)` on this service's own instance (cap-notes.md #11: events must originate from the
service instance other services actually subscribe to).

#### 6. Modify `modules/vehicle/api/operator-portal-ui.cds`

Add `proposedBy` to `Offers`' `UI.LineItem` and `UI.FieldGroup#OfferDetails`. Add to
`UI.Identification`: `{ $Type: 'UI.DataFieldForAction', Action: 'OperatorPortalService.counter', Label: 'Counter Offer' }`.

#### 7. Modify `modules/vehicle/api/customer-portal.cds`

Add virtual fields to `Vehicles`: `hasCustomerOffer`/`hasNoCustomerOffer`, `hasStaffOffer`/
`hasNoStaffOffer`, `myOfferProposedBy: String`. Add three new bound actions after `removeOffer`,
each with a full `@Common.SideEffects` targeting every `myOffer*`/`has*Offer` field (all of them, not
just the ones that specific action changes — the customer could be looking at any of the three new
buttons, and the whole visibility state needs to be consistent after any of them fires):

```cds
action acceptCounterOffer() returns { reservationId: String };
action rejectCounterOffer() returns Boolean;
action makeNewOffer(offeredPrice: Decimal, currency: String, desiredPickupDate: Date, notes: String) returns String;
```

#### 8. Modify `modules/vehicle/application/customer-portal.js`

Extend the `Offers` `SELECT` in `srv.after('READ', 'Vehicles', ...)` to include `proposedBy`. Per
row, compute `isStaffOffer = !!offer && offer.proposedBy === 'STAFF'`, then derive
`hasCustomerOffer`/`hasNoCustomerOffer`/`hasStaffOffer`/`hasNoStaffOffer`/`myOfferProposedBy` from
it (an offer is "the customer's" for button-visibility purposes only when it exists **and** isn't
staff-priced). Add `srv.on('acceptCounterOffer'/'rejectCounterOffer'/'makeNewOffer', 'Vehicles', ...)`:
each looks up the bound vehicle's active `proposedBy: 'STAFF'` offer (404 if none — the buttons
should be hidden anyway, this is the server-side guard), then delegates: `acceptCounterOffer` →
`OfferService.acceptCounterOffer`; `rejectCounterOffer` → the existing `OfferService.withdrawOffer`
(rejecting a staff counter-offer and withdrawing your own offer end the same way — the row is gone,
"Make an Offer" comes back); `makeNewOffer` → `withdrawOffer` the staff offer, then `submitOffer` a
fresh one (two delegated calls, not a single combined action — keeps `OfferService` the sole owner
of every offer state transition, same delegation pattern as the rest of `customer-portal.js`).

#### 9. Modify `modules/vehicle/api/customer-portal-ui.cds`

Change "Remove the Offer"'s `@UI.Hidden` from `hasNoActiveOffer` to `hasNoCustomerOffer` (it must
hide, not just when there's no offer, but also when the current offer is a staff counter-offer —
the customer can't "remove" a price they didn't set). Add three new `UI.DataFieldForAction` entries
(Accept Offer / Reject Offer / Make a New Offer), all `@UI.Hidden: hasNoStaffOffer`. Add
`{Value: myOfferProposedBy, Label: 'Proposed By'}` to the `#MyOffer` `UI.FieldGroup`.

### Verify

Backend logic verified with `curl` end to end: submit (customer) → counter (Manager) → each of the
three customer response paths (accept → `Reservations` row created with `status: 'APPROVED'`;
reject → offer row deleted; make a new offer → old staff offer deleted, new customer offer created)
— all confirmed with correct data at every step.

**A real, confirmed bug found during UI verification, not guessed at:** the operator-side
`app/operator-offers` Object Page's "Counter Offer" dialog submitted successfully (`200`, offer row
updated correctly in the database — confirmed via `curl` immediately after), but the page kept
showing the *pre-counter* price and `proposedBy` until a full reload. Same root cause as
`cap-notes.md` #14 (Favorites, then EPIC22-T1's own offer fields): step 4's `counter` action was
initially written **without** `@Common.SideEffects`, unlike every T2 action on the customer-portal
side, which had it from the start. Fiori Elements has no way to know `offeredPrice`/`proposedBy`/
`status` changed as a side effect of `counter` unless told explicitly — adding
`@Common.SideEffects: {TargetProperties: ['in/offeredPrice', 'in/proposedBy', 'in/status']}` (step 4,
above) fixed it; re-verified via Playwright against a fresh backend + fresh offer: dialog submit
now immediately shows `22,500.00` / `STAFF` / `UNDER_REVIEW` on the Object Page with no reload.
**Any new bound action that changes fields displayed elsewhere on the same page needs
`@Common.SideEffects` from the moment it's written — this is now the third time in this project a
missing one caused a stale-UI bug that looked like a broken action.**

Customer side re-verified on the same fresh backend/offer: Object Page shows `Accept Offer` /
`Reject Offer` / `Make a New Offer` (not `Make an Offer` / `Remove the Offer`), and the "My Offer"
facet shows `22,500` / `EUR` / `UNDER_REVIEW` / `STAFF` / the correct pickup date — all matching the
counter-offer just submitted from the operator side.

```sh
npm run lint && npm run format:check && npm test
```

All 138 tests pass, 0 lint errors (3 pre-existing unrelated warnings), format clean.

---

## EPIC22-T3: Customer Portal Navigation

### What & Why

Three separate, real UX defects reported while manually driving the six standalone customer apps
(EPIC21-T3 split): no way back from a Vehicle Object Page to its List Report, no links between the
customer's six apps (Vehicle Catalog / Reservations / Offers / Test Drives / Orders / Payments —
each its own standalone app, its own port, no shared shell), and no logout (mocked HTTP Basic Auth
has no server-side session to end).

**A wrong turn, corrected before it shipped:** the first approach for the back button tried to
enable `sap.fe`'s *native* Flexible Column Layout (FCL) shell — `sap.fe.core.rootView.Fcl` — since
that's the standard SAP-generated pattern and would have given a native "Close column" arrow for
free. This was abandoned after real-browser testing (not just reading docs) showed the row-click
navigation always lands directly on `layout=MidColumnFullScreen` (skipping the two-column state
FCL expects), which left the native `FCLStandardAction::Close` button's `visible` binding
permanently stuck at `false` — confirmed by inspecting the live control and its `fclhelper` model in
the browser, not guessed at. Chasing down *why* FCL was skipping straight to full screen meant
digging into unpublished `sap.fe.core` internals with no reliable documentation and no guaranteed
fix. Reverted (manifest.json's `rootView`/`routerClass`/`controlAggregation` changes fully removed)
in favor of a much simpler, deterministic mechanism: `sap.fe`'s documented manifest-based **custom
page action** — a plain button wired to a small JS handler, with no dependency on FCL's internal
layout-state computation at all.

### Step-by-step instructions

#### 1. Create `app/<app>/webapp/ext/CustomActions.js` in all six customer apps

(`customer-portal`, `customer-reservations`, `customer-offers`, `customer-testdrives`,
`customer-orders`, `customer-payments`.) Each exports `onBackToList` (`window.location.hash = "#/"`
— hardcoded to the app's own list route rather than `window.history.back()`, so it works identically
whether the user arrived via an in-app row click or a deep/bookmarked link with no relevant browser
history) and `onLogout` (see step 4). `customer-portal`'s copy additionally exports
`onNavReservations`/`onNavOffers`/`onNavTestDrives`/`onNavOrders`/`onNavPayments`, each a plain
`window.location.href` redirect to the sibling app's own port (there is no shared Fiori Launchpad
shell tying the six standalone apps together at runtime, so cross-app navigation can't be an
in-app `router.navTo` — it has to cross an origin).

#### 2. Modify every app's `webapp/manifest.json` — Object Page target

Add a `content.header.actions.BackToList` entry to the `ObjectPage` target's `options.settings`
(sibling to `entitySet`):

```json
"content": {
  "header": {
    "actions": {
      "BackToList": {
        "id": "BackToList",
        "press": "automarket.<app>.ext.CustomActions.onBackToList",
        "text": "Back to List",
        "enabled": true,
        "visible": true
      }
    }
  }
}
```

This is `sap.fe`'s standard manifest-based custom-action extension point — the `press` value is a
dotted module path (dots become slashes, the last segment is the exported method name), resolved
against the app's own namespace. Confirmed via **two wrong guesses before the right key**, not
assumed: `controlConfiguration.@com.sap.vocabularies.UI.v1.Identification.actions` (no error, but
the button never rendered) and `defaultLayoutType` in `options.settings` (silently ignored) were
both tried first; `content.header.actions` is the one that actually renders the button in the
Object Page's header toolbar, verified via a live browser screenshot before moving on.

#### 3. Modify `customer-portal`'s `webapp/manifest.json` — List Report target

Add the same `content.header.actions` structure to the `VehiclesList` target's `options.settings`,
with five `NavX` entries (`NavReservations`/`NavOffers`/`NavTestDrives`/`NavOrders`/`NavPayments`,
labels "My Reservations" / "My Offers" / "My Test Drives" / "My Orders" / "My Payments") each
`press`-wired to its matching `onNavX` handler. This is the "vehicle list page needs links to my
other pages" requirement — a flat row of buttons rather than a dropdown/menu control, since the
flat-button `content.header.actions` shape is the one just proven to work; a menu-type custom
action wasn't attempted (no verified syntax for it, and flat buttons satisfy the requirement
without the extra risk).

#### 4. Add `Logout` to every app, both List Report and Object Page targets

Same `content.header.actions` mechanism, one more entry per target:

```json
"Logout": {
  "id": "Logout",
  "press": "automarket.<app>.ext.CustomActions.onLogout",
  "text": "Logout",
  "enabled": true,
  "visible": true
}
```

`onLogout` in `CustomActions.js`:

```js
onLogout: function () {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "/", true, "logout", "logout");
  xhr.onloadend = function () {
    window.location.href = window.location.origin + window.location.pathname;
  };
  xhr.send();
},
```

Mocked auth (`package.json`, `cds.requires.auth.kind: mocked`) is plain HTTP Basic — there is no
server-side session or token to invalidate, only whatever credentials the browser itself cached
against the origin the first time it was challenged. The standard, well-documented trick for
"logging out" of HTTP Basic Auth: issue one request with deliberately wrong credentials via the
three-argument `XMLHttpRequest#open(method, url, async, user, password)` overload. A real browser
overwrites its cached credential for that origin/realm with the (bad) one just used, so the next
request the app makes gets a genuine `401` and the browser re-prompts for login — there is no
"log out" endpoint to call because none exists for Basic Auth by design.

### Verify

**Back to List** — verified end to end in a live browser (Playwright, `customer-portal` +
`customer-offers`), both navigation paths: (a) List Report → click a row → Object Page → click
"Back to List" → List Report renders correctly again; (b) a **deep link straight to the Object
Page** (`#/Vehicles(id)`, no prior in-app navigation, simulating a bookmark or shared URL) → "Back
to List" is present and still correctly returns to the List Report. Spot-checked on
`customer-reservations`'s List Report to confirm the same `content.header.actions` wiring renders
correctly on a different app/entity.

**Cross-app links** — verified on `customer-portal`'s List Report: all five buttons ("My
Reservations" / "My Offers" / "My Test Drives" / "My Orders" / "My Payments") render correctly
alongside "Logout", confirmed via screenshot.

**Logout** — the mechanism's own effect (a real browser silently overwriting its Basic Auth
credential cache) **could not be fully verified through Playwright**: Playwright's
`httpCredentials` context option is a test-harness feature that automatically answers every `401`
challenge with the originally configured (valid) credentials, regardless of what credentials a
page's own script attempts to set — so a "does the next request now fail?" test can't distinguish
"the trick didn't work" from "Playwright's test harness papered over it." What *was* verified: a
network-request listener confirmed `onLogout` fires exactly the expected request
(`http://logout:logout@localhost:8081/`, i.e. deliberately wrong credentials against the app's own
origin) — the mechanism does what the code says it does. The credential-overwrite *effect* itself
is standard, long-documented browser behavior (Chrome/Firefox/Edge), not something invented for
this ticket; flagged here rather than silently claimed as fully verified, since real-browser manual
testing is the only way to close this gap and wasn't performed.

```sh
npm run lint && npm run format:check && npm test
```

All 138 tests pass, 0 lint errors (`app/` is excluded from ESLint entirely — pre-existing
`.eslint` config, not a T3 change), format clean.

---

## EPIC22-T4: Vehicle Object Page Polish

### What & Why

Two reported defects on the Vehicle Object Page's "Specifications" facet and "Photos" gallery — both
root-caused to the same class of problem as `cap-notes.md` earlier findings: an annotation was
simply never written, not a framework limitation. Fiori Elements only shows a field's raw value with
no caption unless `Label` is explicit — `#VehicleSpecs`'s fields had none, so a customer saw a bare
`AUTOMATIC` with no indication it's the transmission type. Separately, the "Photos" gallery table
showed the image `url` as plain text (a clickable link, but not a rendered thumbnail) because
`@UI.IsImageURL: true` — already applied to `primaryImageUrl` on the List Report back in EPIC19-T4 —
had never been applied to the equivalent field on the Object Page's own image gallery.

### Step-by-step instructions

#### 1. Modify `modules/vehicle/api/customer-portal-ui.cds`

Add an explicit `Label` to every field in `#VehicleSpecs`'s `UI.FieldGroup` (`brand` → "Brand",
`model` → "Model", `year` → "Year", `mileage` → "Mileage", `fuelType` → "Fuel Type",
`transmission` → "Transmission", `color` → "Color", `price` → "Price", `currency` → "Currency" — the
two `branch.*` fields already had one, from EPIC19-T4).

#### 2. Modify `modules/vehicle/api/operator-portal-ui.cds`

Add `annotate automarket.VehicleImages with { url @UI.IsImageURL: true; };` right after the existing
`UI.LineItem` annotate block for the same type. `automarket.VehicleImages` is annotated once here
(not per-service) because it's the shared target type of the `images` composition, reachable from
both `OperatorPortalService.Vehicles(ID)/images` and `CustomerPortalService.Vehicles(ID)/images` —
fixing it here fixes the Photos gallery thumbnail rendering on **both** portals in one place, not
just the customer-facing one this ticket was scoped to.

### Verify

Verified end to end in a live browser (Playwright, `customer-portal`, fresh `cds-serve` + `ui5 serve`
against a vehicle with one image): Specifications facet shows "Brand:", "Fuel Type:",
"Transmission:", "Mileage:" etc. as actual field captions (confirmed via page text search, not just
that the annotation compiled); Photos facet's single row renders a real thumbnail image instead of
the raw Wikimedia Commons URL text — confirmed visually via screenshot.

```sh
npm run lint && npm run format:check && npm test
```

All 138 tests pass, 0 lint errors, format clean.

---
