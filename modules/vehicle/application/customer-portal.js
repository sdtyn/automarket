'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  // Inject status = FOR_SALE into every Vehicles READ before it reaches the DB.
  // This runs for both list and detail requests (OData $filter does not bypass it)
  // because before-READ fires on all SELECT operations on the entity.
  srv.before('READ', 'Vehicles', (req) => {
    req.query.where({ status: 'FOR_SALE' });
  });

  const { Favorites, PriceHistory, VehicleImages } = cds.entities('automarket');

  // Populates the virtual primaryImageUrl field (declared in customer-portal.cds)
  // for every Vehicles row returned by READ — one batched query for the whole
  // result page, not one query per row.
  srv.after('READ', 'Vehicles', async (rows) => {
    const list = Array.isArray(rows) ? rows : [rows];
    const ids = list.filter(Boolean).map((r) => r.ID);
    if (!ids.length) return;

    const images = await SELECT.from(VehicleImages)
      .columns('vehicle_ID', 'url')
      .where({ vehicle_ID: { in: ids } })
      .orderBy({ sortOrder: 'asc' });

    const firstImageByVehicle = {};
    for (const image of images) {
      if (!(image.vehicle_ID in firstImageByVehicle)) {
        firstImageByVehicle[image.vehicle_ID] = image.url;
      }
    }
    for (const row of list) {
      if (row) row.primaryImageUrl = firstImageByVehicle[row.ID] ?? null;
    }
  });

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

  // reserve/addToFavorites/removeFromFavorites (EPIC20-T1) are bound actions
  // on Vehicles so Fiori Elements can wire them onto the Object Page as native
  // buttons (@UI.DataFieldForAction only targets bound actions — see
  // customer-portal-ui.cds). Each delegates to the real domain service via
  // cds.connect.to(...).send(...) instead of reimplementing validation/state
  // logic — req.user propagates to the delegated call automatically because
  // it runs inside the same request context.

  // req.params for a bound action is an array of key objects (e.g. [{ ID: '...' }]),
  // not raw scalar values — verified directly against a live request.
  srv.on('reserve', 'Vehicles', async (req) => {
    const [{ ID: vehicleId }] = req.params;
    const { notes } = req.data;
    const resSrv = await cds.connect.to('ReservationService');
    const { reservationId } = await resSrv.send('createReservation', { vehicleId, notes });
    return { reservationId };
  });

  srv.on('addToFavorites', 'Vehicles', async (req) => {
    const [{ ID: vehicleId }] = req.params;
    const favSrv = await cds.connect.to('FavoritesService');
    return favSrv.send('addFavorite', { vehicleId });
  });

  srv.on('removeFromFavorites', 'Vehicles', async (req) => {
    const [{ ID: vehicleId }] = req.params;
    const favSrv = await cds.connect.to('FavoritesService');
    return favSrv.send('removeFavorite', { vehicleId });
  });

  // cancel (EPIC20-T1): bound to Reservations so a customer can cancel their
  // own reservation from the "My Reservations" Object Page. Delegates to
  // ReservationService.cancelReservation, which already enforces ownership.
  srv.on('cancel', 'Reservations', async (req) => {
    const [{ ID: reservationId }] = req.params;
    const resSrv = await cds.connect.to('ReservationService');
    return resSrv.send('cancelReservation', { reservationId });
  });
});
