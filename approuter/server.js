'use strict';

const approuter = require('@sap/approuter');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// AD-24 rate-limiting policy (approuter/rate-limiting.md), implemented as a
// custom Approuter middleware — @sap/approuter has no built-in throttling
// plugin (checked its own source and docs, not assumed), and SAP API
// Management (the other option the policy doc names) is a separate, paid
// BTP service not available on this trial subaccount's marketplace. This is
// the zero-additional-cost path: express-rate-limit is a pure npm package
// with no BTP service dependency.
//
// "Authenticated" here means "the request carries something that looks like
// a credential" (an Authorization header, or an XSUAA session cookie) — the
// Approuter itself never validates it (every route is authenticationType:
// "none", so CAP's own @requires/@restrict is the real authorization
// decision-maker, see EPIC24-T1's implementation log). This is a coarser
// signal than "actually authenticated," by design: rate limiting only needs
// to distinguish "this client attempted to identify itself" from "this
// client sent nothing at all," not perform real authentication itself.
function looksAuthenticated(req) {
  return (
    Boolean(req.headers.authorization) ||
    Boolean(req.headers.cookie && req.headers.cookie.includes('JSESSIONID'))
  );
}

function isWrite(req) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
}

const READ_LIMITS = { authenticated: 300, guest: 100 };
const WRITE_LIMITS = { authenticated: 100, guest: 20 };

// Two separate limiters (read vs write) rather than one with a dynamic max
// per request type — express-rate-limit tracks each limiter's own counter
// independently, so a client maxing out write requests can't also be
// blocked from reads by the same counter, matching the policy's intent of
// two distinct budgets.
function makeLimiter(limits) {
  return rateLimit({
    windowMs: 60 * 1000,
    max: (req) => (looksAuthenticated(req) ? limits.authenticated : limits.guest),
    standardHeaders: true,
    legacyHeaders: false,
    // Keyed by IP + auth-presence, not by IP alone — otherwise an
    // authenticated and a guest client behind the same NAT/proxy would
    // share one counter and the wrong limit could apply to either.
    // ipKeyGenerator (not req.ip directly) normalizes IPv6 addresses to a
    // /56 subnet — express-rate-limit's own validation rejects raw req.ip
    // use as an IPv6 rate-limit bypass risk (many textual representations
    // of the same address), caught by actually running this, not assumed.
    keyGenerator: (req) =>
      `${ipKeyGenerator(req.ip)}:${looksAuthenticated(req) ? 'auth' : 'guest'}`,
    message: { error: 'Too many requests, please try again later.' },
  });
}

const readLimiter = makeLimiter(READ_LIMITS);
const writeLimiter = makeLimiter(WRITE_LIMITS);

const ar = approuter();

ar.beforeRequestHandler.use((req, res, next) => {
  const limiter = isWrite(req) ? writeLimiter : readLimiter;
  limiter(req, res, next);
});

ar.start();
