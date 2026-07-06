using {automarket} from '../../identity/db/identity';
using {automarket as aud} from '../../audit/db/audit';
using {automarket as br} from '../../branch/db/branch';
using {automarket as pay} from '../../payment/db/payment';

// AdminService is the system administration surface — Admin role only.
// No other role may call any action or read any entity here.
// AuditLogs and EventOutbox are read-only even for Admin — append-only
// guarantees are enforced at the service layer, not just by convention.
@impl: 'modules/admin/application/admin-service.js'
service AdminService @(path: '/admin') {

    // statusCriticality is a read-only calculated field (populated in
    // admin-service.js, srv.after('READ')) — not persisted. Maps UserStatus to
    // an OData UI.CriticalityType for the Fiori status badge (EPIC19-T5).
    @requires: 'Admin'
    entity Users       as
        projection on automarket.Users {
            *,
            virtual null as statusCriticality : Integer
        }
        excluding {
            passwordHash
        }
        actions {
            // disable (EPIC20-T6): permanently deactivates an account (INACTIVE,
            // not LOCKED). Re-enabling requires a separate Admin action (not yet
            // implemented). Bound to Users — replaces the old unbound disableUser.
            @requires: 'Admin'
            action disable()                    returns Boolean;

            // assignRole (EPIC20-T6): adds a role to a user. Idempotent — safe
            // to call twice. Bound to Users — replaces the old unbound
            // assignRole action.
            @requires: 'Admin'
            action assignRole(roleCode: String) returns Boolean;
        };

    @requires: 'Admin'
    entity Roles       as projection on automarket.Roles;

    @requires: 'Admin'
    entity UserRoles   as projection on automarket.UserRoles;

    // statusCriticality: same pattern as Users above, maps BranchStatus.
    @requires: 'Admin'
    entity Branches    as
        projection on br.Branches {
            *,
            virtual null as statusCriticality : Integer
        }
        actions {
            // disable (EPIC20-T6): soft-deletes a branch by setting status to
            // INACTIVE. Bound to Branches — a distinct overload from Users'
            // own `disable` above (OData resolves same-named bound actions by
            // their bound type) — replaces the old unbound disableBranch.
            @requires: 'Admin'
            action disable() returns Boolean;
        };

    // AuditLogs: read-only for Admin. No create/update/delete exposed.
    @requires: 'Admin'
    @readonly
    entity AuditLogs   as projection on aud.AuditLogs;

    // EventOutbox: read-only for Admin — useful for debugging stuck events.
    @requires: 'Admin'
    @readonly
    entity EventOutbox as projection on aud.EventOutbox;

    // createBranch: registers a new branch and sets it ACTIVE.
    @requires: 'Admin'
    action createBranch(code: String,
                        name: String,
                        address: String,
                        city: String,
                        country: String,
                        region: String) returns String;

    // updateBranch: updates mutable branch fields. All parameters are optional
    // except branchId — omitted fields are left unchanged.
    @requires: 'Admin'
    action updateBranch(branchId: String,
                        name: String,
                        address: String,
                        city: String,
                        country: String,
                        region: String) returns Boolean;

    // createUser: creates an account with a temporary random password.
    // In production, a password-reset email is sent immediately after creation.
    @requires: 'Admin'
    action createUser(email: String,
                      firstName: String,
                      lastName: String,
                      phoneNumber: String,
                      roleCode: String) returns String;

    // Payments (EPIC20-T5): PSP-webhook simulation surface for Admin.
    // capture/fail/refund are bound actions delegating to PaymentService via
    // cds.connect.to('PaymentService').send(...) in admin-service.js — NOT
    // reimplemented here. PaymentService.emit('PaymentSucceeded'/'PaymentFailed'/
    // 'PaymentRefunded') must originate from the real PaymentService instance,
    // since SalesService subscribes with cds.connect.to('PaymentService').on(...);
    // reimplementing the status update here and emitting from AdminService's own
    // srv would silently break that downstream Order/Vehicle status flow.
    @requires: 'Admin'
    entity Payments    as projection on pay.Payments
        actions {
            action capture(transactionReference: String) returns Boolean;
            action fail()                                returns Boolean;
            action refund()                              returns Boolean;
        };
}
