using {CustomerPortalService} from './customer-portal';
using {automarket} from '../db/vehicle';

// UI annotations for CustomerPortalService.Vehicles (EPIC19-T4). Kept in a
// separate file from the service definition, same pattern as
// operator-portal-ui.cds — UI presentation stays independent of the API
// contract (@requires, the FOR_SALE filter in customer-portal.js).
annotate CustomerPortalService.Vehicles with @(
    // Catalog list columns, with a thumbnail image column.
    UI.LineItem                : [
        {Value: primaryImageUrl, Label: 'Image'},
        {Value: brand},
        {Value: model},
        {Value: year},
        {Value: price}
    ],

    // Object Page: full specs (internal/operational fields — vin, plateNumber,
    // status — are deliberately left out; a customer does not need them).
    UI.FieldGroup #VehicleSpecs : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {Value: brand},
            {Value: model},
            {Value: year},
            {Value: mileage},
            {Value: fuelType},
            {Value: transmission},
            {Value: color},
            {Value: price},
            {Value: currency},
            {Value: branch.name, Label: 'Branch'},
            {Value: branch.city, Label: 'City'}
        ]
    },

    // Object Page facets: specs form + an inline photo gallery table driven by
    // the images composition (VehicleImages' UI.LineItem is annotated once,
    // shared with OperatorPortalService — see operator-portal-ui.cds).
    UI.Facets                  : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Specifications',
            Target: '@UI.FieldGroup#VehicleSpecs'
        },
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Photos',
            Target: 'images/@UI.LineItem'
        }
    ]
);

// Renders primaryImageUrl as a thumbnail in the List Report table instead of
// a plain text/link column.
annotate CustomerPortalService.Vehicles with {
    primaryImageUrl @UI.IsImageURL: true;
};
