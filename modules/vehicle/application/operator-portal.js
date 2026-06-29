'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { Vehicles } = cds.entities('automarket');

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
});
