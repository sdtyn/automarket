using {OperatorPortalService} from './operator-portal';
using {automarket} from '../db/vehicle';

// UI annotations for OperatorPortalService.Vehicles (EPIC19-T2). Kept in a
// separate file from the service definition (operator-portal.cds) so the API
// contract (what data is exposed, to whom) stays independent of how Fiori
// Elements renders it — a UI-only change here never touches the @restrict
// authorization logic.
annotate OperatorPortalService.Vehicles with @(
    // List Report columns. Status Criticality coloring and the create/edit
    // form (@UI.SelectionFields, editable field annotations) are EPIC19-T3
    // scope, not this ticket.
    UI.LineItem                : [
        {Value: brand},
        {Value: model},
        {Value: year},
        {Value: price},
        {Value: status},
        {Value: branch.name, Label: 'Branch'}
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
