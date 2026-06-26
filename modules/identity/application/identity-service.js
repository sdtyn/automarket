// CAP's automatic service-to-handler binding works by co-location: it expects
// the .cds definition and the .js handler to live in the same folder with the
// same base name. Because this project uses a modular layout (api/ and
// application/ are separate), CAP cannot auto-detect the link — the binding is
// declared explicitly via "impl" in package.json under cds.services.
const cds = require('@sap/cds');
const { verifyPassword } = require('../infrastructure/password');
const { issueToken } = require('../infrastructure/jwt');

module.exports = cds.service.impl(async function (srv) {
  const { Users, UserRoles } = cds.entities('automarket');

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

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      const newCount = (user.failedLoginCount || 0) + 1;
      // On the 5th failure, flip status to LOCKED and record the unlock
      // time (now + 30 min). Subsequent failures while locked are caught
      // by the LOCKED check above — they do not extend the lockout window.
      const update =
        newCount >= 5
          ? {
              failedLoginCount: newCount,
              status: 'LOCKED',
              lockedUntil: new Date(Date.now() + 30 * 60 * 1000),
            }
          : { failedLoginCount: newCount };
      await UPDATE(Users).set(update).where({ ID: user.ID });
      return req.error(401, 'Invalid credentials');
    }

    // Reset the counter on success so isolated failed attempts across sessions
    // do not accumulate into an unintended lockout over time.
    await UPDATE(Users).set({ failedLoginCount: 0 }).where({ ID: user.ID });

    // Read the first assigned role. Multi-role support is additive later —
    // UserRoles is already a join entity, so no schema change will be needed.
    const userRole = await SELECT.one.from(UserRoles).where({ user_ID: user.ID });
    const role = userRole?.role_ID ?? 'Customer';

    const token = issueToken({ userId: user.ID, email: user.email, role });
    return { token, userId: user.ID, role };
  });
});
