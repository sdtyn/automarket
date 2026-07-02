'use strict';

const cds = require('@sap/cds');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// USER_CRITICALITY / BRANCH_CRITICALITY map status enums to
// com.sap.vocabularies.UI.v1.CriticalityType codes (Neutral=0, Negative=1,
// Critical=2, Positive=3) for the Fiori status badge (EPIC19-T5). LOCKED is a
// temporary, self-expiring state (see identity.cds) — Critical rather than
// Negative, since it needs an operator's attention but isn't a dead end.
const USER_CRITICALITY = { ACTIVE: 3, LOCKED: 2, INACTIVE: 1 };
const BRANCH_CRITICALITY = { ACTIVE: 3, INACTIVE: 1 };

module.exports = cds.service.impl(async function (srv) {
  const { Users, Roles, UserRoles, Branches } = cds.entities('automarket');

  // Populates the virtual statusCriticality field (declared in admin-service.cds)
  // on every Users/Branches row returned by READ.
  srv.after('READ', 'Users', (rows) => {
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      if (row) row.statusCriticality = USER_CRITICALITY[row.status] ?? 0;
    }
  });
  srv.after('READ', 'Branches', (rows) => {
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      if (row) row.statusCriticality = BRANCH_CRITICALITY[row.status] ?? 0;
    }
  });

  // createBranch: inserts a new ACTIVE branch.
  srv.on('createBranch', async (req) => {
    const { code, name, address, city, country, region } = req.data;
    if (!code || !name) return req.error(400, 'code and name are required');

    const existing = await SELECT.one.from(Branches).where({ code });
    if (existing) return req.error(409, `Branch code "${code}" is already in use`);

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

  // updateBranch: applies partial updates — only provided fields are changed.
  srv.on('updateBranch', async (req) => {
    const { branchId, name, address, city, country, region } = req.data;

    const branch = await SELECT.one.from(Branches).where({ ID: branchId });
    if (!branch) return req.error(404, 'Branch not found');

    const updates = {};
    if (name) updates.name = name;
    if (address) updates.address = address;
    if (city) updates.city = city;
    if (country) updates.country = country;
    if (region) updates.region = region;
    if (Object.keys(updates).length === 0) return req.error(400, 'No fields to update');

    await UPDATE(Branches).set(updates).where({ ID: branchId });
    return true;
  });

  // disableBranch: sets status to INACTIVE — soft delete, not data removal.
  srv.on('disableBranch', async (req) => {
    const { branchId } = req.data;

    const branch = await SELECT.one.from(Branches).where({ ID: branchId });
    if (!branch) return req.error(404, 'Branch not found');
    if (branch.status === 'INACTIVE') return req.error(409, 'Branch is already inactive');

    await UPDATE(Branches).set({ status: 'INACTIVE' }).where({ ID: branchId });
    return true;
  });

  // createUser: creates an account with a bcrypt-hashed temporary password.
  // The temp password is a cryptographically random string — in production
  // a reset-email flow replaces it before the user ever logs in.
  srv.on('createUser', async (req) => {
    const { email, firstName, lastName, phoneNumber, roleCode } = req.data;
    if (!email || !roleCode) return req.error(400, 'email and roleCode are required');

    const existing = await SELECT.one.from(Users).where({ email });
    if (existing) return req.error(409, `User with email "${email}" already exists`);

    const role = await SELECT.one.from(Roles).where({ code: roleCode });
    if (!role) return req.error(404, `Role "${roleCode}" not found`);

    // Generate a random temp password — never returned to the caller.
    const tempPassword = crypto.randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const id = cds.utils.uuid();
    await INSERT.into(Users).entries({
      ID: id,
      email,
      firstName,
      lastName,
      phoneNumber,
      passwordHash,
      status: 'ACTIVE',
      mfaRequired: ['Operator', 'Manager', 'Admin'].includes(roleCode),
      failedLoginCount: 0,
    });

    await INSERT.into(UserRoles).entries({ user_ID: id, role_ID: role.ID });
    return id;
  });

  // disableUser: sets status to INACTIVE — permanent admin-initiated disable,
  // distinct from LOCKED which is temporary and time-based.
  srv.on('disableUser', async (req) => {
    const { userId } = req.data;

    const user = await SELECT.one.from(Users).where({ ID: userId });
    if (!user) return req.error(404, 'User not found');
    if (user.status === 'INACTIVE') return req.error(409, 'User is already inactive');

    await UPDATE(Users).set({ status: 'INACTIVE' }).where({ ID: userId });
    return true;
  });

  // assignRole: idempotent — skips insert if the user already holds this role.
  srv.on('assignRole', async (req) => {
    const { userId, roleCode } = req.data;

    const user = await SELECT.one.from(Users).where({ ID: userId });
    if (!user) return req.error(404, 'User not found');

    const role = await SELECT.one.from(Roles).where({ code: roleCode });
    if (!role) return req.error(404, `Role "${roleCode}" not found`);

    const existing = await SELECT.one.from(UserRoles).where({ user_ID: userId, role_ID: role.ID });
    if (existing) return true; // idempotent — already assigned

    await INSERT.into(UserRoles).entries({ user_ID: userId, role_ID: role.ID });
    return true;
  });
});
