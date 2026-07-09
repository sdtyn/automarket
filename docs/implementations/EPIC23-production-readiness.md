# EPIC23 — Production Readiness

**Goal:** Make the application deployable to a real environment: persistent database, real
authentication, containerization, and an extended CI/CD pipeline.

---

## Sprint Overview

### Ticket Table

| Ticket | Description | Status |
|--------|-------------|--------|
| EPIC23-T1 | PostgreSQL adapter | Done |
| EPIC23-T2 | XSUAA integration | Open |
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
