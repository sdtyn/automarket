'use strict';

const {
  transition,
  allowedEvents,
} = require('../../../modules/vehicle/domain/vehicle-state-machine');

// Minimal vehicle factory — only the fields the state machine reads.
const vehicle = (status, overrides = {}) => ({
  status,
  price: 10000,
  branch_ID: 'branch-1',
  images: [{ url: 'img.jpg' }],
  ...overrides,
});

describe('VehicleStateMachine — transition()', () => {
  // ── DRAFT transitions ──────────────────────────────────────────────────────

  describe('DRAFT', () => {
    it('publishes to FOR_SALE when price, branch, and image are present', () => {
      expect(transition(vehicle('DRAFT'), 'VehiclePublished')).toBe('FOR_SALE');
    });

    it('rejects VehiclePublished when price is missing', () => {
      expect(() => transition(vehicle('DRAFT', { price: null }), 'VehiclePublished')).toThrow();
    });

    it('rejects VehiclePublished when branch_ID is missing', () => {
      expect(() => transition(vehicle('DRAFT', { branch_ID: null }), 'VehiclePublished')).toThrow();
    });

    it('rejects VehiclePublished when images array is empty', () => {
      expect(() => transition(vehicle('DRAFT', { images: [] }), 'VehiclePublished')).toThrow();
    });

    it('rejects VehiclePublished when images is missing entirely', () => {
      expect(() =>
        transition(vehicle('DRAFT', { images: undefined }), 'VehiclePublished')
      ).toThrow();
    });

    it('archives DRAFT vehicle', () => {
      expect(transition(vehicle('DRAFT'), 'VehicleArchived')).toBe('ARCHIVED');
    });

    it('rejects unknown event from DRAFT', () => {
      expect(() => transition(vehicle('DRAFT'), 'ReservationCreated')).toThrow();
    });
  });

  // ── FOR_SALE transitions ───────────────────────────────────────────────────

  describe('FOR_SALE', () => {
    it('moves to RESERVED on ReservationCreated', () => {
      expect(transition(vehicle('FOR_SALE'), 'ReservationCreated')).toBe('RESERVED');
    });

    it('moves to RESERVED on OfferApproved', () => {
      expect(transition(vehicle('FOR_SALE'), 'OfferApproved')).toBe('RESERVED');
    });

    it('moves to PENDING_PAYMENT on CheckoutStarted (direct purchase)', () => {
      expect(transition(vehicle('FOR_SALE'), 'CheckoutStarted')).toBe('PENDING_PAYMENT');
    });

    it('archives FOR_SALE vehicle', () => {
      expect(transition(vehicle('FOR_SALE'), 'VehicleArchived')).toBe('ARCHIVED');
    });

    it('rejects unknown event from FOR_SALE', () => {
      expect(() => transition(vehicle('FOR_SALE'), 'PaymentSucceeded')).toThrow();
    });
  });

  // ── RESERVED transitions ───────────────────────────────────────────────────

  describe('RESERVED', () => {
    it('cancels reservation and returns to FOR_SALE', () => {
      expect(transition(vehicle('RESERVED'), 'ReservationCancelled')).toBe('FOR_SALE');
    });

    it('expires reservation and returns to FOR_SALE', () => {
      expect(transition(vehicle('RESERVED'), 'ReservationExpired')).toBe('FOR_SALE');
    });

    it('moves to PENDING_PAYMENT on CheckoutStarted when requester owns reservation', () => {
      const ctx = { requesterId: 'user-1', reservationOwnerId: 'user-1' };
      expect(transition(vehicle('RESERVED'), 'CheckoutStarted', ctx)).toBe('PENDING_PAYMENT');
    });

    it('rejects CheckoutStarted when requester does not own reservation', () => {
      const ctx = { requesterId: 'user-2', reservationOwnerId: 'user-1' };
      expect(() => transition(vehicle('RESERVED'), 'CheckoutStarted', ctx)).toThrow();
    });

    it('rejects unknown event from RESERVED', () => {
      expect(() => transition(vehicle('RESERVED'), 'VehicleArchived')).toThrow();
    });
  });

  // ── PENDING_PAYMENT transitions ────────────────────────────────────────────

  describe('PENDING_PAYMENT', () => {
    it('moves to SOLD on PaymentSucceeded', () => {
      expect(transition(vehicle('PENDING_PAYMENT'), 'PaymentSucceeded')).toBe('SOLD');
    });

    it('returns to FOR_SALE on PaymentFailed without active reservation', () => {
      expect(transition(vehicle('PENDING_PAYMENT'), 'PaymentFailed', {})).toBe('FOR_SALE');
    });

    it('returns to FOR_SALE on PaymentFailed when context is omitted', () => {
      // transition() defaults context to {} — no active reservation, so FOR_SALE.
      expect(transition(vehicle('PENDING_PAYMENT'), 'PaymentFailed')).toBe('FOR_SALE');
    });

    it('returns to RESERVED on PaymentFailed with active reservation', () => {
      const ctx = { hasActiveReservation: true };
      expect(transition(vehicle('PENDING_PAYMENT'), 'PaymentFailed', ctx)).toBe('RESERVED');
    });

    it('rejects unknown event from PENDING_PAYMENT', () => {
      expect(() => transition(vehicle('PENDING_PAYMENT'), 'ReservationCreated')).toThrow();
    });
  });

  // ── SOLD transitions ───────────────────────────────────────────────────────

  describe('SOLD', () => {
    it('moves to DELIVERED on DeliveryConfirmed', () => {
      expect(transition(vehicle('SOLD'), 'DeliveryConfirmed')).toBe('DELIVERED');
    });

    it('rejects any other event from SOLD', () => {
      expect(() => transition(vehicle('SOLD'), 'PaymentFailed')).toThrow();
    });
  });

  // ── Terminal statuses ──────────────────────────────────────────────────────

  describe('terminal statuses', () => {
    it('rejects any event from ARCHIVED', () => {
      expect(() => transition(vehicle('ARCHIVED'), 'VehiclePublished')).toThrow();
    });

    it('rejects any event from DELIVERED', () => {
      expect(() => transition(vehicle('DELIVERED'), 'DeliveryConfirmed')).toThrow();
    });
  });
});

describe('VehicleStateMachine — allowedEvents()', () => {
  it('returns publish and archive for a complete DRAFT vehicle', () => {
    const events = allowedEvents(vehicle('DRAFT'));
    expect(events).toContain('VehiclePublished');
    expect(events).toContain('VehicleArchived');
  });

  it('does not include VehiclePublished for an incomplete DRAFT (missing price)', () => {
    const events = allowedEvents(vehicle('DRAFT', { price: null }));
    expect(events).not.toContain('VehiclePublished');
    expect(events).toContain('VehicleArchived');
  });

  it('returns correct events for FOR_SALE', () => {
    const events = allowedEvents(vehicle('FOR_SALE'));
    expect(events).toEqual(
      expect.arrayContaining([
        'ReservationCreated',
        'OfferApproved',
        'CheckoutStarted',
        'VehicleArchived',
      ])
    );
  });

  it('includes CheckoutStarted for RESERVED only when requester owns reservation', () => {
    const ctx = { requesterId: 'u1', reservationOwnerId: 'u1' };
    expect(allowedEvents(vehicle('RESERVED'), ctx)).toContain('CheckoutStarted');
  });

  it('excludes CheckoutStarted for RESERVED when requester is not the owner', () => {
    const ctx = { requesterId: 'u2', reservationOwnerId: 'u1' };
    expect(allowedEvents(vehicle('RESERVED'), ctx)).not.toContain('CheckoutStarted');
  });

  it('returns empty array for ARCHIVED (terminal)', () => {
    expect(allowedEvents(vehicle('ARCHIVED'))).toHaveLength(0);
  });

  it('returns empty array for DELIVERED (terminal)', () => {
    expect(allowedEvents(vehicle('DELIVERED'))).toHaveLength(0);
  });
});
