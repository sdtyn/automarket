'use strict';

const path = require('path');
const cds = require('@sap/cds');

const ROOT = path.join(__dirname, '../../..');

// EPIC17-T4 regression test: proves the two bugs fixed in EPIC17-T2 (wrong-service
// subscription) and EPIC17-T3 (resolveUserId email/UUID mismatch) actually unblock
// notification creation for a favoriting customer — before this ticket, none of
// these three subscribers ever inserted a Notification row (see docs/error-log.md).

// Credentials for the mocked auth users defined in package.json cds.requires.auth.users.
const customerBauerAuth = { username: 'customer.bauer@automarkt.de', password: 'Test@1234' };
const adminAuth = { username: 'admin.mueller@automarkt.de', password: 'Test@1234' };

const BAUER_ID = 'ccc00000-0000-0000-0000-000000000004';

// FOR_SALE vehicles seeded in db/data/automarket.Vehicles.csv, none with a pre-seeded
// PriceHistory row (see db/data/automarket.PriceHistory.csv) — this test file has its
// own in-memory DB, so IDs do not need to avoid other test files, only each other.
const VEHICLE_SOLD = '40000000-4000-4000-4000-400000000006';
const VEHICLE_PRICE_DROP = '40000000-4000-4000-4000-400000000007';
const VEHICLE_SIMILAR = '40000000-4000-4000-4000-400000000008';
const VEHICLE_READ_API = '40000000-4000-4000-4000-400000000009';

describe('NotificationService — integration (EPIC17-T4 regression)', () => {
  // CAP server startup takes time.
  jest.setTimeout(60000);

  // cds.test() registers beforeAll/afterAll to start/stop an in-process CAP server
  // with in-memory SQLite. CSV files in db/data/ are auto-loaded as seed data.
  const { POST, GET } = cds.test(ROOT).silent();

  async function findNotification(subjectSubstring) {
    const { Notifications } = cds.entities('automarket');
    const rows = await SELECT.from(Notifications).where({ recipient_ID: BAUER_ID });
    return rows.find((r) => r.subject.includes(subjectSubstring));
  }

  // ── VehicleSold ──────────────────────────────────────────────────────────────
  // Real end-to-end flow: createOrder → initiatePayment → capturePayment triggers
  // PaymentSucceeded (SalesService) → Vehicle SOLD → VehicleSold (VehicleService)
  // → NotificationService subscriber (unaffected by EPIC17-T2, but blocked until
  // EPIC17-T3 fixed resolveUserId).

  it('creates a Notification when a favorited vehicle is sold', async () => {
    await POST('/favorites/addFavorite', { vehicleId: VEHICLE_SOLD }, { auth: customerBauerAuth });

    const orderRes = await POST(
      '/sales/createOrder',
      { vehicleId: VEHICLE_SOLD, deliveryType: 'CUSTOMER_PICKUP' },
      { auth: customerBauerAuth }
    );
    const orderId = orderRes.data.value ?? orderRes.data;

    const payRes = await POST(
      '/payments/initiatePayment',
      {
        orderId,
        provider: 'StripeDE',
        idempotencyKey: 'notif-sold-001',
        amount: 1,
        currency: 'EUR',
      },
      { auth: customerBauerAuth }
    );
    const paymentId = (payRes.data.value ?? payRes.data).replace('PSP-SESSION-', '');

    await POST(
      '/payments/capturePayment',
      { paymentId, transactionReference: 'TXN-notif-sold' },
      { auth: adminAuth }
    );

    const notification = await findNotification('sold');
    expect(notification).toBeDefined();
    expect(notification.channel).toBe('PUSH');
    expect(notification.content).toContain(VEHICLE_SOLD);
  });

  // ── VehiclePriceDropped ──────────────────────────────────────────────────────
  // Real end-to-end flow: updatePrice (decrease) → PricingService emits
  // VehiclePriceDropped → NotificationService subscriber, now correctly connected
  // to PricingService instead of VehicleService (EPIC17-T2).

  it('creates a Notification when a favorited vehicle drops in price', async () => {
    await POST(
      '/favorites/addFavorite',
      { vehicleId: VEHICLE_PRICE_DROP },
      { auth: customerBauerAuth }
    );

    await POST(
      '/pricing/updatePrice',
      { vehicleId: VEHICLE_PRICE_DROP, newPrice: 1000, currency: 'EUR' },
      { auth: adminAuth }
    );

    const notification = await findNotification('Price drop');
    expect(notification).toBeDefined();
    expect(notification.content).toContain(VEHICLE_PRICE_DROP);
  });

  // ── SimilarVehicleListed ─────────────────────────────────────────────────────
  // No producer emits this event yet — VehicleService does not even declare it
  // (see modules/vehicle/api/vehicle-service.cds). The subscriber itself was never
  // part of the EPIC17-T2 wiring bug (it was already attached to VehicleService,
  // where a future producer would live), only the EPIC17-T3 resolveUserId bug
  // blocked it. Simulated here via a direct emit to cover the subscriber logic.

  it('creates a Notification when SimilarVehicleListed fires (simulated — no producer yet)', async () => {
    await POST(
      '/favorites/addFavorite',
      { vehicleId: VEHICLE_SIMILAR },
      { auth: customerBauerAuth }
    );

    const vehicleSrv = await cds.connect.to('VehicleService');
    await vehicleSrv.emit('SimilarVehicleListed', {
      newVehicleId: '40000000-4000-4000-4000-400000000099',
      similarToVehicleId: VEHICLE_SIMILAR,
    });

    const notification = await findNotification('similar vehicle');
    expect(notification).toBeDefined();
    expect(notification.content).toContain(VEHICLE_SIMILAR);
  });

  // ── Read side: getMyNotifications / getUnreadCount ──────────────────────────
  // Both call resolveUserId(req.user.id) directly — also blocked by the
  // EPIC17-T3 bug regardless of which event created the row.

  describe('getMyNotifications / getUnreadCount', () => {
    it('returns the notifications created above for the same customer', async () => {
      const res = await GET('/notifications/getMyNotifications()', { auth: customerBauerAuth });
      const rows = res.data.value ?? res.data;
      expect(rows.length).toBeGreaterThanOrEqual(3);
    });

    it('counts PENDING notifications for a fresh favorite/price-drop', async () => {
      await POST(
        '/favorites/addFavorite',
        { vehicleId: VEHICLE_READ_API },
        { auth: customerBauerAuth }
      );
      const before = await GET('/notifications/getUnreadCount()', { auth: customerBauerAuth });
      const beforeCount = before.data.value ?? before.data;

      await POST(
        '/pricing/updatePrice',
        { vehicleId: VEHICLE_READ_API, newPrice: 500, currency: 'EUR' },
        { auth: adminAuth }
      );

      const after = await GET('/notifications/getUnreadCount()', { auth: customerBauerAuth });
      const afterCount = after.data.value ?? after.data;
      expect(afterCount).toBe(beforeCount + 1);
    });
  });
});
