# AutoMarket — Post-MVP Development Options

This document lists concrete next development tracks for the AutoMarket backend, which is feature-complete after EPIC01–EPIC14. Each track is independent; they can be started in any order.

---

## 1. Testing

### 1a. Unit Tests

**What:** Jest-based tests for isolated service logic — state machine transitions, business rule validation, calculation logic, idempotency guards.

**Why:** The service layer contains non-trivial logic (VehicleStateMachine, payment idempotency, offer counter logic, branch-scoped access checks) that can fail silently without covering test cases.

**Scope:**

| Target | Test focus |
|---|---|
| `VehicleStateMachine.js` | Every valid and invalid transition |
| `payment-service.js` | Idempotency key deduplication, status guards |
| `offer-service.js` | Counter logic, expiry enforcement |
| `pricing-service.js` | Price-change authorization, history creation |
| `sales-service.js` | PaymentSucceeded / PaymentFailed choreography |
| `identity-service.js` | Lockout threshold, MFA gate, token expiry |

**Effort:** ~2 EPICs (one per module group). Start with the state machine and payment idempotency as highest risk.

**Stack:** Jest (already installed), `cds.test()` helper for in-process CAP server. No real DB needed — in-memory SQLite.

---

### 1b. API / Integration Tests (Postman / HTTP files)

**What:** A full end-to-end test suite covering every OData entity, action, and function across all services. Can be run from Postman, VS Code REST Client (`.http` files), or `curl`.

**Why:** Unit tests verify logic in isolation; integration tests verify that the entire request pipeline (auth middleware → handler → DB → response) works together. This is the closest simulation a developer or tester can do without a real frontend.

**Scope — one test sequence per service:**

| Service | Key scenarios |
|---|---|
| IdentityService | Register, login success, login failure → lockout, MFA flow |
| VehicleService | Create vehicle, publish, update price, archive |
| OperatorPortalService | List vehicles for own branch only (branch-scoped) |
| CustomerPortalService | Browse catalog, filter by brand/fuel, view images |
| ReservationService | Reserve, cancel, expire, re-reserve |
| TestDriveService | Book, complete, cancel |
| OfferService | Submit offer, counter, accept, reject, expire |
| SalesService | Create order, transition to PAID, cancel |
| PaymentService | Initiate, capture (Admin), fail, retry, refund |
| DeliveryService | Schedule, complete, mark delivered |
| FavoritesService | Add, list, remove |
| PricingService | Set price, view history |
| ReportingService | getSalesDashboard, getBranchPerformance, getConversionRates |
| AdminService | createBranch, createUser, assignRole, disableUser |

**Format options:**

- **Postman Collection** — shareable JSON, supports environments (dev / staging), CI via Newman CLI.
- **`.http` files** — VS Code REST Client, committed to repo alongside service files, no extra tooling.

**Recommended structure if using `.http` files:**

```
tests/
  http/
    identity.http
    vehicle.http
    reservation.http
    offer.http
    sales.http
    payment.http
    delivery.http
    reporting.http
    admin.http
  README.md     ← how to run, which user to use per scenario
```

**Effort:** ~1 EPIC. Seed data (EPIC14) is already in place, so tests can run against a cold start without any manual setup.

---

## 2. Frontend / UI

**What:** A browser-based UI for the AutoMarket platform.

**Why:** The OData API is fully functional; adding a UI makes the system testable by non-technical stakeholders and demonstrates the domain model end-to-end.

**Options:**

| Approach | Effort | Notes |
|---|---|---|
| SAP Fiori Elements | Low | CDS `@UI` annotations drive the UI; near-zero custom JS. Works out of the box with `cds watch`. Best for admin/operator views. |
| SAP Build Apps / AppGyver | Low–Medium | No-code frontend connected to OData; quick prototyping. |
| React + OData client | High | Full control over UX; requires a separate frontend project. Best for the customer-facing catalog. |

**Starting point:** Fiori Elements for the Operator Portal and Admin views — these map directly to existing OData entities and require only `@UI.LineItem`, `@UI.FieldGroup`, and `@UI.Facets` annotations on the CDS model.

**Effort:** ~2–3 EPICs for Fiori Elements coverage of all operator/admin screens.

---

## 3. Production Readiness

### 3a. Database

Replace in-memory SQLite with a production-grade database.

| Option | Notes |
|---|---|
| PostgreSQL | Open-source; works with `@cap-js/postgres` adapter; good for on-prem or cloud VM. |
| SAP HANA Cloud | Native target for BTP deployments; column-store for reporting queries. |

**Migration path:** No code changes needed — CAP abstracts DB differences. Change `cds.requires.db.kind` in `package.json` and update credentials.

### 3b. Authentication

Replace mock auth with a real identity provider.

| Option | Notes |
|---|---|
| SAP XSUAA (BTP) | Production standard for SAP ecosystem; JWT-based, role collections map to CAP roles. |
| Keycloak | Open-source OIDC; self-hosted alternative. |
| Azure AD / Entra ID | If the org already uses Microsoft 365. |

**Migration path:** Set `cds.requires.auth.kind = "xsuaa"` in `package.json [production]` section (already scaffolded). Add `xs-security.json` for XSUAA scope definitions.

### 3c. Containerization

```dockerfile
# Minimal Dockerfile — CAP Node.js app
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 4004
CMD ["npm", "start"]
```

Add a `docker-compose.yml` with the app container + PostgreSQL for local integration testing.

### 3d. CI/CD Pipeline

GitHub Actions already runs lint + format check. Extend with:
- `npm test` (Jest) after format check
- Docker build + push to container registry on merge to main
- Automated deployment to staging environment

---

## 4. New Features

| Feature | Scope | Depends on |
|---|---|---|
| **Price-drop alerts** | Trigger `VehiclePriceDropped` event → NotificationService sends EMAIL; infrastructure already wired, handler is a stub | EPIC11 (done) |
| **Similar vehicle alerts** | When a new vehicle matching a saved search is published → notify favorited users | EPIC11 (done) |
| **VIN decoder** | On vehicle creation, auto-populate brand/model/year from VIN via a VIN decode API | VehicleService |
| **Financing calculator** | Given vehicle price + down payment + term → monthly installment; pure function, no DB | PricingService |
| **Vehicle comparison** | Customer selects 2–4 vehicles, gets a side-by-side attribute diff | CustomerPortalService |
| **Advanced search** | Full-text search across brand/model/color + range filters on price/mileage/year | CustomerPortalService |
| **Audit log viewer** | Admin UI page showing AuditLogs with filters by entityType / userId / date range | AdminService + EPIC13 (done) |
| **EventOutbox publisher** | Background job that publishes unpublished EventOutbox rows to a message broker (e.g. SAP Event Mesh) | EPIC13 (done) |

---

## Recommended Starting Order

1. **1b — API integration tests** — low effort, high ROI, makes all future changes safer.
2. **1a — Unit tests** — VehicleStateMachine and PaymentService first.
3. **4 — Price-drop alerts** — only a few lines; infrastructure is ready.
4. **2 — Fiori Elements UI** — makes the system demonstrable.
5. **3 — Production readiness** — when the project moves beyond development.
