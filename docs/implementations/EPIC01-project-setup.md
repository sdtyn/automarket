# EPIC01 — Foundation & Platform

Sprint 1. Goal: repository setup, CAP project scaffold, CI pipeline, local dev environment, and logging conventions.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC01-T1 | Git repo: branch protection (no delete/force-push), CONTRIBUTING.md with branch + commit conventions | Done |
| EPIC01-T2 | CAP project scaffolded; all 13 module folders with api/application/domain/infrastructure/db/tests | Done |
| EPIC01-T3 | CI pipeline (GitHub Actions): lint + format + test on every push to main | Done |
| EPIC01-T4 | `cds watch` verified locally against SQLite; mocked auth configured for 4 roles | Done (real seeded data + JWT issuance deferred to EPIC-02) |
| EPIC01-T5 | Logging convention documented (`cds.log` levels, never-log-sensitive-data rule) | Done |
| EPIC01-T6 | BTP-specific items (XSUAA, Approuter, HTML5 Repo, network isolation, Cloud ALM, subaccounts) | Deferred — see CONTRIBUTING.md |

### Sprint Backlog DoD mapping

- "Build pipeline working" → satisfied by EPIC01-T3.
- "Local environment working" → satisfied by EPIC01-T4.
- "Deployment to DEV successful" → deferred, no BTP DEV subaccount yet (EPIC01-T6).
- "Approuter routes verified (no direct CAP access)" → deferred (EPIC01-T6).

### Sign-off

Per the Solution Architecture Document's Governance & Sign-Off model: this checklist,
confirmed by the project owner, closes Sprint 1 and opens EPIC-02.

Signed off by: Sedat Yeni  Date: 2026-06-25

---

## T1 — Git Repository & Contribution Policy

**What & Why:** Establish the repository structure and contribution rules before any code is written. `CONTRIBUTING.md` records the branch strategy, commit message convention, and the BTP-deferred items so the team never has to rediscover these decisions.

### Create `CONTRIBUTING.md`

```markdown
# Contributing to AutoMarket

## Branch Strategy

- `main` is the single source of truth; protected against force-push and deletion.
- While the project has a single developer, work is committed directly to `main`.
- Mandatory PR review (>=1 approval) is deferred until a second collaborator joins the
  project — at that point, enable "Require a pull request before merging" on `main`.
- Branch naming convention (for future feature branches, once collaborators exist):
  `epic<NN>-t<N>-short-description`, lowercase, hyphen-separated.
  Example: `epic02-t3-mfa-enforcement`.

## Commit Message Convention

Every commit message is prefixed with the Epic/Ticket it belongs to:

[EPIC<NN>-T<N>] <short description>

Example: `[EPIC01-T1] Add CONTRIBUTING.md with branch and commit policy`

## Deferred: BTP-Specific Work (EPIC01-T6)

The following Sprint 0 stories require real SAP BTP services and are **not implemented**
in this phase — only documented, per the project's "local-only development" decision:

- US-1.7 — XSUAA service binding for DEV/TEST
- US-1.8 — Application Router in front of CAP
- US-1.9 — HTML5 Application Repository
- US-1.10 — Network isolation (no public path to CAP/HANA)
- US-1.12 — Application Logging Service / SAP Cloud ALM
- US-1.13 — BTP subaccount provisioning (DEV/TEST/UAT/PROD)

**Why:** no BTP trial/Cloud Foundry account was available when this project started.
Local development already follows the documented fallback path (Implementation
Architecture Document §20: `Email → Password → JWT → CAP` instead of
`SAP IAS → XSUAA → CAP`), so this is not a workaround — it's the path the
architecture document itself defines for local dev.

**Revisit when:** a BTP trial/CF account becomes available, and in any case before
the first real (non-local) deployment — these six items become a hard blocker at
that point, not before.
```

---

## T2 — CAP Project Scaffold

**What & Why:** Initialize the Node.js/CAP project and create all 13 module folders with a consistent sub-structure (`api/application/domain/infrastructure/db/tests`). Creating the folder structure upfront means every future module has a home from day one — no retrofitting directories mid-epic.

### Create `package.json` (initial version)

```json
{
  "name": "automarket",
  "version": "1.0.0",
  "dependencies": {
    "@sap/cds": "^9"
  },
  "devDependencies": {
    "@cap-js/sqlite": "^2"
  },
  "scripts": {
    "start": "cds-serve"
  },
  "private": true,
  "cds": {
    "requires": {
      "db": {
        "kind": "sqlite",
        "credentials": {
          "url": ":memory:"
        }
      }
    }
  }
}
```

### Install dependencies

```bash
npm install
```

### Create module folder structure

Run this script once to scaffold all 13 modules with their sub-directories:

```bash
for module in identity branch vehicle pricing reservation test-drive offer sales payment delivery notification reporting audit; do
  for sub in api application domain infrastructure db tests; do
    mkdir -p modules/$module/$sub && touch modules/$module/$sub/.gitkeep
  done
done
```

### Create top-level directories

```bash
mkdir -p shared/types shared/constants shared/utils shared/errors shared/validation
touch shared/types/.gitkeep shared/constants/.gitkeep shared/utils/.gitkeep shared/errors/.gitkeep shared/validation/.gitkeep
mkdir -p infrastructure/auth infrastructure/logging
touch infrastructure/auth/.gitkeep infrastructure/logging/.gitkeep
mkdir -p srv db approuter
```

---

## T3 — CI Pipeline, ESLint & Prettier

**What & Why:** GitHub Actions pipeline runs lint + format check + tests on every push and PR. ESLint catches logic errors; Prettier owns formatting. Separating the two (via `eslint-config-prettier`) means they never conflict — ESLint never complains about formatting.

### Update `package.json` — add dev dependencies and scripts

```diff
   "devDependencies": {
     "@cap-js/sqlite": "^2",
+    "@eslint/js": "^9.39.4",
+    "eslint": "^9.39.4",
+    "eslint-config-prettier": "^10.1.8",
+    "globals": "^17.7.0",
+    "jest": "^30.4.2",
+    "prettier": "^3.8.4"
   },
   "scripts": {
     "start": "cds-serve",
+    "lint": "eslint .",
+    "format": "prettier --write .",
+    "format:check": "prettier --check .",
+    "test": "jest --passWithNoTests"
   },
```

### Install new dev dependencies

```bash
npm install
```

### Create `eslint.config.js`

```js
const js = require('@eslint/js');
const globals = require('globals');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // node: gives ESLint knowledge of Node.js globals (require, process, __dirname…)
        // jest: gives ESLint knowledge of test globals (describe, it, expect…)
        // Without these, ESLint would flag every Node/Jest global as "undefined".
        ...globals.node,
        ...globals.jest,
        // CAP injects these as globals at runtime; ESLint must be told they exist.
        SELECT: 'readonly',
        INSERT: 'readonly',
        UPDATE: 'readonly',
        DELETE: 'readonly',
        UPSERT: 'readonly',
      },
    },
    rules: {
      // warn instead of error so unused vars surface in CI output without
      // blocking the build during active development. Tighten to 'error'
      // before the first production release.
      'no-unused-vars': 'warn',
    },
  },
  // prettierConfig must come last: it disables all ESLint formatting rules so
  // Prettier owns formatting and ESLint owns logic — the two never conflict.
  prettierConfig,
  {
    // CAP and build tools generate these directories at runtime. Linting
    // generated code produces false positives and hides real issues.
    ignores: ['node_modules/', 'gen/', 'coverage/', '.cds_gen/'],
  },
];
```

### Create `.prettierrc`

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100
}
```

### Create `.github/workflows/ci.yml`

```yaml
name: CI

# Run on every push to main and on every pull request targeting any branch.
# PRs are blocked from merging if any step fails (enforced via branch protection).
on:
  push:
    branches: [main]
  pull_request:

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          # Cache the npm dependency tree between runs. On a warm cache this
          # saves ~30s — meaningful when the pipeline runs on every PR push.
          cache: 'npm'

      # npm ci uses the lockfile exactly, unlike npm install which may silently
      # upgrade packages. This guarantees reproducible builds across all environments.
      - run: npm ci

      # Steps are ordered cheapest-first so the pipeline fails fast:
      # lint catches syntax/logic issues before running the heavier test suite.
      - run: npm run lint
      - run: npm run format:check
      - run: npm test
```

---

## T4 — Local Dev Environment & Mocked Auth

**What & Why:** Configure CAP to run locally with SQLite in-memory and mocked authentication. Mocked auth lets all four roles (Admin, Manager, Operator, Customer) be tested without a real XSUAA tenant. The `operator` user gets a `branchId` attribute that ABAC checks will read later.

### Update `package.json` — add mocked auth config

```diff
   "cds": {
     "requires": {
+      "auth": {
+        "kind": "mocked",
+        "users": {
+          "admin": {
+            "password": "admin",
+            "roles": ["Admin"]
+          },
+          "manager": {
+            "password": "manager",
+            "roles": ["Manager"]
+          },
+          "operator": {
+            "password": "operator",
+            "roles": ["Operator"],
+            "attr": {
+              "branchId": "00000000-0000-0000-0000-000000000001"
+            }
+          },
+          "customer": {
+            "password": "customer",
+            "roles": ["Customer"]
+          }
+        }
+      },
+      "[production]": {
+        "auth": {
+          "kind": "xsuaa"
+        }
+      },
       "db": {
         "kind": "sqlite",
         "credentials": {
           "url": ":memory:"
         }
       }
     }
   }
```

### Verify local dev works

```bash
npm run start
# or for hot-reload during development:
npx cds watch
```

---

## T5 — Logging Convention

**What & Why:** Document the logging rules before any business code is written so every module follows the same standards from the start. No PII or secrets should ever appear in logs.

### Create `infrastructure/logging/README.md`

```markdown
# Logging Convention

Use `cds.log('<module-name>')` to create a named logger per module.
Log levels map to severity: ERROR > WARN > INFO > DEBUG.

Rules:
- Never log passwords, tokens, or any personally identifiable information (PII).
- Use INFO for normal business flows (login succeeded, vehicle published).
- Use WARN for recoverable issues (lock about to expire, cache miss).
- Use ERROR for unexpected failures that require operator attention.
- Never use console.log in production code — use cds.log instead.
```

---

## T6 — BTP-Specific Items (Deferred)

**What & Why:** XSUAA, Approuter, HTML5 App Repository, network isolation, Cloud ALM, and subaccount provisioning all require a real SAP BTP account. These are documented and deferred. See `CONTRIBUTING.md` for the full list and the rationale.

No files are created in this ticket. The `[production]` auth profile in `package.json` (added in T4) is the only BTP hook in place — it switches auth to XSUAA when deployed.

---

## Final `package.json` state after EPIC01

```json
{
  "name": "automarket",
  "version": "1.0.0",
  "dependencies": {
    "@sap/cds": "^9"
  },
  "devDependencies": {
    "@cap-js/sqlite": "^2",
    "@eslint/js": "^9.39.4",
    "eslint": "^9.39.4",
    "eslint-config-prettier": "^10.1.8",
    "globals": "^17.7.0",
    "jest": "^30.4.2",
    "prettier": "^3.8.4"
  },
  "scripts": {
    "start": "cds-serve",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "jest --passWithNoTests"
  },
  "private": true,
  "cds": {
    "requires": {
      "auth": {
        "kind": "mocked",
        "users": {
          "admin":    { "password": "admin",    "roles": ["Admin"] },
          "manager":  { "password": "manager",  "roles": ["Manager"] },
          "operator": { "password": "operator", "roles": ["Operator"], "attr": { "branchId": "00000000-0000-0000-0000-000000000001" } },
          "customer": { "password": "customer", "roles": ["Customer"] }
        }
      },
      "[production]": { "auth": { "kind": "xsuaa" } },
      "db": { "kind": "sqlite", "credentials": { "url": ":memory:" } }
    }
  }
}
```
