'use strict';

const path = require('path');
const cds = require('@sap/cds');

const ROOT = path.join(__dirname, '../../..');

// EPIC20-T1: reserve/addToFavorites/removeFromFavorites (bound to
// CustomerPortalService.Vehicles) and cancel (bound to CustomerPortalService.
// Reservations) delegate to ReservationService/FavoritesService via
// cds.connect.to(...).send(...) instead of reimplementing their logic. These
// tests exercise the full delegation path — user-context propagation, error
// propagation (409/403 from the delegated handler, not a generic 500), and
// the row-level ownership filter on the new Reservations projection.

const customerBauerAuth = { username: 'customer.bauer@automarkt.de', password: 'Test@1234' };
const customerHoffmannAuth = { username: 'customer.hoffmann@automarkt.de', password: 'Test@1234' };

// FOR_SALE vehicles seeded in db/data/automarket.Vehicles.csv — each scenario
// uses its own vehicle so reservation state in one test never leaks into another.
const VEHICLE_RESERVE_HAPPY = '40000000-4000-4000-4000-400000000027';
const VEHICLE_RESERVE_CONFLICT = '40000000-4000-4000-4000-400000000028';
const VEHICLE_CANCEL_OWNERSHIP = '40000000-4000-4000-4000-400000000029';
const VEHICLE_FAVORITE = '40000000-4000-4000-4000-400000000030';
const VEHICLE_OFFER = '40000000-4000-4000-4000-400000000034'; // branch aaa...004
const VEHICLE_TEST_DRIVE = '40000000-4000-4000-4000-400000000035'; // branch aaa...004

describe('CustomerPortalService — bound actions (EPIC20-T1)', () => {
  jest.setTimeout(60000);

  const { POST, GET } = cds.test(ROOT).silent();

  async function reserve(vehicleId, notes, auth = customerBauerAuth) {
    const res = await POST(`/catalog/Vehicles(${vehicleId})/reserve`, { notes }, { auth });
    return res.data.reservationId;
  }

  describe('reserve', () => {
    it('creates a reservation owned by the caller and moves the vehicle to RESERVED', async () => {
      const reservationId = await reserve(VEHICLE_RESERVE_HAPPY, 'weekend test drive first');
      expect(reservationId).toBeDefined();

      const { Reservations, Vehicles } = cds.entities('automarket');
      const reservation = await SELECT.one.from(Reservations).where({ ID: reservationId });
      expect(reservation.customer_ID).toBe('ccc00000-0000-0000-0000-000000000004'); // bauer
      expect(reservation.guestToken).toBeNull();
      expect(reservation.notes).toBe('weekend test drive first');

      const vehicle = await SELECT.one.from(Vehicles).where({ ID: VEHICLE_RESERVE_HAPPY });
      expect(vehicle.status).toBe('RESERVED');
    });

    it('propagates the 409 from ReservationService when the vehicle already has an active reservation', async () => {
      await reserve(VEHICLE_RESERVE_CONFLICT, 'first', customerBauerAuth);

      const err = await POST(
        `/catalog/Vehicles(${VEHICLE_RESERVE_CONFLICT})/reserve`,
        { notes: 'second' },
        { auth: customerHoffmannAuth }
      ).catch((e) => e);
      expect(err.status).toBe(409);
    });
  });

  describe('cancel', () => {
    it("returns the vehicle to FOR_SALE and the reservation's status to CANCELLED", async () => {
      const reservationId = await reserve(VEHICLE_CANCEL_OWNERSHIP, 'to be cancelled');

      const res = await POST(
        `/catalog/Reservations(${reservationId})/cancel`,
        {},
        { auth: customerBauerAuth }
      );
      expect(res.data.value ?? res.data).toBe(true);

      const { Reservations, Vehicles } = cds.entities('automarket');
      const reservation = await SELECT.one.from(Reservations).where({ ID: reservationId });
      expect(reservation.status).toBe('CANCELLED');

      const vehicle = await SELECT.one.from(Vehicles).where({ ID: VEHICLE_CANCEL_OWNERSHIP });
      expect(vehicle.status).toBe('FOR_SALE');
    });

    it("rejects cancelling another customer's reservation with 403, and hides it from their My Reservations list", async () => {
      const reservationId = await reserve(
        '40000000-4000-4000-4000-400000000031',
        'hoffmann owns this',
        customerHoffmannAuth
      );

      const listRes = await GET(`/catalog/Reservations?$filter=ID eq ${reservationId}`, {
        auth: customerBauerAuth,
      });
      expect(listRes.data.value ?? listRes.data).toEqual([]);

      const err = await POST(
        `/catalog/Reservations(${reservationId})/cancel`,
        {},
        { auth: customerBauerAuth }
      ).catch((e) => e);
      expect(err.status).toBe(403);
    });
  });

  describe('addToFavorites / removeFromFavorites', () => {
    it('round-trips through FavoritesService', async () => {
      const addRes = await POST(
        `/catalog/Vehicles(${VEHICLE_FAVORITE})/addToFavorites`,
        {},
        { auth: customerBauerAuth }
      );
      expect(addRes.data.value ?? addRes.data).toBeDefined();

      const { Favorites } = cds.entities('automarket');
      const favorite = await SELECT.one.from(Favorites).where({
        customer_ID: 'ccc00000-0000-0000-0000-000000000004',
        vehicle_ID: VEHICLE_FAVORITE,
      });
      expect(favorite).toBeDefined();

      const removeRes = await POST(
        `/catalog/Vehicles(${VEHICLE_FAVORITE})/removeFromFavorites`,
        {},
        { auth: customerBauerAuth }
      );
      expect(removeRes.data.value ?? removeRes.data).toBe(true);

      const gone = await SELECT.one.from(Favorites).where({
        customer_ID: 'ccc00000-0000-0000-0000-000000000004',
        vehicle_ID: VEHICLE_FAVORITE,
      });
      expect(gone).toBeUndefined();
    });
  });

  // EPIC20-T2
  describe('submitOffer / resubmit', () => {
    it('creates an offer owned by the caller with the vehicle branch, not a caller-supplied one', async () => {
      const res = await POST(
        `/catalog/Vehicles(${VEHICLE_OFFER})/submitOffer`,
        { offeredPrice: 25000, currency: 'EUR', desiredPickupDate: '2026-08-01', notes: 'test' },
        { auth: customerBauerAuth }
      );
      const offerId = res.data.value ?? res.data;
      expect(offerId).toBeDefined();

      const { Offers, Vehicles } = cds.entities('automarket');
      const offer = await SELECT.one.from(Offers).where({ ID: offerId });
      const vehicle = await SELECT.one.from(Vehicles).where({ ID: VEHICLE_OFFER });
      expect(offer.customer_ID).toBe('ccc00000-0000-0000-0000-000000000004');
      expect(offer.branch_ID).toBe(vehicle.branch_ID);
      expect(offer.status).toBe('SUBMITTED');
    });

    it('lets the owner resubmit only after the offer is REJECTED (409 otherwise)', async () => {
      const submitRes = await POST(
        `/catalog/Vehicles(${VEHICLE_OFFER})/submitOffer`,
        { offeredPrice: 20000, currency: 'EUR', desiredPickupDate: '2026-08-01', notes: '' },
        { auth: customerHoffmannAuth }
      );
      const offerId = submitRes.data.value ?? submitRes.data;

      // Still SUBMITTED — resubmit must be rejected.
      const tooEarly = await POST(
        `/catalog/Offers(${offerId})/resubmit`,
        { offeredPrice: 21000, desiredPickupDate: '2026-08-02' },
        { auth: customerHoffmannAuth }
      ).catch((e) => e);
      expect(tooEarly.status).toBe(409);

      const { Offers } = cds.entities('automarket');
      await UPDATE(Offers).set({ status: 'REJECTED' }).where({ ID: offerId });

      const res = await POST(
        `/catalog/Offers(${offerId})/resubmit`,
        { offeredPrice: 22000, desiredPickupDate: '2026-08-03' },
        { auth: customerHoffmannAuth }
      );
      expect(res.data.value ?? res.data).toBe(true);

      const offer = await SELECT.one.from(Offers).where({ ID: offerId });
      expect(offer.status).toBe('SUBMITTED');
      expect(Number(offer.offeredPrice)).toBe(22000);
    });
  });

  // EPIC20-T2
  describe('requestTestDrive / cancel (TestDrives)', () => {
    it('auto-derives branchId from the vehicle — the customer never supplies it', async () => {
      const res = await POST(
        `/catalog/Vehicles(${VEHICLE_TEST_DRIVE})/requestTestDrive`,
        { scheduledAt: '2026-08-10T10:00:00Z', notes: 'weekend' },
        { auth: customerBauerAuth }
      );
      const testDriveId = res.data.value ?? res.data;
      expect(testDriveId).toBeDefined();

      const { TestDrives, Vehicles } = cds.entities('automarket');
      const testDrive = await SELECT.one.from(TestDrives).where({ ID: testDriveId });
      const vehicle = await SELECT.one.from(Vehicles).where({ ID: VEHICLE_TEST_DRIVE });
      expect(testDrive.branch_ID).toBe(vehicle.branch_ID);
      expect(testDrive.customer_ID).toBe('ccc00000-0000-0000-0000-000000000004');
    });

    it('cancel (bound to TestDrives) is a distinct overload from cancel (bound to Reservations)', async () => {
      const res = await POST(
        `/catalog/Vehicles(${VEHICLE_TEST_DRIVE})/requestTestDrive`,
        { scheduledAt: '2026-09-01T09:00:00Z', notes: '' },
        { auth: customerHoffmannAuth }
      );
      const testDriveId = res.data.value ?? res.data;

      const cancelRes = await POST(
        `/catalog/TestDrives(${testDriveId})/cancel`,
        {},
        { auth: customerHoffmannAuth }
      );
      expect(cancelRes.data.value ?? cancelRes.data).toBe(true);

      const { TestDrives } = cds.entities('automarket');
      const testDrive = await SELECT.one.from(TestDrives).where({ ID: testDriveId });
      expect(testDrive.status).toBe('CANCELLED');
    });
  });
});
