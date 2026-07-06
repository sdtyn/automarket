using {automarket} from '../db/vehicle';
using {automarket as automarketReservation} from '../../reservation/db/reservation';
using from '../../test-drive/db/test-drive';
using from '../../offer/db/offer';

// OperatorPortalService is the branch-scoped read/create surface for internal
// staff. Operators are restricted to their own branch via the @restrict where
// clause — CAP injects it as a SQL predicate, so Operators cannot enumerate
// vehicles from other branches even by guessing IDs.
// Managers see all branches and may create vehicles for any branch.
@impl: 'modules/vehicle/application/operator-portal.js'
service OperatorPortalService @(path: '/operator') {

    // Operator READ is filtered to branch_ID = req.user.attr.branchId at the
    // query level. Manager READ is unrestricted. No WRITE on the projection —
    // creation goes through the explicit createVehicle action so status and
    // branch enforcement cannot be bypassed.
    // images is included (unlike CustomerPortalService's list-performance
    // exclusion — see customer-portal.cds) so the @UI.Facets image gallery on
    // the Object Page (EPIC19-T2, operator-portal-ui.cds) has a composition to
    // navigate to. This entity set is opened one record at a time in the
    // Fiori app, not listed in bulk with images inlined, so the cost is fine.
    // CREATE is granted unconditionally (no `where`, unlike READ) — branch/status
    // enforcement moved from the old unbound createVehicle action into a native
    // srv.before('CREATE', 'Vehicles', ...) handler (operator-portal.js), which
    // overwrites req.data.branch_ID/status regardless of what the client sends.
    // This is what gives the Fiori List Report a real native "Create" toolbar
    // button and full-field create form (EPIC20-T4) — the old unbound action
    // could never be wired to one (see docs/implementations/EPIC19-fiori-elements-ui.md, T3).
    @restrict: [
        {
            grant: 'READ',
            to   : 'Operator',
            where: 'branch_ID = $user.branchId'
        },
        {
            grant: 'READ',
            to   : 'Manager'
        },
        {
            grant: 'CREATE',
            to   : [
                'Operator',
                'Manager'
            ]
        }
    ]
    // statusCriticality is a read-only calculated field (populated in
    // operator-portal.js, srv.after('READ')) — not persisted. It maps
    // VehicleStatus to an OData UI.CriticalityType so the Fiori status badge
    // (EPIC19-T3, operator-portal-ui.cds) can color-code rows without the
    // client needing its own copy of the status→color mapping.
    entity Vehicles     as
        projection on automarket.Vehicles {
            *,
            virtual null as statusCriticality : Integer
        };

    // Reservations: Operators see only their branch's reservations via the
    // $user.branchId attribute. Managers see all branches. approve/reject are
    // bound actions (EPIC20-T4) — the branch guard moved into the handler
    // (operator-portal.js), same logic as before, just reading req.params
    // instead of a reservationId parameter.
    @restrict: [
        {
            grant: 'READ',
            to   : 'Operator',
            where: 'branch_ID = $user.branchId'
        },
        {
            grant: 'READ',
            to   : 'Manager'
        },
        {
            grant: [
                'approve',
                'reject'
            ],
            to   : [
                'Operator',
                'Manager'
            ]
        }
    ]
    entity Reservations as projection on automarket.Reservations
        actions {
            @requires: [
                'Operator',
                'Manager'
            ]
            action approve()             returns Boolean;

            @requires: [
                'Operator',
                'Manager'
            ]
            action reject(notes: String) returns Boolean;
        };

    // TestDrives: branch-scoped read for Operators; Managers see all branches.
    // approve/cancel/complete are bound actions (EPIC20-T4), same branch-guard
    // logic as before, moved from unbound-action parameters to req.params.
    @restrict: [
        {
            grant: 'READ',
            to   : 'Operator',
            where: 'branch_ID = $user.branchId'
        },
        {
            grant: 'READ',
            to   : 'Manager'
        },
        {
            grant: [
                'approve',
                'cancel',
                'complete'
            ],
            to   : [
                'Operator',
                'Manager'
            ]
        }
    ]
    entity TestDrives   as projection on automarket.TestDrives
        actions {
            @requires: [
                'Operator',
                'Manager'
            ]
            action approve(durationMinutes: Integer) returns Boolean;

            @requires: [
                'Operator',
                'Manager'
            ]
            action cancel()                          returns Boolean;

            @requires: [
                'Operator',
                'Manager'
            ]
            action complete()                        returns Boolean;
        };

    // Offers: branch-scoped read for Managers and Admins only. approve/reject
    // are bound actions (EPIC20-T5) — same branch-guard logic as before,
    // moved from unbound-action parameters to req.params (same conversion as
    // Reservations/TestDrives in EPIC20-T4).
    @restrict: [
        {
            grant: 'READ',
            to   : 'Manager',
            where: 'branch_ID = $user.branchId'
        },
        {
            grant: 'READ',
            to   : 'Admin'
        },
        {
            grant: [
                'approve',
                'reject'
            ],
            to   : [
                'Manager',
                'Admin'
            ]
        }
    ]
    entity Offers       as projection on automarket.Offers
        actions {
            @requires: [
                'Manager',
                'Admin'
            ]
            action approve()                      returns Boolean;

            @requires: [
                'Manager',
                'Admin'
            ]
            action reject(rejectionNotes: String) returns Boolean;
        };
}
