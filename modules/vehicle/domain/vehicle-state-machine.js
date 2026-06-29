'use strict';

// Authoritative Vehicle state transition table — Implementation Architecture §13.
// Each entry: { from, event, to, guard }
// guard(vehicle, context) returns true when the transition is allowed.
// context carries request-time data (e.g. requesterId) that the entity row alone cannot supply.
const TRANSITIONS = [
  {
    from: 'DRAFT',
    event: 'VehiclePublished',
    to: 'FOR_SALE',
    // All required fields must be present before a vehicle enters the public catalog.
    guard: (v) => !!(v.price && v.branch_ID && v.images && v.images.length > 0),
  },
  {
    from: 'FOR_SALE',
    event: 'ReservationCreated',
    to: 'RESERVED',
    guard: () => true,
  },
  {
    from: 'FOR_SALE',
    event: 'OfferApproved',
    to: 'RESERVED',
    guard: () => true,
  },
  {
    from: 'FOR_SALE',
    event: 'CheckoutStarted',
    to: 'PENDING_PAYMENT',
    guard: () => true,
  },
  {
    from: 'RESERVED',
    event: 'CheckoutStarted',
    to: 'PENDING_PAYMENT',
    // Only the reservation/offer owner may initiate checkout from RESERVED state.
    guard: (v, ctx) => ctx && ctx.requesterId === ctx.reservationOwnerId,
  },
  {
    from: 'RESERVED',
    event: 'ReservationCancelled',
    to: 'FOR_SALE',
    guard: () => true,
  },
  {
    from: 'RESERVED',
    event: 'ReservationExpired',
    to: 'FOR_SALE',
    guard: () => true,
  },
  {
    from: 'PENDING_PAYMENT',
    event: 'PaymentSucceeded',
    to: 'SOLD',
    guard: () => true,
  },
  {
    from: 'PENDING_PAYMENT',
    event: 'PaymentFailed',
    to: 'FOR_SALE',
    // Direct-purchase failure: no reservation exists, vehicle returns to FOR_SALE.
    guard: (v, ctx) => !ctx || !ctx.hasActiveReservation,
  },
  {
    from: 'PENDING_PAYMENT',
    event: 'PaymentFailed',
    to: 'RESERVED',
    // Reservation-backed failure: reservation is still within its validity window.
    guard: (v, ctx) => !!(ctx && ctx.hasActiveReservation),
  },
  {
    from: 'SOLD',
    event: 'DeliveryConfirmed',
    to: 'DELIVERED',
    guard: () => true,
  },
  {
    from: 'FOR_SALE',
    event: 'VehicleArchived',
    to: 'ARCHIVED',
    guard: () => true,
  },
  {
    from: 'DRAFT',
    event: 'VehicleArchived',
    to: 'ARCHIVED',
    guard: () => true,
  },
];

// transition: applies the given event to the vehicle and returns the new status.
// Throws a domain error if no matching transition exists or the guard rejects.
// The caller (service handler) is responsible for persisting the new status and
// emitting the corresponding domain event after this function returns.
function transition(vehicle, event, context = {}) {
  const match = TRANSITIONS.find(
    (t) => t.from === vehicle.status && t.event === event && t.guard(vehicle, context)
  );

  if (!match) {
    throw new Error(
      `Invalid transition: ${vehicle.status} --[${event}]--> (no matching rule or guard rejected)`
    );
  }

  return match.to;
}

// allowedEvents: returns the list of events that can be applied to a vehicle
// in its current status, given the supplied context. Used by the service layer
// to build the set of available actions for a given user/vehicle combination.
function allowedEvents(vehicle, context = {}) {
  return TRANSITIONS.filter((t) => t.from === vehicle.status && t.guard(vehicle, context)).map(
    (t) => t.event
  );
}

module.exports = { transition, allowedEvents };
