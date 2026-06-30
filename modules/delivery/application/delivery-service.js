'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { Deliveries, Orders } = cds.entities('automarket');

  // scheduleDelivery: validates order type and status, then creates a PLANNED delivery.
  // Rejects if the order is CUSTOMER_PICKUP — those have no physical handover step.
  srv.on('scheduleDelivery', async (req) => {
    const { orderId, plannedDate } = req.data;

    const order = await SELECT.one.from(Orders).where({ ID: orderId });
    if (!order) return req.error(404, 'Order not found');
    if (order.deliveryType !== 'HOME_DELIVERY') {
      return req.error(409, 'Cannot schedule delivery for CUSTOMER_PICKUP orders');
    }
    if (!['PAID', 'COMPLETED'].includes(order.status)) {
      return req.error(409, `Cannot schedule delivery for order in status ${order.status}`);
    }

    // Only one active delivery per order — prevents duplicate scheduling.
    const existing = await SELECT.one
      .from(Deliveries)
      .where({ order_ID: orderId, status: { in: ['PLANNED', 'IN_PROGRESS'] } });
    if (existing) return req.error(409, 'An active delivery already exists for this order');

    const result = await INSERT.into(Deliveries).entries({
      order_ID: orderId,
      plannedDate,
      status: 'PLANNED',
    });

    return result.ID;
  });

  // updateDelivery: updates plannedDate and/or status for a non-terminal delivery.
  // DELIVERED and FAILED are terminal — no further updates are accepted.
  srv.on('updateDelivery', async (req) => {
    const { deliveryId, plannedDate, status } = req.data;

    const delivery = await SELECT.one.from(Deliveries).where({ ID: deliveryId });
    if (!delivery) return req.error(404, 'Delivery not found');
    if (['DELIVERED', 'FAILED'].includes(delivery.status)) {
      return req.error(409, `Cannot update a delivery in terminal status ${delivery.status}`);
    }

    const updates = {};
    if (plannedDate) updates.plannedDate = plannedDate;
    if (status) updates.status = status;
    if (Object.keys(updates).length === 0) return req.error(400, 'No fields to update');

    await UPDATE(Deliveries).set(updates).where({ ID: deliveryId });
    return true;
  });

  // completeDelivery: sets status to DELIVERED and records today as deliveredDate.
  // Accepts PLANNED or IN_PROGRESS — a delivery may be completed without
  // going through IN_PROGRESS if the branch skipped the status update.
  srv.on('completeDelivery', async (req) => {
    const { deliveryId } = req.data;

    const delivery = await SELECT.one.from(Deliveries).where({ ID: deliveryId });
    if (!delivery) return req.error(404, 'Delivery not found');
    if (!['PLANNED', 'IN_PROGRESS'].includes(delivery.status)) {
      return req.error(409, `Cannot complete delivery in status ${delivery.status}`);
    }

    await UPDATE(Deliveries)
      .set({
        status: 'DELIVERED',
        deliveredDate: new Date().toISOString().split('T')[0],
      })
      .where({ ID: deliveryId });
    return true;
  });
});
