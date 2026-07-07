# EPIC22 — Customer Portal Offer Negotiation & UX Fixes

**Goal:** Add a two-way offer negotiation workflow — today only the customer can submit an offer;
Operator/Manager can only approve or reject it, with no way to counter-offer — and fix a batch of
real UX defects found while manually driving the split-up customer-portal apps from EPIC21-T3:
missing cross-app navigation, no way back from an Object Page to its List Report, no logout, an
image column rendered as raw text instead of a thumbnail, unlabeled specification fields, and a
native "Delete" button visible to a role that can never actually delete a vehicle.

---

## Sprint Overview

### Ticket Table

| Ticket | Description | Status |
|--------|-------------|--------|
| EPIC22-T1 | Customer offer lifecycle | Open |
| EPIC22-T2 | Operator/Manager counter-offers | Open |
| EPIC22-T3 | Customer Portal navigation | Open |
| EPIC22-T4 | Vehicle Object Page polish | Open |
| EPIC22-T5 | Read-only Vehicles for Customers | Open |

### Sprint Backlog DoD Mapping

| DoD Item | Satisfied by |
|----------|-------------|
| Customer submits an offer → "Make an Offer" hides, a "My Offer" row appears with a working "Remove the Offer" action; removing it (or the offer being rejected) brings "Make an Offer" back | EPIC22-T1 |
| Operator/Manager can counter-offer; customer sees Accept (buys at that price) / Reject (deletes it, "Make an Offer" returns) / Make a New Offer (submits a new offer, discards the counter-offer) | EPIC22-T2 |
| Every customer-portal app has links to the customer's other apps, a working back-to-list button on every Object Page, and a logout button | EPIC22-T3 |
| Vehicle Object Page shows a real image (not a raw URL) and labeled specification fields | EPIC22-T4 |
| No "Delete" button visible to a Customer anywhere in customer-portal | EPIC22-T5 |

### Sign-off

_To be filled in at sprint end._

---
