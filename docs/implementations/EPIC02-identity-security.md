# EPIC02 — Identity & Security

Sprint 1. Goal: user authentication, authorisation, account security, and admin management APIs.

---

## T1 — Identity Domain Model

**What:** `Users`, `Roles`, `UserRoles` entities defined. Password hash field (`passwordHash`), account lockout fields (`failedLoginCount`, `lockedUntil`), and `UserStatus` enum created. Shared types `BaseEntity`, `Email`, `PhoneNumber` extracted to `common.cds`.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/identity/db/identity.cds` | Created | `Users`, `Roles`, `UserRoles` entities; `UserStatus` enum |
| `shared/types/common.cds` | Created | `BaseEntity` (cuid + managed), `Email`, `PhoneNumber` shared types |
| `db/index.cds` | Created | Central CDS entity discovery entry point |
| `docs/epic-02-identity-security.md` | Created | EPIC-02 ticket tracking table |

---

## T2 — Local Authentication

**What:** Email/password login handler written. Bcrypt password hashing (`password.js`), JWT issuance (`jwt.js`), and CDS service definition (`identity-service.cds`) created. `docs/cap-notes.md` started.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/identity/api/identity-service.cds` | Created | `IdentityService` definition; `login` action |
| `modules/identity/application/identity-service.js` | Created | `login` handler: email lookup, Bcrypt verify, JWT issue |
| `modules/identity/infrastructure/jwt.js` | Created | `generateToken(user, role)` — HS256 JWT, 8-hour TTL |
| `modules/identity/infrastructure/password.js` | Created | `hashPassword(plain)` and `verifyPassword(plain, hash)` — Bcrypt wrappers |
| `srv/index.cds` | Created | Central CAP service discovery entry point |
| `docs/cap-notes.md` | Created | Knowledge base for CAP quirks and workarounds |

---

## T3 — Authentication Provider Abstraction

**What:** `local`, `xsuaa`, and `guest` providers unified behind a single interface. Business logic reads only `req.user`; switching auth mechanisms requires no handler changes.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/identity/infrastructure/auth/index.js` | Created | Provider selector — returns the correct provider based on `NODE_ENV` |
| `modules/identity/infrastructure/auth/local-provider.js` | Created | Local provider: validates credentials against the DB |
| `modules/identity/infrastructure/auth/xsuaa-provider.js` | Created | XSUAA token validation stub |
| `modules/identity/infrastructure/auth/guest-token-provider.js` | Created | Anonymous guest token generator stub |
| `modules/identity/application/identity-service.js` | Modified | Login handler updated to use the provider abstraction |

---

## T4 — Account & Profile Self-Service

**What:** Handlers for viewing and updating own profile (`getProfile`, `updateProfile`) and changing own password (`changePassword`) added.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/identity/api/identity-service.cds` | Modified | `getProfile`, `updateProfile`, `changePassword` actions added |
| `modules/identity/application/identity-service.js` | Modified | 3 new handlers: profile read, update, password change |

---

## T5 — Account Lockout

**What:** 5 failed attempts within 15 minutes triggers a 30-minute time-based lock. `lockout.js` domain policy module created; lock checks integrated into the `login` handler.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/identity/domain/lockout.js` | Created | `isLocked`, `shouldLock`, `recordFailure`, `resetFailures` — domain policy functions |
| `modules/identity/application/identity-service.js` | Modified | Login handler: lock check and failure counter update added |

---

## T6 — MFA Enforcement

**What:** `mfa.js` domain policy module created. MFA mandatory for `Operator/Manager/Admin`, optional for `Customer`. `mfaPending` flag added to login flow; `mfaVerify` action defined.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/identity/domain/mfa.js` | Created | `requiresMfa(role)` — role-based MFA requirement rule |
| `modules/identity/api/identity-service.cds` | Modified | `mfaVerify` action added |
| `modules/identity/application/identity-service.js` | Modified | MFA flag in login; `mfaVerify` handler added |

---

## T7 — Session Timeout & Rate Limiting

**What:** Approuter configuration created. Role-based session timeouts (Admin: 15 min, Manager/Operator: 30 min) and rate-limit policies defined in `xs-app.json`. Auth providers moved to global `infrastructure/auth/`.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `approuter/xs-app.json` | Created | Route definitions, session timeout configuration |
| `approuter/rate-limiting.md` | Created | Rate-limit policy documentation |
| `infrastructure/auth/` | Modified | Auth providers relocated from `modules/identity/infrastructure/auth/` |
| `modules/identity/application/identity-service.js` | Modified | Import path updated to new provider location |

---

## T8 — XSUAA Role Collections

**What:** `xs-security.json` created. `AutoMarket_Admin/Manager/Operator/Customer` role collections with CAP-mapped scopes defined. `[production]` profile added to `package.json`.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `xs-security.json` | Created | 4 role collections, scope definitions, XSUAA application security descriptor |
| `package.json` | Modified | `[production]` profile: `auth.kind = xsuaa` |
| `docs/cap-notes.md` | Modified | XSUAA configuration notes added |

---

## T9 — Admin Portal

**What:** Admin user management actions added: `listUsers`, `createUser`, `assignRole`, `disableUser`. All actions restricted with `@requires: 'Admin'`.

**Files created / modified:**
| File | Action | Description |
|---|---|---|
| `modules/identity/api/identity-service.cds` | Modified | `listUsers`, `createUser`, `assignRole`, `disableUser` action definitions |
| `modules/identity/application/identity-service.js` | Modified | 4 new Admin handlers: list users, create user, assign role, disable user |
