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
| EPIC24-T1 | Complete the Approuter | Open |
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
