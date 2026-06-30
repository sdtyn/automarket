// Central entry point for CAP service discovery across all modules.
// CAP scans the srv/ folder by default; module services are registered here
// so they are found without changing CAP's root configuration in package.json.
// Each new module's service definition must be added here manually — this is
// the trade-off for using a modular folder structure instead of CAP's default
// flat srv/ layout.
using from '../modules/identity/api/identity-service';

using from '../modules/branch/api/branch-service';

using from '../modules/vehicle/api/vehicle-service';

using from '../modules/vehicle/api/operator-portal';

using from '../modules/vehicle/api/customer-portal';

using from '../modules/pricing/api/pricing-service';

using from '../modules/favorites/api/favorites-service';

using from '../modules/reservation/api/reservation-service';

using from '../modules/test-drive/api/test-drive-service';

using from '../modules/offer/api/offer-service';
