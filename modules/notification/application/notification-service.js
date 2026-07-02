'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { Notifications, Favorites, Users } = cds.entities('automarket');

  // resolveUserId: confirms customerID (== req.user.id, already the Users.ID UUID
  // everywhere it is written — see Favorites/Orders/Reservations.customer_ID)
  // still refers to an existing user before it is used as a Notification's
  // recipient_ID. EPIC17-T3 fix: this used to look up Users by `email` with a
  // UUID input, which never matched — see docs/error-log.md
  // "resolveUserId always returns null — looks up Users.email with a UUID".
  // Returns null if no matching user exists — callers must handle the null case.
  async function resolveUserId(customerID) {
    const user = await SELECT.one.from(Users).columns('ID').where({ ID: customerID });
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
  // SimilarVehicleListed subscriber is registered now; it will fire automatically
  // once VehicleService adds that event.
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
  // EPIC17-T2 fix: this event is declared and emitted only by PricingService
  // (modules/pricing/api/pricing-service.cds), never by VehicleService — a
  // listener attached to VehicleService could never receive it. See
  // docs/error-log.md "VehiclePriceDropped listener registered on the wrong
  // service — never fires". Content/channel (EMAIL, German) is EPIC18-T1 scope.
  const PricingSrv = await cds.connect.to('PricingService');
  PricingSrv.on('VehiclePriceDropped', async (msg) => {
    const { vehicleId, newPrice } = msg.data;
    await createNotificationsForFavorites(
      vehicleId,
      'Price drop on a vehicle you saved',
      `The price of vehicle ${vehicleId} has dropped to ${newPrice}.`
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
  // Confirms req.user.id still refers to an existing user before querying.
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
