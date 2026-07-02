# EPIC16 — Unit Tests

**Goal:** Cover the highest-risk business logic with Jest unit tests and `cds.test()` integration tests,
so regressions are caught automatically before they reach integration testing or production.

---

## Sprint Overview

### Ticket Table

| Ticket | Description | Status |
|--------|-------------|--------|
| EPIC16-T1 | Test infrastructure — Jest config + folder structure | Done |
| EPIC16-T2 | VehicleStateMachine unit tests | Done |
| EPIC16-T3 | Identity domain unit tests | Done |
| EPIC16-T4 | IdentityService integration tests | Done |
| EPIC16-T5 | PaymentService integration tests | Open |
| EPIC16-T6 | PricingService integration tests | Open |

### Sprint Backlog DoD Mapping

| DoD Item | Satisfied by |
|----------|-------------|
| All tests pass (`npm test`) | Every ticket |
| CI pipeline stays green | Verified after each commit |
| No test file contains Turkish comments | Pre-commit check (CLAUDE.md §5) |
| Each test file covers both happy path and error/guard cases | Per ticket |

### Sign-off

_To be filled in at sprint end._

---

## EPIC16-T1: Test infrastructure — Jest config + folder structure

### What & Why

Jest is already installed (`devDependencies`) and `npm test` runs with `--passWithNoTests`, but
there is no `jest.config.js` and no `tests/unit/` folder. Without explicit config, Jest will
pick up any `*.test.js` file anywhere in the project — including inside `node_modules` — and the
`transform` / `testEnvironment` defaults may conflict with CAP's CommonJS modules.

This ticket creates the Jest config and folder structure so subsequent tickets can add test files
without worrying about runner configuration.

### Step-by-step

#### 1. Create `jest.config.js` in the project root

Create file `jest.config.js`:

```js
'use strict';

module.exports = {
  // Only look for tests under tests/unit/ — keeps http files and seed scripts out of the runner.
  testMatch: ['**/tests/unit/**/*.test.js'],
  testEnvironment: 'node',
  // CAP uses CommonJS; no transform needed.
  transform: {},
  // One suite at a time avoids port conflicts when multiple cds.test() servers start concurrently.
  maxWorkers: 1,
  // Print each test name so CI logs are readable without --verbose flag.
  verbose: true,
};
```

#### 2. Create `tests/unit/` folder with a `.gitkeep`

```
tests/
  unit/
    domain/       ← pure function tests (state machine, lockout, mfa, jwt)
    services/     ← cds.test() integration tests
```

Run:
```sh
mkdir -p tests/unit/domain tests/unit/services
touch tests/unit/domain/.gitkeep tests/unit/services/.gitkeep
```

#### 3. Verify

```sh
npm test
```

Expected output: `Test Suites: 0 skipped`, exit code 0.

---
