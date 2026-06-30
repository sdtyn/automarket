'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { Vehicles, Reservations, TestDrives, Offers } = cds.entities('automarket');
  const { transition } = require('../domain/vehicle-state-machine');

  // createVehicle: inserts a DRAFT vehicle and enforces branch scoping.
  // Operators always get their branch from req.user.attr.branchId —
  // any branchId parameter they pass is silently ignored.
  srv.on('createVehicle', async (req) => {
    const {
      vin,
      plateNumber,
      brand,
      model,
      year,
      mileage,
      fuelType,
      transmission,
      color,
      price,
      currency,
      branchId,
    } = req.data;

    const branch_ID = req.user.is('Operator') ? req.user.attr.branchId : branchId;
    if (!branch_ID) return req.error(400, 'branchId is required for Manager role.');

    const result = await INSERT.into(Vehicles).entries({
      vin,
      plateNumber,
      brand,
      model,
      year,
      mileage,
      fuelType,
      transmission,
      color,
      price,
      currency,
      branch_ID,
      status: 'DRAFT',
    });
    return result.ID;
  });

  // approveReservation: verifies the reservation belongs to the Operator's branch,
  // then delegates to ReservationService so subscribers receive the canonical event.
  srv.on('approveReservation', async (req) => {
    const { reservationId } = req.data;
    const reservation = await SELECT.one.from(Reservations).where({ ID: reservationId });
    if (!reservation) return req.error(404, 'Reservation not found');

    if (req.user.is('Operator') && reservation.branch_ID !== req.user.attr.branchId) {
      return req.error(403, 'You can only approve reservations for your branch');
    }
    if (reservation.status !== 'REQUESTED') {
      return req.error(409, `Cannot approve a reservation in status ${reservation.status}`);
    }

    await UPDATE(Reservations).set({ status: 'APPROVED' }).where({ ID: reservationId });
    const resSrv = await cds.connect.to('ReservationService');
    await resSrv.emit('ReservationApproved', { reservationId, vehicleId: reservation.vehicle_ID });
    return true;
  });

  // rejectReservation: same branch-scoped guard; returns vehicle to FOR_SALE.
  srv.on('rejectReservation', async (req) => {
    const { reservationId, notes } = req.data;
    const reservation = await SELECT.one.from(Reservations).where({ ID: reservationId });
    if (!reservation) return req.error(404, 'Reservation not found');

    if (req.user.is('Operator') && reservation.branch_ID !== req.user.attr.branchId) {
      return req.error(403, 'You can only reject reservations for your branch');
    }
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
    const resSrv = await cds.connect.to('ReservationService');
    await resSrv.emit('ReservationRejected', { reservationId, vehicleId: reservation.vehicle_ID });
    return true;
  });
  // approveTestDrive: branch guard for Operators; delegates event emission to
  // TestDriveService to keep subscribers decoupled from the portal.
  srv.on('approveTestDrive', async (req) => {
    const { testDriveId, durationMinutes } = req.data;
    const testDrive = await SELECT.one.from(TestDrives).where({ ID: testDriveId });
    if (!testDrive) return req.error(404, 'Test drive not found');

    if (req.user.is('Operator') && testDrive.branch_ID !== req.user.attr.branchId) {
      return req.error(403, 'You can only approve test drives for your branch');
    }
    if (testDrive.status !== 'REQUESTED') {
      return req.error(409, `Cannot approve a test drive in status ${testDrive.status}`);
    }

    const patch = { status: 'APPROVED' };
    if (durationMinutes) patch.durationMinutes = durationMinutes;
    await UPDATE(TestDrives).set(patch).where({ ID: testDriveId });
    const tdSrv = await cds.connect.to('TestDriveService');
    await tdSrv.emit('TestDriveApproved', { testDriveId, vehicleId: testDrive.vehicle_ID });
    return true;
  });

  // cancelTestDrive: branch guard for Operators; emits via TestDriveService.
  srv.on('cancelTestDrive', async (req) => {
    const { testDriveId } = req.data;
    const testDrive = await SELECT.one.from(TestDrives).where({ ID: testDriveId });
    if (!testDrive) return req.error(404, 'Test drive not found');

    if (req.user.is('Operator') && testDrive.branch_ID !== req.user.attr.branchId) {
      return req.error(403, 'You can only cancel test drives for your branch');
    }
    if (!['REQUESTED', 'APPROVED'].includes(testDrive.status)) {
      return req.error(409, `Cannot cancel a test drive in status ${testDrive.status}`);
    }

    await UPDATE(TestDrives).set({ status: 'CANCELLED' }).where({ ID: testDriveId });
    const tdSrv = await cds.connect.to('TestDriveService');
    await tdSrv.emit('TestDriveCancelled', { testDriveId, vehicleId: testDrive.vehicle_ID });
    return true;
  });

  // completeTestDrive: branch guard for Operators; only valid from APPROVED.
  srv.on('completeTestDrive', async (req) => {
    const { testDriveId } = req.data;
    const testDrive = await SELECT.one.from(TestDrives).where({ ID: testDriveId });
    if (!testDrive) return req.error(404, 'Test drive not found');

    if (req.user.is('Operator') && testDrive.branch_ID !== req.user.attr.branchId) {
      return req.error(403, 'You can only complete test drives for your branch');
    }
    if (testDrive.status !== 'APPROVED') {
      return req.error(409, `Cannot complete a test drive in status ${testDrive.status}`);
    }

    await UPDATE(TestDrives).set({ status: 'COMPLETED' }).where({ ID: testDriveId });
    const tdSrv = await cds.connect.to('TestDriveService');
    await tdSrv.emit('TestDriveCompleted', { testDriveId, vehicleId: testDrive.vehicle_ID });
    return true;
  });

  // approveOffer: branch guard for Managers; delegates to OfferService for the
  // Reservation creation and event emission.
  srv.on('approveOffer', async (req) => {
    const { offerId } = req.data;
    const offer = await SELECT.one.from(Offers).where({ ID: offerId });
    if (!offer) return req.error(404, 'Offer not found');

    if (req.user.is('Manager') && offer.branch_ID !== req.user.attr.branchId) {
      return req.error(403, 'You can only approve offers for your branch');
    }
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(offer.status)) {
      return req.error(409, `Cannot approve an offer in status ${offer.status}`);
    }

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await UPDATE(Offers).set({ status: 'APPROVED' }).where({ ID: offerId });
    await INSERT.into(Reservations).entries({
      vehicle_ID: offer.vehicle_ID,
      branch_ID: offer.branch_ID,
      customer_ID: offer.customer_ID,
      guestToken: null,
      status: 'APPROVED',
      expiresAt,
    });

    const offerSrv = await cds.connect.to('OfferService');
    await offerSrv.emit('OfferApproved', { offerId, vehicleId: offer.vehicle_ID });
    return true;
  });

  // rejectOffer: branch guard for Managers; stores rejection notes and emits
  // via OfferService so the customer's notification subscriber fires correctly.
  srv.on('rejectOffer', async (req) => {
    const { offerId, rejectionNotes } = req.data;
    const offer = await SELECT.one.from(Offers).where({ ID: offerId });
    if (!offer) return req.error(404, 'Offer not found');

    if (req.user.is('Manager') && offer.branch_ID !== req.user.attr.branchId) {
      return req.error(403, 'You can only reject offers for your branch');
    }
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(offer.status)) {
      return req.error(409, `Cannot reject an offer in status ${offer.status}`);
    }

    await UPDATE(Offers).set({ status: 'REJECTED', rejectionNotes }).where({ ID: offerId });
    const offerSrv = await cds.connect.to('OfferService');
    await offerSrv.emit('OfferRejected', { offerId, vehicleId: offer.vehicle_ID });
    return true;
  });
});
