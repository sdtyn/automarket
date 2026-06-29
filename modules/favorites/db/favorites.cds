namespace automarket;

using {BaseEntity} from '../../../shared/types/common';
using {automarket.Vehicles} from '../../vehicle/db/vehicle';

// Favorites links a customer (by user ID string) to a Vehicle.
// The unique constraint prevents a customer from adding the same
// vehicle twice without requiring a handler-level duplicate check.
@assert.unique: {customerVehicle: [
    customer_ID,
    vehicle_ID
]}
entity Favorites : BaseEntity {
    // customer_ID stores req.user.id — a string rather than a foreign key
    // to avoid a hard dependency on the Identity module's Users entity.
    customer_ID : String(255);
    vehicle     : Association to Vehicles;
}
