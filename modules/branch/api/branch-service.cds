using {automarket} from '../db/branch';

// BranchService is scoped to /branch. All write operations are restricted to
// Admin and Manager — Operators are branch members, not branch administrators.
// deactivate is a dedicated action instead of a generic CRUD update so the
// intent is explicit and the handler can enforce the "no active vehicles" guard later.
service BranchService @(path: '/branch') {

    // READ is open to any authenticated user — branch lists are needed
    // in Vehicle forms for Operators and Managers alike.
    @requires: 'authenticated-user'
    entity Branches as projection on automarket.Branches;

    // createBranch: inserts a new branch. Code uniqueness is enforced by the
    // @assert.unique annotation on the entity; no duplicate check needed here.
    @requires: 'Admin'
    action                               createBranch(code: String,
                                                      name: String,
                                                      address: String,
                                                      city: String,
                                                      country: String,
                                                      region: String)       returns String;

    // updateBranch: allows Admin or Manager to edit display/address fields.
    // Code is immutable after creation — changing it would break all foreign
    // key references stored as strings in external logs and reports.
    @requires: ['Admin', 'Manager']
    action updateBranch(branchId: String,
                                                      name: String,
                                                      address: String,
                                                      city: String,
                                                      country: String,
                                                      region: String)       returns Boolean;

    // deactivateBranch: soft-deletes by setting status to INACTIVE.
    // Hard delete is intentionally not supported — branches have historical
    // vehicle and transaction records that must remain readable.
    @requires: 'Admin'
    action                               deactivateBranch(branchId: String) returns Boolean;
}
