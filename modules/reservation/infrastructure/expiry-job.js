'use strict';

const cds = require('@sap/cds');
const { transition } = require('../../vehicle/domain/vehicle-state-machine');

const log = cds.log('expiry-job');
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

// scanExpired: finds all REQUESTED/APPROVED reservations past their expiresAt,
// transitions the vehicle back to FOR_SALE, marks the reservation EXPIRED,
// and emits ReservationExpired for downstream consumers (e.g. Notifications).
async function scanExpired(srv) {
  const { Reservations, Vehicles } = cds.entities('automarket');
  const now = new Date().toISOString();

  const expired = await SELECT.from(Reservations).where({
    status: { in: ['REQUESTED', 'APPROVED'] },
    expiresAt: { '<=': now },
  });

  for (const reservation of expired) {
    const vehicle = await SELECT.one
      .from(Vehicles)
      .columns('ID', 'status')
      .where({ ID: reservation.vehicle_ID });

    // Vehicle may already be in a terminal state if another flow ran first.
    // Warn and skip the state machine rather than throwing, so one bad row
    // does not block the rest of the batch.
    try {
      const newStatus = transition(vehicle, 'ReservationExpired');
      await UPDATE(Vehicles).set({ status: newStatus }).where({ ID: reservation.vehicle_ID });
    } catch (e) {
      log.warn(`Could not transition vehicle ${reservation.vehicle_ID}: ${e.message}`);
    }

    await UPDATE(Reservations).set({ status: 'EXPIRED' }).where({ ID: reservation.ID });
    await srv.emit('ReservationExpired', {
      reservationId: reservation.ID,
      vehicleId: reservation.vehicle_ID,
    });
  }

  if (expired.length > 0) log.info(`Expired ${expired.length} reservation(s)`);
}

// startExpiryJob: runs an immediate scan on startup, then schedules a recurring
// check. Called once from reservation-service.js via cds.on('served', ...).
function startExpiryJob(srv) {
  scanExpired(srv).catch((e) => log.error('Initial expiry scan failed:', e));
  setInterval(
    () => scanExpired(srv).catch((e) => log.error('Expiry scan failed:', e)),
    CHECK_INTERVAL_MS
  );
}

module.exports = { startExpiryJob };
