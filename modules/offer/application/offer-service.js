'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { Offers, Reservations, Vehicles } = cds.entities('automarket');

  // submitOffer: verifies the vehicle is FOR_SALE, then inserts a SUBMITTED offer.
  // Branch is read from the vehicle row so the customer cannot spoof it.
  srv.on('submitOffer', async (req) => {
    const { vehicleId, offeredPrice, currency, desiredPickupDate, notes } = req.data;

    const vehicle = await SELECT.one
      .from(Vehicles)
      .columns('ID', 'status', 'branch_ID')
      .where({ ID: vehicleId });
    if (!vehicle) return req.error(404, 'Vehicle not found');
    if (vehicle.status !== 'FOR_SALE')
      return req.error(409, 'Offers can only be submitted for FOR_SALE vehicles');

    const id = cds.utils.uuid();
    await INSERT.into(Offers).entries({
      ID: id,
      vehicle_ID: vehicleId,
      branch_ID: vehicle.branch_ID,
      customer_ID: req.user.id,
      offeredPrice,
      currency: currency ?? 'TRY',
      desiredPickupDate,
      status: 'SUBMITTED',
    });

    await srv.emit('OfferSubmitted', { offerId: id, vehicleId });
    return id;
  });

  // approveOffer: transitions offer to APPROVED, then creates an APPROVED
  // Reservation so the vehicle is immediately held for the customer.
  // expiresAt is set to 48h from now — same window as a normal reservation.
  srv.on('approveOffer', async (req) => {
    const { offerId } = req.data;
    const offer = await SELECT.one.from(Offers).where({ ID: offerId });
    if (!offer) return req.error(404, 'Offer not found');
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(offer.status)) {
      return req.error(409, `Cannot approve an offer in status ${offer.status}`);
    }

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    await UPDATE(Offers).set({ status: 'APPROVED' }).where({ ID: offerId });
    await INSERT.into(Reservations).entries({
      vehicle_ID: offer.vehicle_ID,
      branch_ID: offer.branch_ID,
      customer_ID: offer.customer_ID,
      guestToken: null,
      status: 'APPROVED',
      expiresAt,
    });

    await srv.emit('OfferApproved', { offerId, vehicleId: offer.vehicle_ID });
    return true;
  });

  // rejectOffer: transitions offer to REJECTED and stores the Manager's reason.
  // The customer may resubmit with a revised price (handled in T3).
  srv.on('rejectOffer', async (req) => {
    const { offerId, rejectionNotes } = req.data;
    const offer = await SELECT.one.from(Offers).where({ ID: offerId });
    if (!offer) return req.error(404, 'Offer not found');
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(offer.status)) {
      return req.error(409, `Cannot reject an offer in status ${offer.status}`);
    }

    await UPDATE(Offers).set({ status: 'REJECTED', rejectionNotes }).where({ ID: offerId });
    await srv.emit('OfferRejected', { offerId, vehicleId: offer.vehicle_ID });
    return true;
  });

  // resubmitOffer: resets a REJECTED offer to SUBMITTED with a revised price.
  // Only the offer's original customer may resubmit — enforced by checking
  // customer_ID against req.user.id before any write.
  srv.on('resubmitOffer', async (req) => {
    const { offerId, offeredPrice, desiredPickupDate } = req.data;
    const offer = await SELECT.one.from(Offers).where({ ID: offerId });
    if (!offer) return req.error(404, 'Offer not found');

    if (offer.customer_ID !== req.user.id) {
      return req.error(403, 'You can only resubmit your own offers');
    }
    if (offer.status !== 'REJECTED') {
      return req.error(
        409,
        `Only REJECTED offers can be resubmitted; current status: ${offer.status}`
      );
    }

    await UPDATE(Offers)
      .set({ status: 'SUBMITTED', offeredPrice, desiredPickupDate, rejectionNotes: null })
      .where({ ID: offerId });

    await srv.emit('OfferSubmitted', { offerId, vehicleId: offer.vehicle_ID });
    return true;
  });

  // withdrawOffer: deletes a still-pending offer at the customer's own
  // request. Same ownership check as resubmitOffer above. Unlike
  // rejectOffer, this actually removes the row — the customer retracted it
  // before a Manager ever reviewed it, so there is no decision to preserve.
  srv.on('withdrawOffer', async (req) => {
    const { offerId } = req.data;
    const offer = await SELECT.one.from(Offers).where({ ID: offerId });
    if (!offer) return req.error(404, 'Offer not found');

    if (offer.customer_ID !== req.user.id) {
      return req.error(403, 'You can only withdraw your own offers');
    }
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(offer.status)) {
      return req.error(409, `Cannot withdraw an offer in status ${offer.status}`);
    }

    await DELETE.from(Offers).where({ ID: offerId });
    return true;
  });
});
