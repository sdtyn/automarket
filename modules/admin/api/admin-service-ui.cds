using {AdminService} from './admin-service';

// UI annotations for AdminService.Users / .Branches (EPIC19-T5). Kept in a
// separate file from the service definition, same pattern as
// operator-portal-ui.cds / customer-portal-ui.cds.
//
// Note on action buttons: disableUser, assignRole, and disableBranch are all
// *unbound* OData actions (service-level, not bound to the Users/Branches
// entity types — same shape as OperatorPortalService.createVehicle, see
// operator-portal-ui.cds). @UI.DataFieldForAction only targets actions bound
// to an entity type, so none of the three can be wired onto a List Report row
// or Object Page header this way. Wiring them in would need a manifest.json
// custom-action entry that cannot be verified without a real browser session
// — same call as EPIC19-T3, left as a follow-up rather than shipped
// unverified. Both Object Pages below are view-only; the three actions remain
// reachable via their OData endpoints directly (see tests/http/admin.http).
annotate AdminService.Users with @(
    UI.LineItem                : [
        {Value: email},
        {Value: firstName},
        {Value: lastName},
        {Value: status, Criticality: statusCriticality},
        {Value: mfaRequired, Label: 'MFA Required'}
    ],
    UI.FieldGroup #UserDetails : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {Value: email},
            {Value: firstName},
            {Value: lastName},
            {Value: phoneNumber},
            {Value: status},
            {Value: mfaRequired, Label: 'MFA Required'},
            {Value: failedLoginCount, Label: 'Failed Logins'},
            {Value: lockedUntil, Label: 'Locked Until'}
        ]
    },
    UI.Facets                  : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'User Details',
            Target: '@UI.FieldGroup#UserDetails'
        }
    ]
);

annotate AdminService.Branches with @(
    UI.LineItem                  : [
        {Value: code},
        {Value: name},
        {Value: city},
        {Value: region},
        {Value: status, Criticality: statusCriticality}
    ],
    UI.FieldGroup #BranchDetails : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {Value: code},
            {Value: name},
            {Value: address},
            {Value: city},
            {Value: country},
            {Value: region},
            {Value: status}
        ]
    },
    UI.Facets                    : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Branch Details',
            Target: '@UI.FieldGroup#BranchDetails'
        }
    ]
);
