'use strict';

const {
  hashPassword,
  verifyPassword,
} = require('../../../modules/identity/infrastructure/password');

describe('hashPassword() / verifyPassword()', () => {
  // bcrypt is intentionally slow — raise the Jest timeout for this suite.
  jest.setTimeout(15000);

  it('produces a hash that verifyPassword accepts with the original plain text', async () => {
    const hash = await hashPassword('MySecret123!');
    expect(await verifyPassword('MySecret123!', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('produces a different hash each call (random salt)', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');
    expect(hash1).not.toBe(hash2);
  });

  it('hash starts with bcrypt identifier prefix', async () => {
    const hash = await hashPassword('any');
    expect(hash).toMatch(/^\$2[aby]\$/);
  });
});
