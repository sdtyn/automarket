'use strict';

const path = require('path');
const cds = require('@sap/cds');

const ROOT = path.join(__dirname, '../../..');

// EPIC19-T3: statusCriticality is a virtual, read-only field (operator-portal.cds)
// populated by a srv.after('READ') handler (operator-portal.js) that maps
// VehicleStatus to a com.sap.vocabularies.UI.v1.CriticalityType code, driving the
// Fiori status badge color. This is the only new JS logic in EPIC19-T3 — the rest
// of the ticket is CDS/UI annotations, already verified against a live server.
const managerAuth = { username: 'manager.schmidt@automarkt.de', password: 'Test@1234' };

describe('OperatorPortalService — statusCriticality (EPIC19-T3)', () => {
  jest.setTimeout(60000);

  const { GET } = cds.test(ROOT).silent();

  it('maps FOR_SALE to Positive (3)', async () => {
    const res = await GET(
      '/operator/Vehicles?$filter=ID eq 40000000-4000-4000-4000-400000000001&$select=status,statusCriticality',
      { auth: managerAuth }
    );
    const [row] = res.data.value ?? res.data;
    expect(row.status).toBe('FOR_SALE');
    expect(row.statusCriticality).toBe(3);
  });

  it('maps every VehicleStatus enum value to a defined criticality code', async () => {
    const { Vehicles } = cds.entities('automarket');
    const statuses = [
      'DRAFT',
      'FOR_SALE',
      'RESERVED',
      'PENDING_PAYMENT',
      'SOLD',
      'DELIVERED',
      'ARCHIVED',
    ];
    const expected = {
      DRAFT: 0,
      FOR_SALE: 3,
      RESERVED: 2,
      PENDING_PAYMENT: 2,
      SOLD: 3,
      DELIVERED: 3,
      ARCHIVED: 1,
    };

    for (const status of statuses) {
      await UPDATE(Vehicles).set({ status }).where({ ID: '40000000-4000-4000-4000-400000000002' });
      const res = await GET(
        '/operator/Vehicles?$filter=ID eq 40000000-4000-4000-4000-400000000002&$select=status,statusCriticality',
        { auth: managerAuth }
      );
      const [row] = res.data.value ?? res.data;
      expect(row.statusCriticality).toBe(expected[status]);
    }
  });
});
