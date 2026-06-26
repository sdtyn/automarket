const bcrypt = require('bcryptjs');

// SALT_ROUNDS controls hashing cost: each increment doubles the computation time
// (exponential). 12 produces ~200ms on a modern CPU — slow enough to make
// brute-force attacks impractical, fast enough that a real login feels instant.
// Do not lower this below 10 for production.
const SALT_ROUNDS = 12;

async function hashPassword(plain) {
    return bcrypt.hash(plain, SALT_ROUNDS);
}

// bcrypt.compare is timing-safe by design: it always takes the same amount of
// time regardless of where in the hash the comparison fails. This prevents
// timing attacks that could otherwise reveal whether a user account exists.
async function verifyPassword(plain, hash) {
    return bcrypt.compare(plain, hash);
}

module.exports = { hashPassword, verifyPassword };
