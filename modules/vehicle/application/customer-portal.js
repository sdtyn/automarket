'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  // Inject status = FOR_SALE into every Vehicles READ before it reaches the DB.
  // This runs for both list and detail requests (OData $filter does not bypass it)
  // because before-READ fires on all SELECT operations on the entity.
  srv.before('READ', 'Vehicles', (req) => {
    req.query.where({ status: 'FOR_SALE' });
  });

  const { Favorites, Offers, PriceHistory, VehicleImages } = cds.entities('automarket');

  // "Active" offer statuses for the Vehicle page's purposes (EPIC22-T1) —
  // SUBMITTED/UNDER_REVIEW only. REJECTED is negotiation history (still
  // resubmit-able via the separate My Offers app, EPIC20-T2) but is not
  // "active" here, so the Vehicle page's Make an Offer button reappears the
  // moment a Manager rejects, with no extra wiring: hasActiveOffer is
  // recomputed fresh on every READ, not a stored flag.
  const ACTIVE_OFFER_STATUSES = ['SUBMITTED', 'UNDER_REVIEW'];

  // Populates the virtual primaryImageUrl/isFavorited/isNotFavorited/
  // hasActiveOffer/myOffer* fields (declared in customer-portal.cds) for
  // every Vehicles row returned by READ — one batched query per concern for
  // the whole result page, not one query per row. All stay false/null for
  // guests — Favorites/Offers have no concept of a guest, and the actions
  // that use them already require 'Customer' regardless of what these
  // fields say.
  srv.after('READ', 'Vehicles', async (rows, req) => {
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

    let favoritedIds = new Set();
    const activeOfferByVehicle = {};
    if (req.user.is('Customer')) {
      const favorites = await SELECT.from(Favorites)
        .columns('vehicle_ID')
        .where({ customer_ID: req.user.id, vehicle_ID: { in: ids } });
      favoritedIds = new Set(favorites.map((f) => f.vehicle_ID));

      const offers = await SELECT.from(Offers)
        .columns('ID', 'vehicle_ID', 'offeredPrice', 'currency', 'status', 'desiredPickupDate')
        .where({
          customer_ID: req.user.id,
          vehicle_ID: { in: ids },
          status: { in: ACTIVE_OFFER_STATUSES },
        });
      for (const offer of offers) {
        activeOfferByVehicle[offer.vehicle_ID] = offer;
      }
    }

    for (const row of list) {
      if (row) {
        row.primaryImageUrl = firstImageByVehicle[row.ID] ?? null;
        row.isFavorited = favoritedIds.has(row.ID);
        row.isNotFavorited = !favoritedIds.has(row.ID);

        const offer = activeOfferByVehicle[row.ID];
        row.hasActiveOffer = !!offer;
        row.hasNoActiveOffer = !offer;
        row.myOfferId = offer?.ID ?? null;
        row.myOfferPrice = offer?.offeredPrice ?? null;
        row.myOfferCurrency = offer?.currency ?? null;
        row.myOfferStatus = offer?.status ?? null;
        row.myOfferDesiredPickupDate = offer?.desiredPickupDate ?? null;
      }
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

  // submitOffer/requestTestDrive (EPIC20-T2), same bound-action delegation
  // pattern as reserve/addToFavorites above.
  srv.on('submitOffer', 'Vehicles', async (req) => {
    const [{ ID: vehicleId }] = req.params;
    const { offeredPrice, currency, desiredPickupDate, notes } = req.data;
    const offerSrv = await cds.connect.to('OfferService');
    return offerSrv.send('submitOffer', {
      vehicleId,
      offeredPrice,
      currency,
      desiredPickupDate,
      notes,
    });
  });

  // removeOffer (EPIC22-T1): withdraws the customer's own still-pending
  // offer on this vehicle. Looks up the offer itself (same "derive from
  // context" approach submitOffer's branchId derivation uses) so the UI
  // never needs to know or pass an offerId — delegates the actual deletion
  // to OfferService.withdrawOffer, which re-verifies ownership and status.
  srv.on('removeOffer', 'Vehicles', async (req) => {
    const [{ ID: vehicleId }] = req.params;
    const offer = await SELECT.one
      .from(Offers)
      .columns('ID')
      .where({
        vehicle_ID: vehicleId,
        customer_ID: req.user.id,
        status: { in: ACTIVE_OFFER_STATUSES },
      });
    if (!offer) return req.error(404, 'No active offer to remove');

    const offerSrv = await cds.connect.to('OfferService');
    return offerSrv.send('withdrawOffer', { offerId: offer.ID });
  });

  // requestTestDrive needs branchId, which TestDriveService.requestTestDrive
  // takes as a plain parameter (unlike submitOffer, which derives branch_ID
  // from the vehicle row itself internally). Read it here from the bound
  // vehicle so the customer never has to type a branch ID they have no
  // reason to know.
  srv.on('requestTestDrive', 'Vehicles', async (req) => {
    const [{ ID: vehicleId }] = req.params;
    const { scheduledAt, notes } = req.data;
    const { Vehicles } = cds.entities('automarket');
    const vehicle = await SELECT.one.from(Vehicles).columns('branch_ID').where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');

    const tdSrv = await cds.connect.to('TestDriveService');
    return tdSrv.send('requestTestDrive', {
      vehicleId,
      branchId: vehicle.branch_ID,
      scheduledAt,
      notes,
    });
  });

  // resubmit (EPIC20-T2): bound to Offers, delegates to OfferService.resubmitOffer.
  srv.on('resubmit', 'Offers', async (req) => {
    const [{ ID: offerId }] = req.params;
    const { offeredPrice, desiredPickupDate } = req.data;
    const offerSrv = await cds.connect.to('OfferService');
    return offerSrv.send('resubmitOffer', { offerId, offeredPrice, desiredPickupDate });
  });

  // cancel (EPIC20-T2): bound to TestDrives, delegates to
  // TestDriveService.cancelTestDrive, which already enforces ownership for
  // the Customer role.
  srv.on('cancel', 'TestDrives', async (req) => {
    const [{ ID: testDriveId }] = req.params;
    const tdSrv = await cds.connect.to('TestDriveService');
    return tdSrv.send('cancelTestDrive', { testDriveId });
  });

  // checkout (EPIC20-T3): bound to Vehicles, delegates to SalesService.createOrder.
  srv.on('checkout', 'Vehicles', async (req) => {
    const [{ ID: vehicleId }] = req.params;
    const { deliveryType } = req.data;
    const salesSrv = await cds.connect.to('SalesService');
    return salesSrv.send('createOrder', { vehicleId, deliveryType });
  });

  // cancel (EPIC20-T3): bound to Orders, delegates to SalesService.cancelOrder.
  srv.on('cancel', 'Orders', async (req) => {
    const [{ ID: orderId }] = req.params;
    const salesSrv = await cds.connect.to('SalesService');
    return salesSrv.send('cancelOrder', { orderId });
  });

  // pay (EPIC20-T3): bound to Orders. amount/currency are read from the
  // order's own vehicle price — not a customer-supplied value, so there is
  // no way to under/over-pay by editing a form field. idempotencyKey is
  // generated here rather than exposed as a parameter: the customer has no
  // reason to manage one, and PaymentService's own "one active payment per
  // order" guard already protects against accidental double-submission.
  srv.on('pay', 'Orders', async (req) => {
    const [{ ID: orderId }] = req.params;
    const { provider } = req.data;
    const { Orders: OrdersEntity, Vehicles } = cds.entities('automarket');
    const order = await SELECT.one.from(OrdersEntity).columns('vehicle_ID').where({ ID: orderId });
    if (!order) return req.error(404, 'Order not found');
    const vehicle = await SELECT.one
      .from(Vehicles)
      .columns('price', 'currency')
      .where({ ID: order.vehicle_ID });

    const paymentSrv = await cds.connect.to('PaymentService');
    return paymentSrv.send('initiatePayment', {
      orderId,
      provider,
      idempotencyKey: cds.utils.uuid(),
      amount: vehicle.price,
      currency: vehicle.currency,
    });
  });

  // retryPay (EPIC20-T3): bound to Orders. No parameters at all — provider,
  // amount, and currency are copied from the last FAILED payment by
  // PaymentService.retryPayment itself; idempotencyKey is generated here for
  // the same reason as pay above.
  srv.on('retryPay', 'Orders', async (req) => {
    const [{ ID: orderId }] = req.params;
    const paymentSrv = await cds.connect.to('PaymentService');
    return paymentSrv.send('retryPayment', { orderId, idempotencyKey: cds.utils.uuid() });
  });
});
