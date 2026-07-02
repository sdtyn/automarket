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
      const err = await updatePrice(VEHICLE_UPDATE_GUARDS, 1000, customerBauerAuth).catch((e) => e);
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
        { auth: adminAuth }
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
        { auth: adminAuth }
      ).catch((e) => e);
      expect(err.status).toBe(404);
    });

    it('rejects an Operator with 403 (Admin/Manager only, unlike getPriceHistory)', async () => {
      const err = await GET(
        `/pricing/compareToListPrice(vehicleId='${VEHICLE_COMPARE}',offerAmount=1000)`,
        { auth: operatorAuth }
      ).catch((e) => e);
      expect(err.status).toBe(403);
    });

    it('rejects a Customer with 403', async () => {
      const err = await GET(
        `/pricing/compareToListPrice(vehicleId='${VEHICLE_COMPARE}',offerAmount=1000)`,
        { auth: customerBauerAuth }
      ).catch((e) => e);
      expect(err.status).toBe(403);
    });
  });
});
