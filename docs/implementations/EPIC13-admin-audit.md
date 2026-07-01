# EPIC13 — Admin & Audit

Sprint 13. Goal: system administration surface and audit trail. AuditLogs provides a 7-year tamper-evident record of entity changes; EventOutbox is the transactional outbox that guarantees at-least-once event delivery. AdminService exposes branch and user lifecycle management — Admin-only actions that are never reachable by any other role.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC13-T1 | Audit Domain — `AuditLogs` + `EventOutbox` entities | Done |
| EPIC13-T2 | Admin Service — `Branches`, `Users`, `Roles`, `AuditLogs` projections + `createBranch`, `updateBranch`, `disableBranch`, `createUser`, `disableUser`, `assignRole` | Done |

### Sprint Backlog DoD mapping

- "AuditLogs / EventOutbox" → EPIC13-T1
- "Admin branch lifecycle" → EPIC13-T2 (`createBranch`, `updateBranch`, `disableBranch`)
- "Admin user lifecycle" → EPIC13-T2 (`createUser`, `disableUser`, `assignRole`)

### Sign-off

All two tickets delivered and CI green. Sprint completed 2026-07-01.

---

## T2 — Admin Service

**What & Why:** All entities are `@requires: 'Admin'` — no role exception exists anywhere in this service. `Users` excludes `passwordHash` from the projection so the field is never sent over the wire even to Admin. `AuditLogs` and `EventOutbox` carry `@readonly` to prevent even Admin from inserting or mutating rows via OData. `createUser` hashes a cryptographically random temp password (bcryptjs, cost 12) — the password is never returned to the caller; in production a reset-email flow replaces it. `assignRole` is idempotent: if the userId+role_ID pair already exists in `UserRoles`, it returns `true` without inserting a duplicate. `disableUser` sets `status = 'INACTIVE'` (permanent admin action), distinct from `LOCKED` (temporary, time-based). The `using` aliases (`aud`, `br`) avoid namespace collision between the three imported modules that all share the `automarket` namespace.

### Create `modules/admin/api/admin-service.cds`

_(full content as written above)_

### Create `modules/admin/application/admin-service.js`

_(full content as written above)_

### Modify `srv/index.cds`

```cds
using from '../modules/admin/api/admin-service';
```

### Modify `package.json`

```json
"AdminService": { "impl": "modules/admin/application/admin-service.js" }
```

---

## T1 — Audit Domain

**What & Why:** `AuditLogs` is append-only — no UPDATE or DELETE is permitted by any service. `oldValue` and `newValue` store JSON snapshots of the changed fields only (not the full entity) to keep rows small and diff-friendly. `EventOutbox` implements the transactional outbox pattern (AD-5): rows are written in the same DB transaction as the triggering business change, so an event is never lost even if the process crashes before emit. The poller (out of scope) reads `published = false` rows and dispatches them at-least-once; consumers must be idempotent.

### Create `modules/audit/db/audit.cds`

_(full content as written above)_

### Modify `db/index.cds`

```cds
using from '../modules/audit/db/audit';
```
