using {OperatorPortalService} from './operator-portal';
using {automarket} from '../db/vehicle';

// UI annotations for OperatorPortalService.Vehicles (EPIC19-T2/T3). Kept in a
// separate file from the service definition (operator-portal.cds) so the API
// contract (what data is exposed, to whom) stays independent of how Fiori
// Elements renders it — a UI-only change here never touches the @restrict
// authorization logic.
//
// EPIC19-T3 note on the create/edit form: OperatorPortalService.Vehicles has
// no CREATE/UPDATE grant (see operator-portal.cds) — vehicle creation is
// deliberately only reachable through the createVehicle action, so status and
// branch enforcement cannot be bypassed via a raw PATCH/POST. createVehicle is
// an *unbound* OData action (IsBound="false"), so it cannot be wired onto the
// List Report toolbar via @UI.DataFieldForAction (that annotation targets
// actions bound to the entity type). Wiring it in would require a manifest.json
// custom-toolbar-action entry, which cannot be verified without a real browser
// session — left as a follow-up rather than shipped unverified. This Object
// Page is therefore view-only; creation still goes through the createVehicle
// endpoint directly (see tests/http/vehicle.http).
annotate OperatorPortalService.Vehicles with @(
    // List Report columns, with a status color badge (statusCriticality is
    // populated per-row in operator-portal.js, srv.after('READ')).
    UI.LineItem                : [
        {Value: brand},
        {Value: model},
        {Value: year},
        {Value: price},
        {Value: status, Criticality: statusCriticality},
        {Value: branch.name, Label: 'Branch'}
    ],

    // Filter bar fields on the List Report.
    UI.SelectionFields          : [
        brand,
        fuelType,
        status
    ],

    // Object Page general-info section.
    UI.FieldGroup #GeneralInfo : {
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
            {Value: branch.name, Label: 'Branch'}
        ]
    },

    // Object Page facets: general info form + an inline image gallery table
    // driven by the images composition (see UI.LineItem on VehicleImages
    // below — a Facet pointing at a composition needs a LineItem defined on
    // the target type for Fiori Elements to know which columns to render).
    UI.Facets                  : [
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
annotate automarket.VehicleImages with @(
    UI.LineItem: [
        {Value: url},
        {Value: sortOrder, Label: 'Order'}
    ]
);
