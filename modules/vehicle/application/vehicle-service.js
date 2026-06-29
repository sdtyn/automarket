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

  // searchVehicles: builds a dynamic WHERE clause from optional filter params.
  // Guest callers (unauthenticated) are silently restricted to FOR_SALE —
  // they cannot request other statuses even if they pass one as a parameter.
  srv.on('searchVehicles', async (req) => {
    const { brand, model, priceMin, priceMax, status, branchId } = req.data;
    const isGuest = !req.user.is('authenticated-user');
    const effectiveStatus = isGuest ? 'FOR_SALE' : status;

    // Token-stream WHERE clause: each condition is pushed with 'and' separator
    // so missing filters are simply skipped rather than producing a broken query.
    const tokens = [];
    const add = (condition) => {
      if (tokens.length) tokens.push('and');
      tokens.push(...condition);
    };

    if (brand) add(['brand', '=', brand]);
    if (model) add(['model', '=', model]);
    if (branchId) add(['branch_ID', '=', branchId]);
    if (effectiveStatus) add(['status', '=', effectiveStatus]);
    if (priceMin != null) add(['price', '>=', priceMin]);
    if (priceMax != null) add(['price', '<=', priceMax]);

    const query = SELECT.from(Vehicles);
    if (tokens.length) query.where(tokens);
    return query;
  });

  // addImage: inserts a VehicleImages row after verifying the vehicle exists
  // and that no other image on the same vehicle shares the requested sortOrder.
  srv.on('addImage', async (req) => {
    const { vehicleId, url, sortOrder } = req.data;
    const vehicle = await SELECT.one.from(Vehicles).where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');

    const duplicate = await SELECT.one
      .from(VehicleImages)
      .where({ vehicle_ID: vehicleId, sortOrder });
    if (duplicate)
      return req.error(
        409,
        `An image with sortOrder ${sortOrder} already exists for this vehicle.`
      );

    const result = await INSERT.into(VehicleImages).entries({
      vehicle_ID: vehicleId,
      url,
      sortOrder,
    });
    return result.ID;
  });

  // updateImageOrder: fetches the image to resolve its vehicle, then checks
  // that the new sortOrder is not already taken by a sibling image.
  srv.on('updateImageOrder', async (req) => {
    const { imageId, sortOrder } = req.data;
    const image = await SELECT.one.from(VehicleImages).where({ ID: imageId });
    if (!image) return req.error(404, 'Image not found');

    const duplicate = await SELECT.one
      .from(VehicleImages)
      .where([
        'vehicle_ID',
        '=',
        image.vehicle_ID,
        'and',
        'sortOrder',
        '=',
        sortOrder,
        'and',
        'ID',
        '!=',
        imageId,
      ]);
    if (duplicate)
      return req.error(
        409,
        `An image with sortOrder ${sortOrder} already exists for this vehicle.`
      );

    await UPDATE(VehicleImages).set({ sortOrder }).where({ ID: imageId });
    return true;
  });

  // removeImage: hard-deletes the image row from the vehicle aggregate.
  srv.on('removeImage', async (req) => {
    const { imageId } = req.data;
    const image = await SELECT.one.from(VehicleImages).where({ ID: imageId });
    if (!image) return req.error(404, 'Image not found');
    await DELETE.from(VehicleImages).where({ ID: imageId });
    return true;
  });
});
