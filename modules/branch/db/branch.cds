namespace automarket;

using {BaseEntity} from '../../../shared/types/common';

// Branches is the organizational unit that scopes all ABAC checks. Every
// Vehicle, Operator, and Manager belongs to exactly one Branch; Customer does not.
// This coupling is by design (AD-3/AD-38) — branch ownership is not a label,
// it is the access boundary.
entity Branches : BaseEntity {
    // code is the short identifier used in UI selectors and URL segments.
    // Must be unique across all branches — enforced by the unique constraint below.
    code    : String(20) @assert.unique;
    name    : String(100);
    address : String(255);
    city    : String(100);
    country : String(100);
    // region groups branches for Manager-level reporting; not an access boundary itself.
    region  : String(100);
    status  : BranchStatus default 'ACTIVE';
}

// BranchStatus intentionally has only two values. Deactivation is a soft delete:
// a INACTIVE branch's vehicles stay readable for history but no new operations are allowed.
type BranchStatus : String enum {
    ACTIVE;
    INACTIVE;
};
