const jwt = require('jsonwebtoken');

// JWT_SECRET must be set via environment variable — never hardcoded in source.
// Rotating the secret invalidates all active tokens, which is the intended
// behavior for a forced logout scenario (e.g. security incident).
const SECRET = process.env.JWT_SECRET;

// 8h covers a full working day without forcing re-login mid-session.
// Shorter (e.g. 1h) would be more secure but would require refresh-token logic
// which we are not implementing yet. Revisit before production launch.
const EXPIRES_IN = '8h';

// The payload includes role so downstream CAP handlers can read req.user.role
// without an extra DB round-trip on every authenticated request.
function issueToken(payload) {
    if (!SECRET) throw new Error('JWT_SECRET env var is not set');
    return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

function verifyToken(token) {
    if (!SECRET) throw new Error('JWT_SECRET env var is not set');
    // jwt.verify throws if the token is expired or the signature is invalid —
    // callers must catch and return 401, not let the error bubble as a 500.
    return jwt.verify(token, SECRET);
}

module.exports = { issueToken, verifyToken };
