import mongoose from 'mongoose';
import { DistributionOrder } from '../models/DistributionOrder.js';
import { Product } from '../models/Product.js';
import { PriceList } from '../models/PriceList.js';
import { StockService } from './stock.service.js';
import { CounterService } from './counter.service.js';
import { ORDER_STATUS, SOURCE_DOC_TYPES } from '../config/constants.js';
import { ValidationError, NotFoundError, StateTransitionError } from '../utils/errors.js';
import { calculateLineNet, calculateTax } from '../utils/money.js';

export class OrderService {
  /**
   * Create Distribution Order in DRAFT status
   * BR1: One order per vendor
   */
  static async createOrder({
    vendorId,
    warehouseId,
    items, // array of { productId, quantity, discountPercent, discountFlatPaisa }
    orderDiscountFlatPaisa = 0,
    notes = '',
    actorId = null,
    session = null
  }) {
    if (!vendorId) throw new ValidationError('vendorId is required');
    if (!warehouseId) throw new ValidationError('warehouseId is required');
    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError('Order must contain at least one line item');
    }

    const orderNumber = await CounterService.getNextNumber('DO', session);

    let subtotalPaisa = 0;
    let taxTotalPaisa = 0;
    const computedItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId).session(session);
      if (!product) throw new NotFoundError('Product', item.productId);

      // Check vendor-specific price list first, fallback to standard sale price
      const priceEntry = await PriceList.findOne({
        vendorId,
        productId: product._id,
        effectiveFrom: { $lte: new Date() },
        $or: [{ effectiveTo: null }, { effectiveTo: { $gt: new Date() } }]
      }).sort({ effectiveFrom: -1 }).session(session);

      const unitPricePaisa = priceEntry ? priceEntry.pricePaisa : product.salePricePaisa;
      const quantity = item.quantity;
      const discountPercent = item.discountPercent || 0;
      const discountFlatPaisa = item.discountFlatPaisa || 0;
      const taxRateBasisPoints = product.taxRatePercent || 0;

      const lineGrossPaisa = quantity * unitPricePaisa;
      const lineNetPaisa = calculateLineNet(lineGrossPaisa, discountPercent, discountFlatPaisa);
      const lineTaxPaisa = calculateTax(lineNetPaisa, taxRateBasisPoints);
      const lineTotalPaisa = lineNetPaisa + lineTaxPaisa;

      subtotalPaisa += lineNetPaisa;
      taxTotalPaisa += lineTaxPaisa;

      computedItems.push({
        productId: product._id,
        batchId: item.batchId || null,
        quantity,
        allocatedQty: 0,
        dispatchedQty: 0,
        deliveredQty: 0,
        returnedQty: 0,
        lostQty: 0,
        damagedQty: 0,
        unitPricePaisa,
        discountPercent,
        discountFlatPaisa,
        taxRateBasisPoints,
        lineNetPaisa,
        lineTaxPaisa,
        lineTotalPaisa
      });
    }

    const grandTotalPaisa = Math.max(0, subtotalPaisa + taxTotalPaisa - orderDiscountFlatPaisa);

    const order = new DistributionOrder({
      orderNumber,
      vendorId,
      warehouseId,
      status: ORDER_STATUS.DRAFT,
      items: computedItems,
      orderDiscountFlatPaisa,
      subtotalPaisa,
      taxTotalPaisa,
      grandTotalPaisa,
      notes,
      createdBy: actorId
    });

    await order.save({ session });
    return order;
  }

  /**
   * Allocate stock for order items (reserves inventory)
   * BR2: Allocation reserves stock. Expiry-tracked items pick FEFO.
   */
  static async allocateOrder(orderId, { actorId = null, session = null }) {
    const order = await DistributionOrder.findById(orderId).session(session);
    if (!order) throw new NotFoundError('DistributionOrder', orderId);

    if (order.status !== ORDER_STATUS.DRAFT) {
      throw new StateTransitionError('DistributionOrder', order.status, ORDER_STATUS.ALLOCATED);
    }

    // Allocate each line item
    for (const item of order.items) {
      const product = await Product.findById(item.productId).session(session);

      if (product.trackExpiry && !item.batchId) {
        // Use FEFO to allocate earliest non-expired batch
        const fefoAllocations = await StockService.allocateFEFO({
          productId: item.productId,
          warehouseId: order.warehouseId,
          requiredQuantity: item.quantity,
          session
        });

        // For simplicity with single batch on line, reserve using earliest batch
        const primaryBatch = fefoAllocations[0];
        item.batchId = primaryBatch.batchId;

        await StockService.reserveStock({
          productId: item.productId,
          warehouseId: order.warehouseId,
          batchId: item.batchId,
          quantity: item.quantity,
          sourceDocumentType: SOURCE_DOC_TYPES.DISTRIBUTION_ORDER,
          sourceDocumentId: order._id,
          actorId,
          reason: `Allocation for order ${order.orderNumber}`,
          session
        });
      } else {
        // Standard reserve
        await StockService.reserveStock({
          productId: item.productId,
          warehouseId: order.warehouseId,
          batchId: item.batchId,
          quantity: item.quantity,
          sourceDocumentType: SOURCE_DOC_TYPES.DISTRIBUTION_ORDER,
          sourceDocumentId: order._id,
          actorId,
          reason: `Allocation for order ${order.orderNumber}`,
          session
        });
      }

      item.allocatedQty = item.quantity;
    }

    order.status = ORDER_STATUS.ALLOCATED;
    await order.save({ session });
    return order;
  }

  /**
   * Cancel Order
   * Releases any reserved stock if order was in ALLOCATED state
   */
  static async cancelOrder(orderId, { reason = 'Order cancelled', actorId = null, session = null }) {
    const order = await DistributionOrder.findById(orderId).session(session);
    if (!order) throw new NotFoundError('DistributionOrder', orderId);

    if (![ORDER_STATUS.DRAFT, ORDER_STATUS.ALLOCATED].includes(order.status)) {
      throw new StateTransitionError('DistributionOrder', order.status, ORDER_STATUS.CANCELLED);
    }

    if (order.status === ORDER_STATUS.ALLOCATED) {
      // Release reservations
      for (const item of order.items) {
        if (item.allocatedQty > 0) {
          await StockService.releaseReservation({
            productId: item.productId,
            warehouseId: order.warehouseId,
            batchId: item.batchId,
            quantity: item.allocatedQty,
            sourceDocumentType: SOURCE_DOC_TYPES.DISTRIBUTION_ORDER,
            sourceDocumentId: order._id,
            actorId,
            reason: `Cancellation release for ${order.orderNumber}`,
            session
          });
          item.allocatedQty = 0;
        }
      }
    }

    order.status = ORDER_STATUS.CANCELLED;
    order.cancellationReason = reason;
    await order.save({ session });
    return order;
  }
}
