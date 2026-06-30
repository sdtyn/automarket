# EPIC08 — Sales

Sprint 8. Goal: online vehicle purchase flow — Order creation with vehicle checkout transition, cancellation, completion, and payment choreography (PaymentSucceeded/Failed → Order + Vehicle reactions). Payment provider integration is Sprint 9 (EPIC09); this epic owns the Order aggregate and its event subscribers.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC08-T1 | Sales Domain Model — `Orders` entity, `OrderStatus`/`DeliveryType` enums, partial unique constraint | Done |
| EPIC08-T2 | Sales Service — `createOrder` (→ vehicle PENDING_PAYMENT), `cancelOrder`, `completeOrder` | Done |
| EPIC08-T3 | Payment Choreography — `PaymentSucceeded` → order PAID + vehicle SOLD; `PaymentFailed` → order CANCELLED + vehicle released | Open |

### Sprint Backlog DoD mapping

- "Order Creation" → EPIC08-T1, T2
- "Order-level uniqueness constraint" → EPIC08-T1
- "Cross-aggregate choreography" → EPIC08-T2 (CheckoutStarted), T3 (PaymentSucceeded/Failed)

### Sign-off

_To be completed at sprint end._

---

## T1 — Sales Domain Model

**What & Why:** `Orders` tracks the customer's purchase intent from checkout through fulfilment. There is no guest path — `customer_ID` is always set. The `@sql.append` partial unique index enforces Domain Model Rule S-1 at the DB level: only one order per vehicle may be in CREATED, PENDING_PAYMENT, or PAID status simultaneously. This is defense-in-depth alongside the Vehicle state guard — relying on the application-level check alone leaves a race window under concurrent requests.

### Create `modules/sales/db/sales.cds`

```cds
namespace automarket;

using {BaseEntity}          from '../../../shared/types/common';
using {automarket.Vehicles} from '../../vehicle/db/vehicle';
using {automarket.Branches} from '../../branch/db/branch';

// Orders is the aggregate that represents a confirmed purchase intent.
// Unlike Reservations, an Order always has a customer — there is no guest path.
// The vehicle transitions to PENDING_PAYMENT when the Order is created;
// the Order itself moves through CREATED → PENDING_PAYMENT → PAID → COMPLETED.
//
// The partial unique index below enforces Domain Model Rule S-1: only one active
// order per vehicle. It is defense-in-depth alongside the Vehicle-level state
// guard — either one missing leaves a race window.
@sql.append: 'UNIQUE (vehicle_ID) WHERE status IN (''CREATED'', ''PENDING_PAYMENT'', ''PAID'')'
entity Orders : BaseEntity {
    vehicle      : Association to Vehicles;
    branch       : Association to Branches;
    // customer_ID is never null — Order always requires authentication.
    customer_ID  : String(255);
    orderDate    : DateTime;
    deliveryType : DeliveryType;
    status       : OrderStatus default 'CREATED';
}

type DeliveryType : String enum {
    CUSTOMER_PICKUP; // customer collects from branch
    HOME_DELIVERY;   // vehicle delivered to customer address
};

// OrderStatus lifecycle: CREATED → PENDING_PAYMENT → PAID → COMPLETED
//                                              ↘ CANCELLED (by customer, admin, or payment failure)
type OrderStatus : String enum {
    CREATED;         // order placed, awaiting payment initiation
    PENDING_PAYMENT; // payment flow started, vehicle locked
    PAID;            // payment captured; awaiting fulfilment
    COMPLETED;       // vehicle handed over
    CANCELLED;       // cancelled before payment, or payment failed
};
```

### Modify `db/index.cds` — add sales import

Add after the offer line:

```cds
using from '../modules/sales/db/sales';
```

---

## T2 — Sales Service

**What & Why:** `SalesService` owns the Order lifecycle. `createOrder` uses the vehicle state machine's `CheckoutStarted` transition — for a RESERVED vehicle, the guard enforces `requesterId === reservationOwnerId` so only the reservation holder can initiate checkout. The application-level active-order check runs after the state machine guard so that a duplicate order attempt gets a clear 409 error message (the DB partial unique index is the safety net if the app check is somehow bypassed). `cancelOrder` uses the `PaymentFailed` transition with `hasActiveReservation` context to return the vehicle to either RESERVED or FOR_SALE. `completeOrder` only advances the Order to COMPLETED — the vehicle is already SOLD at that point (set by T3's PaymentSucceeded subscriber).

### Create `modules/sales/api/sales-service.cds`

```cds
using {automarket} from '../db/sales';

// SalesService manages the online purchase lifecycle.
// There is no guest path — createOrder requires an authenticated Customer.
// The vehicle transitions to PENDING_PAYMENT immediately on order creation
// (CheckoutStarted event); payment reactions are wired in T3.
service SalesService @(path: '/sales') {

    @restrict: [
        { grant: 'READ', to: 'Customer', where: 'customer_ID = $user' },
        { grant: 'READ', to: ['Admin', 'Manager'] }
    ]
    entity Orders as projection on automarket.Orders;

    // createOrder: places a purchase order and locks the vehicle for payment.
    @requires: 'Customer'
    action createOrder(vehicleId: String, deliveryType: String) returns String;

    // cancelOrder: Customer may only cancel their own; Admin/Manager may cancel any.
    @requires: ['Customer', 'Admin', 'Manager']
    action cancelOrder(orderId: String)   returns Boolean;

    // completeOrder: marks a PAID order as fulfilled. Admin/Manager only.
    @requires: ['Admin', 'Manager']
    action completeOrder(orderId: String) returns Boolean;

    event OrderCreated   { orderId : String; vehicleId : String; }
    event OrderCancelled { orderId : String; vehicleId : String; }
    event OrderCompleted { orderId : String; vehicleId : String; }
}
```

### Create `modules/sales/application/sales-service.js`

```js
'use strict';

const cds = require('@sap/cds');
const { transition } = require('../../vehicle/domain/vehicle-state-machine');

module.exports = cds.service.impl(async function (srv) {
  const { Orders, Vehicles, Reservations } = cds.entities('automarket');

  // createOrder: locks the vehicle for payment via the CheckoutStarted transition.
  // For a RESERVED vehicle the guard requires requesterId === reservationOwnerId.
  srv.on('createOrder', async (req) => {
    const { vehicleId, deliveryType } = req.data;

    const vehicle = await SELECT.one.from(Vehicles).columns('ID', 'status', 'branch_ID').where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');

    const activeReservation = await SELECT.one
      .from(Reservations)
      .where({ vehicle_ID: vehicleId, status: { in: ['REQUESTED', 'APPROVED'] } });

    let newVehicleStatus;
    try {
      newVehicleStatus = transition(vehicle, 'CheckoutStarted', {
        requesterId:        req.user.id,
        reservationOwnerId: activeReservation?.customer_ID,
      });
    } catch (e) {
      return req.error(409, e.message);
    }

    // Application-level duplicate check — the partial unique index is the hard guard.
    const existingOrder = await SELECT.one
      .from(Orders)
      .where({ vehicle_ID: vehicleId, status: { in: ['CREATED', 'PENDING_PAYMENT', 'PAID'] } });
    if (existingOrder) return req.error(409, 'An active order already exists for this vehicle');

    await UPDATE(Vehicles).set({ status: newVehicleStatus }).where({ ID: vehicleId });

    const result = await INSERT.into(Orders).entries({
      vehicle_ID:  vehicleId,
      branch_ID:   vehicle.branch_ID,
      customer_ID: req.user.id,
      orderDate:   new Date().toISOString(),
      deliveryType,
      status:      'CREATED',
    });

    const vehicleSrv = await cds.connect.to('VehicleService');
    await vehicleSrv.emit('VehicleCheckoutStarted', { vehicleId });
    await srv.emit('OrderCreated', { orderId: result.ID, vehicleId });
    return result.ID;
  });

  // cancelOrder: reverses the PENDING_PAYMENT lock using PaymentFailed transition.
  srv.on('cancelOrder', async (req) => {
    const { orderId } = req.data;
    const order = await SELECT.one.from(Orders).where({ ID: orderId });
    if (!order) return req.error(404, 'Order not found');

    if (req.user.is('Customer') && order.customer_ID !== req.user.id) {
      return req.error(403, 'You can only cancel your own orders');
    }
    if (!['CREATED', 'PENDING_PAYMENT'].includes(order.status)) {
      return req.error(409, `Cannot cancel an order in status ${order.status}`);
    }

    const vehicle = await SELECT.one.from(Vehicles).columns('ID', 'status').where({ ID: order.vehicle_ID });

    if (vehicle && vehicle.status === 'PENDING_PAYMENT') {
      const activeReservation = await SELECT.one
        .from(Reservations)
        .where({ vehicle_ID: order.vehicle_ID, status: { in: ['REQUESTED', 'APPROVED'] } });

      let newVehicleStatus;
      try {
        newVehicleStatus = transition(vehicle, 'PaymentFailed', {
          hasActiveReservation: !!activeReservation,
        });
      } catch (e) {
        return req.error(409, e.message);
      }

      await UPDATE(Vehicles).set({ status: newVehicleStatus }).where({ ID: order.vehicle_ID });
      const vehicleSrv = await cds.connect.to('VehicleService');
      await vehicleSrv.emit('VehicleReleased', { vehicleId: order.vehicle_ID });
    }

    await UPDATE(Orders).set({ status: 'CANCELLED' }).where({ ID: orderId });
    await srv.emit('OrderCancelled', { orderId, vehicleId: order.vehicle_ID });
    return true;
  });

  // completeOrder: fulfils a PAID order. Vehicle is already SOLD (set in T3).
  srv.on('completeOrder', async (req) => {
    const { orderId } = req.data;
    const order = await SELECT.one.from(Orders).where({ ID: orderId });
    if (!order) return req.error(404, 'Order not found');
    if (order.status !== 'PAID') {
      return req.error(409, `Cannot complete an order in status ${order.status}`);
    }

    await UPDATE(Orders).set({ status: 'COMPLETED' }).where({ ID: orderId });
    await srv.emit('OrderCompleted', { orderId, vehicleId: order.vehicle_ID });
    return true;
  });
});
```

### Modify `srv/index.cds`

```cds
using from '../modules/sales/api/sales-service';
```

### Modify `package.json`

```json
"SalesService": { "impl": "modules/sales/application/sales-service.js" }
```
