'use strict';

const path = require('path');
const cds = require('@sap/cds');

const ROOT = path.join(__dirname, '../../..');

// EPIC19-T5: statusCriticality is a virtual, read-only field on both
// AdminService.Users and .Branches, populated by srv.after('READ') handlers
// (admin-service.js) mapping UserStatus/BranchStatus to a
// com.sap.vocabularies.UI.v1.CriticalityType code for the Fiori status badge.
const adminAuth = { username: 'admin.mueller@automarkt.de', password: 'Test@1234' };

describe('AdminService — statusCriticality (EPIC19-T5)', () => {
  jest.setTimeout(60000);

  const { GET } = cds.test(ROOT).silent();

  it('maps every UserStatus enum value to a defined criticality code', async () => {
    const { Users } = cds.entities('automarket');
    const expected = { ACTIVE: 3, LOCKED: 2, INACTIVE: 1 };
    const userId = 'ccc00000-0000-0000-0000-000000000004'; // customer.bauer

    for (const [status, criticality] of Object.entries(expected)) {
      await UPDATE(Users).set({ status }).where({ ID: userId });
      const res = await GET(
        `/admin/Users?$filter=ID eq ${userId}&$select=status,statusCriticality`,
        {
          auth: adminAuth,
        }
      );
      const [row] = res.data.value ?? res.data;
      expect(row.statusCriticality).toBe(criticality);
    }

    // Restore for isolation.
    await UPDATE(Users).set({ status: 'ACTIVE' }).where({ ID: userId });
  });

  it('maps every BranchStatus enum value to a defined criticality code', async () => {
    const { Branches } = cds.entities('automarket');
    const expected = { ACTIVE: 3, INACTIVE: 1 };
    const branchId = 'aaa00000-0000-0000-0000-000000000001'; // München

    for (const [status, criticality] of Object.entries(expected)) {
      await UPDATE(Branches).set({ status }).where({ ID: branchId });
      const res = await GET(
        `/admin/Branches?$filter=ID eq ${branchId}&$select=status,statusCriticality`,
        { auth: adminAuth }
      );
      const [row] = res.data.value ?? res.data;
      expect(row.statusCriticality).toBe(criticality);
    }

    // Restore for isolation.
    await UPDATE(Branches).set({ status: 'ACTIVE' }).where({ ID: branchId });
  });

  it('never exposes passwordHash', async () => {
    const res = await GET('/admin/Users?$top=1', { auth: adminAuth });
    const [row] = res.data.value ?? res.data;
    expect(row.passwordHash).toBeUndefined();
  });
});
