# API Integration Tests — HTTP Request Files

These files use [VS Code REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client). Each `.http` file covers one service.

## Setup

1. Install the **REST Client** extension in VS Code (`humao.rest-client`).
2. Start the application: `cds watch`
3. In VS Code, press `Ctrl+Shift+P` → **Rest Client: Switch Environment** → select **dev**.
4. Open any `.http` file and click **Send Request** above a request block.

## Seed data

All tests assume EPIC14 seed data is loaded (automatic on `cds watch`).
Pre-created UUIDs used across files:

| Resource                       | UUID                                   |
| ------------------------------ | -------------------------------------- |
| Branch München (MUC)           | `aaa00000-0000-0000-0000-000000000001` |
| Branch Berlin (BER)            | `aaa00000-0000-0000-0000-000000000002` |
| Branch Hamburg (HAM)           | `aaa00000-0000-0000-0000-000000000003` |
| Branch Frankfurt (FRA)         | `aaa00000-0000-0000-0000-000000000004` |
| User — Admin                   | `ccc00000-0000-0000-0000-000000000001` |
| User — Manager                 | `ccc00000-0000-0000-0000-000000000002` |
| User — Operator                | `ccc00000-0000-0000-0000-000000000003` |
| User — Customer Bauer          | `ccc00000-0000-0000-0000-000000000004` |
| User — Customer Hoffmann       | `ccc00000-0000-0000-0000-000000000005` |
| Vehicle — Golf VIII (MUC)      | `40000000-4000-4000-4000-400000000001` |
| Vehicle — Porsche 911 (MUC)    | `40000000-4000-4000-4000-400000000005` |
| Vehicle — Tesla Model 3 (BER)  | `40000000-4000-4000-4000-400000000016` |
| Vehicle — Tesla Model Y (HAM)  | `40000000-4000-4000-0000-400000000025` |
| Vehicle — Porsche Taycan (FRA) | `40000000-4000-4000-4000-400000000035` |

## Files

| File                   | Service(s) covered                              |
| ---------------------- | ----------------------------------------------- |
| `identity.http`        | IdentityService — register, login, lockout, MFA |
| `vehicle.http`         | VehicleService, OperatorPortalService           |
| `customer-portal.http` | CustomerPortalService                           |
| `reservation.http`     | ReservationService                              |
| `test-drive.http`      | TestDriveService                                |
| `offer.http`           | OfferService                                    |
| `sales.http`           | SalesService                                    |
| `payment.http`         | PaymentService                                  |
| `delivery.http`        | DeliveryService                                 |
| `favorites.http`       | FavoritesService                                |
| `pricing.http`         | PricingService                                  |
| `reporting.http`       | ReportingService                                |
| `admin.http`           | AdminService                                    |
