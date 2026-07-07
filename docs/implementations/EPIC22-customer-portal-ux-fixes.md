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
| EPIC22-T2 | Operator/Manager counter-offers | Open |
| EPIC22-T3 | Customer Portal navigation | Open |
| EPIC22-T4 | Vehicle Object Page polish | Open |
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
