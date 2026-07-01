using {automarket}         from '../../identity/db/identity';
using {automarket as aud}  from '../../audit/db/audit';
using {automarket as br}   from '../../branch/db/branch';

// AdminService is the system administration surface — Admin role only.
// No other role may call any action or read any entity here.
// AuditLogs and EventOutbox are read-only even for Admin — append-only
// guarantees are enforced at the service layer, not just by convention.
@impl: 'modules/admin/application/admin-service.js'
service AdminService @(path: '/admin') {

    @requires: 'Admin'
    entity Users       as projection on automarket.Users
        excluding { passwordHash };

    @requires: 'Admin'
    entity Roles       as projection on automarket.Roles;

    @requires: 'Admin'
    entity UserRoles   as projection on automarket.UserRoles;

    @requires: 'Admin'
    entity Branches    as projection on br.Branches;

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
    action createBranch(
        code    : String,
        name    : String,
        address : String,
        city    : String,
        country : String,
        region  : String
    ) returns String;

    // updateBranch: updates mutable branch fields. All parameters are optional
    // except branchId — omitted fields are left unchanged.
    @requires: 'Admin'
    action updateBranch(
        branchId : String,
        name     : String,
        address  : String,
        city     : String,
        country  : String,
        region   : String
    ) returns Boolean;

    // disableBranch: soft-deletes a branch by setting status to INACTIVE.
    @requires: 'Admin'
    action disableBranch(branchId : String) returns Boolean;

    // createUser: creates an account with a temporary random password.
    // In production, a password-reset email is sent immediately after creation.
    @requires: 'Admin'
    action createUser(
        email       : String,
        firstName   : String,
        lastName    : String,
        phoneNumber : String,
        roleCode    : String
    ) returns String;

    // disableUser: permanently deactivates an account (INACTIVE, not LOCKED).
    // Re-enabling requires a separate Admin action (not yet implemented).
    @requires: 'Admin'
    action disableUser(userId : String) returns Boolean;

    // assignRole: adds a role to a user. Idempotent — safe to call twice.
    @requires: 'Admin'
    action assignRole(userId : String, roleCode : String) returns Boolean;
}
