'use strict';

const {
  issueGuestToken,
  verifyGuestToken,
} = require('../../../modules/reservation/infrastructure/guest-token');

describe('issueGuestToken() / verifyGuestToken()', () => {
  const reservationId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  it('issues a token that verifyGuestToken accepts', () => {
    const token = issueGuestToken(reservationId);
    const payload = verifyGuestToken(token);
    expect(payload.reservationId).toBe(reservationId);
    expect(payload.type).toBe('guest-reservation');
  });

  it('token carries an expiry claim', () => {
    const token = issueGuestToken(reservationId);
    const payload = verifyGuestToken(token);
    expect(payload.exp).toBeDefined();
    // 48h = 172800s
    expect(payload.exp - payload.iat).toBe(172800);
  });

  it('verifyGuestToken throws on a tampered token', () => {
    const token = issueGuestToken(reservationId);
    const tampered = token.slice(0, -4) + 'XXXX';
    expect(() => verifyGuestToken(tampered)).toThrow();
  });

  it('verifyGuestToken throws on an expired token', () => {
    const jwt = require('jsonwebtoken');
    const secret = process.env.GUEST_TOKEN_SECRET || 'guest-token-dev-secret-CHANGE-IN-PROD';
    const expired = jwt.sign({ reservationId, type: 'guest-reservation' }, secret, {
      expiresIn: -1,
    });
    expect(() => verifyGuestToken(expired)).toThrow();
  });
});
