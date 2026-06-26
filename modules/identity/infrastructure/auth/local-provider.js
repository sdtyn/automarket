const { verifyPassword } = require('../password');
const { issueToken, verifyToken } = require('../jwt');

// Local provider implements the auth provider interface for development and
// non-BTP environments. It uses email/password + Bcrypt + JWT — the full
// local auth stack defined in T2. Swapping to xsuaa-provider in production
// requires no changes to any business logic layer.
const localProvider = {
  async authenticate({ password, user }) {
    const valid = await verifyPassword(password, user.passwordHash);
    return valid;
  },

  issueToken(payload) {
    return issueToken(payload);
  },

  verify(token) {
    return verifyToken(token);
  },
};

module.exports = localProvider;
