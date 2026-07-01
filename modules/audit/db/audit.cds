namespace automarket;

using {BaseEntity} from '../../../shared/types/common';

// AuditLogs is an append-only record of every significant entity change.
// No service may UPDATE or DELETE rows — only INSERT is permitted.
// Retention: 7 years (engineering default; legal confirmation pending per jurisdiction).
// oldValue and newValue store JSON snapshots of the changed fields only,
// not the full entity — keeping rows small and diff-friendly.
entity AuditLogs : BaseEntity {
    entityType : String(100);
    entityId   : UUID;
    action     : String(100);
    // JSON snapshot of changed fields before the action.
    oldValue   : LargeString;
    // JSON snapshot of changed fields after the action.
    newValue   : LargeString;
    // userId is stored as UUID — the caller's Users.ID at the time of the action.
    userId     : UUID;
}

// EventOutbox implements the transactional outbox pattern (AD-5).
// Rows are written in the same DB transaction as the triggering business change,
// guaranteeing that the event is never lost even if the process crashes before
// emit. A poller reads PENDING rows (published = false), dispatches them
// at-least-once, then sets published = true. Consumers must be idempotent.
// Retention: 2 years for raw rows.
entity EventOutbox : BaseEntity {
    eventType   : String(255);
    aggregateId : UUID;
    // branchId is carried in the envelope for branch-scoped consumers.
    branchId    : UUID;
    // payload is a JSON string — full event data including schema version.
    payload     : LargeString;
    published   : Boolean default false;
    publishedAt : Timestamp;
}
