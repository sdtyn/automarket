const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { Branches } = cds.entities('automarket');

  // createBranch: inserts a new branch record with ACTIVE status.
  // Code uniqueness is enforced by the DB constraint (@assert.unique on the entity)
  // so CAP will reject duplicates before the INSERT reaches the database.
  srv.on('createBranch', async (req) => {
    const { code, name, address, city, country, region } = req.data;
    const id = cds.utils.uuid();
    await INSERT.into(Branches).entries({
      ID: id,
      code,
      name,
      address,
      city,
      country,
      region,
      status: 'ACTIVE',
    });
    return id;
  });

  // updateBranch: updates mutable display and address fields only.
  // Code is excluded from the update payload — it is immutable after creation.
  srv.on('updateBranch', async (req) => {
    const { branchId, name, address, city, country, region } = req.data;
    const branch = await SELECT.one.from(Branches).where({ ID: branchId });
    if (!branch) return req.error(404, 'Branch not found');
    await UPDATE(Branches).set({ name, address, city, country, region }).where({ ID: branchId });
    return true;
  });

  // deactivateBranch: sets status to INACTIVE — a soft delete.
  // This does not cascade to the branch's vehicles; vehicle visibility
  // is governed by VehicleStatus, not BranchStatus.
  srv.on('deactivateBranch', async (req) => {
    const { branchId } = req.data;
    const branch = await SELECT.one.from(Branches).where({ ID: branchId });
    if (!branch) return req.error(404, 'Branch not found');
    await UPDATE(Branches).set({ status: 'INACTIVE' }).where({ ID: branchId });
    return true;
  });
});
