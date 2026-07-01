# EPIC15 — API Integration Tests

Sprint 15. Goal: a runnable, version-controlled HTTP test suite covering every OData endpoint, action, and function across all services. Tests run against a cold `cds watch` start with EPIC14 seed data — no manual setup required.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC15-T1 | Test infrastructure — `tests/http/` directory, `.vscode/settings.json` REST Client env, README | Done |
| EPIC15-T2 | Identity & Auth tests | Done |
| EPIC15-T3 | Vehicle & Branch tests | Done |
| EPIC15-T4 | Customer Portal tests | Done |
| EPIC15-T5 | Reservation & TestDrive tests | Done |
| EPIC15-T6 | Offer & Sales tests | In Progress |
| EPIC15-T7 | Payment tests | Open |
| EPIC15-T8 | Delivery & Favorites tests | Open |
| EPIC15-T9 | Pricing & Reporting tests | Open |
| EPIC15-T10 | Admin tests | Open |

### Sprint Backlog DoD mapping

- All `.http` files run green against a fresh `cds watch` with EPIC14 seed data
- `tests/http/README.md` documents exact startup sequence
- Every service has at least one happy-path and one error-path request

### Sign-off

_To be completed at sprint end._
