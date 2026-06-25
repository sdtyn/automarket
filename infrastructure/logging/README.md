# Logging

AutoMarket uses CAP's built-in logger — no custom logging library.

```js
const log = cds.log('vehicle'); // name the logger after the module
log.info('vehicle published', { vehicleId });
log.error('payment capture failed', { orderId, reason });
```

## Levels

- `ERROR` — operation failed, needs attention.
- `WARN` — unexpected but recovered.
- `INFO` — business-relevant event (state transition, action completed).
- `DEBUG` — diagnostic detail, off by default in production.

## Rule: never log sensitive data

Never pass these to a logger, in any field: password, token/JWT, card/PAN/CVV,
full name, email, phone, address. Log the ID instead (customerId, vehicleId,
orderId) and look up the record if you need the detail.

This is not optional — see Solution Architecture Document, Data Classification (AD-30).
