// Stub for the guest token provider used in the Guest Checkout flow (Sprint 4).
// A guest token is a short-lived, opaque token issued without credentials —
// it allows an unauthenticated user to track and claim a reservation.
// Full implementation is deferred to EPIC07 (Reservations & Guest Checkout).
const guestTokenProvider = {
  async authenticate() {
    throw new Error('Guest token provider is not implemented yet. Deferred to EPIC07.');
  },

  issueToken() {
    throw new Error('Guest token provider is not implemented yet. Deferred to EPIC07.');
  },

  verify() {
    throw new Error('Guest token provider is not implemented yet. Deferred to EPIC07.');
  },
};

module.exports = guestTokenProvider;
