# API Integration Tests — HTTP Request Files

These files use [VS Code REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client).
Each `.http` file covers one CAP service. They are not automated test suites — they are
interactive, hand-run requests that let you exercise real endpoints against the running server
and observe real responses. Think of them as a structured Postman collection that lives in the repo.

---

## What Is REST Client?

REST Client is a VS Code extension that turns `.http` files into executable HTTP requests.
Each request block is separated by `###`. When you open a `.http` file, a **Send Request**
link appears above every `###` block — clicking it fires the request and opens the response
in a side panel.

Variables like `{{baseUrl}}` and `{{adminAuth}}` are resolved from a named environment
defined in `.vscode/settings.json`. You select the environment once per session.

---

## Initial Setup

### 1. Install the extension

Search for `humao.rest-client` in VS Code Extensions, or install from the terminal:

```bash
code --install-extension humao.rest-client
```

### 2. Start the application server

```bash
cds watch
```

Wait until you see:

```
[cds] - server listening on { url: 'http://localhost:4004' }
```

The server uses SQLite in-memory mode. Seed data (42 vehicles, 4 branches, 5 users) is
loaded automatically on every start — no manual seeding needed.

### 3. Select the `dev` environment

Press `Ctrl+Shift+P` → type **Rest Client: Switch Environment** → select **dev**.

This tells REST Client where to read `{{baseUrl}}`, `{{adminAuth}}`, etc. from.
You only need to do this once per VS Code session — the selection persists until you
switch again or restart VS Code.

If variables appear underlined in red, the environment is not selected yet.

---

## Environment Variables

All variables are defined in `.vscode/settings.json` under the `dev` environment:

| Variable                   | Value                   | User                           |
| -------------------------- | ----------------------- | ------------------------------ |
| `{{baseUrl}}`              | `http://localhost:4004` | —                              |
| `{{adminAuth}}`            | Basic … (Base64)        | admin.mueller@automarkt.de     |
| `{{managerAuth}}`          | Basic … (Base64)        | manager.schmidt@automarkt.de   |
| `{{operatorAuth}}`         | Basic … (Base64)        | operator.weber@automarkt.de    |
| `{{customerBauerAuth}}`    | Basic … (Base64)        | customer.bauer@automarkt.de    |
| `{{customerHoffmannAuth}}` | Basic … (Base64)        | customer.hoffmann@automarkt.de |

All test passwords are `Test@1234`. The Base64 values encode `email:password`.

---

## How to Run a Request

1. Open a `.http` file (e.g. `tests/http/identity.http`).
2. Click **Send Request** above the `###` block you want to fire.
3. The response appears in the right panel — status code, headers, and body.

To run all requests in sequence, click them one by one from top to bottom.
There is no "run all" button — execution is always manual and intentional.

---

## Reading the Response

The right panel shows:

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "value": { ... }
}
```

- **2xx** — success
- **4xx** — expected rejection (auth failure, validation error, business rule violation)
- **5xx** — unexpected server error (check `cds watch` terminal for the stack trace)

For requests marked `— should be rejected`, a `403` or `401` is the correct outcome.

---

## Handling `REPLACE_WITH_*` Placeholders

Some requests depend on IDs created by earlier requests in the same file.
These are marked with `REPLACE_WITH_ID`, `REPLACE_WITH_ORDER_ID`, etc.

**Workflow:**

1. Run the first request (e.g. `createOrder`).
2. Copy the `ID` field from the response body.
3. In the next request block, replace `"REPLACE_WITH_ORDER_ID"` with the actual UUID.
4. Run the next request.

These IDs are ephemeral — the in-memory database resets on every `cds watch` restart,
so IDs from a previous session are no longer valid.

---

## File Dependencies

Most files are independent. A few require prior steps in another file:

| File                    | Depends on                                                            |
| ----------------------- | --------------------------------------------------------------------- |
| `identity.http`         | —                                                                     |
| `vehicle.http`          | —                                                                     |
| `customer-portal.http`  | —                                                                     |
| `reservation.http`      | —                                                                     |
| `test-drive.http`       | —                                                                     |
| `offer.http`            | —                                                                     |
| `sales.http`            | —                                                                     |
| `payment.http`          | `sales.http` — needs an `orderId` from `createOrder`                  |
| `delivery.http`         | `sales.http` + `payment.http` — needs an order with completed payment |
| `favorites.http`        | —                                                                     |
| `pricing.http`          | —                                                                     |
| `reporting.http`        | —                                                                     |
| `admin.http`            | —                                                                     |
| `price-drop-alert.http` | —, but exercises favorites/pricing/identity endpoints together        |

---

## Full End-to-End Scenario

The happy path that exercises the entire purchase flow in order:

```
1. identity.http     → login, verify profile
2. vehicle.http      → browse vehicles, check a FOR_SALE vehicle
3. offer.http        → Customer Bauer submits an offer on Audi A4
4. offer.http        → Operator approves the offer → Order is created
5. sales.http        → Customer sees the Order; copy the Order ID
6. payment.http      → initiatePayment (paste Order ID)
7. payment.http      → capturePayment (Admin simulates PSP)
8. delivery.http     → scheduleDelivery (paste Order ID)
9. delivery.http     → completeDelivery
10. reporting.http   → getSalesDashboard → appears in the report
```

Alternatively, skip the offer flow and go directly through `sales.http → createOrder`.

---

## Seed Data Reference

All tests assume EPIC14 seed data, loaded automatically on `cds watch`.

### Branches

| Branch          | UUID                                   |
| --------------- | -------------------------------------- |
| München (MUC)   | `aaa00000-0000-0000-0000-000000000001` |
| Berlin (BER)    | `aaa00000-0000-0000-0000-000000000002` |
| Hamburg (HAM)   | `aaa00000-0000-0000-0000-000000000003` |
| Frankfurt (FRA) | `aaa00000-0000-0000-0000-000000000004` |

### Users

| User              | UUID                                   | Role     |
| ----------------- | -------------------------------------- | -------- |
| admin.mueller     | `ccc00000-0000-0000-0000-000000000001` | Admin    |
| manager.schmidt   | `ccc00000-0000-0000-0000-000000000002` | Manager  |
| operator.weber    | `ccc00000-0000-0000-0000-000000000003` | Operator |
| customer.bauer    | `ccc00000-0000-0000-0000-000000000004` | Customer |
| customer.hoffmann | `ccc00000-0000-0000-0000-000000000005` | Customer |

### Vehicles (selected)

| Vehicle              | UUID                                   | Branch |
| -------------------- | -------------------------------------- | ------ |
| VW Golf VIII         | `40000000-4000-4000-4000-400000000001` | MUC    |
| BMW 3 Series         | `40000000-4000-4000-4000-400000000002` | MUC    |
| Mercedes C-Class     | `40000000-4000-4000-4000-400000000003` | MUC    |
| Audi A4              | `40000000-4000-4000-4000-400000000004` | MUC    |
| Porsche 911          | `40000000-4000-4000-4000-400000000005` | MUC    |
| Tesla Model 3 (BER)  | `40000000-4000-4000-4000-400000000016` | BER    |
| Tesla Model Y (HAM)  | `40000000-4000-4000-4000-400000000025` | HAM    |
| Porsche Taycan (FRA) | `40000000-4000-4000-4000-400000000035` | FRA    |

Full list: `db/data/automarket.Vehicles.csv` (42 vehicles, IDs `...000001` → `...000042`).

---

## Files

| File                    | Service(s) covered                                             | Requests |
| ----------------------- | -------------------------------------------------------------- | -------- |
| `identity.http`         | IdentityService — login, lockout, profile                      | 13       |
| `vehicle.http`          | VehicleService, OperatorPortalService                          | 12       |
| `customer-portal.http`  | CustomerPortalService — browse, filter, sort                   | 11       |
| `reservation.http`      | ReservationService                                             | 7        |
| `test-drive.http`       | TestDriveService                                               | 7        |
| `offer.http`            | OfferService                                                   | 6        |
| `sales.http`            | SalesService                                                   | 6        |
| `payment.http`          | PaymentService — initiate, capture, refund                     | 9        |
| `delivery.http`         | DeliveryService                                                | 6        |
| `favorites.http`        | FavoritesService                                               | 8        |
| `pricing.http`          | PricingService                                                 | 6        |
| `reporting.http`        | ReportingService — dashboard, branch performance               | 10       |
| `admin.http`            | AdminService — users, branches, audit logs                     | 12       |
| `price-drop-alert.http` | NotificationService — EMAIL price-drop alert, opt-out (EPIC18) | 10       |

---

## Troubleshooting

| Symptom                                    | Cause                                    | Fix                                                    |
| ------------------------------------------ | ---------------------------------------- | ------------------------------------------------------ |
| Variables underlined red (`{{baseUrl}}`)   | No environment selected                  | `Ctrl+Shift+P` → Rest Client: Switch Environment → dev |
| `401 Unauthorized` on every request        | Wrong Base64 or environment not active   | Re-select environment; verify `.vscode/settings.json`  |
| `404 Not Found` on an action               | Using GET instead of POST, or wrong path | Actions are POST; check the `.http` file comment       |
| `REPLACE_WITH_ID` still in body → `400`    | Forgot to paste the actual UUID          | Run the dependency request first, copy the ID          |
| Server not responding                      | `cds watch` not running or crashed       | Restart `cds watch`, wait for "server listening" line  |
| Old IDs returning 404 after server restart | In-memory DB reset on restart            | Re-run dependency requests to get fresh IDs            |
