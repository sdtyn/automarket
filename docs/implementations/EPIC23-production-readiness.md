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
| EPIC23-T3 | Dockerfile | Open |
| EPIC23-T4 | docker-compose (local integration) | Open |
| EPIC23-T5 | CI/CD pipeline extension | Open |
| EPIC23-T6 | Environment configuration | Open |

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
| GitHub Actions pipeline runs tests + builds Docker image on every PR | EPIC23-T5 |
| `docs/dev-notes.md` has complete setup instructions for a new developer | EPIC23-T1, T2, T4, T6 |

### Sign-off

_To be filled in at sprint end (T2–T6 still open)._

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
