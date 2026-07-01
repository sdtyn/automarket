'use strict';

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {
  const { Orders, Offers } = cds.entities('automarket');
  const { BranchPerformanceReport } = cds.entities('automarket');

  // getSalesDashboard: counts orders across all terminal and active statuses.
  srv.on('getSalesDashboard', async () => {
    const rows = await SELECT.from(Orders).columns('status');

    const counts = { totalOrders: 0, paidOrders: 0, completedOrders: 0, cancelledOrders: 0 };
    for (const row of rows) {
      counts.totalOrders++;
      if (row.status === 'PAID') counts.paidOrders++;
      if (row.status === 'COMPLETED') counts.completedOrders++;
      if (row.status === 'CANCELLED') counts.cancelledOrders++;
    }
    return counts;
  });

  // getBranchPerformance: groups BranchPerformanceReport rows by branchId in JS.
  // Optional branchId filter narrows to a single branch.
  srv.on('getBranchPerformance', async (req) => {
    const { branchId } = req.data;

    const query = SELECT.from(BranchPerformanceReport);
    if (branchId) query.where({ branchId });
    const rows = await query;

    // Aggregate in-process — avoids GROUP BY CDS view complexity.
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.branchId)) {
        map.set(row.branchId, {
          branchId: row.branchId,
          branchName: row.branchName,
          totalOrders: 0,
          paidOrders: 0,
          completedOrders: 0,
          cancelledOrders: 0,
        });
      }
      const m = map.get(row.branchId);
      m.totalOrders++;
      if (row.status === 'PAID') m.paidOrders++;
      if (row.status === 'COMPLETED') m.completedOrders++;
      if (row.status === 'CANCELLED') m.cancelledOrders++;
    }
    return Array.from(map.values());
  });

  // getConversionRates: two separate funnels — never merged.
  // 'direct': Orders funnel — how many orders reach PAID or COMPLETED.
  // 'reservation-led': Offers funnel — how many submitted offers are approved.
  srv.on('getConversionRates', async (req) => {
    const { funnelType } = req.data;

    if (funnelType === 'direct') {
      const rows = await SELECT.from(Orders).columns('status');
      const totalEntered = rows.length;
      const totalConverted = rows.filter((r) => ['PAID', 'COMPLETED'].includes(r.status)).length;
      const conversionRate =
        totalEntered > 0 ? Math.round((totalConverted / totalEntered) * 10000) / 100 : 0;
      return { funnelType, totalEntered, totalConverted, conversionRate };
    }

    if (funnelType === 'reservation-led') {
      const rows = await SELECT.from(Offers).columns('status');
      const totalEntered = rows.length;
      const totalConverted = rows.filter((r) => r.status === 'APPROVED').length;
      const conversionRate =
        totalEntered > 0 ? Math.round((totalConverted / totalEntered) * 10000) / 100 : 0;
      return { funnelType, totalEntered, totalConverted, conversionRate };
    }

    return req.error(400, `Unknown funnelType "${funnelType}". Use 'direct' or 'reservation-led'.`);
  });
});
