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
    ],

    // Object Page header buttons (EPIC20-T1). Unlike the unbound createVehicle
    // action (EPIC19-T3, operator-portal-ui.cds), these are bound to Vehicles
    // (see customer-portal.cds), so @UI.DataFieldForAction can target them
    // directly — verified end to end against a live backend, including the
    // 409/403 error propagation through the ReservationService/FavoritesService
    // delegation in customer-portal.js.
    UI.Identification          : [
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.reserve',
            Label : 'Reserve This Vehicle'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.addToFavorites',
            Label : 'Add to Favorites',
            Hidden: isFavorited
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.removeFromFavorites',
            Label : 'Remove from Favorites',
            Hidden: isNotFavorited
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.submitOffer',
            Label : 'Make an Offer'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.requestTestDrive',
            Label : 'Request a Test Drive'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.checkout',
            Label : 'Buy This Vehicle'
        }
    ]
);

// Renders primaryImageUrl as a thumbnail in the List Report table instead of
// a plain text/link column.
annotate CustomerPortalService.Vehicles with {
    primaryImageUrl @UI.IsImageURL: true;
};

// "My Reservations" (EPIC20-T1) — a customer-scoped List Report + Object Page,
// second entity in app/customer-portal (same manual-merge-into-one-app pattern
// as EPIC19-T5's Users/Branches). cancel is bound to Reservations, so it needs
// its own @UI.DataFieldForAction (Object Page header button) rather than
// being reachable only via ReservationService directly.
annotate CustomerPortalService.Reservations with @(
    UI.LineItem                 : [
        {Value: vehicle_ID, Label: 'Vehicle'},
        {Value: status},
        {Value: expiresAt},
        {Value: createdAt, Label: 'Requested'}
    ],
    UI.FieldGroup #ReservationDetails : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {Value: vehicle_ID, Label: 'Vehicle'},
            {Value: status},
            {Value: expiresAt},
            {Value: notes},
            {Value: createdAt, Label: 'Requested'}
        ]
    },
    UI.Facets                   : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Reservation Details',
            Target: '@UI.FieldGroup#ReservationDetails'
        }
    ],
    UI.Identification            : [
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.cancel',
            Label : 'Cancel Reservation'
        }
    ]
);

// "My Offers" (EPIC20-T2) — third entity in app/customer-portal. resubmit is
// bound to Offers (distinct overload from Reservations'/TestDrives' own
// `cancel` — OData resolves same-named bound actions by their bound type).
annotate CustomerPortalService.Offers with @(
    UI.LineItem                 : [
        {Value: vehicle_ID, Label: 'Vehicle'},
        {Value: offeredPrice},
        {Value: currency},
        {Value: status},
        {Value: desiredPickupDate}
    ],
    UI.FieldGroup #OfferDetails : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {Value: vehicle_ID, Label: 'Vehicle'},
            {Value: offeredPrice},
            {Value: currency},
            {Value: desiredPickupDate},
            {Value: status},
            {Value: rejectionNotes}
        ]
    },
    UI.Facets                   : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Offer Details',
            Target: '@UI.FieldGroup#OfferDetails'
        }
    ],
    UI.Identification            : [
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.resubmit',
            Label : 'Resubmit Offer'
        }
    ]
);

// "My Test Drives" (EPIC20-T2) — fourth entity in app/customer-portal.
annotate CustomerPortalService.TestDrives with @(
    UI.LineItem                     : [
        {Value: vehicle_ID, Label: 'Vehicle'},
        {Value: scheduledAt},
        {Value: durationMinutes, Label: 'Duration (min)'},
        {Value: status}
    ],
    UI.FieldGroup #TestDriveDetails : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {Value: vehicle_ID, Label: 'Vehicle'},
            {Value: scheduledAt},
            {Value: durationMinutes, Label: 'Duration (min)'},
            {Value: status},
            {Value: notes}
        ]
    },
    UI.Facets                       : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Test Drive Details',
            Target: '@UI.FieldGroup#TestDriveDetails'
        }
    ],
    UI.Identification                : [
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.cancel',
            Label : 'Cancel Test Drive'
        }
    ]
);

// "My Orders" (EPIC20-T3) — the critical browse → checkout → pay demo path.
// pay/retryPay show up in the auto-generated dialog with only the fields the
// action actually declares (pay: provider; retryPay: none) — amount,
// currency, and idempotencyKey are never customer-facing (see
// customer-portal.js: derived from the order's own vehicle price / generated
// server-side).
annotate CustomerPortalService.Orders with @(
    UI.LineItem                  : [
        {Value: vehicle_ID, Label: 'Vehicle'},
        {Value: deliveryType},
        {Value: status},
        {Value: orderDate}
    ],
    UI.FieldGroup #OrderDetails : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {Value: vehicle_ID, Label: 'Vehicle'},
            {Value: deliveryType},
            {Value: status},
            {Value: orderDate}
        ]
    },
    UI.Facets                    : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Order Details',
            Target: '@UI.FieldGroup#OrderDetails'
        }
    ],
    UI.Identification             : [
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.pay',
            Label : 'Pay Now'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.retryPay',
            Label : 'Retry Payment'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action: 'CustomerPortalService.cancel',
            Label : 'Cancel Order'
        }
    ]
);

// "Payments" (EPIC20-T3) — read-only payment history, no bound actions
// (capture/fail/refund are Admin/Manager-only, EPIC20-T5's job).
annotate CustomerPortalService.Payments with @(
    UI.LineItem                   : [
        {Value: order_ID, Label: 'Order'},
        {Value: provider},
        {Value: amount},
        {Value: currency},
        {Value: status}
    ],
    UI.FieldGroup #PaymentDetails : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {Value: order_ID, Label: 'Order'},
            {Value: provider},
            {Value: amount},
            {Value: currency},
            {Value: status},
            {Value: transactionReference}
        ]
    },
    UI.Facets                     : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Payment Details',
            Target: '@UI.FieldGroup#PaymentDetails'
        }
    ]
);
