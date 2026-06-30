'use strict';

const jwt = require('jsonwebtoken');

// Secret is loaded from env so it can be rotated without a code change.
// The dev fallback must never be used in production — the missing env var
// will produce tokens that any developer with this repo can forge.
const GUEST_TOKEN_SECRET =
  process.env.GUEST_TOKEN_SECRET || 'guest-token-dev-secret-CHANGE-IN-PROD';

// issueGuestToken: signs a short-lived JWT embedding the reservationId.
// Expiry is 48h to match the reservation expiry window — a guest cannot
// use a token to access an already-expired reservation.
function issueGuestToken(reservationId) {
  return jwt.sign({ reservationId, type: 'guest-reservation' }, GUEST_TOKEN_SECRET, {
    expiresIn: '48h',
  });
}

// verifyGuestToken: verifies signature and expiry; throws on failure.
// Callers must catch and convert to a 401 error.
function verifyGuestToken(token) {
  return jwt.verify(token, GUEST_TOKEN_SECRET);
}

module.exports = { issueGuestToken, verifyGuestToken };
