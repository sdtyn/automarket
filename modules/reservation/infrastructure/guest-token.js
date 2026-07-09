'use strict';

const jwt = require('jsonwebtoken');

// Secret is loaded from env so it can be rotated without a code change.
// EPIC23-T6: the dev fallback used to be silently reachable in production
// too (the comment said "must never be used in production" but nothing
// actually enforced it) — now NODE_ENV=production throws immediately if
// the env var is missing, matching JWT_SECRET's own (stricter, always-on)
// enforcement in the sibling identity module. Local dev/test keep the
// fallback unconditionally — this module has no other env var requirement,
// and adding one just for `npm start`/`npm test` isn't worth the friction.
const GUEST_TOKEN_SECRET =
  process.env.GUEST_TOKEN_SECRET ||
  (process.env.NODE_ENV === 'production'
    ? (() => {
        throw new Error('GUEST_TOKEN_SECRET env var is not set');
      })()
    : 'guest-token-dev-secret-CHANGE-IN-PROD');

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
