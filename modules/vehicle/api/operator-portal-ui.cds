using {OperatorPortalService} from './operator-portal';
using {automarket} from '../db/vehicle';

// UI annotations for OperatorPortalService.Vehicles (EPIC19-T2/T3). Kept in a
// separate file from the service definition (operator-portal.cds) so the API
// contract (what data is exposed, to whom) stays independent of how Fiori
// Elements renders it — a UI-only change here never touches the @restrict
// authorization logic.
//
// EPIC20-T4 update: Vehicles now has a native CREATE grant (see
// operator-portal.cds), enforced by srv.before('CREATE', 'Vehicles', ...) in
// operator-portal.js. Fiori Elements shows a "Create" toolbar button on the
// List Report automatically whenever CREATE is permitted — no annotation
// needed here. This replaces the EPIC19-T3 unbound-createVehicle-action note;
// that action is gone, the Object Page is no longer view-only.
annotate OperatorPortalService.Vehicles with @(
    // List Report columns, with a status color badge (statusCriticality is
    // populated per-row in operator-portal.js, srv.after('READ')).
    UI.LineItem               : [
        {Value: brand},
        {Value: model},
        {Value: year},
        {Value: price},
        {
            Value      : status,
            Criticality: statusCriticality
        },
        {
            Value: branch.name,
            Label: 'Branch'
        }
    ],

    // Filter bar fields on the List Report.
    UI.SelectionFields        : [
        brand,
        fuelType,
        status
    ],

    // Object Page general-info section.
    UI.FieldGroup #GeneralInfo: {
        $Type: 'UI.FieldGroupType',
        Data : [
            {Value: vin},
            {Value: plateNumber},
            {Value: brand},
            {Value: model},
            {Value: year},
            {Value: mileage},
            {Value: fuelType},
            {Value: transmission},
            {Value: color},
            {Value: price},
            {Value: currency},
            {Value: status},
            {
                Value: branch.name,
                Label: 'Branch'
            }
        ]
    },

    // Object Page facets: general info form + an inline image gallery table
    // driven by the images composition (see UI.LineItem on VehicleImages
    // below — a Facet pointing at a composition needs a LineItem defined on
    // the target type for Fiori Elements to know which columns to render).
    UI.Facets                 : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Vehicle Details',
            Target: '@UI.FieldGroup#GeneralInfo'
        },
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Images',
            Target: 'images/@UI.LineItem'
        }
    ]
);

// Minimal columns for the inline image gallery table on the Vehicles Object
// Page facet above. Annotated on the shared automarket.VehicleImages type
// (not a per-service projection) because it is not exposed as a standalone
// entity set in OperatorPortalService — it only exists here as the images
// composition's target type, reachable through Vehicles(ID)/images.
annotate automarket.VehicleImages with @(UI.LineItem: [
    {Value: url},
    {
        Value: sortOrder,
        Label: 'Order'
    }
]);

// "Offers" (EPIC20-T5) — fourth entity in app/operator-portal, visible only
// to Manager/Admin per the @restrict on Offers (operator-portal.cds) —
// Operators do not have offer approval authority. approve/reject are bound
// to Offers — a distinct overload from Reservations' own `approve`/`reject`
// above (OData resolves same-named bound actions by their bound type).
annotate OperatorPortalService.Offers with @(
    UI.LineItem                : [
        {
            Value: vehicle_ID,
            Label: 'Vehicle'
        },
        {
            Value: customer_ID,
            Label: 'Customer'
        },
        {Value: offeredPrice},
        {Value: currency},
        {Value: status},
        {Value: desiredPickupDate}
    ],
    UI.FieldGroup #OfferDetails: {
        $Type: 'UI.FieldGroupType',
        Data : [
            {
                Value: vehicle_ID,
                Label: 'Vehicle'
            },
            {
                Value: customer_ID,
                Label: 'Customer'
            },
            {Value: offeredPrice},
            {Value: currency},
            {Value: desiredPickupDate},
            {Value: status},
            {Value: rejectionNotes}
        ]
    },
    UI.Facets                  : [{
        $Type : 'UI.ReferenceFacet',
        Label : 'Offer Details',
        Target: '@UI.FieldGroup#OfferDetails'
    }],
    UI.Identification          : [
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'OperatorPortalService.approve',
            Label : 'Approve Offer'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'OperatorPortalService.reject',
            Label : 'Reject Offer'
        }
    ]
);


// "Reservations" (EPIC20-T4) — branch-scoped List Report + Object Page,
// second entity in app/operator-portal (same manual-merge-into-one-app
// pattern as EPIC19-T5/EPIC20-T1's customer-portal). approve/reject are bound
// to Reservations (see operator-portal.cds), so they get their own
// @UI.DataFieldForAction Object Page header buttons.
annotate OperatorPortalService.Reservations with @(
    UI.LineItem                      : [
        {
            Value: vehicle_ID,
            Label: 'Vehicle'
        },
        {
            Value: customer_ID,
            Label: 'Customer'
        },
        {Value: status},
        {Value: expiresAt},
        {
            Value: createdAt,
            Label: 'Requested'
        }
    ],
    UI.FieldGroup #ReservationDetails: {
        $Type: 'UI.FieldGroupType',
        Data : [
            {
                Value: vehicle_ID,
                Label: 'Vehicle'
            },
            {
                Value: customer_ID,
                Label: 'Customer'
            },
            {Value: status},
            {Value: expiresAt},
            {Value: notes},
            {
                Value: createdAt,
                Label: 'Requested'
            }
        ]
    },
    UI.Facets                        : [{
        $Type : 'UI.ReferenceFacet',
        Label : 'Reservation Details',
        Target: '@UI.FieldGroup#ReservationDetails'
    }],
    UI.Identification                : [
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'OperatorPortalService.approve',
            Label : 'Approve Reservation'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'OperatorPortalService.reject',
            Label : 'Reject Reservation'
        }
    ]
);

// "Test Drives" (EPIC20-T4) — third entity in app/operator-portal.
// approve/cancel/complete are bound to TestDrives — a distinct overload from
// Reservations' own `approve` above (OData resolves same-named bound actions
// by their bound type, same pattern as EPIC20-T2's customer-side `cancel`).
annotate OperatorPortalService.TestDrives with @(
    UI.LineItem                    : [
        {
            Value: vehicle_ID,
            Label: 'Vehicle'
        },
        {
            Value: customer_ID,
            Label: 'Customer'
        },
        {Value: scheduledAt},
        {
            Value: durationMinutes,
            Label: 'Duration (min)'
        },
        {Value: status}
    ],
    UI.FieldGroup #TestDriveDetails: {
        $Type: 'UI.FieldGroupType',
        Data : [
            {
                Value: vehicle_ID,
                Label: 'Vehicle'
            },
            {
                Value: customer_ID,
                Label: 'Customer'
            },
            {Value: contactEmail},
            {Value: contactPhone},
            {Value: scheduledAt},
            {
                Value: durationMinutes,
                Label: 'Duration (min)'
            },
            {Value: status},
            {Value: notes}
        ]
    },
    UI.Facets                      : [{
        $Type : 'UI.ReferenceFacet',
        Label : 'Test Drive Details',
        Target: '@UI.FieldGroup#TestDriveDetails'
    }],
    UI.Identification              : [
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'OperatorPortalService.approve',
            Label : 'Approve Test Drive'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'OperatorPortalService.cancel',
            Label : 'Cancel Test Drive'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'OperatorPortalService.complete',
            Label : 'Complete Test Drive'
        }
    ]
);
