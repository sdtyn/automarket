namespace automarket;

using {
  BaseEntity,
  Email,
  PhoneNumber
} from '../../../shared/types/common';

entity Users : BaseEntity {
  email            : Email;
  passwordHash     : String(255);
  firstName        : String(100);
  lastName         : String(100);
  phoneNumber      : PhoneNumber;
  status           : UserStatus;
  mfaRequired      : Boolean default false; // true for Operator/Manager/Admin
  failedLoginCount : Integer default 0;
  lockedUntil      : Timestamp;
}

entity Roles : BaseEntity {
  code        : String(50);
  description : String(255);
}

entity UserRoles : BaseEntity {
  user : Association to Users;
  role : Association to Roles;
}

type UserStatus : String enum {
  ACTIVE;
  INACTIVE;
  LOCKED; // set after 5 failed attempts in 15 min; 30-min time-based unlock
};
