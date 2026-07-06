using {AdminService} from './admin-service';

// UI annotations for AdminService.Users / .Branches / .AuditLogs (EPIC19-T5/T6).
// Kept in a separate file from the service definition, same pattern as
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
    UI.LineItem               : [
        {Value: email},
        {Value: firstName},
        {Value: lastName},
        {
            Value      : status,
            Criticality: statusCriticality
        },
        {
            Value: mfaRequired,
            Label: 'MFA Required'
        }
    ],
    UI.FieldGroup #UserDetails: {
        $Type: 'UI.FieldGroupType',
        Data : [
            {Value: email},
            {Value: firstName},
            {Value: lastName},
            {Value: phoneNumber},
            {Value: status},
            {
                Value: mfaRequired,
                Label: 'MFA Required'
            },
            {
                Value: failedLoginCount,
                Label: 'Failed Logins'
            },
            {
                Value: lockedUntil,
                Label: 'Locked Until'
            }
        ]
    },
    UI.Facets                 : [{
        $Type : 'UI.ReferenceFacet',
        Label : 'User Details',
        Target: '@UI.FieldGroup#UserDetails'
    }]
);

annotate AdminService.Branches with @(
    UI.LineItem                 : [
        {Value: code},
        {Value: name},
        {Value: city},
        {Value: region},
        {
            Value      : status,
            Criticality: statusCriticality
        }
    ],
    UI.FieldGroup #BranchDetails: {
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
    UI.Facets                   : [{
        $Type : 'UI.ReferenceFacet',
        Label : 'Branch Details',
        Target: '@UI.FieldGroup#BranchDetails'
    }]
);

// AuditLogs (EPIC19-T6): read-only (@readonly and no WRITE grant already on
// the entity in admin-service.cds — nothing to restrict at the UI layer).
// Default sort newest-first via UI.PresentationVariant, since an audit trail
// is read chronologically backwards by default. entityType/userId/createdAt
// in SelectionFields gives the filter bar entityType and userId dropdown-style
// filters plus a date-range filter on createdAt (Fiori Elements infers a range
// filter automatically for a Timestamp field in SelectionFields).
annotate AdminService.AuditLogs with @(
    UI.LineItem              : [
        {
            Value: createdAt,
            Label: 'Timestamp'
        },
        {Value: entityType},
        {Value: entityId},
        {Value: action},
        {Value: userId}
    ],
    UI.SelectionFields       : [
        entityType,
        userId,
        createdAt
    ],
    UI.PresentationVariant   : {SortOrder: [{
        Property  : createdAt,
        Descending: true
    }]},
    UI.FieldGroup #LogDetails: {
        $Type: 'UI.FieldGroupType',
        Data : [
            {
                Value: createdAt,
                Label: 'Timestamp'
            },
            {Value: entityType},
            {Value: entityId},
            {Value: action},
            {Value: userId},
            {
                Value: oldValue,
                Label: 'Old Value'
            },
            {
                Value: newValue,
                Label: 'New Value'
            }
        ]
    },
    UI.Facets                : [{
        $Type : 'UI.ReferenceFacet',
        Label : 'Log Entry',
        Target: '@UI.FieldGroup#LogDetails'
    }]
);

// "Payments" (EPIC20-T5) — fourth entity in app/admin-portal. capture/fail/
// refund are bound actions delegating to the real PaymentService (see the
// @requires comment on Payments in admin-service.cds) — read-only fields
// here, no editable form needed since these are PSP-webhook simulations,
// not manual data entry.
annotate AdminService.Payments with @(
    UI.LineItem                  : [
        {
            Value: order_ID,
            Label: 'Order'
        },
        {Value: provider},
        {Value: amount},
        {Value: currency},
        {Value: status}
    ],
    UI.FieldGroup #PaymentDetails: {
        $Type: 'UI.FieldGroupType',
        Data : [
            {
                Value: order_ID,
                Label: 'Order'
            },
            {Value: provider},
            {Value: amount},
            {Value: currency},
            {Value: status},
            {
                Value: transactionReference,
                Label: 'Transaction Reference'
            },
            {
                Value: idempotencyKey,
                Label: 'Idempotency Key'
            }
        ]
    },
    UI.Facets                    : [{
        $Type : 'UI.ReferenceFacet',
        Label : 'Payment Details',
        Target: '@UI.FieldGroup#PaymentDetails'
    }],
    UI.Identification            : [
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'AdminService.capture',
            Label : 'Capture Payment'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'AdminService.fail',
            Label : 'Fail Payment'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'AdminService.refund',
            Label : 'Refund Payment'
        }
    ]
);
