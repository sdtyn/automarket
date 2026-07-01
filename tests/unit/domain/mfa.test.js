'use strict';

const { isMfaRequired, MFA_REQUIRED_ROLES } = require('../../../modules/identity/domain/mfa');

describe('isMfaRequired()', () => {
  it.each(MFA_REQUIRED_ROLES)('requires MFA for %s', (role) => {
    expect(isMfaRequired(role)).toBe(true);
  });

  it('does not require MFA for Customer', () => {
    expect(isMfaRequired('Customer')).toBe(false);
  });

  it('does not require MFA for unknown roles', () => {
    expect(isMfaRequired('Guest')).toBe(false);
    expect(isMfaRequired('')).toBe(false);
    expect(isMfaRequired(undefined)).toBe(false);
  });
});
