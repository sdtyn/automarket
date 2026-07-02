using {automarket} from '../db/notification';

// NotificationService is read-only — no action creates a Notification directly.
// All rows originate from domain event subscribers wired below the service block.
// Customers access their notifications via functions (not the entity projection)
// so the handler can scope the result to the caller (req.user.id, which is
// already the Users.ID UUID — see EPIC17-T3) without exposing recipient_ID
// as a queryable/filterable field on the entity.
@impl: 'modules/notification/application/notification-service.js'
service NotificationService @(path: '/notifications') {

    // Admin and Manager can read all notifications (support / troubleshooting).
    // Customers use getMyNotifications instead.
    @restrict: [{
        grant: 'READ',
        to   : [
            'Admin',
            'Manager'
        ]
    }]
    entity Notifications as projection on automarket.Notifications;

    // getMyNotifications: returns the caller's notifications, newest first.
    // Optional channel and status filters narrow the result.
    @requires: [
        'Customer',
        'Admin',
        'Manager'
    ]
    function getMyNotifications(channel: String,
                                status: String) returns array of Notifications;

    // getUnreadCount: returns the number of PENDING notifications for the caller.
    @requires: [
        'Customer',
        'Admin',
        'Manager'
    ]
    function getUnreadCount()                   returns Integer;
}
