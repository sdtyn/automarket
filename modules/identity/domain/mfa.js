// Roles for which MFA is mandatory (AD-13). This list is the single source
// of truth — changing it here propagates to login, profile display, and any
// future MFA verification middleware without touching business logic.
const MFA_REQUIRED_ROLES = ['Admin', 'Manager', 'Operator'];

// isMfaRequired: returns true if the given role must complete a second factor.
// Customer is intentionally excluded — MFA is risk-based/optional for them
// and must never block the Guest Checkout path.
function isMfaRequired(role) {
  return MFA_REQUIRED_ROLES.includes(role);
}

module.exports = { isMfaRequired, MFA_REQUIRED_ROLES };
