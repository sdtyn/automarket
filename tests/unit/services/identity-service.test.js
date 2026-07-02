'use strict';

// Must be set before cds loads so jwt.js does not throw on require.
process.env.JWT_SECRET = 'test-secret-for-integration';

const path = require('path');
const cds = require('@sap/cds');
const { MAX_FAILURES } = require('../../../modules/identity/domain/lockout');

const ROOT = path.join(__dirname, '../../..');

describe('IdentityService — integration', () => {
  // CAP server startup takes time.
  jest.setTimeout(60000);

  // cds.test() registers beforeAll/afterAll to start/stop an in-process CAP server
  // with in-memory SQLite. CSV files in db/data/ are auto-loaded as seed data.
  const { POST, GET } = cds.test(ROOT).silent();

  // ── Login — happy path ─────────────────────────────────────────────────────

  describe('login — happy path', () => {
    it('returns token, userId, role and mfaPending for a Customer', async () => {
      const res = await POST('/identity/login', {
        email: 'customer.bauer@automarkt.de',
        password: 'Test@1234',
      });
      expect(res.status).toBe(200);
      const body = res.data.value ?? res.data;
      expect(body.token).toBeDefined();
      expect(body.userId).toBe('ccc00000-0000-0000-0000-000000000004');
      expect(body.role).toBe('Customer');
      expect(body.mfaPending).toBe(false);
    });

    it('sets mfaPending: true for Admin role', async () => {
      const res = await POST('/identity/login', {
        email: 'admin.mueller@automarkt.de',
        password: 'Test@1234',
      });
      const body = res.data.value ?? res.data;
      expect(body.role).toBe('Admin');
      expect(body.mfaPending).toBe(true);
    });

    it('sets mfaPending: true for Manager role', async () => {
      const res = await POST('/identity/login', {
        email: 'manager.schmidt@automarkt.de',
        password: 'Test@1234',
      });
      const body = res.data.value ?? res.data;
      expect(body.role).toBe('Manager');
      expect(body.mfaPending).toBe(true);
    });

    it('resets failedLoginCount to 0 on successful login', async () => {
      const { Users } = cds.entities('automarket');
      // Simulate a prior failure count so we can verify it resets.
      await UPDATE(Users)
        .set({ failedLoginCount: 3 })
        .where({ ID: 'ccc00000-0000-0000-0000-000000000004' });

      await POST('/identity/login', {
        email: 'customer.bauer@automarkt.de',
        password: 'Test@1234',
      });

      const user = await SELECT.one
        .from(Users)
        .where({ ID: 'ccc00000-0000-0000-0000-000000000004' });
      expect(user.failedLoginCount).toBe(0);
    });
  });

  // ── Login — error cases ────────────────────────────────────────────────────

  describe('login — error cases', () => {
    it('returns 401 for wrong password', async () => {
      const err = await POST('/identity/login', {
        email: 'customer.bauer@automarkt.de',
        password: 'WrongPassword!',
      }).catch((e) => e);
      expect(err.status).toBe(401);
    });

    it('returns 401 for non-existent email (same code as wrong password — no user enumeration)', async () => {
      const err = await POST('/identity/login', {
        email: 'nobody@example.com',
        password: 'any',
      }).catch((e) => e);
      // 401 — not 404 — so attackers cannot enumerate valid email addresses
      expect(err.status).toBe(401);
    });

    it('returns 403 for a disabled (INACTIVE) account', async () => {
      const { Users } = cds.entities('automarket');
      await UPDATE(Users)
        .set({ status: 'INACTIVE' })
        .where({ ID: 'ccc00000-0000-0000-0000-000000000005' });

      const err = await POST('/identity/login', {
        email: 'customer.hoffmann@automarkt.de',
        password: 'Test@1234',
      }).catch((e) => e);
      expect(err.status).toBe(403);

      // Restore for isolation.
      await UPDATE(Users)
        .set({ status: 'ACTIVE', failedLoginCount: 0, firstFailedAt: null })
        .where({ ID: 'ccc00000-0000-0000-0000-000000000005' });
    });
  });

  // ── Lockout flow ───────────────────────────────────────────────────────────
  // shouldLock() accumulation logic is unit-tested in lockout.test.js.
  // These integration tests verify that the handler correctly reads the LOCKED
  // status and returns 423 — the handler behaviour, not the accumulation math.

  describe('lockout flow', () => {
    const LOCKED_USER_ID = 'ccc00000-0000-0000-0000-000000000005'; // customer.hoffmann
    const LOCKED_EMAIL = 'customer.hoffmann@automarkt.de';

    beforeEach(async () => {
      // Lock the account directly — decouples the 423 test from accumulation.
      const { Users } = cds.entities('automarket');
      await UPDATE(Users)
        .set({
          status: 'LOCKED',
          lockedUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          failedLoginCount: MAX_FAILURES,
        })
        .where({ ID: LOCKED_USER_ID });
    });

    afterEach(async () => {
      const { Users } = cds.entities('automarket');
      await UPDATE(Users)
        .set({ status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null, firstFailedAt: null })
        .where({ ID: LOCKED_USER_ID });
    });

    it('returns 423 for a locked account regardless of password', async () => {
      const err = await POST('/identity/login', {
        email: LOCKED_EMAIL,
        password: 'wrong',
      }).catch((e) => e);
      expect(err.status).toBe(423);
    });

    it('rejects the correct password while account is locked (lockout cannot be bypassed)', async () => {
      const err = await POST('/identity/login', {
        email: LOCKED_EMAIL,
        password: 'Test@1234',
      }).catch((e) => e);
      expect(err.status).toBe(423);
    });
  });

  // ── Admin-only: listUsers ──────────────────────────────────────────────────

  describe('listUsers — Admin only', () => {
    it('returns all users for Admin', async () => {
      const res = await GET('/identity/listUsers()', {
        auth: { username: 'admin.mueller@automarkt.de', password: 'Test@1234' },
      });
      expect(res.status).toBe(200);
      const users = res.data.value ?? res.data;
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThan(0);
    });

    it('rejects a Customer with 403', async () => {
      const err = await GET('/identity/listUsers()', {
        auth: { username: 'customer.bauer@automarkt.de', password: 'Test@1234' },
      }).catch((e) => e);
      expect(err.status).toBe(403);
    });
  });
});
