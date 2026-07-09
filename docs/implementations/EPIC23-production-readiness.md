# EPIC23 — Production Readiness

**Goal:** Make the application deployable to a real environment: persistent database, real
authentication, containerization, and an extended CI/CD pipeline.

---

## Sprint Overview

### Ticket Table

| Ticket | Description | Status |
|--------|-------------|--------|
| EPIC23-T1 | PostgreSQL adapter | Done |
| EPIC23-T2 | XSUAA integration | Done |
| EPIC23-T3 | Dockerfile | Done |
| EPIC23-T4 | docker-compose (local integration) | Done |
| EPIC23-T5 | CI/CD pipeline extension | Done |
| EPIC23-T6 | Environment configuration | Done |

**Prior art (EPIC02-T8):** `xs-security.json` (scopes + role templates for Admin/Manager/Operator/
Customer) and `package.json`'s `cds.requires.[production].auth.kind: xsuaa` block already exist —
built for the mocked-auth-vs-production-auth split back in EPIC02, not this epic. T2 does **not**
start from scratch: its remaining scope is documenting the BTP service binding procedure (not yet
in `docs/dev-notes.md`) and verifying the existing config is actually correct/complete for a real
deployment, not re-adding scopes/role-templates that already exist.

### Sprint Backlog DoD Mapping

| DoD Item | Satisfied by |
|----------|-------------|
| `docker compose up` starts a working app connected to PostgreSQL | EPIC23-T1, T3, T4 |
| GitHub Actions pipeline runs tests on every PR and builds/pushes the Docker image on every merge to main | EPIC23-T5 |
| `docs/dev-notes.md` has complete setup instructions for a new developer | EPIC23-T1, T2, T4, T6 |

**One correction to the DoD's own wording:** it originally said "builds Docker image on every PR" —
implemented as build+push on every *merge to main* instead, deliberately, not a shortcut. Publishing
an image to GHCR for code that hasn't been reviewed/merged yet would be a real mistake (see
EPIC23-T5's own reasoning); tests still run on every PR via the existing `build-and-test` job,
unchanged.

### Sign-off

All six tickets done, every commit's own CI green (`build-and-test`; `docker-build-push` once T5's
own build-tools fix landed). Three real, confirmed bugs found and fixed while verifying rather than
assumed away because the config "looked right" — the throughline of this whole epic:

- **T2**: `@sap/xssec` was never installed (app crashed instantly under `NODE_ENV=production`) and
  the `branchId` XSUAA attribute was declared but never wired to the Manager/Operator role templates
  (would have left branch-scoped authorization silently broken in a real BTP deployment).
- **T3/T5**: `cds build --for nodejs`'s `gen/srv/` output isn't self-contained for this project's
  `@impl:`-path service-implementation layout (cap-notes.md #21); the Dockerfile's builder stage was
  missing the build toolchain `@cap-js/sqlite`'s native `better-sqlite3` binding needs, caught by
  the **first real `docker build` this epic ever ran** — GitHub Actions, not this sandbox, which
  never had `docker` available (cap-notes.md #22).
- **T6**: `GUEST_TOKEN_SECRET`'s dev-only fallback was silently reachable in production too, despite
  its own comment saying it shouldn't be — inconsistent with `JWT_SECRET`'s stricter, always-on
  enforcement in the same module family.

**What remains genuinely unverified**, flagged explicitly throughout rather than claimed working:
an actual `cds deploy --model-only`/`cds deploy` run against a real (non-containerized-in-CI)
PostgreSQL instance; a real XSUAA role-collection assignment and a genuine XSUAA-issued JWT reaching
`req.user.attr.branchId` in a handler; a full `docker compose up` → `make db-init` → real request
cycle. All three require infrastructure (a BTP subaccount, a persistent local Postgres/Docker
environment) this sandbox never had — each is called out at the exact point in this document where
it stops being verifiable, not silently assumed to work.

---

## EPIC23-T1: PostgreSQL Adapter

### What & Why

Production needs a real, persistent database — the project has run entirely on SQLite `:memory:`
(`package.json`, `cds.requires.db`) since EPIC01, which is fine for local dev/CI but means every
process restart wipes all data. `@cap-js/postgres` is CAP's official production database adapter,
following the same `cds.requires.[production]` profile-override pattern already established for auth
(`kind: xsuaa`, EPIC02-T8) — SQLite stays the default/dev/CI database, PostgreSQL only activates
under `NODE_ENV=production`.

**A version conflict caught before installing, not after:** the latest `@cap-js/postgres` (`3.0.1`)
requires `@sap/cds@^10` as a peer dependency, but this project pins `@sap/cds@^9` throughout (every
module, every test). Installing `3.0.1` would have forced either an `--force`/`--legacy-peer-deps`
install (silently broken peer resolution) or an unplanned `@sap/cds` major-version upgrade — out of
scope for "add a database adapter" and risky enough to affect every other module in the project.
Checked `@cap-js/postgres`'s published version history first and found `2.3.0` (`@sap/cds: >=9.8`,
compatible with the installed `9.9.2`) — installed that instead, no forcing needed.

**A scope question flagged and resolved before implementing, not guessed at:** the backlog wording
("create `db/migrations/` with an initial schema migration script") describes a hand-maintained SQL
migration workflow (Flyway/Liquibase style). `@cap-js/postgres` doesn't work that way — it has its
own built-in schema-evolution mechanism (the same one CAP uses for SAP HANA), tracked automatically
in a `cds_model` table it creates and maintains itself; there's no `db/migrations/*.sql` folder to
hand-write at all. Flagged to the user rather than either (a) creating a `db/migrations/` folder
that `@cap-js/postgres` would never actually read, just to match the literal ticket wording, or
(b) silently deciding to skip it. User confirmed: follow the tool's actual convention, adjust the
ticket's own deliverable accordingly.

### Step-by-step instructions

#### 1. Install the adapter

```sh
npm install --save @cap-js/postgres@2.3.0
```

#### 2. Modify `package.json`

Add a `db` block to the existing `cds.requires.[production]` profile (sibling to the existing
`auth: {kind: xsuaa}`):

```json
"[production]": {
  "auth": {
    "kind": "xsuaa"
  },
  "db": {
    "kind": "postgres"
  }
}
```

No credentials here — same reasoning as the existing `auth.kind: xsuaa` entry: real credentials come
from a bound BTP service (`VCAP_SERVICES`) or environment variables at actual deploy/runtime, never
hardcoded in a committed file. The base (non-production) `db` block — `kind: sqlite`,
`credentials.url: ':memory:'` — is untouched, so `cds-serve`/`npm test` without `NODE_ENV=production`
set behave exactly as before.

Ran `npx cds add postgres --for production` afterward as a cross-check — it produced the exact same
`package.json` diff (confirming the manual edit matched CAP's own convention) and, as a side effect,
regenerated `xs-security.json` with a `branchId` attribute definition that had never been added
(EPIC02-T8 wired `attr.branchId` into the *mocked* auth users but never declared `branchId` as an
actual XSUAA attribute — a real gap for T2, not something this ticket set out to fix, but a
legitimate one caught along the way and kept, not reverted).

#### 3. Document the setup in `docs/dev-notes.md`

Added `docs/dev-notes.md` §3 — local PostgreSQL setup (a one-line `docker run postgres:16` plus the
`CDS_REQUIRES_DB_CREDENTIALS_*` environment variables `NODE_ENV=production` needs), and the actual
CAP schema-evolution deploy workflow (`cds deploy --model-only` once, then `cds deploy` for every
subsequent model change — no hand-written SQL files, see "What & Why" above).

### Verify

**Config resolution** — `npx cds env get requires.db --profile production` correctly resolves
`impl: @cap-js/postgres`, `kind: postgres`, `schema_evolution: auto`.

**No regression to the existing SQLite dev/CI path** — `cds-serve` with no `NODE_ENV` set (the
normal dev/CI mode) still starts cleanly and serves on port 4004 exactly as before; `npm test` still
passes all 138 tests (the test suite runs against SQLite, unaffected by a production-only config
branch it never activates).

**Not verified against a real running PostgreSQL instance** — this sandbox has no `docker` or local
`postgres` available, so the actual `cds deploy --model-only` / `cds deploy` flow against a live
database was **not** run end to end. Flagged explicitly in `dev-notes.md` rather than silently
assumed to work; should be the first thing verified once a real (or containerized, EPIC23-T4)
PostgreSQL instance is available.

```sh
npm run lint && npm run format:check && npm test
```

All 138 tests pass, 0 lint errors (3 pre-existing unrelated warnings), format clean.

---

## EPIC23-T2: XSUAA Integration

### What & Why

`xs-security.json` and `package.json`'s `cds.requires.[production].auth.kind: xsuaa` already existed
from EPIC02-T8 — this ticket's remaining scope, per the Sprint Overview note above, was verifying
that config is actually *complete and working*, and documenting the BTP service binding procedure
(`docs/dev-notes.md`, not yet written). Rather than treat "the JSON validates and CI is green" as
proof it works — CI has never once exercised the `[production]` auth profile, only the default
`mocked` kind — actually started the app with `NODE_ENV=production` set and read what broke. Two
real, confirmed gaps came out of that, not one:

1. **`branchId` attribute declared but never wired to a role.** `xs-security.json` had a top-level
   `attributes: [{name: 'branchId', ...}]` block (added as a side effect of `cds add postgres` in
   T1 — see that ticket's notes), but neither the `Manager` nor `Operator` role-template referenced
   it via `attribute-references`. In BTP's role-collection-assignment UI, that means there would be
   no field to actually set a Manager's or Operator's `branchId` at all — the entire branch-scoped
   authorization model (`req.user.attr.branchId`, used throughout `OperatorPortalService`) would
   have nothing to read in a real deployment, silently defaulting to `undefined` for every branch
   check.
2. **`@sap/xssec` was never installed.** `@sap/cds`'s `xsuaa` auth strategy `require()`s this
   package lazily, only when a request actually needs XSUAA auth — so `npm install`, `npm test`,
   linting, and every previous `cds-serve` session (always run with `mocked` auth) never surfaced
   its absence. Starting with `NODE_ENV=production` set crashed immediately:
   `Cannot find '@sap/xssec'`. See cap-notes.md #20 for the full story and the general lesson
   (a `[production]`-only code path needs to actually be *run* at least once, not just compiled).

Both are real production-blocking bugs discovered while verifying, not scope creep — fixing them is
what "XSUAA integration" actually means, as opposed to "XSUAA config exists somewhere in the repo."

### Step-by-step instructions

#### 1. Modify `xs-security.json`

Add `"attribute-references": ["branchId"]` to the `Manager` and `Operator` role-templates (sibling
to their existing `scope-references`). `Admin` and `Customer` are unchanged — neither is
branch-scoped.

#### 2. Install the missing runtime dependency

```sh
npm install --save @sap/xssec
```

#### 3. Document the BTP service binding procedure

Added `docs/dev-notes.md` §4 — the three `cf` CLI commands to create the XSUAA service instance from
`xs-security.json`, bind it to the app, and restage; how to update an existing instance after an
`xs-security.json` change (`cf update-service`, not recreate); and where role-collection-to-user
assignment (including setting a Manager's/Operator's `branchId`) actually happens (BTP cockpit, not
`cf`).

### Verify

**Before the fix**, `NODE_ENV=production npx cds-serve` crashed on startup:
```
Error: Cannot find '@sap/xssec'. Make sure to install it with 'npm i @sap/xssec'
```

**After `npm install --save @sap/xssec`**, the same command gets past that and fails with a
*different*, and correct, error — confirming the auth strategy itself is now wired correctly and
the only thing missing is an actual bound BTP service (which this sandbox has no way to provide):
```
Error: Authentication kind "xsuaa" configured, but no XSUAA instance bound to application.
```

**Not verified**: an actual role-collection assignment in a real BTP cockpit, or a real request
carrying a genuine XSUAA-issued JWT with a `branchId` attribute reaching `req.user.attr.branchId` in
a handler. This sandbox has no BTP subaccount to test against — the `attribute-references` fix is
correct per XSUAA's documented config schema, but the end-to-end "does a Manager's branch-scoped
query actually filter correctly against a real JWT" path was previously (EPIC02) and remains only
tested against the mocked auth users, which set `attr.branchId` directly with no JWT involved.

```sh
npm run lint && npm run format:check && npm test
```

All 138 tests pass, 0 lint errors (3 pre-existing unrelated warnings), format clean.

---

## EPIC23-T3: Dockerfile

### What & Why

A multi-stage Dockerfile to containerize the backend for deployment. The natural first design —
`builder` stage runs `cds build`, `runtime` stage copies only `gen/srv/` (small, "official"
CAP-produced artifact) — was tried and empirically rejected before writing the real Dockerfile
around it: `gen/srv/` alone does not start. See cap-notes.md #21 for the full root cause — this
project's service implementations are wired via `@impl:` paths relative to the project root
(`modules/*/application/*.js`, needed because the `api/`+`application/` folder split breaks CAP's
default co-location auto-binding), and `cds build --for nodejs` doesn't relocate those `.js` files
into `gen/srv/`. `cds build` is still run in the builder stage — it's a real, useful validation gate
that fails the image build if the CDS model itself doesn't compile — but the runtime stage ships the
actual source tree instead of trusting `gen/srv/`'s output to be runnable on its own.

Also discovered while inventorying what actually needs to ship: two pre-existing top-level
directories, `infrastructure/` (genuinely required at runtime —
`modules/identity/application/identity-service.js` does
`require('../../../infrastructure/auth')`, confirmed via `grep`, not assumed from the folder name)
and `approuter/` (a separate, standalone BTP App Router component — its own `xs-app.json`, never
`require()`-d by the backend anywhere — correctly **not** included in this Dockerfile, since it's a
different deployable unit, not part of the CAP backend service this ticket containerizes).

### Step-by-step instructions

#### 1. Create `Dockerfile`

Two stages:

- **`builder`** (`node:20-slim`): `npm ci` (full deps, including devDependencies), copy the whole
  project, run `npx cds build --for nodejs` as a model-validation gate.
- **`runtime`** (`node:20-slim`): `npm ci --omit=dev` (production deps only — excludes eslint,
  jest, prettier, the Fiori-tooling devDependencies), `ENV NODE_ENV=production` (activates the
  `[production]` cds profile — `kind: postgres` for db, `kind: xsuaa` for auth, T1/T2), then
  `COPY --from=builder` for `db/`, `srv/`, `modules/`, `app/`, `shared/`, `infrastructure/`, and
  `xs-security.json`. `EXPOSE 4004`, `CMD ["npx", "cds-serve"]` — same entrypoint the project has
  used in every dev/verification session throughout this whole epic.

#### 2. Create `.dockerignore`

Excludes: root `node_modules` (reinstalled fresh in each stage) and every `app/*/node_modules`
(each Fiori app's own `npm install`, used only by standalone `ui5 serve` dev tooling — `cds-serve`
serves `app/*/webapp`'s static files directly, no `ui5 build`/bundling step, so these are never
needed at runtime); `gen/`/`.cds_gen/` (build output, not the runtime source — see above); local
SQLite files and `.env*` (except `.env.example`); `.git`/`.github`/`.vscode`/`.claude`; `docs/`,
`tests/`, `test/` (the latter is a pre-existing empty scaffold directory, `.gitkeep` files only);
logs/coverage/cache directories; the Docker-related files themselves.

### Verify

**No real `docker`/`docker build` available in this sandbox** — flagged explicitly rather than
claiming a full build-and-run was performed. What *was* verified, by manually reproducing each
stage's effect with plain shell commands against a scratch copy of the file tree:

1. Copied exactly the runtime stage's file set (`package.json`, `package-lock.json`, `db/`, `srv/`,
   `modules/`, `app/` minus each `app/*/node_modules`, `shared/`, `infrastructure/`,
   `xs-security.json`) into an isolated directory, ran `npm ci` there, started `cds-serve` from it:
   the index page, a Fiori app (`customer-portal`), the OData `$metadata`, and an authenticated
   `GET /catalog/Vehicles` all returned `200` with correct data — confirms the COPY list is complete
   and nothing needed at runtime was missed.
2. Separately confirmed `NODE_ENV=production` (what the Dockerfile's `ENV` line sets) reaches the
   same "no XSUAA instance bound" failure already verified as the *correct* behavior in EPIC23-T2 —
   consistent with this being a sandbox-without-a-real-BTP-binding limitation, not a Dockerfile bug.
3. `npx cds build --for nodejs` (the builder stage's validation step) succeeds cleanly against the
   current model.

**Not verified**: an actual `docker build` + `docker run` cycle, or the container actually starting
end to end with a real bound XSUAA + PostgreSQL service. The first genuinely-full test of this
Dockerfile should be EPIC23-T4 (`docker-compose`), where a real containerized PostgreSQL at least
closes half that gap.

```sh
npm run lint && npm run format:check && npm test
```

All 138 tests pass, 0 lint errors (3 pre-existing unrelated warnings), format clean — the Dockerfile/
`.dockerignore` themselves aren't covered by these (no docker-specific linter is configured), but
their content was manually inspected for correctness against the actual project structure.

---

## EPIC23-T4: docker-compose (Local Integration)

### What & Why

A `docker compose up` that actually starts a *working* app connected to PostgreSQL — the DoD's own
wording — surfaced a real design tension before any file was written: the app's only two-profile
setup (`default` = SQLite + mocked auth, `[production]` = PostgreSQL + XSUAA, T1/T2) has no profile
that gets PostgreSQL *without* also requiring a real XSUAA binding, which `docker-compose` running
locally can never provide (no BTP subaccount). Using `NODE_ENV=production` in `docker-compose.yml`
would just reproduce EPIC23-T2's "no XSUAA instance bound" crash on every `docker compose up` — not
a "working app."

Resolved with CAP's own multi-profile convention: added a third `[hybrid]` profile
(`package.json`) that overrides only `db.kind: postgres`, leaving `auth` unset so it falls through
to the default `mocked` block (same users as every other dev session, e.g.
`admin.mueller@automarkt.de`/`Test@1234`). Confirmed via `npx cds env get requires.db --profile
hybrid` / `...requires.auth --profile hybrid` that this actually resolves to postgres+mocked
together, not guessed at — `[hybrid]` is a commonly-used CAP convention name for exactly this
"real backing service, still-local auth" scenario, not an invented one-off.

### Step-by-step instructions

#### 1. Modify `package.json`

Add `"[hybrid]": {"db": {"kind": "postgres"}}` to `cds.requires`, sibling to the existing
`[production]` block.

#### 2. Create `docker-compose.yml`

Two services: `db` (`postgres:16`, credentials from `.env` via `${POSTGRES_*}` substitution, a
named volume for persistence across `down`/`up` cycles, a `pg_isready` healthcheck); `app` (builds
from the project's own `Dockerfile`, `depends_on: db` with `condition: service_healthy` — waits for
a real healthy Postgres, not just a started container — `NODE_ENV: hybrid`, and the
`CDS_REQUIRES_DB_CREDENTIALS_*` environment variables CAP maps directly onto
`cds.requires.db.credentials.*`, port `4004` published).

#### 3. Create `.env.example`

Template for the three `POSTGRES_*` variables `docker-compose.yml` requires (`:?` required-variable
syntax — compose refuses to start with a clear error if `.env` is missing/incomplete, rather than
silently defaulting to an empty password). `.env` itself is already `.gitignore`d.

#### 4. Create `Makefile`

`up` (`docker compose up -d --build`), `down` (`docker compose down`), `db-init` (one-time schema
deploy — `cds deploy --model-only` then `cds deploy`, run via `docker compose exec app`, **not**
baked into the container's own startup command: `cds deploy --model-only`'s own documentation frames
it as a one-time step, and blindly re-running schema-evolution logic on every container start
without being able to verify its idempotency against a real Postgres wasn't a risk worth taking —
see "Verify" below), `logs` (tail the app container's output).

### Verify

**Config resolution** — `[hybrid]` profile confirmed to resolve `db.kind: postgres` +
`auth.kind: mocked` together (not assumed from reading the JSON — actually queried via `cds env`).

**`CDS_REQUIRES_DB_CREDENTIALS_*` env vars correctly populate `cds.requires.db.credentials`** —
confirmed via `cds env get requires.db --profile hybrid` with those env vars set, all five fields
(`host`/`port`/`user`/`password`/`database`) present and correct.

**A leftover stale field checked, not assumed harmless** — the base (non-hybrid) `db` config's
`credentials.url: ':memory:'` remains present after merging in the hybrid env-var credentials (CAP
merges profile overrides onto the base config rather than replacing it wholesale). Read `pg`'s own
`connection-parameters.js` source to confirm it only recognizes a key named `connectionString` for
URL-style connection strings — an unrecognized `url` key is silently ignored, `host`/`port`/etc. are
used directly. Confirmed harmless by reading the actual driver code, not assumed.

**`docker-compose.yml` YAML syntax validated** (`npx js-yaml docker-compose.yml`), **`Makefile`
confirmed to use real tab characters** (`cat -A Makefile` — Make requires literal tabs for recipe
lines, a space-indented Makefile fails silently/confusingly).

**Not verified against real `docker compose`** — this sandbox has no `docker` available (same
limitation as T1/T3). The full `docker compose up` → healthy Postgres → app starts → `make db-init`
→ a real request against real persisted data sequence has not been run end to end. Flagged
explicitly, not silently assumed to work — should be the first thing tried once `docker` is
available; it's the first point in this epic where the containerized app, `@cap-js/postgres`, and a
real (if not XSUAA-backed) database all come together.

```sh
npm run lint && npm run format:check && npm test
```

All 138 tests pass, 0 lint errors (3 pre-existing unrelated warnings), format clean.

---

## EPIC23-T5: CI/CD Pipeline Extension

### What & Why

Checked the existing `.github/workflows/ci.yml` before writing anything — its "npm test step after
format check" requirement was **already satisfied**, from an earlier epic (`lint` → `format:check`
→ `test`, in that cheapest-first order). Not re-added; the remaining, actually-open scope was the
Docker build + push to GHCR.

**A real opportunity, not just a checkbox:** this sandbox has had no `docker` available for the
entire epic — T1/T3/T4 all had to be verified by manually reproducing each stage's effect with
plain shell commands instead of an actual `docker build`. GitHub Actions runners *do* have Docker.
Adding the `docker-build-push` job means the very next push to `main` becomes the first genuine,
real `docker build` of this project's `Dockerfile` — closing a verification gap this epic couldn't
close locally, for free, as a side effect of doing T5's own work.

### Step-by-step instructions

#### 1. Modify `.github/workflows/ci.yml`

Add a second job, `docker-build-push`:

- `needs: build-and-test` — only runs if lint/format/tests all pass first.
- `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` — only on an actual merge to
  main, never on a PR push (publishing an image for unreviewed/unmerged code would be a real
  security-relevant mistake, not just wasted CI minutes).
- `permissions: {contents: read, packages: write}` — the minimum GHCR needs; `GITHUB_TOKEN` (the
  auto-provided, per-run token — no extra secret to create or rotate) is sufficient to push to this
  repo's own GHCR namespace once the job explicitly requests write access to packages.
- Lowercases `github.repository` before using it in the image tag — GHCR requires an all-lowercase
  image path, and `github.repository` preserves whatever case the org/repo name actually has. This
  repo happens to already be lowercase (`sdtyn/automarket`), but hardcoding that assumption would
  make the workflow silently break the moment it's copied to (or the org is renamed to) a
  mixed-case name — the lowercase step costs one line and removes that landmine entirely.
- Tags the built image both `:latest` and `:<commit-sha>` — `latest` alone can't be rolled back to a
  specific prior build; the SHA tag is an immutable pointer that always can.

**"Optional: deploy-to-staging step" — deliberately not added.** No staging environment/hosting
target exists anywhere in this project yet (no BTP space, no Kubernetes cluster, no server to
deploy to) — the backlog itself frames this step as optional, and adding a deploy step with nothing
real to deploy to would mean either a fake no-op step (misleading — looks like it does something) or
inventing a hosting target unilaterally (a real infrastructure decision, not something to decide
silently while doing CI/CD cleanup). Flagged here rather than skipped without comment.

### Verify

```sh
npm run lint && npm run format:check && npm test
```

All 138 tests pass, 0 lint errors (3 pre-existing unrelated warnings), format clean. `ci.yml`'s YAML
syntax validated via `npx js-yaml .github/workflows/ci.yml`.

**The first real `docker build` this epic ever ran, on GitHub Actions after this ticket's own
commit reached `main`, failed** — not a hypothetical the docs hedged about, an actual observed
failure: `npm ci did not complete successfully: exit code: 1` in the builder stage. Diagnosed via
the (publicly readable, no admin token needed) check-runs annotations API rather than guessing, root
caused, and fixed in a follow-up commit — see cap-notes.md #22 for the full story: `@cap-js/sqlite`
(devDependency)'s `better-sqlite3` needs a native compile toolchain `node:20-slim` doesn't ship,
which this sandbox's own environment happened to have installed already, masking the gap through
every earlier "verified locally" claim in T1/T3/T4. This is the strongest evidence in the entire
epic that "manually reproduce each Docker stage's effect without real `docker`" is a genuinely
weaker substitute for the real thing, not just epistemically more honest — it missed a real bug.
The fix's own result (does `docker-build-push` succeed after the follow-up commit) is confirmed in
the Sign-off section once that commit's own CI run completes.

```sh
npm run lint && npm run format:check && npm test
```

All 138 tests pass, 0 lint errors (3 pre-existing unrelated warnings), format clean.

---

## EPIC23-T6: Environment Configuration

### What & Why

Before extracting anything, inventoried what's actually hardcoded and shouldn't be —
`grep -rn "process.env" modules/ infrastructure/` gave the complete, authoritative list of every env
var the application code already reads, rather than guessing at what "port, DB url, auth config"
means for this specific project. Two of the three named categories turned out to already be
correctly externalized from earlier tickets: **port** was never hardcoded anywhere (CAP's
`cds-serve` reads the standard `PORT` env var natively, confirmed by having used
`PORT=4005`/`PORT=4099` repeatedly throughout this epic's own verification work); **DB url/auth
config** were handled by EPIC23-T1/T2/T4's `CDS_REQUIRES_DB_CREDENTIALS_*` env vars and CAP's
profile system. What genuinely needed T6's attention was documentation (no single place listed every
env var and which environment actually requires it) and one real gap in enforcement.

**A real, confirmed security gap found while writing the env-var documentation, not left
undocumented:** `GUEST_TOKEN_SECRET` (`modules/reservation/infrastructure/guest-token.js`) had a
hardcoded dev-fallback secret, and its own comment said "must never be used in production" — but
nothing in the code actually enforced that. If the env var were accidentally left unset in a real
deployment, the app would silently sign guest-reservation tokens with a secret visible to anyone who
can read this public repo, letting anyone forge them. `JWT_SECRET`, in the sibling identity module,
has always thrown immediately if missing, in every environment — the two secrets had inconsistent
enforcement for no documented reason. Flagged to the user with the concrete risk before changing any
production-affecting security behavior (per CLAUDE.md §8); user confirmed the fix.

### Step-by-step instructions

#### 1. Modify `modules/reservation/infrastructure/guest-token.js`

`GUEST_TOKEN_SECRET` now throws `GUEST_TOKEN_SECRET env var is not set` when `NODE_ENV=production`
and the env var is missing; the dev-only fallback stays available, unconditionally, for every other
`NODE_ENV` value (no new required env var for local `npm start`/`npm test`).

#### 2. Expand `.env.example`

Grew from EPIC23-T4's Postgres-only template to cover every env var the app reads:
`JWT_SECRET`/`GUEST_TOKEN_SECRET` (application secrets), `AUTH_PROVIDER` (optional,
`infrastructure/auth/index.js`), and the existing `POSTGRES_*` set. Kept the name `.env.example`
rather than adding a second, differently-named `sample.env` the backlog literally asked for — same
purpose, already wired into `.gitignore`, no reason to have two.

#### 3. Document every env var in `docs/dev-notes.md`

Added §6 — a table of every env var, which environment actually requires it, what it defaults to if
unset, and which file reads it. Documents the `GUEST_TOKEN_SECRET` fix's own reasoning inline.

### Verify

**`GUEST_TOKEN_SECRET` enforcement** — a Node one-liner with `NODE_ENV=production` set and the env
var unset confirmed the module now throws `GUEST_TOKEN_SECRET env var is not set` on `require()`;
the same one-liner without `NODE_ENV=production` confirmed the dev fallback still issues a working
token. The existing `tests/unit/domain/guest-token.test.js` (runs without `NODE_ENV=production`, so
exercises the fallback path, same as before this change) still passes unchanged — no test needed
updating, since the fallback behavior itself didn't change, only what happens when it's *not*
available.

**Full inventory cross-checked, not assumed complete** — `grep -rn "process.env" modules/
infrastructure/` was re-run after the fix to confirm the dev-notes.md §6 table lists every env var
the code actually reads, with none missed and none documented that isn't real.

```sh
npm run lint && npm run format:check && npm test
```

All 138 tests pass, 0 lint errors (3 pre-existing unrelated warnings), format clean.

---
