# EPIC20 — Full UI & Backend Integration

**Goal:** EPIC19 only wired browse/view screens (Vehicles, Users, Branches, AuditLogs) — every
actual business workflow (reserve, offer, test-drive, checkout, pay, approve, admin actions) is
still API-only, because almost every write operation in this system is an *unbound* OData action
(service-level, not bound to an entity type), and `@UI.DataFieldForAction` — Fiori Elements' native
toolbar-button mechanism — only targets actions bound to an entity type. This epic converts the
~20 unbound actions that matter for a real end-to-end demo into bound actions (backend) and wires
each one onto the relevant List Report/Object Page as a native button (UI), ticket by ticket,
verified with the same rigor as EPIC19 (live backend + live `ui5 serve`, not just annotations read
for plausibility). Backend and UI land together in every ticket — no ticket is "just the refactor"
or "just the button."

---

## Sprint Overview

### Ticket Table

| Ticket | Description | Status |
|--------|-------------|--------|
| EPIC20-T1 | Customer — Reservations & Favorites | Open |
| EPIC20-T2 | Customer — Offers & Test Drives | Open |
| EPIC20-T3 | Customer — Checkout & Payment | Open |
| EPIC20-T4 | Operator — Vehicle & approval workflows | Open |
| EPIC20-T5 | Manager & Admin — Offer approval and PSP simulation | Open |
| EPIC20-T6 | Admin — User & Branch management actions | Open |

### Sprint Backlog DoD Mapping

| DoD Item | Satisfied by |
|----------|-------------|
| Customer: browse → reserve or offer → checkout → pay is clickable end to end, no `.http` file needed | EPIC20-T1, T2, T3 |
| Operator can approve/reject a reservation/test drive from the UI | EPIC20-T4 |
| Manager can approve/reject an offer from the UI | EPIC20-T5 |
| Admin can disable a user, assign a role, and disable a branch from the UI | EPIC20-T6 |
| Every button verified against a live backend + live `ui5 serve` (proxy, auth, metadata, real data) | Per ticket |

### Sign-off

_To be filled in at sprint end._

---
