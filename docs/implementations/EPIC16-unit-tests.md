# EPIC16 — Unit Tests

**Goal:** Cover the highest-risk business logic with Jest unit tests and `cds.test()` integration tests,
so regressions are caught automatically before they reach integration testing or production.

---

## Sprint Overview

### Ticket Table

| Ticket | Description | Status |
|--------|-------------|--------|
| EPIC16-T1 | Test infrastructure — Jest config + folder structure | Done |
| EPIC16-T2 | VehicleStateMachine unit tests | Done |
| EPIC16-T3 | Identity domain unit tests | Done |
| EPIC16-T4 | IdentityService integration tests | Done |
| EPIC16-T5 | PaymentService integration tests | Done |
| EPIC16-T6 | PricingService integration tests | Done |

### Sprint Backlog DoD Mapping

| DoD Item | Satisfied by |
|----------|-------------|
| All tests pass (`npm test`) | Every ticket |
| CI pipeline stays green | Verified after each commit |
| No test file contains Turkish comments | Pre-commit check (CLAUDE.md §5) |
| Each test file covers both happy path and error/guard cases | Per ticket |

### Sign-off

All six tickets delivered and CI green. 9 test suites, 107 tests. Sprint completed 2026-07-02.
Known issue found during T5 (`retryPayment` unreachable after `failPayment`) logged in
`docs/error-log.md`, not fixed — left for a follow-up ticket.

---

## EPIC16-T1: Test infrastructure — Jest config + folder structure

### What & Why

Jest is already installed (`devDependencies`) and `npm test` runs with `--passWithNoTests`, but
there is no `jest.config.js` and no `tests/unit/` folder. Without explicit config, Jest will
pick up any `*.test.js` file anywhere in the project — including inside `node_modules` — and the
`transform` / `testEnvironment` defaults may conflict with CAP's CommonJS modules.

This ticket creates the Jest config and folder structure so subsequent tickets can add test files
without worrying about runner configuration.

### Step-by-step

#### 1. Create `jest.config.js` in the project root

Create file `jest.config.js`:

```js
'use strict';

module.exports = {
  // Only look for tests under tests/unit/ — keeps http files and seed scripts out of the runner.
  testMatch: ['**/tests/unit/**/*.test.js'],
  testEnvironment: 'node',
  // CAP uses CommonJS; no transform needed.
  transform: {},
  // One suite at a time avoids port conflicts when multiple cds.test() servers start concurrently.
  maxWorkers: 1,
  // Print each test name so CI logs are readable without --verbose flag.
  verbose: true,
};
```

#### 2. Create `tests/unit/` folder with a `.gitkeep`

```
tests/
  unit/
    domain/       ← pure function tests (state machine, lockout, mfa, jwt)
    services/     ← cds.test() integration tests
```

Run:
```sh
mkdir -p tests/unit/domain tests/unit/services
touch tests/unit/domain/.gitkeep tests/unit/services/.gitkeep
```

#### 3. Verify

```sh
npm test
```

Expected output: `Test Suites: 0 skipped`, exit code 0.

---

## EPIC16-T5: PaymentService integration tests

### What & Why

`PaymentService` owns the full payment lifecycle (`initiatePayment`, `capturePayment`,
`failPayment`, `refundPayment`, `retryPayment`, `getPaymentStatus`) and cross-service
choreography with `SalesService` (Order status) and `VehicleService` (Vehicle status). Until
this ticket the only coverage was manual `.http` requests with placeholder IDs — no automated
test exercised the full initiate → capture/fail → refund/retry sequence end to end.

Each scenario in the test file uses its own seeded `FOR_SALE` vehicle (from
`db/data/automarket.Vehicles.csv`) so that state changes made by one scenario (vehicle going to
`PENDING_PAYMENT`, `SOLD`, etc.) never leak into another — the whole suite shares one in-memory
SQLite instance for the file's lifetime.

Writing the `retryPayment` tests surfaced a real design gap: `failPayment`'s `PaymentFailed`
choreography (built in EPIC08-T3) moves the Order straight to `CANCELLED`, but `retryPayment`
(built later, in EPIC09-T2) requires the Order to still be `PENDING_PAYMENT`. The two behaviours
were never reconciled, so `retryPayment` can never succeed after a real failed payment. This is
documented as a known issue in `docs/error-log.md` (`[2026-07-02] retryPayment is unreachable
after failPayment`) rather than fixed here — deciding whether a failed payment should still
allow retry is a product/design decision, out of scope for a test-writing ticket.

### Step-by-step

#### 1. Create `tests/unit/services/payment-service.test.js`

```js
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
      { auth },
    );
    return res.data.value ?? res.data;
  }

  // Opens a payment session for orderId and returns the paymentId (strips the PSP-SESSION- prefix).
  async function initiatePayment(orderId, idempotencyKey, auth = customerBauerAuth) {
    const res = await POST(
      '/payments/initiatePayment',
      { orderId, provider: 'StripeDE', idempotencyKey, amount: 28990.0, currency: 'EUR' },
      { auth },
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
        { auth: customerBauerAuth },
      ).catch((e) => e);
      expect(err.status).toBe(400);
    });

    it('returns 404 for a non-existent order', async () => {
      const err = await POST(
        '/payments/initiatePayment',
        { orderId: 'does-not-exist', idempotencyKey: 'pay-404', amount: 1, currency: 'EUR' },
        { auth: customerBauerAuth },
      ).catch((e) => e);
      expect(err.status).toBe(404);
    });

    it("returns 403 for another customer's order", async () => {
      const orderId = await createOrder(VEHICLE_NOT_OWNER, customerBauerAuth);
      const err = await POST(
        '/payments/initiatePayment',
        { orderId, idempotencyKey: 'pay-403', amount: 1, currency: 'EUR' },
        { auth: customerHoffmannAuth },
      ).catch((e) => e);
      expect(err.status).toBe(403);
    });

    it('returns 409 when an active payment already exists for the order', async () => {
      // Reuses the order created in the idempotency test above — it already has
      // an INITIATED payment, so a different idempotencyKey must be rejected.
      const { Orders } = cds.entities('automarket');
      const order = await SELECT.one
        .from(Orders)
        .where({ vehicle_ID: VEHICLE_ACTIVE_CONFLICT });

      const err = await POST(
        '/payments/initiatePayment',
        { orderId: order.ID, idempotencyKey: 'pay-conflict-002', amount: 1, currency: 'EUR' },
        { auth: customerHoffmannAuth },
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
        { auth: adminAuth },
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
        { auth: customerBauerAuth },
      ).catch((e) => e);
      expect(err.status).toBe(403);
    });

    it('returns 404 for a non-existent payment', async () => {
      const err = await POST(
        '/payments/capturePayment',
        { paymentId: 'does-not-exist', transactionReference: 'TXN-x' },
        { auth: adminAuth },
      ).catch((e) => e);
      expect(err.status).toBe(404);
    });

    it('returns 409 when the payment is not INITIATED/AUTHORIZED', async () => {
      const orderId = await createOrder(VEHICLE_STATUS_A, customerBauerAuth);
      const paymentId = await initiatePayment(orderId, 'pay-double-capture');
      await POST(
        '/payments/capturePayment',
        { paymentId, transactionReference: 'TXN-002' },
        { auth: adminAuth },
      );

      const err = await POST(
        '/payments/capturePayment',
        { paymentId, transactionReference: 'TXN-003' },
        { auth: adminAuth },
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
        { auth: adminAuth },
      ).catch((e) => e);
      expect(err.status).toBe(404);
    });

    it('returns 409 when the payment is not INITIATED/AUTHORIZED', async () => {
      const orderId = await createOrder(VEHICLE_STATUS_B, customerHoffmannAuth);
      const paymentId = await initiatePayment(orderId, 'pay-double-fail', customerHoffmannAuth);
      await POST('/payments/failPayment', { paymentId }, { auth: adminAuth });

      const err = await POST(
        '/payments/failPayment',
        { paymentId },
        { auth: adminAuth },
      ).catch((e) => e);
      expect(err.status).toBe(409);
    });
  });

  // ── retryPayment ─────────────────────────────────────────────────────────────

  describe('retryPayment — guards and the CANCELLED-order gap', () => {
    it('returns 400 when idempotencyKey is missing', async () => {
      const err = await POST(
        '/payments/retryPayment',
        { orderId: 'irrelevant' },
        { auth: customerBauerAuth },
      ).catch((e) => e);
      expect(err.status).toBe(400);
    });

    it('returns 404 for a non-existent order', async () => {
      const err = await POST(
        '/payments/retryPayment',
        { orderId: 'does-not-exist', idempotencyKey: 'pay-retry-404' },
        { auth: customerBauerAuth },
      ).catch((e) => e);
      expect(err.status).toBe(404);
    });

    it("returns 403 for another customer's order", async () => {
      const orderId = await createOrder('40000000-4000-4000-4000-400000000016', customerBauerAuth);
      const err = await POST(
        '/payments/retryPayment',
        { orderId, idempotencyKey: 'pay-retry-403' },
        { auth: customerHoffmannAuth },
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
        { auth: customerBauerAuth },
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
        { auth: adminAuth },
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
        { auth: customerBauerAuth },
      ).catch((e) => e);
      expect(err.status).toBe(403);
    });

    it('returns 409 for a payment that is not CAPTURED', async () => {
      const orderId = await createOrder('40000000-4000-4000-4000-400000000011', customerBauerAuth);
      const paymentId = await initiatePayment(orderId, 'pay-refund-guard');

      const err = await POST(
        '/payments/refundPayment',
        { paymentId },
        { auth: adminAuth },
      ).catch((e) => e);
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

    it('Admin can read any order\'s payment status', async () => {
      const orderId = await createOrder('40000000-4000-4000-4000-400000000013', customerHoffmannAuth);
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
```

#### 2. Add the known-issue entry to `docs/error-log.md`

See `[2026-07-02] retryPayment is unreachable after failPayment — Order is already CANCELLED`
at the top of the file — added alongside this ticket, not fixed.

#### 3. Verify

```sh
npm test
```

Expected: `Test Suites: 8 passed, 8 total`, `Tests: 93 passed, 93 total`.

---

## EPIC16-T6: PricingService integration tests

### What & Why

`PricingService` is the single authorised path for changing a vehicle's list price —
`updatePrice` records a `PriceHistory` row and emits `VehiclePriceDropped` only when the new
price is lower than the old one. `getPriceHistory` and `compareToListPrice` are read-only and
have different role restrictions (`getPriceHistory` allows Operator, `compareToListPrice` does
not), which is easy to get backwards without a test pinning it down.

The seed data in `db/data/automarket.PriceHistory.csv` already has one row for several vehicles
(e.g. `...020`, `...034`). Tests must pick vehicles that are **not** in that file, otherwise a
`SELECT.one` on `PriceHistory` after calling `updatePrice` can return the pre-seeded row instead
of the one the test just created (this was caught while writing the ticket — see the vehicle ID
comment in the test file).

`VehiclePriceDropped` has no subscriber yet (the doc comment says "consumed by Favorites in a
later sprint"), so the emit assertions subscribe directly in the test via
`cds.connect.to('PricingService').on(...)` rather than checking a downstream side effect.

### Step-by-step

#### 1. Create `tests/unit/services/pricing-service.test.js`

```js
'use strict';

const path = require('path');
const cds = require('@sap/cds');

const ROOT = path.join(__dirname, '../../..');

// Credentials for the mocked auth users defined in package.json cds.requires.auth.users.
const adminAuth = { username: 'admin.mueller@automarkt.de', password: 'Test@1234' };
const managerAuth = { username: 'manager.schmidt@automarkt.de', password: 'Test@1234' };
const operatorAuth = { username: 'operator.weber@automarkt.de', password: 'Test@1234' };
const customerBauerAuth = { username: 'customer.bauer@automarkt.de', password: 'Test@1234' };

// FOR_SALE vehicles seeded in db/data/automarket.Vehicles.csv. Each scenario uses its own
// vehicle so price mutations in one describe block never affect another — the suite shares
// one in-memory DB for its whole lifetime. None of these have a pre-seeded PriceHistory row
// (see db/data/automarket.PriceHistory.csv) — vehicles that do (e.g. ...020) already have an
// existing history row, which breaks SELECT.one assertions that expect exactly one row.
const VEHICLE_DROP = '40000000-4000-4000-4000-400000000025'; // seeded price 49900.00
const VEHICLE_NO_DROP = '40000000-4000-4000-4000-400000000021'; // seeded price 32900.00
const VEHICLE_UPDATE_GUARDS = '40000000-4000-4000-4000-400000000022'; // seeded price 18900.00
const VEHICLE_HISTORY = '40000000-4000-4000-4000-400000000023'; // seeded price 39900.00
const VEHICLE_HISTORY_EMPTY = '40000000-4000-4000-4000-400000000024'; // untouched
const VEHICLE_COMPARE = '40000000-4000-4000-4000-400000000026'; // seeded price 17900.00

describe('PricingService — integration', () => {
  // CAP server startup takes time.
  jest.setTimeout(60000);

  // cds.test() registers beforeAll/afterAll to start/stop an in-process CAP server
  // with in-memory SQLite. CSV files in db/data/ are auto-loaded as seed data.
  const { POST, GET } = cds.test(ROOT).silent();

  async function updatePrice(vehicleId, newPrice, auth = adminAuth, currency = 'EUR') {
    return POST('/pricing/updatePrice', { vehicleId, newPrice, currency }, { auth });
  }

  // ── updatePrice — happy path ─────────────────────────────────────────────────

  describe('updatePrice — happy path', () => {
    it('updates the vehicle price and records a PriceHistory row', async () => {
      const res = await updatePrice(VEHICLE_DROP, 45000.0);
      expect(res.data.value ?? res.data).toBe(true);

      const { Vehicles, PriceHistory } = cds.entities('automarket');
      const vehicle = await SELECT.one.from(Vehicles).where({ ID: VEHICLE_DROP });
      expect(Number(vehicle.price)).toBe(45000);

      const history = await SELECT.one.from(PriceHistory).where({ vehicle_ID: VEHICLE_DROP });
      expect(Number(history.oldPrice)).toBe(49900);
      expect(Number(history.newPrice)).toBe(45000);
      expect(history.changedBy).toBe('ccc00000-0000-0000-0000-000000000001'); // admin.mueller
    });

    it('emits VehiclePriceDropped with old/new price when the price decreases', async () => {
      const pricingSrv = await cds.connect.to('PricingService');
      let emitted = null;
      pricingSrv.on('VehiclePriceDropped', (msg) => {
        if (msg.data.vehicleId === VEHICLE_DROP) emitted = msg.data;
      });

      await updatePrice(VEHICLE_DROP, 40000.0);

      expect(emitted).toEqual({ vehicleId: VEHICLE_DROP, oldPrice: 45000, newPrice: 40000 });
    });

    it('does not emit VehiclePriceDropped when the price increases', async () => {
      const pricingSrv = await cds.connect.to('PricingService');
      let emitted = null;
      pricingSrv.on('VehiclePriceDropped', (msg) => {
        if (msg.data.vehicleId === VEHICLE_NO_DROP) emitted = msg.data;
      });

      await updatePrice(VEHICLE_NO_DROP, 35000.0);

      expect(emitted).toBeNull();
    });
  });

  // ── updatePrice — error cases ────────────────────────────────────────────────

  describe('updatePrice — error cases', () => {
    it('returns 404 for a non-existent vehicle', async () => {
      const err = await updatePrice('does-not-exist', 1000).catch((e) => e);
      expect(err.status).toBe(404);
    });

    it('rejects an Operator with 403 (Admin/Manager only)', async () => {
      const err = await updatePrice(VEHICLE_UPDATE_GUARDS, 1000, operatorAuth).catch((e) => e);
      expect(err.status).toBe(403);
    });

    it('rejects a Customer with 403', async () => {
      const err = await updatePrice(VEHICLE_UPDATE_GUARDS, 1000, customerBauerAuth).catch(
        (e) => e,
      );
      expect(err.status).toBe(403);
    });
  });

  // ── getPriceHistory ───────────────────────────────────────────────────────────

  describe('getPriceHistory', () => {
    it('returns rows for a vehicle ordered by createdAt descending', async () => {
      await updatePrice(VEHICLE_HISTORY, 38000.0, managerAuth);
      await updatePrice(VEHICLE_HISTORY, 37000.0, managerAuth);

      const res = await GET(`/pricing/getPriceHistory(vehicleId='${VEHICLE_HISTORY}')`, {
        auth: adminAuth,
      });
      const rows = res.data.value ?? res.data;
      expect(rows.length).toBe(2);
      // Most recent change (38000 → 37000) comes first.
      expect(Number(rows[0].newPrice)).toBe(37000);
      expect(Number(rows[1].newPrice)).toBe(38000);
    });

    it('returns an empty array for a vehicle with no price changes', async () => {
      const res = await GET(`/pricing/getPriceHistory(vehicleId='${VEHICLE_HISTORY_EMPTY}')`, {
        auth: adminAuth,
      });
      const rows = res.data.value ?? res.data;
      expect(rows).toEqual([]);
    });

    it('allows an Operator to read', async () => {
      const res = await GET(`/pricing/getPriceHistory(vehicleId='${VEHICLE_HISTORY}')`, {
        auth: operatorAuth,
      });
      expect(res.status).toBe(200);
    });

    it('rejects a Customer with 403', async () => {
      const err = await GET(`/pricing/getPriceHistory(vehicleId='${VEHICLE_HISTORY}')`, {
        auth: customerBauerAuth,
      }).catch((e) => e);
      expect(err.status).toBe(403);
    });
  });

  // ── compareToListPrice ────────────────────────────────────────────────────────

  describe('compareToListPrice', () => {
    it('computes diffs against the current and all-time lowest recorded price', async () => {
      // Seeded price 17900 → drop to 16000 (new lowest) → rise to 17000 (new current).
      await updatePrice(VEHICLE_COMPARE, 16000.0);
      await updatePrice(VEHICLE_COMPARE, 17000.0);

      const res = await GET(
        `/pricing/compareToListPrice(vehicleId='${VEHICLE_COMPARE}',offerAmount=15000)`,
        { auth: adminAuth },
      );
      const result = res.data.value ?? res.data;
      expect(Number(result.currentPrice)).toBe(17000);
      expect(Number(result.lowestPrice)).toBe(16000);
      expect(Number(result.diffFromCurrent)).toBe(2000);
      expect(Number(result.diffFromLowest)).toBe(1000);
      expect(Number(result.belowCurrentPct)).toBeCloseTo((2000 / 17000) * 100, 5);
      expect(Number(result.belowLowestPct)).toBeCloseTo(6.25, 5);
    });

    it('returns 404 for a non-existent vehicle', async () => {
      const err = await GET(
        "/pricing/compareToListPrice(vehicleId='does-not-exist',offerAmount=1000)",
        { auth: adminAuth },
      ).catch((e) => e);
      expect(err.status).toBe(404);
    });

    it('rejects an Operator with 403 (Admin/Manager only, unlike getPriceHistory)', async () => {
      const err = await GET(
        `/pricing/compareToListPrice(vehicleId='${VEHICLE_COMPARE}',offerAmount=1000)`,
        { auth: operatorAuth },
      ).catch((e) => e);
      expect(err.status).toBe(403);
    });

    it('rejects a Customer with 403', async () => {
      const err = await GET(
        `/pricing/compareToListPrice(vehicleId='${VEHICLE_COMPARE}',offerAmount=1000)`,
        { auth: customerBauerAuth },
      ).catch((e) => e);
      expect(err.status).toBe(403);
    });
  });
});
```

#### 2. Verify

```sh
npm test
```

Expected: `Test Suites: 9 passed, 9 total`, `Tests: 107 passed, 107 total`.

---
