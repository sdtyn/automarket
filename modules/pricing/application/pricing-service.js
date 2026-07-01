'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { PriceHistory } = cds.entities('automarket');

  // updatePrice: reads the current price, persists the new one, appends a
  // PriceHistory row, and emits VehiclePriceDropped when the price decreased.
  // Uses cds.entities to reach Vehicles directly so the update is not routed
  // through VehicleService's before-UPDATE guard (which blocks price changes).
  srv.on('updatePrice', async (req) => {
    const { vehicleId, newPrice, currency } = req.data;
    const { Vehicles } = cds.entities('automarket');

    const vehicle = await SELECT.one.from(Vehicles).where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');

    const oldPrice = vehicle.price;
    const effectiveCurrency = currency || vehicle.currency;

    await UPDATE(Vehicles)
      .set({ price: newPrice, currency: effectiveCurrency })
      .where({ ID: vehicleId });

    await INSERT.into(PriceHistory).entries({
      vehicle_ID: vehicleId,
      oldPrice,
      newPrice,
      currency: effectiveCurrency,
      changedBy: req.user.id,
    });

    if (newPrice < oldPrice) {
      await srv.emit('VehiclePriceDropped', { vehicleId, oldPrice, newPrice });
    }

    return true;
  });

  // getPriceHistory: returns all price changes for a vehicle, newest first.
  srv.on('getPriceHistory', async (req) => {
    const { vehicleId } = req.data;
    return SELECT.from(PriceHistory)
      .where({ vehicle_ID: vehicleId })
      .orderBy({ createdAt: 'desc' });
  });
  // compareToListPrice: computes how far the offer sits below the current list
  // price and below the all-time lowest recorded price for the same vehicle.
  // Returns absolute diffs and percentage diffs so the caller can apply either.
  srv.on('compareToListPrice', async (req) => {
    const { vehicleId, offerAmount } = req.data;
    const { Vehicles } = cds.entities('automarket');

    const vehicle = await SELECT.one.from(Vehicles).columns('price').where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');

    const history = await SELECT.from(PriceHistory)
      .columns('newPrice')
      .where({ vehicle_ID: vehicleId });

    const allPrices = [vehicle.price, ...history.map((r) => r.newPrice)];
    const lowestPrice = Math.min(...allPrices);
    const currentPrice = vehicle.price;

    const diffFromCurrent = currentPrice - offerAmount;
    const diffFromLowest = lowestPrice - offerAmount;

    return {
      currentPrice,
      lowestPrice,
      diffFromCurrent,
      diffFromLowest,
      belowCurrentPct: currentPrice > 0 ? (diffFromCurrent / currentPrice) * 100 : 0,
      belowLowestPct: lowestPrice > 0 ? (diffFromLowest / lowestPrice) * 100 : 0,
    };
  });
});
