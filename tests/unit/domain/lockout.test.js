'use strict';

const {
  shouldLock,
  lockoutUntil,
  MAX_FAILURES,
  WINDOW_MS,
  LOCKOUT_MS,
} = require('../../../modules/identity/domain/lockout');

describe('shouldLock()', () => {
  it('does not lock before reaching the failure threshold', () => {
    expect(shouldLock(MAX_FAILURES - 2, null)).toBe(false);
  });

  it('locks exactly at the threshold with no firstFailedAt (first session)', () => {
    // When firstFailedAt is null, only the count matters.
    expect(shouldLock(MAX_FAILURES - 1, null)).toBe(true);
  });

  it('locks when threshold is reached within the rolling window', () => {
    const recentFailure = new Date(Date.now() - WINDOW_MS + 5000).toISOString();
    expect(shouldLock(MAX_FAILURES - 1, recentFailure)).toBe(true);
  });

  it('does not lock when threshold is reached but window has expired', () => {
    // First failure happened longer ago than WINDOW_MS — slate is considered clean.
    const oldFailure = new Date(Date.now() - WINDOW_MS - 1000).toISOString();
    expect(shouldLock(MAX_FAILURES - 1, oldFailure)).toBe(false);
  });

  it('does not lock when count is below threshold even within window', () => {
    const recentFailure = new Date(Date.now() - 1000).toISOString();
    expect(shouldLock(1, recentFailure)).toBe(false);
  });
});

describe('lockoutUntil()', () => {
  it('returns a timestamp approximately LOCKOUT_MS in the future', () => {
    const before = Date.now();
    const until = lockoutUntil();
    const after = Date.now();
    const ts = new Date(until).getTime();
    expect(ts).toBeGreaterThanOrEqual(before + LOCKOUT_MS);
    expect(ts).toBeLessThanOrEqual(after + LOCKOUT_MS);
  });

  it('returns a Date object', () => {
    expect(lockoutUntil()).toBeInstanceOf(Date);
  });
});
