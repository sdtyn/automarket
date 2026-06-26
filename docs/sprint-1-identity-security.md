# Sprint 1 — Identity & Security (EPIC-02)

Local-only development scope (see CONTRIBUTING.md, "Deferred: BTP-Specific Work").

| # | Item | Status |
|---|---|---|
| EPIC02-T1 | Identity Domain Model — `Users`, `Roles`, `UserRoles` entities + `UserStatus` enum; `common.cds` shared types | Done |
| EPIC02-T2 | Local Auth — Bcrypt password hashing, email/password login handler, JWT issuance (US-2.3, US-2.4, US-2.5) | In Progress |
| EPIC02-T3 | Authentication Provider Abstraction — `local-provider` / `xsuaa-provider` / `guest-token-provider` behind one interface; business logic reads only `req.user` (US-2.16) | Open |
| EPIC02-T4 | Account & Profile Self-Service — view/update own profile (name, phone), change own password (US-2.12, US-2.13) | Open |
| EPIC02-T5 | Account Lockout — 5 failed attempts / 15 min → 30-min time-based unlock; `LOCKED` status + `lockedUntil` field (US-2.9) | Open |
| EPIC02-T6 | MFA Enforcement — mandatory for Operator/Manager/Admin; risk-based/optional for Customer; never blocks Guest Checkout (US-2.8) | Open |
| EPIC02-T7 | Session Timeout & Rate Limiting — Approuter config: 15 min Admin, 30 min Manager/Operator; 100/300 req/min auth, 20/100 req/min guest (US-2.10, US-2.11) | Open |
| EPIC02-T8 | XSUAA Role Collections — `AutoMarket_Admin/Manager/Operator/Customer` mapped to CAP roles; verified in TEST (US-2.7) | Open |
| EPIC02-T9 | Admin Portal — User list, create user, assign roles, disable user, MFA/lockout status display (US-2.1, US-2.2, US-2.6, US-2.14, US-2.15) | Open |

## Sprint Backlog DoD mapping

- "Identity Module" → EPIC02-T1, T2, T3, T4, T5
- "Authentication Module" → EPIC02-T2, T3, T6, T7
- "Authorization Framework (RBAC scaffold)" → EPIC02-T8, T9

## Sign-off

_To be completed at sprint end._
