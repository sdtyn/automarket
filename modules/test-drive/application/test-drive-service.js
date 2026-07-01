'use strict';

// Returns true when two test drive windows overlap.
// Strict overlap: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅
// bDurationMin defaults to 30 — the standard slot length used for new requests.
function windowsOverlap(aStart, aDurationMin, bStart, bDurationMin = 30) {
  const aEnd = new Date(aStart).getTime() + aDurationMin * 60_000;
  const bEnd = new Date(bStart).getTime() + bDurationMin * 60_000;
  return new Date(aStart).getTime() < bEnd && aEnd > new Date(bStart).getTime();
}

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  // Subscribe to VehicleService to auto-cancel open test drives when a vehicle
  // is sold. VehicleSold is emitted by the payment flow (outside this module);
  // we register the subscriber here so the handler is ready whenever it fires.
  const VehicleSrv = await cds.connect.to('VehicleService');
  VehicleSrv.on('VehicleSold', async (msg) => {
    const { vehicleId } = msg.data;
    const openDrives = await SELECT.from(TestDrives).where({
      vehicle_ID: vehicleId,
      status: { in: ['REQUESTED', 'APPROVED'] },
    });
    for (const drive of openDrives) {
      await UPDATE(TestDrives).set({ status: 'CANCELLED' }).where({ ID: drive.ID });
      await srv.emit('TestDriveCancelled', { testDriveId: drive.ID, vehicleId });
    }
  });

  const { TestDrives } = cds.entities('automarket');

  // requestTestDrive: inserts a REQUESTED slot after checking for slot conflicts.
  // Branch is taken from the caller's parameter — guest override added in T3.
  srv.on('requestTestDrive', async (req) => {
    const { vehicleId, branchId, scheduledAt, notes } = req.data;

    // Reject if the new window overlaps any active booking for this vehicle.
    const activeBookings = await SELECT.from(TestDrives).where({
      vehicle_ID: vehicleId,
      status: { in: ['REQUESTED', 'APPROVED'] },
    });
    const conflict = activeBookings.some((b) =>
      windowsOverlap(b.scheduledAt, b.durationMinutes, scheduledAt)
    );
    if (conflict)
      return req.error(
        409,
        'This time slot overlaps with an existing booking for the selected vehicle'
      );

    const id = cds.utils.uuid();
    await INSERT.into(TestDrives).entries({
      ID: id,
      vehicle_ID: vehicleId,
      branch_ID: branchId,
      customer_ID: req.user.id,
      scheduledAt,
      notes,
      status: 'REQUESTED',
    });

    await srv.emit('TestDriveRequested', { testDriveId: id, vehicleId });
    return id;
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

    const activeBookings = await SELECT.from(TestDrives).where({
      vehicle_ID: vehicleId,
      status: { in: ['REQUESTED', 'APPROVED'] },
    });
    const conflict = activeBookings.some((b) =>
      windowsOverlap(b.scheduledAt, b.durationMinutes, scheduledAt)
    );
    if (conflict)
      return req.error(
        409,
        'This time slot overlaps with an existing booking for the selected vehicle'
      );

    const id = cds.utils.uuid();
    await INSERT.into(TestDrives).entries({
      ID: id,
      vehicle_ID: vehicleId,
      branch_ID: branchId,
      customer_ID: null,
      contactEmail,
      contactPhone,
      scheduledAt,
      notes,
      status: 'REQUESTED',
    });

    await srv.emit('TestDriveRequested', { testDriveId: id, vehicleId });
    return id;
  });

  // getAvailableSlots: generates 09:00–16:30 UTC slots in 30-min increments,
  // then marks each as available or taken based on window-overlap against
  // active bookings. Filtering is done in JS since per-vehicle booking counts
  // are small; move to a DB date-range predicate if that assumption changes.
  srv.on('getAvailableSlots', async (req) => {
    const { vehicleId, date } = req.data;

    const slots = [];
    for (let hour = 9; hour < 17; hour++) {
      for (let min = 0; min < 60; min += 30) {
        const slot = new Date(date);
        slot.setUTCHours(hour, min, 0, 0);
        slots.push(slot);
      }
    }

    const activeBookings = await SELECT.from(TestDrives).where({
      vehicle_ID: vehicleId,
      status: { in: ['REQUESTED', 'APPROVED'] },
    });

    const [year, month, day] = date.split('-').map(Number);
    const dayBookings = activeBookings.filter((b) => {
      if (!b.scheduledAt) return false;
      const d = new Date(b.scheduledAt);
      return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
    });

    return slots.map((slotTime) => ({
      scheduledAt: slotTime.toISOString(),
      available: !dayBookings.some((b) =>
        windowsOverlap(b.scheduledAt, b.durationMinutes, slotTime)
      ),
    }));
  });
});
