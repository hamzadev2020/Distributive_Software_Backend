import mongoose from 'mongoose';
import { Vendor } from '../models/Vendor.js';
import { DistributionOrder } from '../models/DistributionOrder.js';
import { Invoice } from '../models/Invoice.js';
import { StockBalance } from '../models/StockBalance.js';
import { Product } from '../models/Product.js';
import { Payment } from '../models/Payment.js';
import { Return } from '../models/Return.js';
import { DOCUMENT_STATUS, PAYMENT_STATUS, ORDER_STATUS, ROLES } from '../config/constants.js';

export class ReportService {
  /**
   * BR19: Not-Received Report
   * Lists vendors with zero delivered quantity in the selected period,
   * shown separately from vendors that ordered but have undelivered quantity.
   */
  static async getNotReceivedReport({ fromDate, toDate }) {
    const from = new Date(fromDate);
    const to = new Date(toDate);

    const activeVendors = await Vendor.find({ isActive: true, deletedAt: null });

    // Find all orders placed in this period
    const orders = await DistributionOrder.find({
      createdAt: { $gte: from, $lte: to }
    });

    const deliveredVendorIds = new Set();
    const orderedUndeliveredVendorIds = new Set();

    for (const order of orders) {
      const vId = order.vendorId.toString();
      const hasDeliveries = order.items.some(i => i.deliveredQty > 0);
      const hasUndelivered = order.items.some(i => (i.quantity - i.deliveredQty) > 0);

      if (hasDeliveries) {
        deliveredVendorIds.add(vId);
      }
      if (hasUndelivered && !hasDeliveries) {
        orderedUndeliveredVendorIds.add(vId);
      }
    }

    const neverOrdered = [];
    const orderedZeroDelivered = [];

    for (const vendor of activeVendors) {
      const vId = vendor._id.toString();
      if (!deliveredVendorIds.has(vId)) {
        if (orderedUndeliveredVendorIds.has(vId)) {
          orderedZeroDelivered.push({
            vendorId: vendor._id,
            code: vendor.code,
            name: vendor.name,
            phone: vendor.phone,
            status: 'ORDERED_BUT_ZERO_DELIVERED'
          });
        } else {
          neverOrdered.push({
            vendorId: vendor._id,
            code: vendor.code,
            name: vendor.name,
            phone: vendor.phone,
            status: 'NEVER_ORDERED'
          });
        }
      }
    }

    return {
      period: { fromDate, toDate },
      summary: {
        totalActiveVendors: activeVendors.length,
        deliveredCount: deliveredVendorIds.size,
        orderedZeroDeliveredCount: orderedZeroDelivered.length,
        neverOrderedCount: neverOrdered.length
      },
      orderedZeroDelivered,
      neverOrdered
    };
  }

  /**
   * Receivables Aging Report (Current 0-30, 31-60, 61-90, 91+ days overdue)
   */
  static async getAgingReport() {
    const now = new Date();
    const unpaidInvoices = await Invoice.find({
      documentStatus: DOCUMENT_STATUS.ISSUED,
      outstandingPaisa: { $gt: 0 }
    }).populate('vendorId', 'code name phone');

    const dayMs = 24 * 60 * 60 * 1000;
    const vendorMap = new Map();

    for (const inv of unpaidInvoices) {
      const vId = inv.vendorId?._id?.toString() || 'unknown';
      if (!vendorMap.has(vId)) {
        vendorMap.set(vId, {
          vendorId: inv.vendorId?._id,
          vendorCode: inv.vendorId?.code || 'N/A',
          vendorName: inv.vendorId?.name || 'Unknown',
          currentPaisa: 0,
          days1to30Paisa: 0,
          days31to60Paisa: 0,
          days61to90Paisa: 0,
          days91PlusPaisa: 0,
          totalOutstandingPaisa: 0
        });
      }

      const entry = vendorMap.get(vId);
      const out = inv.outstandingPaisa;
      entry.totalOutstandingPaisa += out;

      const daysOverdue = inv.dueDate ? Math.floor((now - new Date(inv.dueDate)) / dayMs) : 0;

      if (daysOverdue <= 0) {
        entry.currentPaisa += out; // Not overdue yet
      } else if (daysOverdue <= 30) {
        entry.days1to30Paisa += out;
      } else if (daysOverdue <= 60) {
        entry.days31to60Paisa += out;
      } else if (daysOverdue <= 90) {
        entry.days61to90Paisa += out;
      } else {
        entry.days91PlusPaisa += out;
      }
    }

    return Array.from(vendorMap.values());
  }

  /**
   * Stock Valuation Report (Weighted Average Costing)
   */
  static async getStockValuation() {
    const balances = await StockBalance.find({ onHand: { $gt: 0 } })
      .populate('productId', 'sku name costPricePaisa baseUnit')
      .populate('warehouseId', 'code name');

    let totalValuationPaisa = 0;
    const lines = balances.map(b => {
      const unitCost = b.productId?.costPricePaisa || 0;
      const valuationPaisa = b.onHand * unitCost;
      totalValuationPaisa += valuationPaisa;

      return {
        productSku: b.productId?.sku,
        productName: b.productId?.name,
        warehouseCode: b.warehouseId?.code,
        onHand: b.onHand,
        available: b.available,
        unitCostPaisa: unitCost,
        valuationPaisa
      };
    });

    return {
      totalValuationPaisa,
      lines
    };
  }

  /**
   * Role-based Dashboard Summary (Owner & Operations Analytics)
   */
  static async getDashboardSummary(userRole) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [todayOrders, pendingDispatchOrders, stockBalances, allProducts] = await Promise.all([
      DistributionOrder.countDocuments({ createdAt: { $gte: startOfToday } }),
      DistributionOrder.countDocuments({ status: { $in: [ORDER_STATUS.ALLOCATED, ORDER_STATUS.PARTIALLY_DISPATCHED] } }),
      StockBalance.find().populate('productId', 'name sku reorderLevel'),
      Product.find({ deletedAt: null }, 'name sku reorderLevel')
    ]);

    // Inventory metrics
    let totalStockRemaining = 0;
    const productStockMap = {};
    for (const b of stockBalances) {
      const avail = b.available !== undefined ? b.available : (b.onHand - b.reserved);
      totalStockRemaining += avail;
      const pid = b.productId?._id?.toString() || b.productId?.toString();
      if (pid) {
        productStockMap[pid] = (productStockMap[pid] || 0) + avail;
      }
    }

    // Find lowest stock product
    let lowestStockProduct = null;
    let minStock = Infinity;
    for (const p of allProducts) {
      const stock = productStockMap[p._id.toString()] || 0;
      if (stock < minStock) {
        minStock = stock;
        lowestStockProduct = { name: p.name, sku: p.sku, available: stock };
      }
    }

    // Financial & Sales metrics
    let financialData = null;
    if (userRole !== ROLES.WAREHOUSE_STAFF) {
      const [overdueInvoices, outstandingSummary, returnsSummary, salesAggregation] = await Promise.all([
        Invoice.countDocuments({
          documentStatus: DOCUMENT_STATUS.ISSUED,
          outstandingPaisa: { $gt: 0 },
          dueDate: { $lt: new Date() }
        }),
        Invoice.aggregate([
          { $match: { documentStatus: DOCUMENT_STATUS.ISSUED } },
          { $group: { _id: null, totalOut: { $sum: '$outstandingPaisa' }, totalPaid: { $sum: '$paidPaisa' }, totalRevenue: { $sum: '$grandTotalPaisa' } } }
        ]),
        Return.aggregate([
          { $group: { _id: null, totalLoss: { $sum: '$grandTotalPaisa' } } }
        ]),
        Invoice.aggregate([
          { $match: { documentStatus: DOCUMENT_STATUS.ISSUED } },
          { $unwind: '$items' },
          {
            $group: {
              _id: '$items.productId',
              productName: { $first: '$items.productName' },
              totalQtySold: { $sum: '$items.quantity' },
              totalSalesPaisa: { $sum: '$items.lineNetPaisa' },
              totalCogsPaisa: { $sum: { $multiply: ['$items.quantity', '$items.cogsPaisaPerUnit'] } }
            }
          },
          { $sort: { totalQtySold: -1 } }
        ])
      ]);

      let totalUnitsSold = 0;
      let totalProfitPaisa = 0;
      let topSellingProduct = null;

      if (salesAggregation && salesAggregation.length > 0) {
        topSellingProduct = {
          name: salesAggregation[0].productName,
          qtySold: salesAggregation[0].totalQtySold
        };
        for (const item of salesAggregation) {
          totalUnitsSold += item.totalQtySold;
          totalProfitPaisa += (item.totalSalesPaisa - item.totalCogsPaisa);
        }
      }

      financialData = {
        overdueInvoicesCount: overdueInvoices,
        totalOutstandingPaisa: outstandingSummary[0]?.totalOut || 0,
        totalCollectedPaisa: outstandingSummary[0]?.totalPaid || 0,
        totalRevenuePaisa: outstandingSummary[0]?.totalRevenue || 0,
        totalProfitPaisa: Math.max(0, totalProfitPaisa),
        totalUnitsSold,
        totalLossPaisa: returnsSummary[0]?.totalLoss || 0,
        topSellingProduct
      };
    }

    return {
      todayOrdersCount: todayOrders,
      pendingDispatchCount: pendingDispatchOrders,
      totalStockRemaining,
      lowestStockProduct,
      financial: financialData
    };
  }
}
