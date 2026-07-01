using {automarket} from '../db/reporting';

// ReportingService exposes read models and aggregation functions for
// Admin/Manager dashboards. All entities are read-only projections over
// the CDS views defined in the reporting domain.
@impl: 'modules/reporting/application/reporting-service.js'
service ReportingService @(path: '/reporting') {

    @requires: [
        'Admin',
        'Manager'
    ]
    entity VehicleSalesReport      as projection on automarket.VehicleSalesReport;

    @requires: [
        'Admin',
        'Manager'
    ]
    entity ReservationReport       as projection on automarket.ReservationReport;

    @requires: [
        'Admin',
        'Manager'
    ]
    entity OfferConversionReport   as projection on automarket.OfferConversionReport;

    @requires: [
        'Admin',
        'Manager'
    ]
    entity BranchPerformanceReport as projection on automarket.BranchPerformanceReport;

    // getSalesDashboard: aggregate order counts across all statuses.
    @requires: [
        'Admin',
        'Manager'
    ]
    function getSalesDashboard()                    returns SalesDashboard;

    // getBranchPerformance: order counts grouped by branch.
    // branchId is optional — omit to get all branches.
    @requires: [
        'Admin',
        'Manager'
    ]
    function getBranchPerformance(branchId: String) returns array of BranchMetrics;

    // getConversionRates: funnel efficiency.
    // funnelType = 'direct' → Orders funnel (created → paid/completed).
    // funnelType = 'reservation-led' → Offers funnel (submitted → approved).
    // The two funnels are never merged — a healthy direct rate must not mask
    // a declining reservation-led rate.
    @requires: [
        'Admin',
        'Manager'
    ]
    function getConversionRates(funnelType: String) returns ConversionRate;
}

// SalesDashboard: top-level order count summary.
type SalesDashboard {
    totalOrders     : Integer;
    paidOrders      : Integer;
    completedOrders : Integer;
    cancelledOrders : Integer;
}

// BranchMetrics: per-branch order breakdown.
type BranchMetrics {
    branchId        : String;
    branchName      : String;
    totalOrders     : Integer;
    paidOrders      : Integer;
    completedOrders : Integer;
    cancelledOrders : Integer;
}

// ConversionRate: funnel entry vs. successful conversion.
type ConversionRate {
    funnelType     : String;
    totalEntered   : Integer;
    totalConverted : Integer;
    // conversionRate is a percentage (0–100), rounded to two decimal places.
    conversionRate : Decimal(5, 2);
}
