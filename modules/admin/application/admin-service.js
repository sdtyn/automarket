'use strict';

const cds = require('@sap/cds');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

module.exports = cds.service.impl(async function (srv) {
  const { Users, Roles, UserRoles, Branches } = cds.entities('automarket');

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
