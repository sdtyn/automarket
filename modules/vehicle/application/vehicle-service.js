'use strict';

const cds = require('@sap/cds');
const { transition } = require('../domain/vehicle-state-machine');

module.exports = cds.service.impl(async function (srv) {
  const { Vehicles, VehicleImages } = cds.entities('automarket');

  // Force status to DRAFT on every new vehicle regardless of client input.
  // Status is only advanced through the publish/archive actions.
  srv.before('CREATE', 'Vehicles', (req) => {
    req.data.status = 'DRAFT';
  });

  // Reject any PATCH/PUT that carries a status field — callers must use
  // publish or archive actions to trigger a state transition.
  srv.before('UPDATE', 'Vehicles', (req) => {
    if (req.data.status) {
      return req.error(400, 'Status cannot be changed directly. Use publish or archive actions.');
    }
  });

  // Prevent hard-delete of active vehicles to preserve transaction history.
  // Only DRAFT or ARCHIVED vehicles may be removed from the database.
  srv.before('DELETE', 'Vehicles', async (req) => {
    const vehicle = await SELECT.one.from(Vehicles).where({ ID: req.data.ID });
    if (!vehicle) return req.error(404, 'Vehicle not found');
    if (!['DRAFT', 'ARCHIVED'].includes(vehicle.status)) {
      return req.error(
        409,
        `Cannot delete a vehicle in status ${vehicle.status}. Archive it first.`
      );
    }
  });

  // publish: loads the vehicle and its images, then delegates transition
  // logic to the state machine. The guard inside the machine verifies
  // that price, branch, and at least one image are present before allowing
  // the DRAFT → FOR_SALE transition.
  srv.on('publish', async (req) => {
    const { vehicleId } = req.data;
    const vehicle = await SELECT.one
      .from(Vehicles)
      .columns('ID', 'status', 'price', 'branch_ID')
      .where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');

    const images = await SELECT.from(VehicleImages).where({ vehicle_ID: vehicleId });
    vehicle.images = images;

    let newStatus;
    try {
      newStatus = transition(vehicle, 'VehiclePublished');
    } catch (e) {
      return req.error(409, e.message);
    }

    await UPDATE(Vehicles).set({ status: newStatus }).where({ ID: vehicleId });
    return newStatus;
  });

  // archive: transitions a DRAFT or FOR_SALE vehicle to ARCHIVED via the
  // state machine. No guard beyond status — any Manager or Admin may archive.
  srv.on('archive', async (req) => {
    const { vehicleId } = req.data;
    const vehicle = await SELECT.one
      .from(Vehicles)
      .columns('ID', 'status')
      .where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');

    let newStatus;
    try {
      newStatus = transition(vehicle, 'VehicleArchived');
    } catch (e) {
      return req.error(409, e.message);
    }

    await UPDATE(Vehicles).set({ status: newStatus }).where({ ID: vehicleId });
    return newStatus;
  });
});
