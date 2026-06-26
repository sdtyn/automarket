using {automarket} from '../db/identity';

// IdentityService is intentionally scoped to /identity so that rate limiting
// and routing rules at the Approuter can target the auth surface independently
// from domain services. No domain entity is exposed directly here — only actions.
service IdentityService @(path: '/identity') {

    // login is an action (not a function) because CAP maps actions to HTTP POST.
    // POST is correct here: login is side-effectful (it resets failedLoginCount,
    // updates lockedUntil, and issues a token) — a GET would be semantically wrong
    // and could be cached by intermediaries.
    action login(email : String, password : String) returns {
        token  : String;
        userId : String;
        role   : String;
    };

}
