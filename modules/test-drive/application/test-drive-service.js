'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { TestDrives } = cds.entities('automarket');

  // requestTestDrive: inserts a REQUESTED slot after checking for slot conflicts.
  // Branch is taken from the caller's parameter — guest override added in T3.
  srv.on('requestTestDrive', async (req) => {
    const { vehicleId, branchId, scheduledAt, notes } = req.data;

    // Reject if the same vehicle already has an active request at this exact slot.
    // Duration-window overlap checking is deferred to getAvailableSlots (T4).
    const conflict = await SELECT.one.from(TestDrives).where({
      vehicle_ID: vehicleId,
      scheduledAt: scheduledAt,
      status: { in: ['REQUESTED', 'APPROVED'] },
    });
    if (conflict) return req.error(409, 'This time slot is already taken for the selected vehicle');

    const result = await INSERT.into(TestDrives).entries({
      vehicle_ID: vehicleId,
      branch_ID: branchId,
      customer_ID: req.user.id,
      scheduledAt,
      notes,
      status: 'REQUESTED',
    });

    await srv.emit('TestDriveRequested', { testDriveId: result.ID, vehicleId });
    return result.ID;
  });

  // approveTestDrive: advances a REQUESTED test drive to APPROVED.
  // Optionally updates durationMinutes if the Operator provides a value.
  srv.on('approveTestDrive', async (req) => {
    const { testDriveId, durationMinutes } = req.data;
    const testDrive = await SELECT.one.from(TestDrives).where({ ID: testDriveId });
    if (!testDrive) return req.error(404, 'Test drive not found');
    if (testDrive.status !== 'REQUESTED') {
      return req.error(409, `Cannot approve a test drive in status ${testDrive.status}`);
    }

    const patch = { status: 'APPROVED' };
    if (durationMinutes) patch.durationMinutes = durationMinutes;
    await UPDATE(TestDrives).set(patch).where({ ID: testDriveId });
    await srv.emit('TestDriveApproved', { testDriveId, vehicleId: testDrive.vehicle_ID });
    return true;
  });

  // cancelTestDrive: Customer may only cancel their own; Operator/Manager
  // may cancel any test drive regardless of who requested it.
  srv.on('cancelTestDrive', async (req) => {
    const { testDriveId } = req.data;
    const testDrive = await SELECT.one.from(TestDrives).where({ ID: testDriveId });
    if (!testDrive) return req.error(404, 'Test drive not found');

    if (req.user.is('Customer') && testDrive.customer_ID !== req.user.id) {
      return req.error(403, 'You can only cancel your own test drive');
    }
    if (!['REQUESTED', 'APPROVED'].includes(testDrive.status)) {
      return req.error(409, `Cannot cancel a test drive in status ${testDrive.status}`);
    }

    await UPDATE(TestDrives).set({ status: 'CANCELLED' }).where({ ID: testDriveId });
    await srv.emit('TestDriveCancelled', { testDriveId, vehicleId: testDrive.vehicle_ID });
    return true;
  });

  // completeTestDrive: valid only from APPROVED. Records that the drive took place.
  srv.on('completeTestDrive', async (req) => {
    const { testDriveId } = req.data;
    const testDrive = await SELECT.one.from(TestDrives).where({ ID: testDriveId });
    if (!testDrive) return req.error(404, 'Test drive not found');
    if (testDrive.status !== 'APPROVED') {
      return req.error(409, `Cannot complete a test drive in status ${testDrive.status}`);
    }

    await UPDATE(TestDrives).set({ status: 'COMPLETED' }).where({ ID: testDriveId });
    await srv.emit('TestDriveCompleted', { testDriveId, vehicleId: testDrive.vehicle_ID });
    return true;
  });

  // requestTestDriveAsGuest: same slot-conflict guard as the authenticated path.
  // customer_ID is intentionally left null — contactEmail is the identifier.
  // No claim step: there is no token issued; guests cannot read their own row.
  srv.on('requestTestDriveAsGuest', async (req) => {
    const { vehicleId, branchId, scheduledAt, contactEmail, contactPhone, notes } = req.data;

    if (!contactEmail) return req.error(400, 'contactEmail is required for guest requests');

    const conflict = await SELECT.one.from(TestDrives).where({
      vehicle_ID: vehicleId,
      scheduledAt: scheduledAt,
      status: { in: ['REQUESTED', 'APPROVED'] },
    });
    if (conflict) return req.error(409, 'This time slot is already taken for the selected vehicle');

    const result = await INSERT.into(TestDrives).entries({
      vehicle_ID: vehicleId,
      branch_ID: branchId,
      customer_ID: null,
      contactEmail,
      contactPhone,
      scheduledAt,
      notes,
      status: 'REQUESTED',
    });

    await srv.emit('TestDriveRequested', { testDriveId: result.ID, vehicleId });
    return result.ID;
  });
});
