# EPIC21 — Fiori Elements Multi-App Remediation

**Goal:** Fix a defect discovered via real-browser (Playwright) testing during EPIC20 sign-off,
documented in `docs/cap-notes.md` #12: `sap.fe.templates` does not support hosting multiple
unrelated List Report/Object Page pairs in one `sap.fe.core.AppComponent` the way EPIC19-T5/T6 and
EPIC20-T1 through T6 assumed ("manually merge the Nth entity into an existing app via extra
`manifest.json` routes"). Every entity beyond an app's original root (`Vehicles` in
`app/operator-portal`/`app/customer-portal`, `Users` in `app/admin-portal`) crashes to a full-page
"Sorry, we can't find this page" error the instant its route is opened — confirmed for
`ReservationsList`/`TestDrivesList`/`OffersList` (operator), `PaymentsList` (admin), `OrdersList`
(customer), and expected identically for `BranchesList`/`AuditLogsList` (admin, EPIC19-T5/T6) and
every remaining customer-portal entity by the same construction. An attempted
`sap.fe.core.rootView.Fcl` fix stops the crash but breaks the List Report's search/"Go" action for
every non-root entity instead — not a real fix; it was reverted, not shipped. The only pattern
proven to work end to end is one entity's List Report as the sole root of its own app. This epic
splits every affected entity into its own dedicated Fiori Elements application, and separately
fixes the native "Create" toolbar button (EPIC20-T4's core deliverable) never appearing on
`Vehicles` despite the `CREATE` grant, because CAP is not emitting the
`Capabilities.InsertRestrictions` annotation Fiori Elements needs to decide to show it. The backend
(CDS bound actions, JS handlers, `@UI` annotations) built in EPIC19-T5/T6 and EPIC20-T1–T6 is
correct and unaffected — this epic is UI-hosting-structure only, no backend/CDS changes expected
except where T4's Create-button fix requires a capability annotation.

Root-cause trace, the rejected FCL attempt, and verification commands: `docs/cap-notes.md` #12.

---

## Sprint Overview

### Ticket Table

| Ticket | Description | Status |
|--------|-------------|--------|
| EPIC21-T1 | Operator Portal — split into separate apps | Open |
| EPIC21-T2 | Admin Portal — split into separate apps | Open |
| EPIC21-T3 | Customer Portal — split into separate apps | Open |
| EPIC21-T4 | Native Create button fix | Open |
| EPIC21-T5 | Per-role navigation | Open |

### Sprint Backlog DoD Mapping

| DoD Item | Satisfied by |
|----------|-------------|
| Every EPIC19-T5/T6 and EPIC20-T1–T6 List Report/Object Page is reachable and functional (real data on "Go", buttons work) in a real browser | EPIC21-T1, T2, T3 |
| Native "Create" button visible and functional on `Vehicles` | EPIC21-T4 |
| Every role can actually reach all of their apps, not just the one at each app's root hash | EPIC21-T5 |
| Verified with Playwright/`chromium-cli` against a live backend + live `ui5 serve`, not just backend curl + `$metadata` grep | Per ticket |

### Sign-off

_To be filled in at sprint end._

---
