'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  // Inject status = FOR_SALE into every Vehicles READ before it reaches the DB.
  // This runs for both list and detail requests (OData $filter does not bypass it)
  // because before-READ fires on all SELECT operations on the entity.
  srv.before('READ', 'Vehicles', (req) => {
    req.query.where({ status: 'FOR_SALE' });
  });

  const { Favorites, PriceHistory } = cds.entities('automarket');

  // getFavoriteVehicles: joins the customer's Favorites against the Vehicles
  // entity and applies the same FOR_SALE filter that guards the entity projection.
  srv.on('getFavoriteVehicles', async (req) => {
    const customer_ID = req.user.id;
    const favorites = await SELECT.from(Favorites).columns('vehicle_ID').where({ customer_ID });

    if (!favorites.length) return [];

    const vehicleIds = favorites.map((f) => f.vehicle_ID);
    const { Vehicles } = cds.entities('automarket');
    return SELECT.from(Vehicles).where({ ID: { in: vehicleIds }, status: 'FOR_SALE' });
  });

  // getPriceHistory: returns price-change rows for sparkline rendering.
  // Only newPrice, currency, and createdAt are exposed — cost basis and
  // who changed the price are internal-tier data, not shown to customers.
  srv.on('getPriceHistory', async (req) => {
    const { vehicleId } = req.data;
    return SELECT.from(PriceHistory)
      .columns('newPrice', 'currency', 'createdAt')
      .where({ vehicle_ID: vehicleId })
      .orderBy({ createdAt: 'asc' });
  });
});
