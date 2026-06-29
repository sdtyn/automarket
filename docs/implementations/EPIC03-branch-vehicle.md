# EPIC03 — Branch & Vehicle Management

Sprint 2. Goal: branch and vehicle domain models, state machine, CRUD services, search, image management, event wiring, and portal projections.

---

## T1 — Branch Domain Model

**What:** `Branches` entity and `BranchStatus` enum (`ACTIVE/INACTIVE`) created. Registered in `db/index.cds`.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/branch/db/branch.cds` | Created | `Branches` entity (code, name, address, city, country, region, status); `BranchStatus` enum |
| `db/index.cds` | Modified | `branch.cds` import added |
| `docs/sprint-2-branch-vehicle.md` | Created | Sprint-2 ticket tracking table |

---

## T2 — Branch Service

**What:** `BranchService` CDS definition and handlers created. `createBranch` (Admin), `updateBranch` (Admin/Manager), `deactivateBranch` (Admin) actions written. Registered in `package.json` services.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/branch/api/branch-service.cds` | Created | `BranchService @(path: '/branch')`, 3 actions with `@requires` role guards |
| `modules/branch/application/branch-service.js` | Created | `createBranch`, `updateBranch`, `deactivateBranch` handlers |
| `srv/index.cds` | Modified | `branch-service` import added |
| `package.json` | Modified | `BranchService` impl path added to services section |

---

## T3 — Vehicle Domain Model

**What:** `Vehicles` entity (vin, plateNumber, brand, model, year, mileage, fuelType, transmission, color, price, currency, status, branch association), `VehicleImages` entity, and `VehicleStatus` enum (`DRAFT→DELIVERED+ARCHIVED`) created. `FuelType` and `Transmission` enums defined.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/vehicle/db/vehicle.cds` | Created | `Vehicles`, `VehicleImages` entities; `VehicleStatus`, `FuelType`, `Transmission` enums |
| `db/index.cds` | Modified | `vehicle.cds` import added |

---

## T4 — Vehicle State Machine

**What:** `vehicle-state-machine.js` domain module created with 13 transition rules (from/event/to/guard). `transition(vehicle, event, context)` and `allowedEvents(vehicle, context)` functions exported.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/vehicle/domain/vehicle-state-machine.js` | Created | `TRANSITIONS` table (13 rules); `transition()` and `allowedEvents()` functions |

**Key transitions:**
- `DRAFT` → `FOR_SALE` via `VehiclePublished` (guard: requires price + branch + at least one image)
- `FOR_SALE` → `RESERVED` via `ReservationCreated` / `OfferApproved`
- `RESERVED` → `PENDING_PAYMENT` via `CheckoutStarted` (guard: reservation owner only)
- `PENDING_PAYMENT` → `FOR_SALE` / `RESERVED` via `PaymentFailed` (depends on active reservation)
- `DRAFT` / `FOR_SALE` → `ARCHIVED` via `VehicleArchived`

---

## T5 — Vehicle Service

**What:** `VehicleService` CDS definition and handlers created. `@odata.etag` on `modifiedAt` for optimistic locking, `@restrict` for per-verb role guards, `publish` and `archive` actions drive state transitions through the state machine. Missing `VehicleService` registration in `package.json` fixed (discovered in T9).

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/vehicle/api/vehicle-service.cds` | Created | `VehicleService @(path: '/vehicle')`; `Vehicles` projection with `@odata.etag modifiedAt`; `publish` and `archive` actions |
| `modules/vehicle/application/vehicle-service.js` | Created | `before CREATE` (force status=DRAFT), `before UPDATE` (block direct status change), `before DELETE` (DRAFT/ARCHIVED only), `publish` and `archive` handlers |
| `srv/index.cds` | Modified | `vehicle-service` import added |
| `package.json` | Modified | `VehicleService` impl path added (in T9) |

---

## T6 — Vehicle Search

**What:** `searchVehicles` function added to `VehicleService`. Guest callers are silently restricted to `FOR_SALE` via `req.user.is('authenticated-user')` check in the handler. Supports `brand`, `model`, `priceMin`, `priceMax`, `status`, `branchId` parameters.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/vehicle/api/vehicle-service.cds` | Modified | `searchVehicles` function with `@requires: 'any'` added |
| `modules/vehicle/application/vehicle-service.js` | Modified | `srv.on('searchVehicles', ...)` handler added; token-stream WHERE clause approach |

---

## T7 — Vehicle Images

**What:** `VehicleImages` entity added to `VehicleService` as a read-only projection. `addImage`, `updateImageOrder`, `removeImage` actions and handlers written. Duplicate `sortOrder` within the same vehicle rejected in `addImage` and `updateImageOrder`.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/vehicle/api/vehicle-service.cds` | Modified | `VehicleImages` read-only projection; `addImage`, `updateImageOrder`, `removeImage` action definitions |
| `modules/vehicle/application/vehicle-service.js` | Modified | 3 new handlers: add image (sortOrder uniqueness check), update order, remove |

---

## T8 — Cache-Bust Event Wiring

**What:** 5 domain events (`VehiclePublished`, `VehicleSold`, `VehicleReserved`, `VehicleReleased`, `VehicleCheckoutStarted`) declared in CDS. `srv.emit('VehiclePublished', ...)` added to `publish` handler. `cache-bust.js` infrastructure stub created. Subscriptions for all 5 events wired — future modules (Reservation, Payment) only need to emit; no additional wiring required.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/vehicle/api/vehicle-service.cds` | Modified | 5 domain event declarations added |
| `modules/vehicle/infrastructure/cache-bust.js` | Created | `invalidate(vehicleId)` stub — to be replaced with Redis/CDN call |
| `modules/vehicle/application/vehicle-service.js` | Modified | `srv.emit` in `publish` handler; 5 `srv.on` subscriptions calling cache-bust |

---

## T9 — Operator Portal

**What:** `OperatorPortalService` created. Operators are restricted to their own branch via `@restrict where: 'branch_ID = $user.branchId'` at the SQL level. Managers see all branches. `createVehicle` action reads branch from `req.user.attr.branchId` for Operators; Managers supply it explicitly. `branchId` attribute added to mocked operator user in `package.json`.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/vehicle/api/operator-portal.cds` | Created | `OperatorPortalService @(path: '/operator')`; ABAC `@restrict` on Vehicles; `createVehicle` action |
| `modules/vehicle/application/operator-portal.js` | Created | `createVehicle` handler: branch_ID from user attribute for Operators |
| `srv/index.cds` | Modified | `operator-portal` import added |
| `package.json` | Modified | `OperatorPortalService` impl path; `attr.branchId` added to operator mocked user |

---

## T10 — Customer Portal

**What:** `CustomerPortalService` created for the public-facing vehicle catalog. Guest access enabled (`@requires: 'any'`). `before READ` handler injects `status = 'FOR_SALE'` into every Vehicles query — enforced in the handler rather than a CDS annotation so it cannot be lifted without a code change.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/vehicle/api/customer-portal.cds` | Created | `CustomerPortalService @(path: '/catalog')`; `Vehicles` and `VehicleImages` projections with `@requires: 'any'` |
| `modules/vehicle/application/customer-portal.js` | Created | `before READ` handler: `req.query.where({ status: 'FOR_SALE' })` |
| `srv/index.cds` | Modified | `customer-portal` import added |
| `package.json` | Modified | `CustomerPortalService` impl path added |
