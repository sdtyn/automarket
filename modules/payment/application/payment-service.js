'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { Payments, Orders } = cds.entities('automarket');

  // initiatePayment: idempotency-safe payment session creation.
  // Returns a simulated PSP session reference (real impl: PSP redirect URL).
  srv.on('initiatePayment', async (req) => {
    const { orderId, provider, idempotencyKey, amount, currency } = req.data;

    if (!idempotencyKey) return req.error(400, 'idempotencyKey is required');

    // Idempotency: same key → return existing paymentId without creating a duplicate.
    const existing = await SELECT.one.from(Payments).where({ idempotencyKey });
    if (existing) return `PSP-SESSION-${existing.ID}`;

    const order = await SELECT.one.from(Orders).where({ ID: orderId });
    if (!order) return req.error(404, 'Order not found');
    if (order.customer_ID !== req.user.id) return req.error(403, 'Not your order');
    if (!['CREATED', 'PENDING_PAYMENT'].includes(order.status)) {
      return req.error(409, `Cannot initiate payment for order in status ${order.status}`);
    }

    // Only one active payment per order at a time.
    const active = await SELECT.one
      .from(Payments)
      .where({ order_ID: orderId, status: { in: ['INITIATED', 'AUTHORIZED'] } });
    if (active) return req.error(409, 'An active payment already exists for this order');

    await UPDATE(Orders).set({ status: 'PENDING_PAYMENT' }).where({ ID: orderId });

    const id = cds.utils.uuid();
    await INSERT.into(Payments).entries({
      ID: id,
      order_ID: orderId,
      provider,
      amount,
      currency: currency || 'TRY',
      idempotencyKey,
      status: 'INITIATED',
    });

    return `PSP-SESSION-${id}`;
  });

  // retryPayment: opens a new INITIATED payment after a FAILED attempt.
  // Copies provider/amount/currency from the most recent failed payment.
  srv.on('retryPayment', async (req) => {
    const { orderId, idempotencyKey } = req.data;

    if (!idempotencyKey) return req.error(400, 'idempotencyKey is required');

    const existing = await SELECT.one.from(Payments).where({ idempotencyKey });
    if (existing) return `PSP-SESSION-${existing.ID}`;

    const order = await SELECT.one.from(Orders).where({ ID: orderId });
    if (!order) return req.error(404, 'Order not found');
    if (order.customer_ID !== req.user.id) return req.error(403, 'Not your order');
    if (order.status !== 'PENDING_PAYMENT') {
      return req.error(409, `Cannot retry payment for order in status ${order.status}`);
    }

    const failed = await SELECT.one
      .from(Payments)
      .where({ order_ID: orderId, status: 'FAILED' })
      .orderBy({ createdAt: 'desc' });
    if (!failed) return req.error(409, 'No failed payment found to retry');

    const active = await SELECT.one
      .from(Payments)
      .where({ order_ID: orderId, status: { in: ['INITIATED', 'AUTHORIZED'] } });
    if (active) return req.error(409, 'An active payment already exists for this order');

    const id = cds.utils.uuid();
    await INSERT.into(Payments).entries({
      ID: id,
      order_ID: orderId,
      provider: failed.provider,
      amount: failed.amount,
      currency: failed.currency,
      idempotencyKey,
      status: 'INITIATED',
    });

    return `PSP-SESSION-${id}`;
  });

  // capturePayment: simulates a PSP success webhook; emits PaymentSucceeded.
  srv.on('capturePayment', async (req) => {
    const { paymentId, transactionReference } = req.data;

    const payment = await SELECT.one.from(Payments).where({ ID: paymentId });
    if (!payment) return req.error(404, 'Payment not found');
    if (!['INITIATED', 'AUTHORIZED'].includes(payment.status)) {
      return req.error(409, `Cannot capture payment in status ${payment.status}`);
    }

    await UPDATE(Payments)
      .set({ status: 'CAPTURED', transactionReference })
      .where({ ID: paymentId });

    const order = await SELECT.one.from(Orders).where({ ID: payment.order_ID });
    await srv.emit('PaymentSucceeded', { orderId: payment.order_ID, vehicleId: order?.vehicle_ID });
    return true;
  });

  // failPayment: simulates a PSP decline/timeout webhook; emits PaymentFailed.
  srv.on('failPayment', async (req) => {
    const { paymentId } = req.data;

    const payment = await SELECT.one.from(Payments).where({ ID: paymentId });
    if (!payment) return req.error(404, 'Payment not found');
    if (!['INITIATED', 'AUTHORIZED'].includes(payment.status)) {
      return req.error(409, `Cannot fail payment in status ${payment.status}`);
    }

    await UPDATE(Payments).set({ status: 'FAILED' }).where({ ID: paymentId });

    const order = await SELECT.one.from(Orders).where({ ID: payment.order_ID });
    await srv.emit('PaymentFailed', { orderId: payment.order_ID, vehicleId: order?.vehicle_ID });
    return true;
  });

  // refundPayment: reverses a CAPTURED payment; emits PaymentRefunded.
  srv.on('refundPayment', async (req) => {
    const { paymentId } = req.data;

    const payment = await SELECT.one.from(Payments).where({ ID: paymentId });
    if (!payment) return req.error(404, 'Payment not found');
    if (payment.status !== 'CAPTURED') {
      return req.error(409, `Cannot refund payment in status ${payment.status}`);
    }

    await UPDATE(Payments).set({ status: 'REFUNDED' }).where({ ID: paymentId });

    const order = await SELECT.one.from(Orders).where({ ID: payment.order_ID });
    await srv.emit('PaymentRefunded', { orderId: payment.order_ID, vehicleId: order?.vehicle_ID });
    return true;
  });

  // getPaymentStatus: returns the most recent payment status for an order.
  // Customer ownership is checked here; @restrict on the entity covers READ.
  srv.on('getPaymentStatus', async (req) => {
    const { orderId } = req.data;

    if (req.user.is('Customer')) {
      const order = await SELECT.one.from(Orders).where({ ID: orderId });
      if (!order) return req.error(404, 'Order not found');
      if (order.customer_ID !== req.user.id) return req.error(403, 'Not your order');
    }

    const payment = await SELECT.one
      .from(Payments)
      .where({ order_ID: orderId })
      .orderBy({ createdAt: 'desc' });
    if (!payment) return req.error(404, 'No payment found for this order');

    return payment.status;
  });
});
