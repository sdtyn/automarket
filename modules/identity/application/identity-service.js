// CAP's automatic service-to-handler binding works by co-location: it expects
// the .cds definition and the .js handler to live in the same folder with the
// same base name. Because this project uses a modular layout (api/ and
// application/ are separate), CAP cannot auto-detect the link — the binding is
// declared explicitly via "impl" in package.json under cds.services.
const cds = require('@sap/cds');
const authProvider = require('../../../infrastructure/auth');
const { shouldLock, lockoutUntil } = require('../domain/lockout');
const { isMfaRequired } = require('../domain/mfa');
const { hashPassword } = require('../infrastructure/password');

module.exports = cds.service.impl(async function (srv) {
  const { Users, UserRoles, Roles } = cds.entities('automarket');

  // login: authenticates with email/password, returns a signed JWT on success.
  // All lockout and status checks happen here before delegating to authProvider.
  srv.on('login', async (req) => {
    const { email, password } = req.data;

    const user = await SELECT.one.from(Users).where({ email });
    // Return 401 (not 404) when the user does not exist. Returning a distinct
    // error for "user not found" vs "wrong password" would allow an attacker
    // to enumerate valid email addresses via the login endpoint.
    if (!user) return req.error(401, 'Invalid credentials');

    // Time-based lockout check: if the lock window has passed, reset the
    // account automatically — no background job or admin action needed.
    if (user.status === 'LOCKED') {
      if (user.lockedUntil && new Date() < new Date(user.lockedUntil)) {
        return req.error(423, 'Account is locked. Try again later.');
      }
      await UPDATE(Users)
        .set({ status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null })
        .where({ ID: user.ID });
      user.status = 'ACTIVE';
    }

    // INACTIVE is a permanent admin-set state, unlike LOCKED which is temporary.
    if (user.status === 'INACTIVE') return req.error(403, 'Account is disabled');

    const valid = await authProvider.authenticate({ password, user });
    if (!valid) {
      const newCount = (user.failedLoginCount || 0) + 1;
      // Delegate lockout decision to the domain layer — policy constants
      // (threshold, window, duration) live in lockout.js, not here.
      const update = shouldLock(user.failedLoginCount, user.firstFailedAt)
        ? {
            failedLoginCount: newCount,
            status: 'LOCKED',
            lockedUntil: lockoutUntil(),
            firstFailedAt: null,
          }
        : { failedLoginCount: newCount, firstFailedAt: user.firstFailedAt ?? new Date() };
      await UPDATE(Users).set(update).where({ ID: user.ID });
      return req.error(401, 'Invalid credentials');
    }

    // Reset all failure tracking on success — clears both the counter and
    // the window start so the next failure sequence starts fresh.
    await UPDATE(Users).set({ failedLoginCount: 0, firstFailedAt: null }).where({ ID: user.ID });

    // Read the first assigned role. Join to Roles to get the code string, not the UUID.
    // role_ID is the Roles entity PK (UUID) — passing it directly to isMfaRequired
    // would always return false and the JWT would carry an opaque ID instead of a code.
    const userRole = await SELECT.one.from(UserRoles).where({ user_ID: user.ID });
    const roleRow = userRole ? await SELECT.one.from(Roles).where({ ID: userRole.role_ID }) : null;
    const role = roleRow?.code ?? 'Customer';

    const token = authProvider.issueToken({ userId: user.ID, email: user.email, role });
    // mfaPending tells the client a second factor is required. The token is
    // issued regardless — in local dev MFA is not enforced at the server side.
    // When XSUAA is active, it handles MFA enforcement before the request
    // reaches this handler, so mfaPending becomes informational only.
    const mfaPending = isMfaRequired(role);
    return { token, userId: user.ID, role, mfaPending };
  });

  // getProfile: returns the authenticated user's own profile fields.
  // Email is read-only — it doubles as the login credential and username,
  // so changing it requires a separate admin flow, not a self-service update.
  srv.on('getProfile', async (req) => {
    // req.user.id is populated by CAP from the JWT — no need to pass userId
    // in the request body, which would open a door for users to read others' profiles.
    const user = await SELECT.one.from(Users).where({ ID: req.user.id });
    if (!user) return req.error(404, 'User not found');
    return {
      id: user.ID,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
    };
  });

  // updateProfile: allows the authenticated user to update display fields only.
  // Sensitive fields (email, passwordHash, status, mfaRequired) are excluded —
  // those require admin action or a dedicated flow (changePassword).
  srv.on('updateProfile', async (req) => {
    // req.user.id comes from the verified JWT — the user cannot spoof another
    // user's ID by passing it in the request body, because the body is ignored here.
    const { firstName, lastName, phoneNumber } = req.data;
    await UPDATE(Users).set({ firstName, lastName, phoneNumber }).where({ ID: req.user.id });
    return true;
  });

  // updateNotificationPreference: lets the caller opt in/out of VehiclePriceDropped
  // EMAIL alerts. Same self-service pattern as updateProfile — scoped to req.user.id.
  srv.on('updateNotificationPreference', async (req) => {
    const { notifyOnPriceDrop } = req.data;
    await UPDATE(Users).set({ notifyOnPriceDrop }).where({ ID: req.user.id });
    return true;
  });

  // changePassword: replaces the user's password after verifying the current one.
  // Old password verification is mandatory — a stolen session token alone must
  // not be enough to lock out the legitimate account owner.
  srv.on('changePassword', async (req) => {
    const { oldPassword, newPassword } = req.data;
    const user = await SELECT.one.from(Users).where({ ID: req.user.id });
    if (!user) return req.error(404, 'User not found');

    // Verify the old password before allowing the change — prevents an
    // attacker with a stolen session token from locking out the real user.
    const valid = await authProvider.authenticate({ password: oldPassword, user });
    if (!valid) return req.error(401, 'Current password is incorrect');

    const newHash = await hashPassword(newPassword);
    await UPDATE(Users).set({ passwordHash: newHash }).where({ ID: req.user.id });
    return true;
  });

  // listUsers: returns all users with their current MFA and lockout state.
  // isLocked is derived at read time from status — it is not a stored field,
  // so it always reflects the current state without a background sync job.
  srv.on('listUsers', async (req) => {
    const users = await SELECT.from(Users);
    return users.map((u) => ({
      id: u.ID,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      status: u.status,
      mfaRequired: u.mfaRequired,
      isLocked: u.status === 'LOCKED',
    }));
  });

  // createUser: creates a new user account with a hashed password and assigns
  // the given role. Email uniqueness is enforced here — CAP does not enforce
  // it automatically without a DB-level unique constraint.
  srv.on('createUser', async (req) => {
    const { email, firstName, lastName, phoneNumber, password, roleCode } = req.data;

    const existing = await SELECT.one.from(Users).where({ email });
    if (existing) return req.error(409, `A user with email ${email} already exists`);

    const role = await SELECT.one.from(Roles).where({ code: roleCode });
    if (!role) return req.error(400, `Unknown role: ${roleCode}`);

    const passwordHash = await hashPassword(password);
    const id = cds.utils.uuid();
    await INSERT.into(Users).entries({
      ID: id,
      email,
      firstName,
      lastName,
      phoneNumber,
      passwordHash,
      status: 'ACTIVE',
      mfaRequired: isMfaRequired(roleCode),
      failedLoginCount: 0,
    });

    await INSERT.into(UserRoles).entries({ user_ID: id, role_ID: role.ID });
    return id;
  });

  // assignRole: replaces the user's current role assignment with the given role.
  // Single-role model for now — existing UserRoles rows are deleted before inserting
  // the new one. Multi-role support is additive without a schema change.
  srv.on('assignRole', async (req) => {
    const { userId, roleCode } = req.data;
    const role = await SELECT.one.from(Roles).where({ code: roleCode });
    if (!role) return req.error(400, `Unknown role: ${roleCode}`);

    await DELETE.from(UserRoles).where({ user_ID: userId });
    await INSERT.into(UserRoles).entries({ user_ID: userId, role_ID: role.ID });

    // Update mfaRequired to match the new role — role change must propagate
    // immediately, not on next login.
    await UPDATE(Users)
      .set({ mfaRequired: isMfaRequired(roleCode) })
      .where({ ID: userId });
    return true;
  });

  // disableUser: sets status to INACTIVE, which blocks login permanently until
  // an Admin re-enables the account. Unlike LOCKED, INACTIVE does not expire.
  srv.on('disableUser', async (req) => {
    const { userId } = req.data;
    const user = await SELECT.one.from(Users).where({ ID: userId });
    if (!user) return req.error(404, 'User not found');
    await UPDATE(Users).set({ status: 'INACTIVE' }).where({ ID: userId });
    return true;
  });
});
