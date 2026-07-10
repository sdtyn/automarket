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
| EPIC24-T2 | Deployment descriptor (`mta.yaml`) | Done |
| EPIC24-T3 | UI app deployment strategy | Done |
| EPIC24-T4 | Real deployment (`cf deploy`) | Done |
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

## EPIC24-T3: UI App Deployment Strategy

### What & Why

Decided with the user before writing `mta.yaml` (T2 needed this decision to know what to describe):
bundle all 14 `app/*/webapp` UI apps into the backend's own module, exactly as the existing
Dockerfile (EPIC23-T3) already does and as `cds-serve` has served them in every environment this
whole project has ever run in — rather than deploying each to the HTML5 Application Repository
(`html5-apps-repo`, confirmed free/available on this trial subaccount's marketplace) as separate
modules, served via the Approuter. The HTML5-repo route is the more "standard" BTP Fiori pattern,
but would mean 14 additional deployable units with their own build tasks, entirely unproven in this
project and adding real complexity for a trial deployment with no demonstrated need for it. No code
change of its own — this ticket's only artifact is the decision, reflected in T2's `mta.yaml`
(`automarket-srv`'s `path: .` includes `app/`, there is no separate UI module).

### Verify

Confirmed via the same `mbt build` used to verify T2: the packaged `automarket-srv` module's
`data.zip` contains `app/customer-portal/webapp/manifest.json` and every sibling app, served by the
same `cds-serve` process as the OData backend — no separate deployment step, no separate module.

---

## EPIC24-T2: Deployment Descriptor (`mta.yaml`)

### What & Why

`cds add mta` (the official `@sap/cds-dk` scaffolding command — used instead of hand-writing from
memory, same discipline as EPIC23-T1's `cds add postgres`) generated a starting `mta.yaml`, but its
defaults didn't match this epic's own decisions and needed real correction, not just cosmetic
edits:

1. **Deployed `gen/srv/`, which doesn't work for this project.** Identical finding to EPIC23-T3's
   Dockerfile (cap-notes.md #21): this project's `@impl:`-path service implementations
   (`modules/*/application/*.js`) aren't relocated into `gen/srv/` by `cds build`, so a module
   whose `path` is `gen/srv` would crash on startup exactly like the first Dockerfile attempt did.
   Changed `automarket-srv`'s `path` to `.` (the actual source tree) — `cds build` stays in
   `build-parameters.before-all` as a model-validation gate only, same role it plays in the
   Dockerfile.
2. **Included a `automarket-postgres` resource and an `automarket-postgres-deployer` module.**
   Removed both, per this epic's own scope correction (no paid services on this trial subaccount).
3. **No Approuter module at all.** Added `automarket-approuter` (`type: approuter.nodejs`,
   `path: approuter` — T1's now-complete module), wired to `automarket-auth` (the `xsuaa` resource,
   unchanged from the generated default — its `service-plan: application` already matches the
   confirmed-free plan from `cf marketplace -e xsuaa`) and to the backend's `srv-api` via a
   `destinations`-group `requires` entry (`name: cap-backend`, `url: ~{srv-url}`,
   `forwardAuthToken: true`) — this is what makes the Approuter's `xs-app.json` destination named
   `cap-backend` actually resolve to the real deployed backend URL at runtime, not a placeholder.
4. **`NODE_ENV: trial`** added to `automarket-srv`'s `parameters.env` — activates the `[trial]` cds
   profile (EPIC24-T6) on the deployed instance.
5. **A `build-parameters.ignore` list** on `automarket-srv` — excludes every `app/*/node_modules`
   and `approuter/node_modules` (dev-tooling-only, never used at runtime), plus `tests/`, `docs/`,
   `.git/`, `.github/`, `.claude/`, `.vscode/`, `gen/`, `mta_archives/` — none of which the running
   backend needs, all of which would otherwise bloat the uploaded module for no reason.

### Step-by-step instructions

#### 1. Run `npx cds add mta`

Scaffolds the starting `mta.yaml` (and, as a side effect, re-serializes `xs-security.json` with
different but equivalent formatting — same harmless side effect already seen from `cds add postgres`
in EPIC23-T1).

#### 2. Modify `mta.yaml`

All five corrections above, applied directly to the generated file.

### Verify

**Actually built the MTA archive locally**, not just eyeballed the YAML — `mbt` (Cloud MTA Build
Tool) happened to already be available in this sandbox (`which mbt` — a real, if lucky, capability
this epic's earlier tickets didn't have for `docker`). `mbt build` succeeded, producing
`mta_archives/automarket_1.0.0.mtar`. Unzipped and inspected both packaged modules directly:

- **`automarket-srv`**: contains `modules/identity/application/identity-service.js` (confirms the
  `@impl:`-path fix actually worked, not just that the YAML looked right) and every
  `app/*/webapp/manifest.json` (confirms T3's bundling decision is really reflected in what gets
  deployed). No `app/*/node_modules` bloat — the `ignore` list worked.
- **`automarket-approuter`**: contains `xs-app.json`, `server.js`, and its own `node_modules` — a
  complete, correctly self-contained module.
- **The generated `mtad.yaml`** (deployment descriptor, inside `META-INF/`) correctly shows both
  modules' `requires`/`provides` wired together (`srv-api` → `cap-backend` destination with
  `forwardAuthToken: true`) and `NODE_ENV: trial` set — confirms the abstract YAML config actually
  compiles to the intended real deployment topology, not just that it parses.

**A real, disruptive mistake made and immediately caught while doing this verification, not left
unnoticed:** `mbt build` with `automarket-srv`'s `path: .` runs its `npm ci --production`/`npm
clean-install --production` build step **directly in the project's own working directory** (not a
copy) — this silently stripped every devDependency (`prettier`, `jest`, `eslint`, etc.) from the
root `node_modules`, breaking `npm run format`/`npm test`/`npm run lint` until `npm install` was
re-run to restore them. Also left a stray `gen/` folder behind (the `cds build` validation step's
own output). **Anyone running `mbt build` locally in this repo must re-run `npm install` afterward
and remove the leftover `gen/` folder** — documented here so this doesn't quietly happen again and
go unnoticed the next time someone builds the MTA locally.

```sh
npm install
rm -rf gen mta_archives .automarket_mta_build_tmp
npm run lint && npm run format:check && npm test
```

All 138 tests pass, 0 lint errors (3 pre-existing unrelated warnings), format clean.

---

## EPIC24-T4: Real Deployment (`cf deploy`)

### What & Why

**Corrected before starting, by the user:** the ticket was originally planned as a separate manual
`cf create-service`/`cf bind-service` sequence, matching the pattern `docs/dev-notes.md` §4
documented for a generic BTP deployment. The user, who had already deployed the standard CAP
bookshop sample to this same trial subaccount, pointed out this is unnecessary — the `multiapps` CF
CLI plugin's `cf deploy <mtar>` command (confirmed installed via `cf plugins`) reads `mta.yaml`'s
own `resources:` section and creates + binds every declared service as part of the same operation
that uploads and starts the apps. T4 became: build the `.mtar` and run `cf deploy` for real,
nothing more.

**This ticket found (and fixed) four real, confirmed deployment bugs — none of them guessable from
reading the YAML, only from actually deploying and reading real crash/staging logs.** Each is a
genuine "verify what you can, don't guess" outcome, in the same spirit as every prior epic-closing
discovery this project has made:

1. **`mta.yaml`'s `automarket-srv.parameters.env` is not a valid key.** `cf deploy`'s own output
   warned `Parameter(s) "{automarket-srv=[env]}" are not supported... will be lost`, silently
   dropping the `NODE_ENV: trial` setting entirely. CF's Node.js buildpack then defaulted
   `NODE_ENV` to `production` on its own, activating the `[production]` cds profile (`postgres` +
   `xsuaa`) instead of `[trial]` — confirmed directly in `cf logs`:
   `"msg":"connect to db > postgres { url: ':memory:' }"`. The app then crashed for a second,
   compounding reason: EPIC23-T6's own `GUEST_TOKEN_SECRET` production-enforcement fired correctly
   (working exactly as designed — just triggered in the wrong profile). **Fix:** module-level
   `properties:` is the correct MTA key for CF user-provided environment variables, not
   `parameters.env`.
2. **`@cap-js/sqlite` was a devDependency.** With `NODE_ENV` correctly reaching `trial` after fix
   #1, the app crashed differently: `Cannot find module '/home/vcap/app/@cap-js/sqlite'`. Both
   `mbt`'s own packaging step and CF's Node.js buildpack install with `--production`
   (`npm clean-install --production`) regardless of what `NODE_ENV` the *running* app is later
   given — a devDependency is never in the uploaded package at all, full stop. `@cap-js/sqlite` had
   only ever been a devDependency because, until this epic, SQLite was exclusively a local-dev/CI
   tool — this epic's own decision to deploy *with* SQLite (no PostgreSQL, no paid service) makes it
   a genuine runtime dependency now, not an oversight to route around. **Fix:** moved
   `@cap-js/sqlite` from `devDependencies` to `dependencies` in `package.json`.
3. **`approuter/package.json`'s `engines.node: "^20"` doesn't exist on this landscape.** Staging
   failed with `Unable to install node: no match found for ^20 in [22.22.2 24.14.0 24.15.0]` — this
   CF Cloud Foundry landscape's Node.js buildpack simply doesn't offer a Node 20.x runtime at all.
   The backend module has no `engines` constraint of its own (defaults to whatever the buildpack
   picks) and started fine throughout; only the Approuter module, which I'd given an (incorrect,
   guessed) `^20` constraint in T1, was affected. **Fix:** relaxed to `^22 || ^24` — matching what
   `@sap/approuter@22.0.3` itself already declares as *its own* engine requirement (seen in an
   `EBADENGINE` warning during T1's local `npm install`, correctly ignored then since local
   `npm install` doesn't enforce `engines` — but CF's buildpack does).
4. **A confirmed, disruptive local side effect, not new to this ticket but hit again here:**
   `mbt build`'s `npm ci --production` (cap-notes.md #23) stripped devDependencies from the working
   directory on every one of the four build attempts below — `npm install` re-run after each one.

### Step-by-step instructions

#### 1. Modify `mta.yaml`

`automarket-srv`'s `properties: {NODE_ENV: trial}` instead of `parameters: {env: {NODE_ENV: trial}}`.

#### 2. Modify `package.json`

Move `@cap-js/sqlite` from `devDependencies` to `dependencies`.

#### 3. Modify `approuter/package.json`

`engines.node`: `"^20"` → `"^22 || ^24"`.

#### 4. Build and deploy

```sh
mbt build
cf deploy mta_archives/automarket_1.0.0.mtar -f
npm install   # mbt build strips devDependencies from the working tree — see cap-notes.md #23
```

### Verify

**The real thing, not a simulation** — four full `cf deploy` attempts against the actual
`asy-dev-train`/`dev` Cloud Foundry space, each diagnosed from real `cf logs`/staging output, not
guessed at. The fourth succeeded completely:

```
Application "automarket-srv" started and available at "asy-dev-train-dev-automarket-srv.cfapps.eu20-001.hana.ondemand.com"
Application "automarket-approuter" started and available at "asy-dev-train-dev-automarket-approuter.cfapps.eu20-001.hana.ondemand.com"
```

Then verified the live deployment actually works, via real HTTPS requests against the real
Approuter URL — not just that `cf deploy` printed "started":

- `GET /` → `200` (Approuter's own welcome-file redirect resolves).
- `GET /customer-portal/webapp/index.html` → `200` — the bundled Fiori UI app (EPIC24-T3's
  decision) is genuinely served through the Approuter.
- `GET /catalog/$metadata` → `200` — OData proxying through the Approuter to the real backend
  works.
- `GET /catalog/Vehicles` (no credentials) → `200`, `"createdBy":"anonymous"` — **guest catalog
  browsing, the entire reason T1 chose `authenticationType: "none"` over the stub's blanket
  `"xsuaa"`, genuinely works on the real, live, XSUAA-fronted deployment**, not just in the local
  approximation T1 tested against.

The XSUAA service instance (`automarket-auth`) exists in the real subaccount on the confirmed-free
`application` plan — `cf services` shows `create succeeded`, bound to both apps.

**Not yet verified**: an actual XSUAA login flow through a real browser (only guest/no-credential
requests were tested above — this app's guest-open surface is large enough that "it works" doesn't
by itself prove the login redirect + role-based authorization path is correct end to end); whether
`JWT_SECRET`/`GUEST_TOKEN_SECRET` are set on the deployed app at all (neither was configured via
`cf set-env` or `mta.yaml` `properties` — the app started successfully because nothing exercised
`/identity/login` or a guest-write path during this verification, not because those secrets are
confirmed present).

```sh
npm run lint && npm run format:check && npm test
```

All 138 tests pass, 0 lint errors (3 pre-existing unrelated warnings), format clean.

---
