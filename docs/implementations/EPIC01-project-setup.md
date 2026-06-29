# EPIC01 — Project Setup & Definition of Done

Sprint 0. Goal: establish the project infrastructure before writing any domain code — CI, linting, folder structure, configuration.

---

## T1 — Git Repository Setup

**What:** GitHub repo created, branch protection rules configured (force-push and deletion blocked), contribution guidelines documented.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `CONTRIBUTING.md` | Created | Branch naming, commit format `[EPIC-T]`, PR rules |

---

## T2 — CAP Project Scaffold

**What:** Project skeleton created with `@sap/cds`. Each of the 13 domain modules got `api/application/domain/infrastructure/db/tests` sub-folders.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `package.json` | Created | `@sap/cds`, `@cap-js/sqlite` dependencies, `cds-serve` start script |
| `readme.md` | Created | Project overview |
| `modules/*/api/.gitkeep` etc. | Created | 13 modules × 6 folders = 78 `.gitkeep` placeholder files |
| `app/*/`, `shared/*/`, `test/*/`, `infrastructure/*/` | Created | Skeleton folders for other application layers |

---

## T3 — CI Pipeline (ESLint + Prettier + GitHub Actions)

**What:** ESLint and Prettier configured; GitHub Actions CI pipeline added. Every push to `main` runs lint + format check + tests.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `eslint.config.js` | Created | `@eslint/js` flat config; CAP runtime globals (`SELECT`, `INSERT`, etc.) declared |
| `.prettierrc` | Created | `singleQuote: true`, `printWidth: 100`, `tabWidth: 2` |
| `.prettierignore` | Created | Excludes `node_modules`, `package-lock.json` |
| `.github/workflows/ci.yml` | Created | Node 22, `npm ci`, `lint`, `format:check`, `test` steps |
| `package.json` | Modified | `lint`, `format`, `format:check`, `test` scripts; dev dependencies added |

---

## T4 — CAP Mocked Auth Configuration

**What:** CAP mocked auth added to `package.json`. Four roles defined: `Admin`, `Manager`, `Operator`, `Customer`. Local `cds watch` verified against an empty model.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `package.json` | Modified | `cds.requires.auth` block: `kind: mocked`, 4 users with role assignments; `[production]` profile with `xsuaa` placeholder |

---

## T5 — Logging Convention

**What:** Project-wide logging standards documented. `cds.log` severity levels (`debug/info/warn/error`) and the never-log-sensitive-data rule (passwords, tokens) defined.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `infrastructure/logging/README.md` | Created | `cds.log` usage guide, never-log-sensitive-data rule |

---

## T6 — Deferred BTP Items

**What:** BTP-specific work (XSUAA, Approuter, HTML5 Repository, Cloud ALM, subaccounts) documented as deferred with explicit re-entry triggers.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `CONTRIBUTING.md` | Modified | "Deferred: BTP-Specific Work" section added |

---

## T7 — Sprint-0 DoD Checklist & Comments

**What:** Sprint-0 definition-of-done document created and signed off. Explanatory comments added to ESLint config and CI pipeline.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `docs/sprint-0-definition-of-done.md` | Created | 6-item DoD table, sign-off |
| `eslint.config.js` | Modified | Comments explaining why CAP globals are declared |
| `.github/workflows/ci.yml` | Modified | Comments explaining the purpose of each CI step |
