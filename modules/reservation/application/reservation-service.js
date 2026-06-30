'use strict';

const cds = require('@sap/cds');
const { transition } = require('../../vehicle/domain/vehicle-state-machine');
const { issueGuestToken, verifyGuestToken } = require('../infrastructure/guest-token');

module.exports = cds.service.impl(async function (srv) {
  const { Reservations } = cds.entities('automarket');

  // createReservation: validates the vehicle is FOR_SALE, moves it to RESERVED
  // via the state machine, then inserts the Reservations row.
  srv.on('createReservation', async (req) => {
    const { vehicleId, notes } = req.data;
    const { Vehicles } = cds.entities('automarket');

    // forUpdate() takes a row-level lock on the vehicle for the duration of
    // this transaction, preventing a second concurrent createReservation from
    // reading the same FOR_SALE snapshot before either write commits.
    // SQLite (local dev) silently ignores FOR UPDATE — the state machine guard
    // is the only protection there. HANA/PG enforce the lock.
    const vehicle = await SELECT.one
      .from(Vehicles)
      .columns('ID', 'status', 'branch_ID', 'price', 'images')
      .where({ ID: vehicleId })
      .forUpdate();
    if (!vehicle) return req.error(404, 'Vehicle not found');

    // Explicit active-reservation check as belt-and-suspenders.
    // The state machine catches this too (vehicle would not be FOR_SALE),
    // but this guard fires before the state machine and gives a clearer error.
    const activeReservation = await SELECT.one
      .from(Reservations)
      .where({ vehicle_ID: vehicleId, status: { in: ['REQUESTED', 'APPROVED'] } });
    if (activeReservation) {
      return req.error(409, 'This vehicle already has an active reservation');
    }

    let newVehicleStatus;
    try {
      newVehicleStatus = transition(vehicle, 'ReservationCreated');
    } catch (e) {
      return req.error(409, e.message);
    }

    // Compute expiresAt once at creation — never reset later.
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    await UPDATE(Vehicles).set({ status: newVehicleStatus }).where({ ID: vehicleId });

    const isGuest = !req.user.is('authenticated-user');

    const result = await INSERT.into(Reservations).entries({
      vehicle_ID: vehicleId,
      branch_ID: vehicle.branch_ID,
      customer_ID: isGuest ? null : req.user.id,
      status: 'REQUESTED',
      expiresAt,
      notes,
    });

    const guestToken = isGuest ? issueGuestToken(result.ID) : null;

    // Persist guestToken on the row so it can be looked up by verifyGuestToken later.
    if (guestToken) {
      await UPDATE(Reservations).set({ guestToken }).where({ ID: result.ID });
    }

    await srv.emit('ReservationCreated', { reservationId: result.ID, vehicleId });
    return { reservationId: result.ID, guestToken };
  });

  // approveReservation: only valid from REQUESTED status.
  // Vehicle stays RESERVED — no state machine call needed here.
  srv.on('approveReservation', async (req) => {
    const { reservationId } = req.data;
    const reservation = await SELECT.one.from(Reservations).where({ ID: reservationId });
    if (!reservation) return req.error(404, 'Reservation not found');
    if (reservation.status !== 'REQUESTED') {
      return req.error(409, `Cannot approve a reservation in status ${reservation.status}`);
    }
    await UPDATE(Reservations).set({ status: 'APPROVED' }).where({ ID: reservationId });
    await srv.emit('ReservationApproved', { reservationId, vehicleId: reservation.vehicle_ID });
    return true;
  });

  // rejectReservation: valid from REQUESTED or APPROVED.
  // Returns the vehicle to FOR_SALE via ReservationCancelled event on the state machine.
  srv.on('rejectReservation', async (req) => {
    const { reservationId, notes } = req.data;
    const { Vehicles } = cds.entities('automarket');
    const reservation = await SELECT.one.from(Reservations).where({ ID: reservationId });
    if (!reservation) return req.error(404, 'Reservation not found');
    if (!['REQUESTED', 'APPROVED'].includes(reservation.status)) {
      return req.error(409, `Cannot reject a reservation in status ${reservation.status}`);
    }

    const vehicle = await SELECT.one
      .from(Vehicles)
      .columns('ID', 'status')
      .where({ ID: reservation.vehicle_ID });
    let newVehicleStatus;
    try {
      newVehicleStatus = transition(vehicle, 'ReservationCancelled');
    } catch (e) {
      return req.error(409, e.message);
    }

    await UPDATE(Vehicles).set({ status: newVehicleStatus }).where({ ID: reservation.vehicle_ID });
    await UPDATE(Reservations).set({ status: 'REJECTED', notes }).where({ ID: reservationId });
    await srv.emit('ReservationRejected', { reservationId, vehicleId: reservation.vehicle_ID });
    return true;
  });

  // cancelReservation: customer may only cancel their own reservation.
  // Returns the vehicle to FOR_SALE if the reservation was REQUESTED or APPROVED.
  srv.on('cancelReservation', async (req) => {
    const { reservationId } = req.data;
    const { Vehicles } = cds.entities('automarket');
    const reservation = await SELECT.one.from(Reservations).where({ ID: reservationId });
    if (!reservation) return req.error(404, 'Reservation not found');
    if (reservation.customer_ID !== req.user.id) {
      return req.error(403, 'You can only cancel your own reservation');
    }
    if (!['REQUESTED', 'APPROVED'].includes(reservation.status)) {
      return req.error(409, `Cannot cancel a reservation in status ${reservation.status}`);
    }

    const vehicle = await SELECT.one
      .from(Vehicles)
      .columns('ID', 'status')
      .where({ ID: reservation.vehicle_ID });
    let newVehicleStatus;
    try {
      newVehicleStatus = transition(vehicle, 'ReservationCancelled');
    } catch (e) {
      return req.error(409, e.message);
    }

    await UPDATE(Vehicles).set({ status: newVehicleStatus }).where({ ID: reservation.vehicle_ID });
    await UPDATE(Reservations).set({ status: 'CANCELLED' }).where({ ID: reservationId });
    await srv.emit('ReservationCancelled', { reservationId, vehicleId: reservation.vehicle_ID });
    return true;
  });

  // claimReservation: verifies the guestToken, then sets customer_ID to the
  // caller's user ID and clears guestToken. Only valid while the reservation
  // is still REQUESTED or APPROVED — expired/cancelled reservations cannot be claimed.
  srv.on('claimReservation', async (req) => {
    const { guestToken } = req.data;
    let payload;
    try {
      payload = verifyGuestToken(guestToken);
    } catch {
      return req.error(401, 'Invalid or expired guest token');
    }

    const reservation = await SELECT.one.from(Reservations).where({ ID: payload.reservationId });
    if (!reservation) return req.error(404, 'Reservation not found');
    if (reservation.customer_ID) {
      return req.error(409, 'This reservation has already been claimed');
    }
    if (!['REQUESTED', 'APPROVED'].includes(reservation.status)) {
      return req.error(409, `Cannot claim a reservation in status ${reservation.status}`);
    }

    await UPDATE(Reservations)
      .set({ customer_ID: req.user.id, guestToken: null })
      .where({ ID: payload.reservationId });

    await srv.emit('ReservationClaimed', {
      reservationId: payload.reservationId,
      vehicleId: reservation.vehicle_ID,
      customerId: req.user.id,
    });
    return true;
  });

  // completeReservation: valid only from APPROVED. Marks the reservation done;
  // vehicle status is advanced to PENDING_PAYMENT by the Sales flow, not here.
  srv.on('completeReservation', async (req) => {
    const { reservationId } = req.data;
    const reservation = await SELECT.one.from(Reservations).where({ ID: reservationId });
    if (!reservation) return req.error(404, 'Reservation not found');
    if (reservation.status !== 'APPROVED') {
      return req.error(409, `Cannot complete a reservation in status ${reservation.status}`);
    }
    await UPDATE(Reservations).set({ status: 'COMPLETED' }).where({ ID: reservationId });
    await srv.emit('ReservationCompleted', { reservationId, vehicleId: reservation.vehicle_ID });
    return true;
  });

  // getGuestReservation: looks up a reservation by guestToken after verifying
  // the JWT signature. Returns 401 on invalid/expired token.
  srv.on('getGuestReservation', async (req) => {
    const { guestToken } = req.data;
    let payload;
    try {
      payload = verifyGuestToken(guestToken);
    } catch {
      return req.error(401, 'Invalid or expired guest token');
    }
    const reservation = await SELECT.one.from(Reservations).where({ ID: payload.reservationId });
    if (!reservation) return req.error(404, 'Reservation not found');
    return reservation;
  });

  // cancelGuestReservation: verifies token, then reuses the same vehicle-return
  // logic as cancelReservation. Guests cannot cancel an already-claimed reservation
  // (customer_ID would be set; token still valid but ownership transferred).
  srv.on('cancelGuestReservation', async (req) => {
    const { guestToken } = req.data;
    const { Vehicles } = cds.entities('automarket');
    let payload;
    try {
      payload = verifyGuestToken(guestToken);
    } catch {
      return req.error(401, 'Invalid or expired guest token');
    }

    const reservation = await SELECT.one.from(Reservations).where({ ID: payload.reservationId });
    if (!reservation) return req.error(404, 'Reservation not found');
    if (reservation.customer_ID) {
      return req.error(409, 'This reservation has been claimed by an identified customer');
    }
    if (!['REQUESTED', 'APPROVED'].includes(reservation.status)) {
      return req.error(409, `Cannot cancel a reservation in status ${reservation.status}`);
    }

    const vehicle = await SELECT.one
      .from(Vehicles)
      .columns('ID', 'status')
      .where({ ID: reservation.vehicle_ID });
    let newVehicleStatus;
    try {
      newVehicleStatus = transition(vehicle, 'ReservationCancelled');
    } catch (e) {
      return req.error(409, e.message);
    }

    await UPDATE(Vehicles).set({ status: newVehicleStatus }).where({ ID: reservation.vehicle_ID });
    await UPDATE(Reservations).set({ status: 'CANCELLED' }).where({ ID: payload.reservationId });
    await srv.emit('ReservationCancelled', {
      reservationId: payload.reservationId,
      vehicleId: reservation.vehicle_ID,
    });
    return true;
  });
});
