namespace automarket;

using {automarket.Orders}       from '../../sales/db/sales';
using {automarket.Reservations} from '../../reservation/db/reservation';
using {automarket.Offers}       from '../../offer/db/offer';

// Reporting entities are CDS views — read models over operational tables.
// In production these would be populated asynchronously from EventOutbox;
// here CDS views provide the same query interface without extra infrastructure.
// Aggregation (counts, sums, rates) is done in the service-layer functions,
// not in the view, so the views remain compatible across all CDS databases.

// VehicleSalesReport: PAID and COMPLETED orders with vehicle and branch context.
entity VehicleSalesReport      as
    SELECT FROM Orders {
        key ID,
            vehicle.ID    as vehicleId,
            vehicle.brand as brand,
            vehicle.model as model,
            vehicle.year  as year,
            branch.ID     as branchId,
            branch.name   as branchName,
            customer_ID   as customerId,
            orderDate,
            deliveryType,
            status
    }
    WHERE status IN (
        'PAID',
        'COMPLETED'
    );

// ReservationReport: all reservation records for pipeline and conversion analysis.
entity ReservationReport       as
    SELECT FROM Reservations {
        key ID,
            vehicle.ID    as vehicleId,
            vehicle.brand as brand,
            vehicle.model as model,
            branch.ID     as branchId,
            customer_ID   as customerId,
            status,
            expiresAt,
            createdAt
    };

// OfferConversionReport: offer records for funnel analysis (submitted → approved/rejected).
entity OfferConversionReport   as
    SELECT FROM Offers {
        key ID,
            vehicle.ID    as vehicleId,
            vehicle.brand as brand,
            vehicle.model as model,
            branch.ID     as branchId,
            customer_ID   as customerId,
            offeredPrice,
            currency,
            status,
            createdAt
    };

// BranchPerformanceReport: order records with branch context for performance metrics.
// Row-level data — the service function aggregates counts and revenue by branchId.
entity BranchPerformanceReport as
    SELECT FROM Orders {
        key ID,
            branch.ID   as branchId,
            branch.name as branchName,
            status,
            deliveryType,
            orderDate,
            createdAt
    };
