// Single entry point for CDS entity discovery. CAP reads this file to build the
// combined schema; adding a new module's db file here is enough for it to be
// included in migrations and the generated service model — no other config needed.
using from '../modules/identity/db/identity';

using from '../modules/branch/db/branch';

using from '../modules/vehicle/db/vehicle';

using from '../modules/pricing/db/pricing';

using from '../modules/favorites/db/favorites';

using from '../modules/reservation/db/reservation';

using from '../modules/test-drive/db/test-drive';

using from '../modules/offer/db/offer';
