namespace automarket;

using {BaseEntity} from '../../../shared/types/common';
using {automarket.Vehicles} from '../../vehicle/db/vehicle';

// PriceHistory records every price change on a Vehicle so that:
//  - VehiclePriceDropped can be emitted with the correct delta,
//  - the Offer module can compare a bid against historical prices, and
//  - Managers have an audit trail of pricing decisions.
// Rows are append-only — never updated or deleted.
entity PriceHistory : BaseEntity {
    vehicle   : Association to Vehicles;
    oldPrice  : Decimal(15, 2);
    newPrice  : Decimal(15, 2);
    currency  : String(3) default 'TRY';
    // changedBy is stored explicitly rather than relying on managed.modifiedBy
    // because modifiedBy reflects the last OData write, which may differ from
    // the user who triggered the price-change business action.
    changedBy : String(255);
}
