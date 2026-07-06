'use strict';

const cds = require('@sap/cds');

// CRITICALITY maps VehicleStatus to com.sap.vocabularies.UI.v1.CriticalityType
// codes (Neutral=0, Negative=1, Critical=2, Positive=3) for the Fiori status
// badge (EPIC19-T3). FOR_SALE/SOLD/DELIVERED are "good" outcomes; RESERVED and
// PENDING_PAYMENT are mid-flow states worth an operator's attention; ARCHIVED
// is the only genuinely negative state (no longer available at all).
const CRITICALITY = {
  DRAFT: 0,
  FOR_SALE: 3,
  RESERVED: 2,
  PENDING_PAYMENT: 2,
  SOLD: 3,
  DELIVERED: 3,
  ARCHIVED: 1,
};

module.exports = cds.service.impl(async function (srv) {
  const { Vehicles, Reservations, TestDrives, Offers } = cds.entities('automarket');
  const { transition } = require('../domain/vehicle-state-machine');

  // Populates the virtual statusCriticality field (declared in
  // operator-portal.cds) on every Vehicles row returned by READ.
  srv.after('READ', 'Vehicles', (rows) => {
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      if (row) row.statusCriticality = CRITICALITY[row.status] ?? 0;
    }
  });

  // Native CREATE on Vehicles (EPIC20-T4, replaces the old unbound createVehicle
  // action — see the @restrict comment on Vehicles in operator-portal.cds).
  // Overwrites branch_ID/status unconditionally so a client cannot create a
  // vehicle directly into FOR_SALE, or an Operator into another branch, by
  // simply submitting those fields in the create payload.
  srv.before('CREATE', 'Vehicles', (req) => {
    if (req.user.is('Operator')) {
      req.data.branch_ID = req.user.attr.branchId;
    } else if (!req.data.branch_ID) {
      return req.error(400, 'branch_ID is required for Manager role.');
    }
    req.data.status = 'DRAFT';
  });

  // approve (EPIC20-T4): bound to Reservations. Verifies the reservation
  // belongs to the Operator's branch, then delegates to ReservationService so
  // subscribers receive the canonical event. Same logic as the old unbound
  // approveReservation action, just reading the bound key from req.params.
  srv.on('approve', 'Reservations', async (req) => {
    const [{ ID: reservationId }] = req.params;
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

  // reject (EPIC20-T4): bound to Reservations, same branch-scoped guard;
  // returns the vehicle to FOR_SALE.
  srv.on('reject', 'Reservations', async (req) => {
    const [{ ID: reservationId }] = req.params;
    const { notes } = req.data;
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

  // approve (EPIC20-T4): bound to TestDrives — a distinct overload from
  // Reservations' own `approve` above (OData resolves same-named bound
  // actions by their bound type, same pattern as EPIC20-T2's `cancel`).
  srv.on('approve', 'TestDrives', async (req) => {
    const [{ ID: testDriveId }] = req.params;
    const { durationMinutes } = req.data;
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

  // cancel (EPIC20-T4): bound to TestDrives.
  srv.on('cancel', 'TestDrives', async (req) => {
    const [{ ID: testDriveId }] = req.params;
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

  // complete (EPIC20-T4): bound to TestDrives; only valid from APPROVED.
  srv.on('complete', 'TestDrives', async (req) => {
    const [{ ID: testDriveId }] = req.params;
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
    const reservationId = cds.utils.uuid();
    await INSERT.into(Reservations).entries({
      ID: reservationId,
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
