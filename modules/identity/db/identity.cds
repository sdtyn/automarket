namespace automarket;

using {
  BaseEntity,
  Email,
  PhoneNumber
} from '../../../shared/types/common';

// Users holds identity data only — no business domain data lives here.
// Profile fields (firstName, lastName, phoneNumber) are kept minimal; extending
// them later does not require touching any domain entity.
entity Users : BaseEntity {
  email            : Email;
  // We store the Bcrypt hash, never the plaintext password. The hash field is
  // String(255) because a Bcrypt hash is always 60 chars; the extra headroom
  // allows swapping to a longer algorithm (e.g. Argon2) without a migration.
  passwordHash     : String(255);
  firstName        : String(100);
  lastName         : String(100);
  phoneNumber      : PhoneNumber;
  status           : UserStatus;
  // mfaRequired is set to true at account creation for Operator/Manager/Admin.
  // It is stored here (not derived at runtime) so a role change automatically
  // cascades to the MFA requirement without a separate migration step.
  mfaRequired      : Boolean default false;
  // failedLoginCount and lockedUntil work together: after 5 consecutive failures
  // within 15 min, status flips to LOCKED and lockedUntil is set 30 min ahead.
  // The lock is time-based — no background job needed to unlock; the login
  // handler simply checks whether lockedUntil has passed.
  failedLoginCount : Integer default 0;
  // Marks the start of the current failure window. Used together with
  // failedLoginCount to enforce the 15-minute rolling window lockout policy —
  // failures older than 15 minutes do not count toward the threshold.
  firstFailedAt    : Timestamp;
  lockedUntil      : Timestamp;
}

// Roles is a reference table, not an enum, so new roles can be added at runtime
// by an Admin without a code deployment.
entity Roles : BaseEntity {
  code        : String(50);
  description : String(255);
}

// UserRoles is a separate join entity (not a single role field on Users) so a
// user can hold multiple roles in future without a schema migration. For now the
// login handler reads the first role found; multi-role support is additive later.
entity UserRoles : BaseEntity {
  user : Association to Users;
  role : Association to Roles;
}

type UserStatus : String enum {
  ACTIVE;
  INACTIVE;
  // LOCKED is a temporary status — it expires automatically when lockedUntil
  // passes. INACTIVE is permanent until an Admin explicitly re-enables the account.
  LOCKED;
};
