'use strict';

const cds = require('@sap/cds');
// Shared state machine — same file used by OperatorPortal and VehicleService.
const { transition } = require('../../vehicle/domain/vehicle-state-machine');

module.exports = cds.service.impl(async function (srv) {
  // Subscribe to PaymentService to react to payment outcomes.
  // PaymentService does not exist yet (EPIC09); these handlers are registered
  // now so they fire automatically once the Payment module emits events.
  const PaymentSrv = await cds.connect.to('PaymentService');

  // PaymentSucceeded: advance order to PAID, vehicle to SOLD, emit VehicleSold.
  PaymentSrv.on('PaymentSucceeded', async (msg) => {
    const { orderId, vehicleId } = msg.data;

    const vehicle = await SELECT.one
      .from(Vehicles)
      .columns('ID', 'status')
      .where({ ID: vehicleId });
    if (vehicle && vehicle.status === 'PENDING_PAYMENT') {
      let newVehicleStatus;
      try {
        newVehicleStatus = transition(vehicle, 'PaymentSucceeded');
      } catch (_) {
        return;
      }
      await UPDATE(Vehicles).set({ status: newVehicleStatus }).where({ ID: vehicleId });
      const vehicleSrv = await cds.connect.to('VehicleService');
      await vehicleSrv.emit('VehicleSold', { vehicleId });
    }

    await UPDATE(Orders).set({ status: 'PAID' }).where({ ID: orderId });
  });

  // PaymentFailed: cancel order, return vehicle to FOR_SALE or RESERVED.
  PaymentSrv.on('PaymentFailed', async (msg) => {
    const { orderId, vehicleId } = msg.data;

    const vehicle = await SELECT.one
      .from(Vehicles)
      .columns('ID', 'status')
      .where({ ID: vehicleId });
    if (vehicle && vehicle.status === 'PENDING_PAYMENT') {
      const activeReservation = await SELECT.one
        .from(Reservations)
        .where({ vehicle_ID: vehicleId, status: { in: ['REQUESTED', 'APPROVED'] } });

      let newVehicleStatus;
      try {
        newVehicleStatus = transition(vehicle, 'PaymentFailed', {
          hasActiveReservation: !!activeReservation,
        });
      } catch (_) {
        return;
      }
      await UPDATE(Vehicles).set({ status: newVehicleStatus }).where({ ID: vehicleId });
      const vehicleSrv = await cds.connect.to('VehicleService');
      await vehicleSrv.emit('VehicleReleased', { vehicleId });
    }

    await UPDATE(Orders).set({ status: 'CANCELLED' }).where({ ID: orderId });
  });

  const { Orders, Vehicles, Reservations } = cds.entities('automarket');

  // createOrder: locks the vehicle for payment via the CheckoutStarted transition.
  // For a RESERVED vehicle the guard requires requesterId === reservationOwnerId,
  // so only the reservation holder may initiate checkout from that state.
  srv.on('createOrder', async (req) => {
    const { vehicleId, deliveryType } = req.data;

    const vehicle = await SELECT.one
      .from(Vehicles)
      .columns('ID', 'status', 'branch_ID')
      .where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');

    const activeReservation = await SELECT.one
      .from(Reservations)
      .where({ vehicle_ID: vehicleId, status: { in: ['REQUESTED', 'APPROVED'] } });

    let newVehicleStatus;
    try {
      newVehicleStatus = transition(vehicle, 'CheckoutStarted', {
        requesterId: req.user.id,
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
      vehicle_ID: vehicleId,
      branch_ID: vehicle.branch_ID,
      customer_ID: req.user.id,
      orderDate: new Date().toISOString(),
      deliveryType,
      status: 'CREATED',
    });

    const vehicleSrv = await cds.connect.to('VehicleService');
    await vehicleSrv.emit('VehicleCheckoutStarted', { vehicleId });
    await srv.emit('OrderCreated', { orderId: result.ID, vehicleId });
    return result.ID;
  });

  // cancelOrder: reverses the vehicle's PENDING_PAYMENT lock using the PaymentFailed
  // transition — returns to RESERVED if a reservation still exists, FOR_SALE otherwise.
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

    const vehicle = await SELECT.one
      .from(Vehicles)
      .columns('ID', 'status')
      .where({ ID: order.vehicle_ID });

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

  // completeOrder: fulfils a PAID order. Vehicle is already SOLD (set in T3);
  // this action only advances the Order record to COMPLETED.
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
