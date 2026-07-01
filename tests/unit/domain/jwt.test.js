'use strict';

// Set JWT_SECRET before requiring the module so issueToken does not throw.
process.env.JWT_SECRET = 'test-secret-for-unit-tests';

const { issueToken, verifyToken } = require('../../../modules/identity/infrastructure/jwt');

describe('issueToken() / verifyToken()', () => {
  const payload = { id: 'user-1', email: 'test@example.com', role: 'Customer' };

  it('issues a token that verifyToken accepts', () => {
    const token = issueToken(payload);
    const decoded = verifyToken(token);
    expect(decoded.id).toBe(payload.id);
    expect(decoded.email).toBe(payload.email);
    expect(decoded.role).toBe(payload.role);
  });

  it('includes an exp (expiry) claim in the token', () => {
    const token = issueToken(payload);
    const decoded = verifyToken(token);
    expect(decoded.exp).toBeDefined();
    // 8h = 28800s; token should expire roughly 8h from now.
    expect(decoded.exp - decoded.iat).toBe(28800);
  });

  it('verifyToken throws on a tampered token', () => {
    const token = issueToken(payload);
    const tampered = token.slice(0, -4) + 'XXXX';
    expect(() => verifyToken(tampered)).toThrow();
  });

  it('verifyToken throws on an expired token', () => {
    const jwt = require('jsonwebtoken');
    // Sign with -1s expiry so the token is immediately expired.
    const expired = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: -1 });
    expect(() => verifyToken(expired)).toThrow();
  });

  it('verifyToken throws on a token signed with a different secret', () => {
    const jwt = require('jsonwebtoken');
    const wrongSecret = jwt.sign(payload, 'wrong-secret');
    expect(() => verifyToken(wrongSecret)).toThrow();
  });
});
