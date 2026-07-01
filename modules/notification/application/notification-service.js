'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { Notifications, Favorites, Users } = cds.entities('automarket');

  // resolveUserId: maps a customer_ID string (JWT subject = email) to Users.ID (UUID).
  // Returns null if no matching user exists — callers must handle the null case.
  async function resolveUserId(customerID) {
    const user = await SELECT.one.from(Users).columns('ID').where({ email: customerID });
    return user?.ID ?? null;
  }

  // createNotificationsForFavorites: inserts a PENDING PUSH notification for every
  // user who has favorited the given vehicle. Used by all three event subscribers.
  async function createNotificationsForFavorites(vehicleId, subject, content) {
    const favorites = await SELECT.from(Favorites).where({ vehicle_ID: vehicleId });
    for (const fav of favorites) {
      const recipientId = await resolveUserId(fav.customer_ID);
      if (!recipientId) continue;
      await INSERT.into(Notifications).entries({
        recipient_ID: recipientId,
        channel: 'PUSH',
        subject,
        content,
        status: 'PENDING',
      });
    }
  }

  // Subscribe to VehicleService events that concern favorited vehicles.
  // VehiclePriceDropped and SimilarVehicleListed subscribers are registered now;
  // they will fire automatically once the emitting services add those events.
  const VehicleSrv = await cds.connect.to('VehicleService');

  // VehicleSold: notify users who favorited this vehicle that it is no longer available.
  VehicleSrv.on('VehicleSold', async (msg) => {
    const { vehicleId } = msg.data;
    await createNotificationsForFavorites(
      vehicleId,
      'A vehicle you saved has been sold',
      `Vehicle ${vehicleId} has been sold and is no longer available.`
    );
  });

  // VehiclePriceDropped: notify favoriting users of a price reduction.
  // Event is emitted by PricingService (wired in a future sprint).
  VehicleSrv.on('VehiclePriceDropped', async (msg) => {
    const { vehicleId, newPrice, currency } = msg.data;
    await createNotificationsForFavorites(
      vehicleId,
      'Price drop on a vehicle you saved',
      `The price of vehicle ${vehicleId} has dropped to ${newPrice} ${currency ?? 'TRY'}.`
    );
  });

  // SimilarVehicleListed: notify users who favorited a comparable vehicle.
  // Event payload: { newVehicleId, similarToVehicleId }
  VehicleSrv.on('SimilarVehicleListed', async (msg) => {
    const { newVehicleId, similarToVehicleId } = msg.data;
    await createNotificationsForFavorites(
      similarToVehicleId,
      'A similar vehicle has been listed',
      `A vehicle similar to one you saved (${similarToVehicleId}) is now available: ${newVehicleId}.`
    );
  });

  // getMyNotifications: returns the caller's notifications ordered by newest first.
  // Resolves req.user.id (email) to Users.ID (UUID) before querying.
  srv.on('getMyNotifications', async (req) => {
    const { channel, status } = req.data;
    const recipientId = await resolveUserId(req.user.id);
    if (!recipientId) return [];

    const filter = { recipient_ID: recipientId };
    if (channel) filter.channel = channel;
    if (status) filter.status = status;

    return SELECT.from(Notifications).where(filter).orderBy({ createdAt: 'desc' });
  });

  // getUnreadCount: counts PENDING notifications for the caller.
  srv.on('getUnreadCount', async (req) => {
    const recipientId = await resolveUserId(req.user.id);
    if (!recipientId) return 0;

    const result = await SELECT.one
      .from(Notifications)
      .columns('count(*) as cnt')
      .where({ recipient_ID: recipientId, status: 'PENDING' });
    return Number(result?.cnt ?? 0);
  });
});
