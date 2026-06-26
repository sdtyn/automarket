// Lockout policy constants — defined once here so changing the policy
// (e.g. raising the threshold from 5 to 10) is a single-line edit, not
// a search-and-replace across multiple files.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MS = 30 * 60 * 1000; // 30 minutes

// shouldLock: returns true when the failure count has reached the threshold
// AND the first failure happened within the rolling 15-minute window.
// Without the window check, isolated failures across days would accumulate
// and eventually lock out a legitimate user who occasionally miskeys.
function shouldLock(failedLoginCount, firstFailedAt) {
    if (failedLoginCount + 1 < MAX_FAILURES) return false;
    if (!firstFailedAt) return true;
    return Date.now() - new Date(firstFailedAt).getTime() <= WINDOW_MS;
}

// lockoutUntil: returns the timestamp when the lockout expires.
function lockoutUntil() {
    return new Date(Date.now() + LOCKOUT_MS);
}

module.exports = { shouldLock, lockoutUntil, MAX_FAILURES, WINDOW_MS, LOCKOUT_MS };