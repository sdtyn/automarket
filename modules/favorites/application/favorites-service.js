'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { Favorites } = cds.entities('automarket');

  // addFavorite: inserts a Favorites row keyed by the caller's user ID.
  // The @assert.unique constraint on the entity rejects duplicates at the DB level.
  srv.on('addFavorite', async (req) => {
    const { vehicleId } = req.data;
    const customer_ID = req.user.id;
    const result = await INSERT.into(Favorites).entries({ customer_ID, vehicle_ID: vehicleId });
    return result.ID;
  });

  // removeFavorite: deletes the row matching the caller's user ID and vehicleId.
  // Returns false (not an error) when the row does not exist — idempotent removal.
  srv.on('removeFavorite', async (req) => {
    const { vehicleId } = req.data;
    const customer_ID = req.user.id;
    const favorite = await SELECT.one.from(Favorites).where({ customer_ID, vehicle_ID: vehicleId });
    if (!favorite) return false;
    await DELETE.from(Favorites).where({ customer_ID, vehicle_ID: vehicleId });
    return true;
  });

  // listFavorites: returns every Favorites row belonging to the calling customer.
  // customer_ID comes from the token — clients cannot request another user's list.
  srv.on('listFavorites', async (req) => {
    return SELECT.from(Favorites).where({ customer_ID: req.user.id });
  });
});
