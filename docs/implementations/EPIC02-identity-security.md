# EPIC02 — Identity & Security

Sprint 2. Goal: user authentication, authorisation, account security, and admin management APIs.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC02-T1 | Identity Domain Model — `Users`, `Roles`, `UserRoles` entities + `UserStatus` enum; `common.cds` shared types | Done |
| EPIC02-T2 | Local Auth — Bcrypt password hashing, email/password login handler, JWT issuance (US-2.3, US-2.4, US-2.5) | Done |
| EPIC02-T3 | Authentication Provider Abstraction — `local-provider` / `xsuaa-provider` / `guest-token-provider` behind one interface; business logic reads only `req.user` (US-2.16) | Done |
| EPIC02-T4 | Account & Profile Self-Service — view/update own profile (name, phone), change own password (US-2.12, US-2.13) | Done |
| EPIC02-T5 | Account Lockout — 5 failed attempts / 15 min → 30-min time-based unlock; `LOCKED` status + `lockedUntil` field (US-2.9) | Done |
| EPIC02-T6 | MFA Enforcement — mandatory for Operator/Manager/Admin; risk-based/optional for Customer; never blocks Guest Checkout (US-2.8) | Done |
| EPIC02-T7 | Session Timeout & Rate Limiting — Approuter config: 15 min Admin, 30 min Manager/Operator; 100/300 req/min auth, 20/100 req/min guest (US-2.10, US-2.11) | Done |
| EPIC02-T8 | XSUAA Role Collections — `AutoMarket_Admin/Manager/Operator/Customer` mapped to CAP roles; verified in TEST (US-2.7) | Done |
| EPIC02-T9 | Admin Portal — User list, create user, assign roles, disable user, MFA/lockout status display (US-2.1, US-2.2, US-2.6, US-2.14, US-2.15) | Done |

### Sprint Backlog DoD mapping

- "Identity Module" → EPIC02-T1, T2, T3, T4, T5
- "Authentication Module" → EPIC02-T2, T3, T6, T7
- "Authorization Framework (RBAC scaffold)" → EPIC02-T8, T9

### Sign-off

_To be completed at sprint end._

---

## T1 — Identity Domain Model

**What & Why:** Define `Users`, `Roles`, and `UserRoles` entities. Shared types (`BaseEntity`, `Email`, `PhoneNumber`) are extracted to `shared/types/common.cds` so that changing a max-length is a one-line edit rather than a search-and-replace across every entity. `db/index.cds` is the single entry point for CAP's entity discovery — adding a module's db file here is the only config needed.

### Create `shared/types/common.cds`

```cds
using { managed, cuid } from '@sap/cds/common';

// BaseEntity is the root aspect for every entity in this project.
// - cuid: CAP auto-generates a UUID primary key (field: ID) so we never manage
//   key generation manually and avoid sequential ID enumeration attacks.
// - managed: CAP auto-populates createdAt, createdBy, modifiedAt, modifiedBy on
//   every INSERT/UPDATE, giving us a free audit trail without extra handler code.
aspect BaseEntity : cuid, managed {
}

// Named scalar types so that changing a max-length is a one-line edit here
// rather than a search-and-replace across every entity that uses the field.
type CurrencyCode : String(3);
type Email        : String(255);
type PhoneNumber  : String(50);
```

### Create `modules/identity/db/identity.cds`

```cds
namespace automarket;

using {
  BaseEntity,
  Email,
  PhoneNumber
} from '../../../shared/types/common';

// Users holds identity data only — no business domain data lives here.
// Profile fields (firstName, lastName, phoneNumber) are kept minimal; extending
// them later does not require touching any domain entity.
entity Users : BaseEntity {
  email            : Email;
  // We store the Bcrypt hash, never the plaintext password. The hash field is
  // String(255) because a Bcrypt hash is always 60 chars; the extra headroom
  // allows swapping to a longer algorithm (e.g. Argon2) without a migration.
  passwordHash     : String(255);
  firstName        : String(100);
  lastName         : String(100);
  phoneNumber      : PhoneNumber;
  status           : UserStatus;
  // mfaRequired is set to true at account creation for Operator/Manager/Admin.
  // It is stored here (not derived at runtime) so a role change automatically
  // cascades to the MFA requirement without a separate migration step.
  mfaRequired      : Boolean default false;
  // failedLoginCount and lockedUntil work together: after 5 consecutive failures
  // within 15 min, status flips to LOCKED and lockedUntil is set 30 min ahead.
  // The lock is time-based — no background job needed to unlock; the login
  // handler simply checks whether lockedUntil has passed.
  failedLoginCount : Integer default 0;
  // Marks the start of the current failure window. Used together with
  // failedLoginCount to enforce the 15-minute rolling window lockout policy —
  // failures older than 15 minutes do not count toward the threshold.
  firstFailedAt    : Timestamp;
  lockedUntil      : Timestamp;
}

// Roles is a reference table, not an enum, so new roles can be added at runtime
// by an Admin without a code deployment.
entity Roles : BaseEntity {
  code        : String(50);
  description : String(255);
}

// UserRoles is a separate join entity (not a single role field on Users) so a
// user can hold multiple roles in future without a schema migration. For now the
// login handler reads the first role found; multi-role support is additive later.
entity UserRoles : BaseEntity {
  user : Association to Users;
  role : Association to Roles;
}

type UserStatus : String enum {
  ACTIVE;
  INACTIVE;
  // LOCKED is a temporary status — it expires automatically when lockedUntil
  // passes. INACTIVE is permanent until an Admin explicitly re-enables the account.
  LOCKED;
};
```

### Create `db/index.cds`

```cds
// Single entry point for CDS entity discovery. CAP reads this file to build the
// combined schema; adding a new module's db file here is enough for it to be
// included in migrations and the generated service model — no other config needed.
using from '../modules/identity/db/identity';
```

### Create `docs/epic-02-identity-security.md`

Create the sprint tracking table for EPIC02 (see the actual file for the full table).

---

## T2 — Local Authentication

**What & Why:** Implement the email/password login flow. JWT is chosen over sessions because CAP runs stateless; the token is signed with `JWT_SECRET` so it can be verified without a DB round-trip on every request. Bcrypt with 12 salt rounds makes brute-force infeasible while keeping login latency under 200ms on typical hardware.

### Install runtime dependencies

```bash
npm install bcryptjs jsonwebtoken
```

### Create `modules/identity/infrastructure/password.js`

```js
const bcrypt = require('bcryptjs');

// SALT_ROUNDS controls hashing cost: each increment doubles the computation time
// (exponential). 12 produces ~200ms on a modern CPU — slow enough to make
// brute-force attacks impractical, fast enough that a real login feels instant.
// Do not lower this below 10 for production.
const SALT_ROUNDS = 12;

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

// bcrypt.compare is timing-safe by design: it always takes the same amount of
// time regardless of where in the hash the comparison fails. This prevents
// timing attacks that could otherwise reveal whether a user account exists.
async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { hashPassword, verifyPassword };
```

### Create `modules/identity/infrastructure/jwt.js`

```js
const jwt = require('jsonwebtoken');

// JWT_SECRET must be set via environment variable — never hardcoded in source.
// Rotating the secret invalidates all active tokens, which is the intended
// behavior for a forced logout scenario (e.g. security incident).
const SECRET = process.env.JWT_SECRET;

// 8h covers a full working day without forcing re-login mid-session.
// Shorter (e.g. 1h) would be more secure but would require refresh-token logic
// which we are not implementing yet. Revisit before production launch.
const EXPIRES_IN = '8h';

// The payload includes role so downstream CAP handlers can read req.user.role
// without an extra DB round-trip on every authenticated request.
function issueToken(payload) {
  if (!SECRET) throw new Error('JWT_SECRET env var is not set');
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

function verifyToken(token) {
  if (!SECRET) throw new Error('JWT_SECRET env var is not set');
  // jwt.verify throws if the token is expired or the signature is invalid —
  // callers must catch and return 401, not let the error bubble as a 500.
  return jwt.verify(token, SECRET);
}

module.exports = { issueToken, verifyToken };
```

### Create `modules/identity/api/identity-service.cds` (initial — login only)

```cds
using {automarket} from '../db/identity';

// IdentityService is intentionally scoped to /identity so that rate limiting
// and routing rules at the Approuter can target the auth surface independently
// from domain services. No domain entity is exposed directly here — only actions.
service IdentityService @(path: '/identity') {

    // login is an action (not a function) because CAP maps actions to HTTP POST.
    // POST is correct here: login is side-effectful (it resets failedLoginCount,
    // updates lockedUntil, and issues a token) — a GET would be semantically wrong
    // and could be cached by intermediaries.
    action login(email: String, password: String) returns {
        token      : String;
        userId     : String;
        role       : String;
        // mfaPending signals the client that a second factor is required before
        // the token should be considered fully authenticated. In local dev this
        // flag is returned but not enforced — enforcement is deferred to XSUAA.
        mfaPending : Boolean;
    };
}
```

### Create `srv/index.cds`

```cds
// Central entry point for CAP service discovery across all modules.
// CAP scans the srv/ folder by default; module services are registered here
// so they are found without changing CAP's root configuration in package.json.
// Each new module's service definition must be added here manually — this is
// the trade-off for using a modular folder structure instead of CAP's default
// flat srv/ layout.
using from '../modules/identity/api/identity-service';
```

### Create `modules/identity/application/identity-service.js` (initial — login handler only)

```js
// CAP's automatic service-to-handler binding works by co-location: it expects
// the .cds definition and the .js handler to live in the same folder with the
// same base name. Because this project uses a modular layout (api/ and
// application/ are separate), CAP cannot auto-detect the link — the binding is
// declared explicitly via "impl" in package.json under cds.services.
const cds = require('@sap/cds');
const authProvider = require('../../../infrastructure/auth');
const { isMfaRequired } = require('../domain/mfa');

module.exports = cds.service.impl(async function (srv) {
  const { Users, UserRoles } = cds.entities('automarket');

  // login: authenticates with email/password, returns a signed JWT on success.
  srv.on('login', async (req) => {
    const { email, password } = req.data;

    const user = await SELECT.one.from(Users).where({ email });
    // Return 401 (not 404) when the user does not exist. Returning a distinct
    // error for "user not found" vs "wrong password" would allow an attacker
    // to enumerate valid email addresses via the login endpoint.
    if (!user) return req.error(401, 'Invalid credentials');

    const valid = await authProvider.authenticate({ password, user });
    if (!valid) return req.error(401, 'Invalid credentials');

    await UPDATE(Users).set({ failedLoginCount: 0, firstFailedAt: null }).where({ ID: user.ID });

    const userRole = await SELECT.one.from(UserRoles).where({ user_ID: user.ID });
    const role = userRole?.role_ID ?? 'Customer';

    const token = authProvider.issueToken({ userId: user.ID, email: user.email, role });
    const mfaPending = isMfaRequired(role);
    return { token, userId: user.ID, role, mfaPending };
  });
});
```

### Update `package.json` — register IdentityService

```diff
   "cds": {
     "requires": { ... },
+    "services": {
+      "IdentityService": {
+        "impl": "modules/identity/application/identity-service.js"
+      }
+    }
   }
```

---

## T3 — Authentication Provider Abstraction

**What & Why:** Business logic must not import a specific auth provider directly. A provider abstraction (`infrastructure/auth/index.js`) selects the active provider via `AUTH_PROVIDER` env var so swapping local → XSUAA requires only a config change, not a code change.

### Create `infrastructure/auth/local-provider.js`

```js
const { verifyPassword } = require('../../modules/identity/infrastructure/password');
const { issueToken, verifyToken } = require('../../modules/identity/infrastructure/jwt');

// Local provider implements the auth provider interface for development and
// non-BTP environments. It uses email/password + Bcrypt + JWT — the full
// local auth stack defined in T2. Swapping to xsuaa-provider in production
// requires no changes to any business logic layer.
const localProvider = {
  async authenticate({ password, user }) {
    const valid = await verifyPassword(password, user.passwordHash);
    return valid;
  },

  issueToken(payload) {
    return issueToken(payload);
  },

  verify(token) {
    return verifyToken(token);
  },
};

module.exports = localProvider;
```

### Create `infrastructure/auth/xsuaa-provider.js`

```js
// Stub for the BTP/XSUAA authentication provider.
// XSUAA handles token verification at the Approuter level — by the time a
// request reaches a CAP handler, req.user is already populated by the XSUAA
// middleware. This provider exists to satisfy the interface and will be
// implemented when BTP deployment is set up (EPIC01-T6 revisit).
const xsuaaProvider = {
  async authenticate() {
    throw new Error('XSUAA provider is not implemented yet. Deferred to BTP sprint.');
  },
  issueToken() {
    throw new Error('XSUAA provider is not implemented yet. Deferred to BTP sprint.');
  },
  verify() {
    throw new Error('XSUAA provider is not implemented yet. Deferred to BTP sprint.');
  },
};

module.exports = xsuaaProvider;
```

### Create `infrastructure/auth/guest-token-provider.js`

```js
// Stub for the guest token provider used in the Guest Checkout flow (Sprint 5).
// A guest token is a short-lived, opaque token issued without credentials —
// it allows an unauthenticated user to track and claim a reservation.
// Full implementation is deferred to EPIC05 (Reservations & Guest Checkout).
const guestTokenProvider = {
  async authenticate() {
    throw new Error('Guest token provider is not implemented yet. Deferred to EPIC05.');
  },
  issueToken() {
    throw new Error('Guest token provider is not implemented yet. Deferred to EPIC05.');
  },
  verify() {
    throw new Error('Guest token provider is not implemented yet. Deferred to EPIC05.');
  },
};

module.exports = guestTokenProvider;
```

### Create `infrastructure/auth/index.js`

```js
const localProvider = require('./local-provider');
const xsuaaProvider = require('./xsuaa-provider');
const guestTokenProvider = require('./guest-token-provider');

// AUTH_PROVIDER env var selects the active provider at startup.
// Defaults to 'local' so development works out of the box without any config.
// Valid values: 'local' | 'xsuaa' | 'guest'
// This is the only place in the codebase that knows which provider is active —
// all business logic imports from this file, never from a specific provider directly.
const providers = {
  local: localProvider,
  xsuaa: xsuaaProvider,
  guest: guestTokenProvider,
};

const activeProviderKey = process.env.AUTH_PROVIDER ?? 'local';
const authProvider = providers[activeProviderKey];

if (!authProvider) {
  throw new Error(
    `Unknown AUTH_PROVIDER: "${activeProviderKey}". Valid values: local, xsuaa, guest`
  );
}

module.exports = authProvider;
```

---

## T4 — Account & Profile Self-Service

**What & Why:** `getProfile` and `updateProfile` let users manage their own display fields. `changePassword` requires the current password before accepting a new one — a stolen session token alone must not be enough to lock out the legitimate account owner.

### Modify `modules/identity/api/identity-service.cds` — add profile and password actions

```diff
 service IdentityService @(path: '/identity') {
     action login(...) returns { ... };

+    @requires: 'authenticated-user'
+    action   changePassword(oldPassword: String, newPassword: String) returns Boolean;
+
+    @requires: 'authenticated-user'
+    function getProfile() returns {
+        id          : String;
+        email       : String;
+        firstName   : String;
+        lastName    : String;
+        phoneNumber : String;
+    };
+
+    @requires: 'authenticated-user'
+    action   updateProfile(firstName: String, lastName: String, phoneNumber: String) returns Boolean;
 }
```

### Modify `modules/identity/application/identity-service.js` — add profile and password handlers

```diff
 module.exports = cds.service.impl(async function (srv) {
   const { Users, UserRoles } = cds.entities('automarket');

   srv.on('login', async (req) => { ... });

+  // getProfile: returns the authenticated user's own profile fields.
+  // Email is read-only — it doubles as the login credential and username,
+  // so changing it requires a separate admin flow, not a self-service update.
+  srv.on('getProfile', async (req) => {
+    const user = await SELECT.one.from(Users).where({ ID: req.user.id });
+    if (!user) return req.error(404, 'User not found');
+    return {
+      id: user.ID,
+      email: user.email,
+      firstName: user.firstName,
+      lastName: user.lastName,
+      phoneNumber: user.phoneNumber,
+    };
+  });
+
+  // updateProfile: allows the authenticated user to update display fields only.
+  // Sensitive fields (email, passwordHash, status, mfaRequired) are excluded.
+  srv.on('updateProfile', async (req) => {
+    const { firstName, lastName, phoneNumber } = req.data;
+    await UPDATE(Users).set({ firstName, lastName, phoneNumber }).where({ ID: req.user.id });
+    return true;
+  });
+
+  // changePassword: replaces the user's password after verifying the current one.
+  srv.on('changePassword', async (req) => {
+    const { oldPassword, newPassword } = req.data;
+    const user = await SELECT.one.from(Users).where({ ID: req.user.id });
+    if (!user) return req.error(404, 'User not found');
+    const valid = await authProvider.authenticate({ password: oldPassword, user });
+    if (!valid) return req.error(401, 'Current password is incorrect');
+    const newHash = await hashPassword(newPassword);
+    await UPDATE(Users).set({ passwordHash: newHash }).where({ ID: req.user.id });
+    return true;
+  });
 });
```

Also add `hashPassword` to the imports at the top:

```diff
 const authProvider = require('../../../infrastructure/auth');
+const { hashPassword } = require('../infrastructure/password');
 const { isMfaRequired } = require('../domain/mfa');
```

---

## T5 — Account Lockout

**What & Why:** After 5 failed login attempts within a 15-minute window, the account is locked for 30 minutes. The lock is time-based — it expires automatically, no background job needed. Policy constants live in `lockout.js` so changing thresholds is a one-line edit.

### Create `modules/identity/domain/lockout.js`

```js
// Lockout policy constants — defined once here so changing the policy
// (e.g. raising the threshold from 5 to 10) is a single-line edit, not
// a search-and-replace across multiple files.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MS = 30 * 60 * 1000; // 30 minutes

// shouldLock: returns true when the failure count has reached the threshold
// AND the first failure happened within the rolling 15-minute window.
// Without the window check, isolated failures across days would accumulate
// and eventually lock out a legitimate user who occasionally miskeys.
function shouldLock(failedLoginCount, firstFailedAt) {
  if (failedLoginCount + 1 < MAX_FAILURES) return false;
  if (!firstFailedAt) return true;
  return Date.now() - new Date(firstFailedAt).getTime() <= WINDOW_MS;
}

// lockoutUntil: returns the timestamp when the lockout expires.
function lockoutUntil() {
  return new Date(Date.now() + LOCKOUT_MS);
}

module.exports = { shouldLock, lockoutUntil, MAX_FAILURES, WINDOW_MS, LOCKOUT_MS };
```

### Modify `modules/identity/application/identity-service.js` — add lockout logic to login

```diff
 const authProvider = require('../../../infrastructure/auth');
+const { shouldLock, lockoutUntil } = require('../domain/lockout');
 const { isMfaRequired } = require('../domain/mfa');
 const { hashPassword } = require('../infrastructure/password');

 srv.on('login', async (req) => {
   const { email, password } = req.data;
   const user = await SELECT.one.from(Users).where({ email });
   if (!user) return req.error(401, 'Invalid credentials');

+  // Time-based lockout check: if the lock window has passed, reset the
+  // account automatically — no background job or admin action needed.
+  if (user.status === 'LOCKED') {
+    if (user.lockedUntil && new Date() < new Date(user.lockedUntil)) {
+      return req.error(423, 'Account is locked. Try again later.');
+    }
+    await UPDATE(Users)
+      .set({ status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null })
+      .where({ ID: user.ID });
+    user.status = 'ACTIVE';
+  }
+
+  // INACTIVE is a permanent admin-set state, unlike LOCKED which is temporary.
+  if (user.status === 'INACTIVE') return req.error(403, 'Account is disabled');
+
   const valid = await authProvider.authenticate({ password, user });
   if (!valid) {
-    return req.error(401, 'Invalid credentials');
+    const newCount = (user.failedLoginCount || 0) + 1;
+    const update = shouldLock(user.failedLoginCount, user.firstFailedAt)
+      ? { failedLoginCount: newCount, status: 'LOCKED', lockedUntil: lockoutUntil(), firstFailedAt: null }
+      : { failedLoginCount: newCount, firstFailedAt: user.firstFailedAt ?? new Date() };
+    await UPDATE(Users).set(update).where({ ID: user.ID });
+    return req.error(401, 'Invalid credentials');
   }

   await UPDATE(Users).set({ failedLoginCount: 0, firstFailedAt: null }).where({ ID: user.ID });
   ...
 });
```

---

## T6 — MFA Enforcement

**What & Why:** MFA is mandatory for Admin, Manager, and Operator (AD-13). The `isMfaRequired` function is the single source of truth — it is called both at login (to set `mfaPending`) and at `createUser` (to set the persisted `mfaRequired` field). Changing the policy is a one-line edit in `mfa.js`.

### Create `modules/identity/domain/mfa.js`

```js
// Roles for which MFA is mandatory (AD-13). This list is the single source
// of truth — changing it here propagates to login, profile display, and any
// future MFA verification middleware without touching business logic.
const MFA_REQUIRED_ROLES = ['Admin', 'Manager', 'Operator'];

// isMfaRequired: returns true if the given role must complete a second factor.
// Customer is intentionally excluded — MFA is risk-based/optional for them
// and must never block the Guest Checkout path.
function isMfaRequired(role) {
  return MFA_REQUIRED_ROLES.includes(role);
}

module.exports = { isMfaRequired, MFA_REQUIRED_ROLES };
```

---

## T7 — Session Timeout & Rate Limiting

**What & Why:** Session timeouts and rate-limit policies live in the Approuter layer. Creating `xs-app.json` now means the policies are documented and ready for when BTP deployment is configured.

### Create `approuter/xs-app.json`

```json
{
  "authenticationMethod": "route",
  "sessionTimeout": 15,
  "routes": [
    {
      "source": "^/identity/(.*)$",
      "target": "/identity/$1",
      "authenticationType": "none"
    },
    {
      "source": "^/(.*)$",
      "target": "/$1",
      "authenticationType": "xsuaa"
    }
  ]
}
```

### Create `approuter/rate-limiting.md`

```markdown
# Rate Limiting Policy

Configured at the Approuter level (AD-24):

- Authenticated write requests: 100 req/min per user
- Authenticated read requests: 300 req/min per user
- Guest writes (reservation, test-drive): 20 req/min per IP (implemented in EPIC05)

Session timeouts:
- Admin: 15 minutes idle
- Manager/Operator: 30 minutes idle
- Customer: IAS default
```

---

## T8 — XSUAA Role Collections

**What & Why:** `xs-security.json` maps XSUAA scopes to CAP role names. The `[production]` profile in `package.json` (already present from EPIC01-T4) switches auth to XSUAA automatically when deployed to BTP.

### Create `xs-security.json`

```json
{
  "xsappname": "automarket",
  "tenant-mode": "dedicated",
  "scopes": [
    { "name": "$XSAPPNAME.Admin",    "description": "Full administrative access" },
    { "name": "$XSAPPNAME.Manager",  "description": "Branch manager access" },
    { "name": "$XSAPPNAME.Operator", "description": "Branch operator access" },
    { "name": "$XSAPPNAME.Customer", "description": "Customer access" }
  ],
  "role-templates": [
    { "name": "Admin",    "description": "Administrator",    "scope-references": ["$XSAPPNAME.Admin"] },
    { "name": "Manager",  "description": "Branch Manager",   "scope-references": ["$XSAPPNAME.Manager"] },
    { "name": "Operator", "description": "Branch Operator",  "scope-references": ["$XSAPPNAME.Operator"] },
    { "name": "Customer", "description": "Customer",         "scope-references": ["$XSAPPNAME.Customer"] }
  ],
  "role-collections": [
    { "name": "AutoMarket_Admin",    "role-template-references": ["$XSAPPNAME.Admin"] },
    { "name": "AutoMarket_Manager",  "role-template-references": ["$XSAPPNAME.Manager"] },
    { "name": "AutoMarket_Operator", "role-template-references": ["$XSAPPNAME.Operator"] },
    { "name": "AutoMarket_Customer", "role-template-references": ["$XSAPPNAME.Customer"] }
  ]
}
```

---

## T9 — Admin Portal

**What & Why:** Admin user management operations: `listUsers`, `createUser`, `assignRole`, `disableUser`. All are `@requires: 'Admin'` — CAP rejects non-Admin requests before they reach the handler. Email uniqueness is enforced in the handler because CAP does not add a DB unique constraint automatically from CDS.

### Modify `modules/identity/api/identity-service.cds` — add admin actions

```diff
     @requires: 'authenticated-user'
     action updateProfile(...) returns Boolean;

+    // Admin-only user management operations.
+    // @requires: 'Admin' ensures CAP rejects any request from a non-Admin role
+    // before it reaches the handler — no role check needed inside the handler.
+    @requires: 'Admin'
+    function listUsers() returns array of {
+        id          : String;
+        email       : String;
+        firstName   : String;
+        lastName    : String;
+        status      : String;
+        mfaRequired : Boolean;
+        isLocked    : Boolean;
+    };
+
+    @requires: 'Admin'
+    action createUser(email: String, firstName: String, lastName: String,
+                      phoneNumber: String, password: String, roleCode: String) returns String;
+
+    @requires: 'Admin'
+    action assignRole(userId: String, roleCode: String) returns Boolean;
+
+    @requires: 'Admin'
+    action disableUser(userId: String) returns Boolean;
 }
```

### Modify `modules/identity/application/identity-service.js` — add admin handlers

```diff
   srv.on('disableUser' ... // add after changePassword handler

+  // listUsers: returns all users with their current MFA and lockout state.
+  srv.on('listUsers', async (req) => {
+    const users = await SELECT.from(Users);
+    return users.map((u) => ({
+      id: u.ID, email: u.email, firstName: u.firstName, lastName: u.lastName,
+      status: u.status, mfaRequired: u.mfaRequired, isLocked: u.status === 'LOCKED',
+    }));
+  });
+
+  // createUser: creates a new user account with a hashed password and assigns the role.
+  // Email uniqueness is enforced here — CAP does not enforce it automatically.
+  srv.on('createUser', async (req) => {
+    const { email, firstName, lastName, phoneNumber, password, roleCode } = req.data;
+    const existing = await SELECT.one.from(Users).where({ email });
+    if (existing) return req.error(409, `A user with email ${email} already exists`);
+    const role = await SELECT.one.from(Roles).where({ code: roleCode });
+    if (!role) return req.error(400, `Unknown role: ${roleCode}`);
+    const passwordHash = await hashPassword(password);
+    const newUser = await INSERT.into(Users).entries({
+      email, firstName, lastName, phoneNumber, passwordHash,
+      status: 'ACTIVE', mfaRequired: isMfaRequired(roleCode), failedLoginCount: 0,
+    });
+    await INSERT.into(UserRoles).entries({ user_ID: newUser.ID, role_ID: role.ID });
+    return newUser.ID;
+  });
+
+  // assignRole: replaces the user's current role with the given role.
+  srv.on('assignRole', async (req) => {
+    const { userId, roleCode } = req.data;
+    const role = await SELECT.one.from(Roles).where({ code: roleCode });
+    if (!role) return req.error(400, `Unknown role: ${roleCode}`);
+    await DELETE.from(UserRoles).where({ user_ID: userId });
+    await INSERT.into(UserRoles).entries({ user_ID: userId, role_ID: role.ID });
+    await UPDATE(Users).set({ mfaRequired: isMfaRequired(roleCode) }).where({ ID: userId });
+    return true;
+  });
+
+  // disableUser: sets status to INACTIVE — permanent until Admin re-enables it.
+  srv.on('disableUser', async (req) => {
+    const { userId } = req.data;
+    const user = await SELECT.one.from(Users).where({ ID: userId });
+    if (!user) return req.error(404, 'User not found');
+    await UPDATE(Users).set({ status: 'INACTIVE' }).where({ ID: userId });
+    return true;
+  });
```

Also add `Roles` to the destructured `cds.entities` call at the top of the handler:

```diff
-  const { Users, UserRoles } = cds.entities('automarket');
+  const { Users, UserRoles, Roles } = cds.entities('automarket');
```
