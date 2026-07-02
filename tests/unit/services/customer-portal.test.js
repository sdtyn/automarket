'use strict';

const path = require('path');
const cds = require('@sap/cds');

const ROOT = path.join(__dirname, '../../..');

// EPIC19-T4: primaryImageUrl is a virtual field (customer-portal.cds) populated
// by a single batched srv.after('READ') query (customer-portal.js) — the first
// VehicleImages row by sortOrder, or null. Every seeded vehicle already has
// exactly one image (sortOrder 0), so the ordering and "no images" cases are
// exercised here by mutating fixture data directly, not just the seeded happy path.
const VEHICLE_MULTI_IMAGE = '40000000-4000-4000-4000-400000000010';
const VEHICLE_NO_IMAGE = '40000000-4000-4000-4000-400000000011';

describe('CustomerPortalService — primaryImageUrl (EPIC19-T4)', () => {
  jest.setTimeout(60000);

  const { GET } = cds.test(ROOT).silent();

  it('returns the first image by sortOrder when a vehicle has multiple images', async () => {
    const { VehicleImages } = cds.entities('automarket');
    await INSERT.into(VehicleImages).entries({
      ID: cds.utils.uuid(),
      vehicle_ID: VEHICLE_MULTI_IMAGE,
      url: 'https://example.com/second.jpg',
      sortOrder: 5,
    });

    const res = await GET(
      `/catalog/Vehicles?$filter=ID eq ${VEHICLE_MULTI_IMAGE}&$select=primaryImageUrl`
    );
    const [row] = res.data.value ?? res.data;
    // Seeded sortOrder 0 image must win over the newly inserted sortOrder 5 one.
    expect(row.primaryImageUrl).toContain('Volkswagen_Golf_VIII_Facelift');
  });

  it('returns null when a vehicle has no images', async () => {
    const { VehicleImages } = cds.entities('automarket');
    await DELETE.from(VehicleImages).where({ vehicle_ID: VEHICLE_NO_IMAGE });

    const res = await GET(
      `/catalog/Vehicles?$filter=ID eq ${VEHICLE_NO_IMAGE}&$select=primaryImageUrl`
    );
    const [row] = res.data.value ?? res.data;
    expect(row.primaryImageUrl).toBeNull();
  });

  it('does not inline the images composition into a plain list query', async () => {
    const res = await GET('/catalog/Vehicles?$top=1');
    const [row] = res.data.value ?? res.data;
    expect(row.images).toBeUndefined();
  });
});
