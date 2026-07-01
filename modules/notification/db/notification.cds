namespace automarket;

using {BaseEntity} from '../../../shared/types/common';
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
    SMS; // short message service
    PUSH; // in-app push notification
};

// NotificationStatus lifecycle: PENDING → SENT
//                                       ↘ FAILED → RETRY → SENT (or FAILED again)
type NotificationStatus  : String enum {
    PENDING; // created but not yet dispatched
    SENT; // successfully delivered
    FAILED; // delivery attempt failed
    RETRY; // scheduled for re-delivery after failure
};
