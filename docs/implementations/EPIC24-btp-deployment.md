# EPIC24 — SAP BTP Deployment

**Goal:** Deploy the application to the real SAP BTP trial subaccount (`asy-dev-train` org, `dev`
space, Cloud Foundry `eu20-001`) — a real XSUAA login flow behind a real Approuter, no paid
services. PostgreSQL provisioning is out of scope (confirmed via `cf marketplace -e postgresql-db`:
no free plan on this subaccount) — the app runs on SQLite (`:memory:`) instead, via a new `[trial]`
cds profile.

---

## Sprint Overview

### Ticket Table

| Ticket | Description | Status |
|--------|-------------|--------|
| EPIC24-T1 | Complete the Approuter | Done |
| EPIC24-T2 | Deployment descriptor (`mta.yaml`) | Open |
| EPIC24-T3 | UI app deployment strategy | Open |
| EPIC24-T4 | Real XSUAA provisioning | Open |
| EPIC24-T5 | CI/CD deploy step | Open |
| EPIC24-T6 | `[trial]` cds profile | Done |

### Sprint Backlog DoD Mapping

| DoD Item | Satisfied by |
|----------|-------------|
| Application reachable at a real BTP URL, behind the Approuter | EPIC24-T1, T2, T3 |
| Genuine XSUAA login flow (not mocked auth) | EPIC24-T1, T4, T6 |
| Database is SQLite (`:memory:`) — accepted trade-off, not a bug | EPIC24-T6 |
| GitHub Actions deploys on merge to main (or on approval) | EPIC24-T5 |

### Sign-off

_To be filled in at sprint end (T1–T5 still open)._

---

## EPIC24-T6: `[trial]` cds Profile

### What & Why

Neither of EPIC23's two profiles fits this deployment: `[production]` pairs `xsuaa` with
`postgres` (postgres now out of scope, per this epic's scope correction), `[hybrid]` pairs
`mocked` auth with `postgres` (wrong auth for a real BTP login flow). This trial deployment needs
real `xsuaa` auth with the plain `sqlite` `:memory:` database already used for local dev/CI — a
combination neither existing profile produces.

### Step-by-step instructions

#### 1. Modify `package.json`

Added `"[trial]": {"auth": {"kind": "xsuaa"}}` to `cds.requires`, sibling to `[production]` and
`[hybrid]`. No `db` override — omitting it means `db` falls through to the base (non-profile)
config, which is already `kind: sqlite`, `credentials.url: ':memory:'`.

### Verify

`npx cds env get requires.auth --profile trial` → `kind: xsuaa`; `npx cds env get requires.db
--profile trial` → `kind: sqlite`, `credentials.url: ':memory:'` — confirmed via `cds env`, not
assumed from reading the JSON.

```sh
npm run lint && npm run format:check && npm test
```

All 138 tests pass, 0 lint errors (3 pre-existing unrelated warnings), format clean.

---

## EPIC24-T1: Complete the Approuter

### What & Why

`approuter/` had a stub `xs-app.json` and a rate-limiting policy doc (AD-24) but wasn't a
deployable unit — no `package.json`, no `@sap/approuter` dependency, and its config file was
literally named `" xs-app.json"` with a leading space (the Approuter looks for a file named exactly
`xs-app.json`; the typo meant it would never have found its own config at all).

**A real design tension surfaced and resolved with the user before writing routes, not guessed
at:** the stub's routes set `authenticationType: "xsuaa"` globally — forcing an XSUAA login
redirect on every request. This project has deliberate, tested guest access (`@requires: 'any'`
across `/catalog`, `/vehicle`, `/reservation`, `/test-drive` — verified across many earlier epics,
most recently EPIC22's Vehicle Catalog work). Forcing XSUAA on every route would have broken guest
browsing entirely. Investigated `modules/identity/api/identity-service.cds`'s own comment first —
it explains that CAP's `@requires`/`@restrict` is already the authoritative, fine-grained
authorization layer, and when XSUAA is active it "handles MFA enforcement before the request
reaches this handler" (i.e., authentication happens once, upstream, and the backend just trusts the
already-validated identity it's handed). Confirmed with the user: keep every route
`authenticationType: "none"` at the Approuter layer, and let CAP's own authorization — already
correct and already tested — be the single source of truth for who can do what, exactly as it
already works in local/mocked-auth mode today. The Approuter's job becomes purely "route + forward
identity if present," not "gate access."

### Step-by-step instructions

#### 1. Rename `approuter/ xs-app.json` → `approuter/xs-app.json`

Fixes the leading-space typo — confirmed via `git mv`, not just a manual rename (preserves file
history).

#### 2. Modify `approuter/xs-app.json`

Changed both routes' `authenticationType` from `"xsuaa"` to `"none"` (see reasoning above).
`/identity/(.*)$` keeps its own dedicated route (not folded into the catch-all) — its own comment
in `identity-service.cds` says this split exists specifically so routing/rate-limiting can target
the auth surface independently, so the existing separation was preserved, not accidental. Updated
`welcomeFile` from `/index.html` (never existed — pre-dates the EPIC21 multi-app split, when
`app/*/webapp` didn't exist yet) to `/customer-portal/webapp/index.html`, the actual customer-facing
landing app; `csrfProtection: true` on both routes was already correct, left unchanged.

#### 3. Create `approuter/package.json`

`@sap/approuter` (`^22`) + `express-rate-limit` (`^8.5.2`, for step 4) as dependencies; `start`
script points at a custom `server.js` (step 4) instead of the bare `@sap/approuter` CLI entry
point, since custom middleware injection requires using the Approuter as a library, not its CLI.

#### 4. Create `approuter/server.js`

Implements AD-24's rate-limiting policy (`approuter/rate-limiting.md`) as custom Approuter
middleware, via its documented `beforeRequestHandler.use(...)` extension point (`doc/extending.md`
in the installed package — confirmed this extension mechanism actually exists by reading it, not
assumed). Two `express-rate-limit` limiters (read: GET/HEAD/OPTIONS, write: everything else), each
with a dynamic `max` distinguishing "looks authenticated" (an `Authorization` header or an
XSUAA/`JSESSIONID` session cookie present — a coarse signal, not real authentication; the Approuter
never validates it, CAP does) from guest.

**Corrected the policy doc's own premise, not blindly implemented it:** `rate-limiting.md` named two
options — SAP API Management (checked the actual `cf marketplace` output from this trial subaccount,
EPIC24's own scope-correction note above — not present at all, and would be paid if it were) or "the
Approuter's built-in throttling plugin" (grepped the installed `@sap/approuter@22.0.3` package's own
source for "rate limit"/"throttl" — no such built-in feature exists). Implemented via
`express-rate-limit`, a plain npm package with no BTP service dependency, instead — zero-cost, no
paid service, matching the user's constraint from this epic's own scope correction.

### Verify

All verified end to end in a live local setup (`cds-serve` as the backend on port 4005, the
Approuter itself on port 5000, `destinations` env var pointing the `cap-backend` destination at the
local backend — the closest approximation of the real deployment topology available without a
bound XSUAA service):

- **Routing correctness**: `/customer-portal/webapp/index.html` (a Fiori UI app) → `200`;
  `/catalog/$metadata` → `200`; an authenticated `GET /catalog/Vehicles` → `200` with real data,
  proxied and forwarded correctly through the Approuter.
- **Guest access preserved** (the whole point of the `none`-everywhere design): an unauthenticated
  `GET /catalog/Vehicles` through the Approuter → `200`, `createdBy: "anonymous"` — guest browsing
  genuinely still works end to end, not just in theory.
- **Staff-only resources still protected**: an unauthenticated `GET /operator/Vehicles` through the
  Approuter → `401` — confirms `authenticationType: "none"` at the Approuter does **not** create a
  security hole; CAP's own `@requires`/`@restrict` continues to enforce exactly as it always has.
- **Rate limiting, all four policy combinations confirmed via response headers**, not just that the
  middleware loads without error: guest read → `RateLimit-Limit: 100`; authenticated read →
  `RateLimit-Limit: 300`; guest write → `RateLimit-Limit: 20`; authenticated write →
  `RateLimit-Limit: 100` — all four match AD-24's table exactly.
- **A real bug caught by `express-rate-limit`'s own startup validation, not discovered later**: the
  first version of the `keyGenerator` used `req.ip` directly, which `express-rate-limit@8` flags as
  a potential IPv6 rate-limit-bypass risk (many textual representations of one IPv6 address could
  each get their own counter) — fixed by using the package's own `ipKeyGenerator` helper instead.

**Not verified**: real XSUAA session-cookie-based authentication and CSRF protection's actual
enforcement against a genuine browser session — both require a real bound XSUAA service (EPIC24-T4)
to test properly. The Basic-Auth-header-based local testing above exercises the routing/forwarding
and rate-limiting logic correctly, but not the full XSUAA login-redirect handshake.

```sh
npm run lint && npm run format:check && npm test
```

All 138 tests pass, 0 lint errors (3 pre-existing unrelated warnings), format clean.
`npx eslint approuter/server.js` run explicitly too (not excluded from the root ESLint config's
scope — only `app/` is) — clean.

---
