'use strict';

const path = require('path');
const cds = require('@sap/cds');

const ROOT = path.join(__dirname, '../../..');

// Credentials for the mocked auth users defined in package.json cds.requires.auth.users.
const customerBauerAuth = { username: 'customer.bauer@automarkt.de', password: 'Test@1234' };
const customerHoffmannAuth = { username: 'customer.hoffmann@automarkt.de', password: 'Test@1234' };
const adminAuth = { username: 'admin.mueller@automarkt.de', password: 'Test@1234' };
const managerAuth = { username: 'manager.schmidt@automarkt.de', password: 'Test@1234' };

// FOR_SALE vehicles seeded in db/data/automarket.Vehicles.csv, all under branch 001.
// Each scenario below uses its own vehicle so state changes (PENDING_PAYMENT/SOLD/...)
// in one describe block never leak into another — the suite shares one in-memory DB.
const VEHICLE_INITIATE = '40000000-4000-4000-4000-400000000001';
const VEHICLE_CAPTURE = '40000000-4000-4000-4000-400000000002';
const VEHICLE_FAIL = '40000000-4000-4000-4000-400000000003';
const VEHICLE_REFUND = '40000000-4000-4000-4000-400000000004';
const VEHICLE_STATUS_A = '40000000-4000-4000-4000-400000000005';
const VEHICLE_NOT_OWNER = '40000000-4000-4000-4000-400000000006';
const VEHICLE_ACTIVE_CONFLICT = '40000000-4000-4000-4000-400000000007';
const VEHICLE_RETRY_GUARDS = '40000000-4000-4000-4000-400000000008';
const VEHICLE_STATUS_B = '40000000-4000-4000-4000-400000000009';
const VEHICLE_RETRY_GAP = '40000000-4000-4000-4000-400000000010';

describe('PaymentService — integration', () => {
  // CAP server startup takes time.
  jest.setTimeout(60000);

  // cds.test() registers beforeAll/afterAll to start/stop an in-process CAP server
  // with in-memory SQLite. CSV files in db/data/ are auto-loaded as seed data.
  const { POST, GET } = cds.test(ROOT).silent();

  // Places a purchase order for vehicleId as the given user and returns the orderId.
  async function createOrder(vehicleId, auth) {
    const res = await POST(
      '/sales/createOrder',
      { vehicleId, deliveryType: 'CUSTOMER_PICKUP' },
      { auth }
    );
    return res.data.value ?? res.data;
  }

  // Opens a payment session for orderId and returns the paymentId (strips the PSP-SESSION- prefix).
  async function initiatePayment(orderId, idempotencyKey, auth = customerBauerAuth) {
    const res = await POST(
      '/payments/initiatePayment',
      { orderId, provider: 'StripeDE', idempotencyKey, amount: 28990.0, currency: 'EUR' },
      { auth }
    );
    const session = res.data.value ?? res.data;
    return session.replace('PSP-SESSION-', '');
  }

  // ── initiatePayment — happy path ────────────────────────────────────────────

  describe('initiatePayment — happy path', () => {
    it('creates a payment session and moves the order to PENDING_PAYMENT', async () => {
      const orderId = await createOrder(VEHICLE_INITIATE, customerBauerAuth);
      const paymentId = await initiatePayment(orderId, 'pay-init-001');
      expect(paymentId).toBeDefined();

      const { Orders } = cds.entities('automarket');
      const order = await SELECT.one.from(Orders).where({ ID: orderId });
      expect(order.status).toBe('PENDING_PAYMENT');
    });

    it('returns the same session for a repeated idempotencyKey (no duplicate row)', async () => {
      const orderId = await createOrder(VEHICLE_ACTIVE_CONFLICT, customerHoffmannAuth);
      const first = await initiatePayment(orderId, 'pay-idem-001', customerHoffmannAuth);
      const second = await initiatePayment(orderId, 'pay-idem-001', customerHoffmannAuth);
      expect(second).toBe(first);

      const { Payments } = cds.entities('automarket');
      const rows = await SELECT.from(Payments).where({ idempotencyKey: 'pay-idem-001' });
      expect(rows.length).toBe(1);
    });
  });

  // ── initiatePayment — error cases ───────────────────────────────────────────

  describe('initiatePayment — error cases', () => {
    it('returns 400 when idempotencyKey is missing', async () => {
      const orderId = await createOrder(VEHICLE_RETRY_GUARDS, customerBauerAuth);
      const err = await POST(
        '/payments/initiatePayment',
        { orderId, provider: 'StripeDE', amount: 1, currency: 'EUR' },
        { auth: customerBauerAuth }
      ).catch((e) => e);
      expect(err.status).toBe(400);
    });

    it('returns 404 for a non-existent order', async () => {
      const err = await POST(
        '/payments/initiatePayment',
        { orderId: 'does-not-exist', idempotencyKey: 'pay-404', amount: 1, currency: 'EUR' },
        { auth: customerBauerAuth }
      ).catch((e) => e);
      expect(err.status).toBe(404);
    });

    it("returns 403 for another customer's order", async () => {
      const orderId = await createOrder(VEHICLE_NOT_OWNER, customerBauerAuth);
      const err = await POST(
        '/payments/initiatePayment',
        { orderId, idempotencyKey: 'pay-403', amount: 1, currency: 'EUR' },
        { auth: customerHoffmannAuth }
      ).catch((e) => e);
      expect(err.status).toBe(403);
    });

    it('returns 409 when an active payment already exists for the order', async () => {
      // Reuses the order created in the idempotency test above — it already has
      // an INITIATED payment, so a different idempotencyKey must be rejected.
      const { Orders } = cds.entities('automarket');
      const order = await SELECT.one.from(Orders).where({ vehicle_ID: VEHICLE_ACTIVE_CONFLICT });

      const err = await POST(
        '/payments/initiatePayment',
        { orderId: order.ID, idempotencyKey: 'pay-conflict-002', amount: 1, currency: 'EUR' },
        { auth: customerHoffmannAuth }
      ).catch((e) => e);
      expect(err.status).toBe(409);
    });
  });

  // ── capturePayment ───────────────────────────────────────────────────────────
  // Simulates a PSP success webhook. Verifies the full choreography: Payment
  // CAPTURED, Order PAID (SalesService PaymentSucceeded subscriber), Vehicle SOLD.

  describe('capturePayment', () => {
    it('captures the payment and cascades Order → PAID, Vehicle → SOLD', async () => {
      const orderId = await createOrder(VEHICLE_CAPTURE, customerBauerAuth);
      const paymentId = await initiatePayment(orderId, 'pay-capture-001');

      const res = await POST(
        '/payments/capturePayment',
        { paymentId, transactionReference: 'TXN-001' },
        { auth: adminAuth }
      );
      expect(res.data.value ?? res.data).toBe(true);

      const { Payments, Orders } = cds.entities('automarket');
      const payment = await SELECT.one.from(Payments).where({ ID: paymentId });
      expect(payment.status).toBe('CAPTURED');

      const order = await SELECT.one.from(Orders).where({ ID: orderId });
      expect(order.status).toBe('PAID');

      const vehicleSrv = await cds.connect.to('VehicleService');
      const { Vehicles } = vehicleSrv.entities;
      const vehicle = await SELECT.one.from(Vehicles).where({ ID: VEHICLE_CAPTURE });
      expect(vehicle.status).toBe('SOLD');
    });

    it('rejects a Customer with 403 (Admin-only action)', async () => {
      const err = await POST(
        '/payments/capturePayment',
        { paymentId: 'irrelevant', transactionReference: 'TXN-x' },
        { auth: customerBauerAuth }
      ).catch((e) => e);
      expect(err.status).toBe(403);
    });

    it('returns 404 for a non-existent payment', async () => {
      const err = await POST(
        '/payments/capturePayment',
        { paymentId: 'does-not-exist', transactionReference: 'TXN-x' },
        { auth: adminAuth }
      ).catch((e) => e);
      expect(err.status).toBe(404);
    });

    it('returns 409 when the payment is not INITIATED/AUTHORIZED', async () => {
      const orderId = await createOrder(VEHICLE_STATUS_A, customerBauerAuth);
      const paymentId = await initiatePayment(orderId, 'pay-double-capture');
      await POST(
        '/payments/capturePayment',
        { paymentId, transactionReference: 'TXN-002' },
        { auth: adminAuth }
      );

      const err = await POST(
        '/payments/capturePayment',
        { paymentId, transactionReference: 'TXN-003' },
        { auth: adminAuth }
      ).catch((e) => e);
      expect(err.status).toBe(409);
    });
  });

  // ── failPayment ──────────────────────────────────────────────────────────────

  describe('failPayment', () => {
    it('fails the payment and cascades Order → CANCELLED, Vehicle → FOR_SALE', async () => {
      const orderId = await createOrder(VEHICLE_FAIL, customerBauerAuth);
      const paymentId = await initiatePayment(orderId, 'pay-fail-001');

      const res = await POST('/payments/failPayment', { paymentId }, { auth: adminAuth });
      expect(res.data.value ?? res.data).toBe(true);

      const { Payments, Orders } = cds.entities('automarket');
      const payment = await SELECT.one.from(Payments).where({ ID: paymentId });
      expect(payment.status).toBe('FAILED');

      const order = await SELECT.one.from(Orders).where({ ID: orderId });
      expect(order.status).toBe('CANCELLED');

      const vehicleSrv = await cds.connect.to('VehicleService');
      const { Vehicles } = vehicleSrv.entities;
      const vehicle = await SELECT.one.from(Vehicles).where({ ID: VEHICLE_FAIL });
      expect(vehicle.status).toBe('FOR_SALE');
    });

    it('returns 404 for a non-existent payment', async () => {
      const err = await POST(
        '/payments/failPayment',
        { paymentId: 'does-not-exist' },
        { auth: adminAuth }
      ).catch((e) => e);
      expect(err.status).toBe(404);
    });

    it('returns 409 when the payment is not INITIATED/AUTHORIZED', async () => {
      const orderId = await createOrder(VEHICLE_STATUS_B, customerHoffmannAuth);
      const paymentId = await initiatePayment(orderId, 'pay-double-fail', customerHoffmannAuth);
      await POST('/payments/failPayment', { paymentId }, { auth: adminAuth });

      const err = await POST('/payments/failPayment', { paymentId }, { auth: adminAuth }).catch(
        (e) => e
      );
      expect(err.status).toBe(409);
    });
  });

  // ── retryPayment ─────────────────────────────────────────────────────────────

  describe('retryPayment — guards and the CANCELLED-order gap', () => {
    it('returns 400 when idempotencyKey is missing', async () => {
      const err = await POST(
        '/payments/retryPayment',
        { orderId: 'irrelevant' },
        { auth: customerBauerAuth }
      ).catch((e) => e);
      expect(err.status).toBe(400);
    });

    it('returns 404 for a non-existent order', async () => {
      const err = await POST(
        '/payments/retryPayment',
        { orderId: 'does-not-exist', idempotencyKey: 'pay-retry-404' },
        { auth: customerBauerAuth }
      ).catch((e) => e);
      expect(err.status).toBe(404);
    });

    it("returns 403 for another customer's order", async () => {
      const orderId = await createOrder('40000000-4000-4000-4000-400000000016', customerBauerAuth);
      const err = await POST(
        '/payments/retryPayment',
        { orderId, idempotencyKey: 'pay-retry-403' },
        { auth: customerHoffmannAuth }
      ).catch((e) => e);
      expect(err.status).toBe(403);
    });

    // KNOWN ISSUE — see docs/error-log.md "retryPayment is unreachable after failPayment".
    // failPayment's PaymentFailed choreography (SalesService) moves the Order straight
    // to CANCELLED, but retryPayment requires the Order to still be PENDING_PAYMENT.
    // The two behaviours were built in separate epics (EPIC08-T3 and EPIC09-T2) and
    // were never reconciled, so retry can never succeed. This test documents the
    // actual (contradictory) behaviour rather than the originally intended one.
    it('returns 409 (not a retried session) once the order has been cancelled by a failed payment', async () => {
      const orderId = await createOrder(VEHICLE_RETRY_GAP, customerBauerAuth);
      const paymentId = await initiatePayment(orderId, 'pay-retry-gap-001');
      await POST('/payments/failPayment', { paymentId }, { auth: adminAuth });

      const err = await POST(
        '/payments/retryPayment',
        { orderId, idempotencyKey: 'pay-retry-gap-002' },
        { auth: customerBauerAuth }
      ).catch((e) => e);
      expect(err.status).toBe(409);
    });
  });

  // ── refundPayment ────────────────────────────────────────────────────────────

  describe('refundPayment', () => {
    it('refunds a CAPTURED payment', async () => {
      const orderId = await createOrder(VEHICLE_REFUND, customerBauerAuth);
      const paymentId = await initiatePayment(orderId, 'pay-refund-001');
      await POST(
        '/payments/capturePayment',
        { paymentId, transactionReference: 'TXN-refund' },
        { auth: adminAuth }
      );

      const res = await POST('/payments/refundPayment', { paymentId }, { auth: managerAuth });
      expect(res.data.value ?? res.data).toBe(true);

      const { Payments } = cds.entities('automarket');
      const payment = await SELECT.one.from(Payments).where({ ID: paymentId });
      expect(payment.status).toBe('REFUNDED');
    });

    it('rejects a Customer with 403 (Admin/Manager only)', async () => {
      const err = await POST(
        '/payments/refundPayment',
        { paymentId: 'irrelevant' },
        { auth: customerBauerAuth }
      ).catch((e) => e);
      expect(err.status).toBe(403);
    });

    it('returns 409 for a payment that is not CAPTURED', async () => {
      const orderId = await createOrder('40000000-4000-4000-4000-400000000011', customerBauerAuth);
      const paymentId = await initiatePayment(orderId, 'pay-refund-guard');

      const err = await POST('/payments/refundPayment', { paymentId }, { auth: adminAuth }).catch(
        (e) => e
      );
      expect(err.status).toBe(409);
    });
  });

  // ── getPaymentStatus ─────────────────────────────────────────────────────────

  describe('getPaymentStatus', () => {
    it("returns the most recent payment status for the customer's own order", async () => {
      const orderId = await createOrder('40000000-4000-4000-4000-400000000012', customerBauerAuth);
      await initiatePayment(orderId, 'pay-status-001');

      const res = await GET(`/payments/getPaymentStatus(orderId='${orderId}')`, {
        auth: customerBauerAuth,
      });
      expect(res.data.value ?? res.data).toBe('INITIATED');
    });

    it("Admin can read any order's payment status", async () => {
      const orderId = await createOrder(
        '40000000-4000-4000-4000-400000000013',
        customerHoffmannAuth
      );
      await initiatePayment(orderId, 'pay-status-002', customerHoffmannAuth);

      const res = await GET(`/payments/getPaymentStatus(orderId='${orderId}')`, {
        auth: adminAuth,
      });
      expect(res.data.value ?? res.data).toBe('INITIATED');
    });

    it("returns 403 when a Customer queries another customer's order", async () => {
      const orderId = await createOrder('40000000-4000-4000-4000-400000000014', customerBauerAuth);
      await initiatePayment(orderId, 'pay-status-003');

      const err = await GET(`/payments/getPaymentStatus(orderId='${orderId}')`, {
        auth: customerHoffmannAuth,
      }).catch((e) => e);
      expect(err.status).toBe(403);
    });

    it('returns 404 when the order has no payment yet', async () => {
      const orderId = await createOrder('40000000-4000-4000-4000-400000000015', customerBauerAuth);

      const err = await GET(`/payments/getPaymentStatus(orderId='${orderId}')`, {
        auth: customerBauerAuth,
      }).catch((e) => e);
      expect(err.status).toBe(404);
    });
  });
});
