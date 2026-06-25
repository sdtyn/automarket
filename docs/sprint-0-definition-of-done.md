# Sprint 0 — Definition of Done (EPIC-01)

Local-only development scope (see CONTRIBUTING.md, "Deferred: BTP-Specific Work").

| # | Item | Status |
|---|---|---|
| EPIC01-T1 | Git repo: branch protection (no delete/force-push), CONTRIBUTING.md with branch + commit conventions | Done |
| EPIC01-T2 | CAP project scaffolded; all 13 module folders with api/application/domain/infrastructure/db/tests | Done |
| EPIC01-T3 | CI pipeline (GitHub Actions): lint + format + test on every push to main | Done |
| EPIC01-T4 | `cds watch` verified locally against SQLite; mocked auth configured for 4 roles | Done (real seeded data + JWT issuance deferred to EPIC-02) |
| EPIC01-T5 | Logging convention documented (`cds.log` levels, never-log-sensitive-data rule) | Done |
| EPIC01-T6 | BTP-specific items (XSUAA, Approuter, HTML5 Repo, network isolation, Cloud ALM, subaccounts) | Deferred — see CONTRIBUTING.md |

## Original Sprint Backlog DoD vs. this scope

- "Build pipeline working" → satisfied by EPIC01-T3.
- "Local environment working" → satisfied by EPIC01-T4.
- "Deployment to DEV successful" → deferred, no BTP DEV subaccount yet (EPIC01-T6).
- "Approuter routes verified (no direct CAP access)" → deferred (EPIC01-T6).

## Sign-off

Per the Solution Architecture Document's Governance & Sign-Off model: this checklist,
confirmed by the project owner, closes Sprint 0 and opens EPIC-02.

Signed off by: Sedat Yeni  Date: 2026-06-25