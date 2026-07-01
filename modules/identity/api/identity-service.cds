using {automarket} from '../db/identity';

// IdentityService is intentionally scoped to /identity so that rate limiting
// and routing rules at the Approuter can target the auth surface independently
// from domain services. No domain entity is exposed directly here — only actions.
@impl: 'modules/identity/application/identity-service.js'
service IdentityService @(path: '/identity') {

    // login is an action (not a function) because CAP maps actions to HTTP POST.
    // POST is correct here: login is side-effectful (it resets failedLoginCount,
    // updates lockedUntil, and issues a token) — a GET would be semantically wrong
    // and could be cached by intermediaries.
    action   login(email: String, password: String)                                  returns {
        token      : String;
        userId     : String;
        role       : String;
        // mfaPending signals the client that a second factor is required before
        // the token should be considered fully authenticated. In local dev this
        // flag is returned but not enforced — enforcement is deferred to XSUAA.
        mfaPending : Boolean;
    };

    @requires: 'authenticated-user'
    action   changePassword(oldPassword: String, newPassword: String)                returns Boolean;

    @requires: 'authenticated-user'
    function getProfile()                                                            returns {
        id          : String;
        email       : String;
        firstName   : String;
        lastName    : String;
        phoneNumber : String;
    };

    @requires: 'authenticated-user'
    action   updateProfile(firstName: String, lastName: String, phoneNumber: String) returns Boolean;

    // Admin-only user management operations.
    // @requires: 'Admin' ensures CAP rejects any request from a non-Admin role
    // before it reaches the handler — no role check needed inside the handler.
    @requires: 'Admin'
    function listUsers()                                                             returns array of {
        id          : String;
        email       : String;
        firstName   : String;
        lastName    : String;
        status      : String;
        mfaRequired : Boolean;
        isLocked    : Boolean;
    };

    @requires: 'Admin'
    action   createUser(email: String,
                        firstName: String,
                        lastName: String,
                        phoneNumber: String,
                        password: String,
                        roleCode: String)                                            returns String;

    @requires: 'Admin'
    action   assignRole(userId: String, roleCode: String)                            returns Boolean;


    @requires: 'Admin'
    action   disableUser(userId: String)                                             returns Boolean;
}
