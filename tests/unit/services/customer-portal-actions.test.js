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
});
