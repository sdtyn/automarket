# EPIC11 — Notifications

Sprint 11. Goal: event-driven notification system. Notifications are never created directly — all rows originate from domain event subscribers. NotificationService owns the read path; event handlers create PENDING rows that a background job would later dispatch (dispatch is out of scope for this sprint). VehicleSold subscriber is immediately active; VehiclePriceDropped and SimilarVehicleListed subscribers are wired now and will fire once the emitting services add those events.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC11-T1 | Notification Domain Model — `Notifications` entity, `NotificationChannel`/`NotificationStatus` enums | Done |
| EPIC11-T2 | Notification Service — read-only entity, `getMyNotifications`, `getUnreadCount`, event subscribers | Open |

### Sprint Backlog DoD mapping

- "Notification entity" → EPIC11-T1
- "Event-driven creation (VehicleSold, VehiclePriceDropped, SimilarVehicleListed)" → EPIC11-T2
- "Customer read path (getMyNotifications, getUnreadCount)" → EPIC11-T2

### Sign-off

_To be completed at sprint end._

---

## T1 — Notification Domain Model

**What & Why:** `Notifications` is an append-only log — rows are created by event subscribers and read by the customer via the service layer; there is no direct create action. `recipient` is an Association to `Users` so that CAP's identity checks can verify `recipient_ID = $user` at query time. `sentAt` is null until the background dispatch job delivers the notification — keeping it null makes it easy to query for undelivered rows. The RETRY status exists for the dispatch job's retry loop; the service layer never sets it directly. Retention is 1 year, enforced by a purge job (out of scope).

### Create `modules/notification/db/notification.cds`

```cds
namespace automarket;

using {BaseEntity}       from '../../../shared/types/common';
using {automarket.Users} from '../../identity/db/identity';

// Notifications is an append-only log of outbound messages to users.
// Rows are created by event subscribers in NotificationService — there is
// no direct create action. A background dispatch job (out of scope) reads
// PENDING rows, delivers them, and advances status to SENT or FAILED.
// sentAt is null until the dispatch job sets it.
//
// Retention: 1 year — enforced by a scheduled purge job, not a CDS TTL.
entity Notifications : BaseEntity {
    recipient : Association to Users;
    channel   : NotificationChannel;
    subject   : String(255);
    content   : LargeString;
    status    : NotificationStatus default 'PENDING';
    // sentAt is null until the dispatch job delivers the notification.
    sentAt    : Timestamp;
}

// NotificationChannel determines the delivery mechanism.
type NotificationChannel : String enum {
    EMAIL; // transactional email
    SMS;   // short message service
    PUSH;  // in-app push notification
};

// NotificationStatus lifecycle: PENDING → SENT
//                                       ↘ FAILED → RETRY → SENT (or FAILED again)
type NotificationStatus : String enum {
    PENDING; // created but not yet dispatched
    SENT;    // successfully delivered
    FAILED;  // delivery attempt failed
    RETRY;   // scheduled for re-delivery after failure
};
```

### Modify `db/index.cds`

```cds
using from '../modules/notification/db/notification';
```
