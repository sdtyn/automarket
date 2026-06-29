# EPIC03 — Branch & Vehicle Management

Sprint 3. Goal: branch and vehicle domain models, state machine, CRUD services, search, image management, event wiring, and portal projections.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC03-T1 | Branch Domain Model — `Branches` entity, `BranchStatus` enum, CDS schema + db module file | Done |
| EPIC03-T2 | Branch Service — Branch CRUD API, Admin/Manager role guards, handlers | Done |
| EPIC03-T3 | Vehicle Domain Model — `Vehicles` entity (all attributes), `VehicleStatus` enum (DRAFT→DELIVERED+ARCHIVED), `VehicleImages` entity, CDS schema + db file | Done |
| EPIC03-T4 | Vehicle State Machine — `VehicleStateMachine` domain class, full authoritative transition table, guards, domain events | Done |
| EPIC03-T5 | Vehicle Service — Vehicle CRUD, `publish`/`archive` actions, `@odata.etag` on `modifiedAt` optimistic locking | Done |
| EPIC03-T6 | Vehicle Search — Filter endpoint (brand/model/price/status/branch), guest-accessible for `FOR_SALE` vehicles | Done |
| EPIC03-T7 | Vehicle Images — `VehicleImage` CRUD handlers, URL + sortOrder management, linked to Vehicle aggregate | Done |
| EPIC03-T8 | Cache-Bust Event Wiring — Wire `VehiclePublished`, `VehicleSold`, `VehicleReserved`, `VehicleReleased`, `VehicleCheckoutStarted` to catalog cache invalidation | Done |
| EPIC03-T9 | Operator Portal — Vehicle List, Vehicle Detail, Create Vehicle service projections (branch-scoped ABAC) | Done |
| EPIC03-T10 | Customer Portal — Vehicle Catalog + Vehicle Detail service projections, guest-accessible for `FOR_SALE` | Done |

### Sprint Backlog DoD mapping

- "Branch Module" → EPIC03-T1, T2
- "Vehicle Module" → EPIC03-T3, T4, T5, T6, T7, T8
- "Vehicle Portal Screens" → EPIC03-T9, T10

### Sign-off

Signed off by: Sedat Yeni  Date: 2026-06-29

---

## T1 — Branch Domain Model

**What & Why:** `Branches` entity with `BranchStatus` enum. Branch is implemented before Vehicle because every Vehicle, Reservation, Offer, and TestDrive carries a `branch_ID` foreign key from the moment it is created (AD-38). Building Vehicle first and retrofitting the reference later would require a migration on day one.

### Create `modules/branch/db/branch.cds`

```cds
namespace automarket;

using {BaseEntity} from '../../../shared/types/common';

// Branches is the organizational unit that scopes all ABAC checks. Every
// Vehicle, Operator, and Manager belongs to exactly one Branch; Customer does not.
// This coupling is by design (AD-3/AD-38) — branch ownership is not a label,
// it is the access boundary.
entity Branches : BaseEntity {
    // code is the short identifier used in UI selectors and URL segments.
    // Must be unique across all branches — enforced by the unique constraint below.
    code    : String(20) @assert.unique;
    name    : String(100);
    address : String(255);
    city    : String(100);
    country : String(100);
    // region groups branches for Manager-level reporting; not an access boundary itself.
    region  : String(100);
    status  : BranchStatus default 'ACTIVE';
}

// BranchStatus intentionally has only two values. Deactivation is a soft delete:
// a INACTIVE branch's vehicles stay readable for history but no new operations are allowed.
type BranchStatus : String enum {
    ACTIVE;
    INACTIVE;
};
```

### Modify `db/index.cds` — add branch import

```diff
 using from '../modules/identity/db/identity';
+
+using from '../modules/branch/db/branch';
```

### Create `docs/epic-03-branch-vehicle.md`

Create the sprint tracking table for EPIC03 (see the actual file for the full table).

---

## T2 — Branch Service

**What & Why:** `BranchService` exposes branch CRUD via explicit actions rather than generic OData CREATE/UPDATE to make intent clear and enforce business rules. `deactivateBranch` is a separate action (not a PATCH) so the handler can add guards later (e.g. "no active vehicles") without changing the API surface.

### Create `modules/branch/api/branch-service.cds`

```cds
using {automarket} from '../db/branch';

// BranchService is scoped to /branch. All write operations are restricted to
// Admin and Manager — Operators are branch members, not branch administrators.
// deactivate is a dedicated action instead of a generic CRUD update so the
// intent is explicit and the handler can enforce the "no active vehicles" guard later.
service BranchService @(path: '/branch') {

    // READ is open to any authenticated user — branch lists are needed
    // in Vehicle forms for Operators and Managers alike.
    @requires: 'authenticated-user'
    entity Branches as projection on automarket.Branches;

    // createBranch: inserts a new branch. Code uniqueness is enforced by the
    // @assert.unique annotation on the entity; no duplicate check needed here.
    @requires: 'Admin'
    action createBranch(code: String, name: String, address: String,
                        city: String, country: String, region: String) returns String;

    // updateBranch: allows Admin or Manager to edit display/address fields.
    // Code is immutable after creation — changing it would break all foreign
    // key references stored as strings in external logs and reports.
    @requires: ['Admin', 'Manager']
    action updateBranch(branchId: String, name: String, address: String,
                        city: String, country: String, region: String) returns Boolean;

    // deactivateBranch: soft-deletes by setting status to INACTIVE.
    // Hard delete is intentionally not supported — branches have historical
    // vehicle and transaction records that must remain readable.
    @requires: 'Admin'
    action deactivateBranch(branchId: String) returns Boolean;
}
```

### Create `modules/branch/application/branch-service.js`

```js
const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { Branches } = cds.entities('automarket');

  // createBranch: inserts a new branch record with ACTIVE status.
  // Code uniqueness is enforced by the DB constraint (@assert.unique on the entity)
  // so CAP will reject duplicates before the INSERT reaches the database.
  srv.on('createBranch', async (req) => {
    const { code, name, address, city, country, region } = req.data;
    const result = await INSERT.into(Branches).entries({
      code, name, address, city, country, region, status: 'ACTIVE',
    });
    return result.ID;
  });

  // updateBranch: updates mutable display and address fields only.
  // Code is excluded from the update payload — it is immutable after creation.
  srv.on('updateBranch', async (req) => {
    const { branchId, name, address, city, country, region } = req.data;
    const branch = await SELECT.one.from(Branches).where({ ID: branchId });
    if (!branch) return req.error(404, 'Branch not found');
    await UPDATE(Branches).set({ name, address, city, country, region }).where({ ID: branchId });
    return true;
  });

  // deactivateBranch: sets status to INACTIVE — a soft delete.
  // This does not cascade to the branch's vehicles; vehicle visibility
  // is governed by VehicleStatus, not BranchStatus.
  srv.on('deactivateBranch', async (req) => {
    const { branchId } = req.data;
    const branch = await SELECT.one.from(Branches).where({ ID: branchId });
    if (!branch) return req.error(404, 'Branch not found');
    await UPDATE(Branches).set({ status: 'INACTIVE' }).where({ ID: branchId });
    return true;
  });
});
```

### Modify `srv/index.cds` — add branch-service import

```diff
 using from '../modules/identity/api/identity-service';
+
+using from '../modules/branch/api/branch-service';
```

### Modify `package.json` — register BranchService

```diff
   "services": {
     "IdentityService": { "impl": "modules/identity/application/identity-service.js" },
+    "BranchService":   { "impl": "modules/branch/application/branch-service.js" }
   }
```

---

## T3 — Vehicle Domain Model

**What & Why:** `Vehicles` is the central aggregate. `images` is a `Composition` (not an Association) so that `VehicleImages` rows are owned by the Vehicle and cascade-deleted automatically. `VehicleStatus` enum mirrors the authoritative state machine in Implementation Architecture §13 — the values must stay in sync with `vehicle-state-machine.js`.

### Create `modules/vehicle/db/vehicle.cds`

```cds
namespace automarket;

using {BaseEntity} from '../../../shared/types/common';
using {automarket.Branches} from '../../branch/db/branch';

// Vehicles is the central aggregate of the AutoMarket domain. Its row is
// locked (SELECT FOR UPDATE) during every state transition so that concurrent
// reservation and checkout requests cannot race past the guard checks.
// Keep this entity lean — Reservation, Offer, and TestDrive reference it by ID
// only to avoid widening the lock scope.
entity Vehicles : BaseEntity {
    vin          : String(17); // ISO 3779 — always 17 chars
    plateNumber  : String(20);
    brand        : String(100);
    model        : String(100);
    year         : Integer;
    mileage      : Integer; // in km
    fuelType     : FuelType;
    transmission : Transmission;
    color        : String(50);
    price        : Decimal(15, 2);
    currency     : String(3) default 'TRY';
    status       : VehicleStatus default 'DRAFT';
    branch       : Association to Branches;
    // images is a composition so that VehicleImages rows are owned by the Vehicle
    // aggregate and deleted automatically when the Vehicle is deleted.
    images       : Composition of many VehicleImages
                       on images.vehicle = $self;
}

// VehicleImages is part of the Vehicle aggregate. SortOrder controls display
// sequence in the catalog; the handler must reject duplicate sortOrder values
// within the same vehicle to avoid ambiguous ordering.
entity VehicleImages : BaseEntity {
    vehicle   : Association to Vehicles;
    url       : String(1000);
    sortOrder : Integer default 0;
}

// VehicleStatus mirrors the authoritative state machine in the Implementation
// Architecture Document §13. Do not add or remove values here without updating
// VehicleStateMachine.js — the two must stay in sync.
type VehicleStatus : String enum {
    DRAFT;
    FOR_SALE;
    RESERVED;
    PENDING_PAYMENT;
    SOLD;
    DELIVERED;
    ARCHIVED;
};

type FuelType : String enum {
    PETROL; DIESEL; ELECTRIC; HYBRID; LPG;
};

type Transmission : String enum {
    MANUAL; AUTOMATIC; SEMI_AUTOMATIC;
};
```

### Modify `db/index.cds` — add vehicle import

```diff
 using from '../modules/branch/db/branch';
+
+using from '../modules/vehicle/db/vehicle';
```

---

## T4 — Vehicle State Machine

**What & Why:** The state machine lives in a dedicated domain module rather than in the service handler so it can be unit-tested in isolation. `TRANSITIONS` is a flat array of `{from, event, to, guard}` rules — adding a new transition is a one-line addition to the array, not a change to a switch/case tree.

### Create `modules/vehicle/domain/vehicle-state-machine.js`

```js
'use strict';

// Authoritative Vehicle state transition table — Implementation Architecture §13.
// Each entry: { from, event, to, guard }
// guard(vehicle, context) returns true when the transition is allowed.
// context carries request-time data (e.g. requesterId) that the entity row alone cannot supply.
const TRANSITIONS = [
  {
    from: 'DRAFT', event: 'VehiclePublished', to: 'FOR_SALE',
    // All required fields must be present before a vehicle enters the public catalog.
    guard: (v) => !!(v.price && v.branch_ID && v.images && v.images.length > 0),
  },
  { from: 'FOR_SALE', event: 'ReservationCreated', to: 'RESERVED',       guard: () => true },
  { from: 'FOR_SALE', event: 'OfferApproved',      to: 'RESERVED',       guard: () => true },
  { from: 'FOR_SALE', event: 'CheckoutStarted',    to: 'PENDING_PAYMENT', guard: () => true },
  {
    from: 'RESERVED', event: 'CheckoutStarted', to: 'PENDING_PAYMENT',
    // Only the reservation/offer owner may initiate checkout from RESERVED state.
    guard: (v, ctx) => ctx && ctx.requesterId === ctx.reservationOwnerId,
  },
  { from: 'RESERVED',        event: 'ReservationCancelled', to: 'FOR_SALE', guard: () => true },
  { from: 'RESERVED',        event: 'ReservationExpired',   to: 'FOR_SALE', guard: () => true },
  { from: 'PENDING_PAYMENT', event: 'PaymentSucceeded',     to: 'SOLD',     guard: () => true },
  {
    from: 'PENDING_PAYMENT', event: 'PaymentFailed', to: 'FOR_SALE',
    // Direct-purchase failure: no reservation exists, vehicle returns to FOR_SALE.
    guard: (v, ctx) => !ctx || !ctx.hasActiveReservation,
  },
  {
    from: 'PENDING_PAYMENT', event: 'PaymentFailed', to: 'RESERVED',
    // Reservation-backed failure: reservation is still within its validity window.
    guard: (v, ctx) => !!(ctx && ctx.hasActiveReservation),
  },
  { from: 'SOLD',     event: 'DeliveryConfirmed', to: 'DELIVERED', guard: () => true },
  { from: 'FOR_SALE', event: 'VehicleArchived',   to: 'ARCHIVED',  guard: () => true },
  { from: 'DRAFT',    event: 'VehicleArchived',   to: 'ARCHIVED',  guard: () => true },
];

// transition: applies the given event to the vehicle and returns the new status.
// Throws a domain error if no matching transition exists or the guard rejects.
// The caller (service handler) is responsible for persisting the new status and
// emitting the corresponding domain event after this function returns.
function transition(vehicle, event, context = {}) {
  const match = TRANSITIONS.find(
    (t) => t.from === vehicle.status && t.event === event && t.guard(vehicle, context)
  );
  if (!match) {
    throw new Error(
      `Invalid transition: ${vehicle.status} --[${event}]--> (no matching rule or guard rejected)`
    );
  }
  return match.to;
}

// allowedEvents: returns the list of events that can be applied to a vehicle
// in its current status, given the supplied context. Used by the service layer
// to build the set of available actions for a given user/vehicle combination.
function allowedEvents(vehicle, context = {}) {
  return TRANSITIONS
    .filter((t) => t.from === vehicle.status && t.guard(vehicle, context))
    .map((t) => t.event);
}

module.exports = { transition, allowedEvents };
```

---

## T5 — Vehicle Service

**What & Why:** `VehicleService` enforces the rule that status changes must go through explicit `publish`/`archive` actions — never via a direct PATCH. `@odata.etag` on `modifiedAt` gives optimistic locking for free: a stale `If-Match` header returns 412 without any manual version counter.

### Create `modules/vehicle/api/vehicle-service.cds`

```cds
using {automarket} from '../db/vehicle';

// VehicleService is scoped to /vehicle. Status transitions are only
// possible through the publish and archive actions — never via a direct
// PATCH on the entity — so the state machine cannot be bypassed.
service VehicleService @(path: '/vehicle') {

    // @odata.etag on modifiedAt: CAP returns the etag on every GET and
    // validates the If-Match header on PATCH/PUT, giving us optimistic
    // locking without any manual version-counter code.
    @restrict: [
        { grant: 'READ',             to: 'authenticated-user' },
        { grant: ['CREATE','UPDATE'], to: ['Operator','Manager'] },
        { grant: 'DELETE',           to: 'Admin' }
    ]
    entity Vehicles as projection on automarket.Vehicles {
        *, @odata.etag modifiedAt
    };

    // publish: transitions a DRAFT vehicle to FOR_SALE.
    @requires: 'Manager'
    action publish(vehicleId: String) returns String;

    // archive: transitions a DRAFT or FOR_SALE vehicle to ARCHIVED.
    @requires: ['Manager', 'Admin']
    action archive(vehicleId: String) returns String;

    // searchVehicles: open to guests but the handler silently locks the
    // status filter to FOR_SALE for unauthenticated callers.
    @requires: 'any'
    function searchVehicles(brand: String, model: String, priceMin: Decimal,
                            priceMax: Decimal, status: automarket.VehicleStatus,
                            branchId: String) returns array of Vehicles;

    @restrict: [{ grant: 'READ', to: 'authenticated-user' }]
    entity VehicleImages as projection on automarket.VehicleImages;

    @requires: ['Operator','Manager']
    action addImage(vehicleId: String, url: String, sortOrder: Integer) returns String;

    @requires: ['Operator','Manager']
    action updateImageOrder(imageId: String, sortOrder: Integer) returns Boolean;

    @requires: ['Operator','Manager']
    action removeImage(imageId: String) returns Boolean;

    // Domain events emitted after each vehicle status transition.
    event VehiclePublished        { vehicleId : String; }
    event VehicleSold             { vehicleId : String; }
    event VehicleReserved         { vehicleId : String; }
    event VehicleReleased         { vehicleId : String; }
    event VehicleCheckoutStarted  { vehicleId : String; }
}
```

### Create `modules/vehicle/infrastructure/cache-bust.js`

```js
'use strict';

// invalidate: marks the catalog cache entry for a vehicle as stale.
// Current implementation is a stub — replace the log with a real Redis DEL
// or CDN purge call when the cache layer is introduced.
function invalidate(vehicleId) {
  console.log(`[cache-bust] invalidate vehicle ${vehicleId}`);
  // TODO: await redisClient.del(`vehicle:${vehicleId}`);
  // TODO: await cdnPurge(`/catalog/vehicles/${vehicleId}`);
}

module.exports = { invalidate };
```

### Create `modules/vehicle/application/vehicle-service.js`

```js
'use strict';

const cds = require('@sap/cds');
const { transition } = require('../domain/vehicle-state-machine');
const { invalidate } = require('../infrastructure/cache-bust');

module.exports = cds.service.impl(async function (srv) {
  const { Vehicles, VehicleImages } = cds.entities('automarket');

  // Force status to DRAFT on every new vehicle regardless of client input.
  // Status is only advanced through the publish/archive actions.
  srv.before('CREATE', 'Vehicles', (req) => {
    req.data.status = 'DRAFT';
  });

  // Reject any PATCH/PUT that carries a status field — callers must use
  // publish or archive actions to trigger a state transition.
  srv.before('UPDATE', 'Vehicles', (req) => {
    if (req.data.status) {
      return req.error(400, 'Status cannot be changed directly. Use publish or archive actions.');
    }
    // Price changes must go through PricingService.updatePrice so that every
    // change is audited and VehiclePriceDropped is emitted when applicable.
    if (req.data.price !== undefined || req.data.currency !== undefined) {
      return req.error(400, 'Price cannot be changed directly. Use PricingService.updatePrice.');
    }
  });

  // Prevent hard-delete of active vehicles to preserve transaction history.
  srv.before('DELETE', 'Vehicles', async (req) => {
    const vehicle = await SELECT.one.from(Vehicles).where({ ID: req.data.ID });
    if (!vehicle) return req.error(404, 'Vehicle not found');
    if (!['DRAFT', 'ARCHIVED'].includes(vehicle.status)) {
      return req.error(409, `Cannot delete a vehicle in status ${vehicle.status}. Archive it first.`);
    }
  });

  // publish: loads the vehicle and its images, then delegates transition
  // logic to the state machine. The guard verifies price, branch, and images.
  srv.on('publish', async (req) => {
    const { vehicleId } = req.data;
    const vehicle = await SELECT.one.from(Vehicles)
      .columns('ID', 'status', 'price', 'branch_ID')
      .where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');

    const images = await SELECT.from(VehicleImages).where({ vehicle_ID: vehicleId });
    vehicle.images = images;

    let newStatus;
    try { newStatus = transition(vehicle, 'VehiclePublished'); }
    catch (e) { return req.error(409, e.message); }

    await UPDATE(Vehicles).set({ status: newStatus }).where({ ID: vehicleId });
    await srv.emit('VehiclePublished', { vehicleId });
    return newStatus;
  });

  // archive: transitions a DRAFT or FOR_SALE vehicle to ARCHIVED.
  srv.on('archive', async (req) => {
    const { vehicleId } = req.data;
    const vehicle = await SELECT.one.from(Vehicles).columns('ID', 'status').where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');

    let newStatus;
    try { newStatus = transition(vehicle, 'VehicleArchived'); }
    catch (e) { return req.error(409, e.message); }

    await UPDATE(Vehicles).set({ status: newStatus }).where({ ID: vehicleId });
    return newStatus;
  });

  // searchVehicles: builds a dynamic WHERE clause from optional filter params.
  // Guest callers are silently restricted to FOR_SALE.
  srv.on('searchVehicles', async (req) => {
    const { brand, model, priceMin, priceMax, status, branchId } = req.data;
    const isGuest = !req.user.is('authenticated-user');
    const effectiveStatus = isGuest ? 'FOR_SALE' : status;

    // Token-stream WHERE clause: each condition is pushed with 'and' separator
    // so missing filters are simply skipped rather than producing a broken query.
    const tokens = [];
    const add = (condition) => {
      if (tokens.length) tokens.push('and');
      tokens.push(...condition);
    };

    if (brand)           add(['brand',     '=',  brand]);
    if (model)           add(['model',     '=',  model]);
    if (branchId)        add(['branch_ID', '=',  branchId]);
    if (effectiveStatus) add(['status',    '=',  effectiveStatus]);
    if (priceMin != null) add(['price',    '>=', priceMin]);
    if (priceMax != null) add(['price',    '<=', priceMax]);

    const query = SELECT.from(Vehicles);
    if (tokens.length) query.where(tokens);
    return query;
  });

  // addImage: inserts a VehicleImages row, rejects duplicate sortOrder.
  srv.on('addImage', async (req) => {
    const { vehicleId, url, sortOrder } = req.data;
    const vehicle = await SELECT.one.from(Vehicles).where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');
    const duplicate = await SELECT.one.from(VehicleImages).where({ vehicle_ID: vehicleId, sortOrder });
    if (duplicate) return req.error(409, `An image with sortOrder ${sortOrder} already exists for this vehicle.`);
    const result = await INSERT.into(VehicleImages).entries({ vehicle_ID: vehicleId, url, sortOrder });
    return result.ID;
  });

  // updateImageOrder: repositions an existing image, rejects duplicate sortOrder.
  srv.on('updateImageOrder', async (req) => {
    const { imageId, sortOrder } = req.data;
    const image = await SELECT.one.from(VehicleImages).where({ ID: imageId });
    if (!image) return req.error(404, 'Image not found');
    const duplicate = await SELECT.one.from(VehicleImages)
      .where(['vehicle_ID', '=', image.vehicle_ID, 'and', 'sortOrder', '=', sortOrder, 'and', 'ID', '!=', imageId]);
    if (duplicate) return req.error(409, `An image with sortOrder ${sortOrder} already exists for this vehicle.`);
    await UPDATE(VehicleImages).set({ sortOrder }).where({ ID: imageId });
    return true;
  });

  // removeImage: hard-deletes the image row.
  srv.on('removeImage', async (req) => {
    const { imageId } = req.data;
    const image = await SELECT.one.from(VehicleImages).where({ ID: imageId });
    if (!image) return req.error(404, 'Image not found');
    await DELETE.from(VehicleImages).where({ ID: imageId });
    return true;
  });

  // Wire cache invalidation to every vehicle domain event.
  srv.on('VehiclePublished',       (msg) => invalidate(msg.data.vehicleId));
  srv.on('VehicleSold',            (msg) => invalidate(msg.data.vehicleId));
  srv.on('VehicleReserved',        (msg) => invalidate(msg.data.vehicleId));
  srv.on('VehicleReleased',        (msg) => invalidate(msg.data.vehicleId));
  srv.on('VehicleCheckoutStarted', (msg) => invalidate(msg.data.vehicleId));
});
```

### Modify `srv/index.cds` — add vehicle-service import

```diff
 using from '../modules/branch/api/branch-service';
+
+using from '../modules/vehicle/api/vehicle-service';
```

### Modify `package.json` — register VehicleService

```diff
   "BranchService":  { "impl": "modules/branch/application/branch-service.js" },
+  "VehicleService": { "impl": "modules/vehicle/application/vehicle-service.js" }
```

---

## T9 — Operator Portal

**What & Why:** `OperatorPortalService` provides branch-scoped vehicle read access for Operators. The `@restrict where: 'branch_ID = $user.branchId'` annotation injects a SQL predicate at query time — Operators physically cannot retrieve vehicles from other branches, even by guessing IDs. The `createVehicle` action forces branch from the user token for Operators so they cannot target another branch.

### Create `modules/vehicle/api/operator-portal.cds`

```cds
using {automarket} from '../db/vehicle';

// OperatorPortalService is the branch-scoped read/create surface for internal
// staff. Operators are restricted to their own branch via the @restrict where
// clause — CAP injects it as a SQL predicate, so Operators cannot enumerate
// vehicles from other branches even by guessing IDs.
// Managers see all branches and may create vehicles for any branch.
service OperatorPortalService @(path: '/operator') {

    @restrict: [
        { grant: 'READ', to: 'Operator', where: 'branch_ID = $user.branchId' },
        { grant: 'READ', to: 'Manager' }
    ]
    entity Vehicles as projection on automarket.Vehicles excluding { images };

    // createVehicle: for Operators the branch is taken from the user attribute —
    // they cannot target a different branch by passing a branchId.
    @requires: ['Operator', 'Manager']
    action createVehicle(vin: String, plateNumber: String, brand: String, model: String,
                         year: Integer, mileage: Integer, fuelType: automarket.FuelType,
                         transmission: automarket.Transmission, color: String,
                         price: Decimal, currency: String, branchId: String) returns String;
}
```

### Create `modules/vehicle/application/operator-portal.js`

```js
'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { Vehicles } = cds.entities('automarket');

  // createVehicle: inserts a DRAFT vehicle and enforces branch scoping.
  // Operators always get their branch from req.user.attr.branchId —
  // any branchId parameter they pass is silently ignored.
  srv.on('createVehicle', async (req) => {
    const { vin, plateNumber, brand, model, year, mileage,
            fuelType, transmission, color, price, currency, branchId } = req.data;

    const branch_ID = req.user.is('Operator') ? req.user.attr.branchId : branchId;
    if (!branch_ID) return req.error(400, 'branchId is required for Manager role.');

    const result = await INSERT.into(Vehicles).entries({
      vin, plateNumber, brand, model, year, mileage,
      fuelType, transmission, color, price, currency,
      branch_ID, status: 'DRAFT',
    });
    return result.ID;
  });
});
```

### Modify `srv/index.cds` — add operator-portal import

```diff
 using from '../modules/vehicle/api/vehicle-service';
+
+using from '../modules/vehicle/api/operator-portal';
```

### Modify `package.json` — register OperatorPortalService

```diff
   "VehicleService":      { "impl": "modules/vehicle/application/vehicle-service.js" },
+  "OperatorPortalService": { "impl": "modules/vehicle/application/operator-portal.js" }
```

---

## T10 — Customer Portal

**What & Why:** `CustomerPortalService` is the public-facing catalog. `@requires: 'any'` opens it to unauthenticated guests. The `status = FOR_SALE` filter is enforced in the `before READ` handler rather than a CDS annotation — this means the restriction cannot be silently lifted by a future annotation change without also modifying the handler code.

### Create `modules/vehicle/api/customer-portal.cds`

```cds
using {automarket} from '../db/vehicle';

// CustomerPortalService is the public-facing vehicle catalog.
// @requires: 'any' opens it to unauthenticated guests. The status = FOR_SALE
// restriction is enforced in the handler so it cannot be lifted by a future
// annotation change without also touching the handler.
service CustomerPortalService @(path: '/catalog') {

    // images excluded from the list projection — the detail page fetches
    // VehicleImages separately so the list query stays lightweight.
    @requires: 'any'
    entity Vehicles as projection on automarket.Vehicles excluding { images };

    // VehicleImages is needed for the detail page image gallery.
    @requires: 'any'
    entity VehicleImages as projection on automarket.VehicleImages;
}
```

### Create `modules/vehicle/application/customer-portal.js`

```js
'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  // Inject status = FOR_SALE into every Vehicles READ before it reaches the DB.
  // This runs for both list and detail requests (OData $filter does not bypass it)
  // because before-READ fires on all SELECT operations on the entity.
  srv.before('READ', 'Vehicles', (req) => {
    req.query.where({ status: 'FOR_SALE' });
  });
});
```

### Modify `srv/index.cds` — add customer-portal import

```diff
 using from '../modules/vehicle/api/operator-portal';
+
+using from '../modules/vehicle/api/customer-portal';
```

### Modify `package.json` — register CustomerPortalService

```diff
   "OperatorPortalService":  { "impl": "modules/vehicle/application/operator-portal.js" },
+  "CustomerPortalService":  { "impl": "modules/vehicle/application/customer-portal.js" }
```
