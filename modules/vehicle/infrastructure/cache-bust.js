'use strict';

// invalidate: marks the catalog cache entry for a vehicle as stale.
// Current implementation is a stub — replace the log with a real Redis DEL
// or CDN purge call when the cache layer is introduced.
function invalidate(vehicleId) {
  console.log(`[cache-bust] invalidate vehicle ${vehicleId}`);
  // TODO: await redisClient.del(`vehicle:${vehicleId}`);
  // TODO: await cdnPurge(`/catalog/vehicles/${vehicleId}`);
}

module.exports = { invalidate };
