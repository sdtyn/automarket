# Approuter Rate Limiting Configuration

Rate limiting is enforced at the Approuter level via SAP API Management or
the Approuter's built-in throttling plugin. Configuration is deferred until
BTP deployment (EPIC01-T6 revisit) — the policy is documented here so it
is not lost.

## Policy (AD-24)

| Traffic type            | Write limit | Read limit  |
| ----------------------- | ----------- | ----------- |
| Authenticated           | 100 req/min | 300 req/min |
| Guest (unauthenticated) | 20 req/min  | 100 req/min |

Guest traffic write limit is intentionally low — Guest Checkout (EPIC07)
is the only unauthenticated write path. The config must exist in the
Approuter before Sprint 4 introduces guest writes, even with zero guest
traffic in earlier sprints.
