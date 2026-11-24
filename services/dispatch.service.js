import mongoose from 'mongoose';
import { DistributionOrder } from '../models/DistributionOrder.js';
import { DeliveryChallan } from '../models/DeliveryChallan.js';
import { Invoice } from '../models/Invoice.js';
import { Product } from '../models/Product.js';
import { Vendor } from '../models/Vendor.js';
import { StockService } from './stock.service.js';
import { CounterService } from './counter.service.js';
import { ORDER_STATUS, DOCUMENT_STATUS, PAYMENT_STATUS, SOURCE_DOC_TYPES } from '../config/constants.js';
import { ValidationError, NotFoundError, StateTransitionError } from '../utils/errors.js';

export class DispatchService {
  /**
   * Dispatch Order (Creates Delivery Challan and Draft Invoice)
   * BR5: Moves stock to inTransit, creates numbered delivery challan
   * BR7: Drafts invoice per dispatch
   */
  static async dispatchOrder(orderId, {
    transporterName = '',
    vehicleNumber = '',
    driverName = '',
    driverPhone = '',
    actorId = null,
    session = null
  }) {
    const order = await DistributionOrder.findById(orderId).session(session);
    if (!order) throw new NotFoundError('DistributionOrder', orderId);

    if (![ORDER_STATUS.ALLOCATED, ORDER_STATUS.PARTIALLY_DISPATCHED].includes(order.status)) {
      throw new StateTransitionError('DistributionOrder', order.status, ORDER_STATUS.DISPATCHED);
    }

    const challanNumber = await CounterService.getNextNumber('DC', session);
    const challanItems = [];
    const invoiceItems = [];

    let subtotalPaisa = 0;
    let taxTotalPaisa = 0;

    for (const item of order.items) {
      const remainingToDispatch = item.allocatedQty - item.dispatchedQty;
      if (remainingToDispatch <= 0) continue;

      const product = await Product.findById(item.productId).session(session);

      // Move stock: onHand--, reserved--, inTransit++
      await StockService.dispatchStock({
        productId: item.productId,
        warehouseId: order.warehouseId,
        batchId: item.batchId,
        quantity: remainingToDispatch,
        sourceDocumentType: SOURCE_DOC_TYPES.DELIVERY_CHALLAN,
        actorId,
        costPaisaPerUnit: product ? product.costPricePaisa : 0,
        reason: `Dispatch for order ${order.orderNumber}`,
        session
      });

      item.dispatchedQty += remainingToDispatch;

      challanItems.push({
        productId: item.productId,
        batchId: item.batchId,
        dispatchedQty: remainingToDispatch,
        deliveredQty: 0
      });

      // Prepare invoice item
      const lineNetPaisa = Math.round((remainingToDispatch / item.quantity) * item.lineNetPaisa);
      const lineTaxPaisa = Math.round((remainingToDispatch / item.quantity) * item.lineTaxPaisa);
      const lineTotalPaisa = lineNetPaisa + lineTaxPaisa;

      subtotalPaisa += lineNetPaisa;
      taxTotalPaisa += lineTaxPaisa;

      invoiceItems.push({
        productId: item.productId,
        sku: product ? product.sku : 'UNKNOWN',
        productName: product ? product.name : 'Unknown Product',
        batchNumber: null,
        quantity: remainingToDispatch,
        unitPricePaisa: item.unitPricePaisa,
        discountPercent: item.discountPercent,
        discountFlatPaisa: item.discountFlatPaisa,
        taxRateBasisPoints: item.taxRateBasisPoints,
        lineNetPaisa,
        lineTaxPaisa,
        lineTotalPaisa,
        cogsPaisaPerUnit: product ? product.costPricePaisa : 0
      });
    }

    if (challanItems.length === 0) {
      throw new ValidationError('No remaining allocated items to dispatch');
    }

    // Create Delivery Challan
    const challan = new DeliveryChallan({
      challanNumber,
      distributionOrderId: order._id,
      vendorId: order.vendorId,
      warehouseId: order.warehouseId,
      items: challanItems,
      transporterName,
      vehicleNumber,
      driverName,
      driverPhone,
      dispatchDate: new Date(),
      status: 'DISPATCHED',
      createdBy: actorId
    });
    await challan.save({ session });

    // Update order status
    const allDispatched = order.items.every(i => i.dispatchedQty === i.quantity);
    order.status = allDispatched ? ORDER_STATUS.DISPATCHED : ORDER_STATUS.PARTIALLY_DISPATCHED;
    await order.save({ session });

    // Create Draft Invoice for this dispatch
    const vendor = await Vendor.findById(order.vendorId).session(session);
    const draftInvoiceNumber = await CounterService.getNextNumber('INV', session);
    const grandTotalPaisa = subtotalPaisa + taxTotalPaisa;

    const invoice = new Invoice({
      invoiceNumber: draftInvoiceNumber,
      distributionOrderId: order._id,
      deliveryChallanId: challan._id,
      vendorId: order.vendorId,
      documentStatus: DOCUMENT_STATUS.DRAFT,
      paymentStatus: PAYMENT_STATUS.UNPAID,
      vendorSnapshot: {
        code: vendor ? vendor.code : '',
        name: vendor ? vendor.name : '',
        ntn: vendor ? vendor.ntn : '',
        salesTaxReg: vendor ? vendor.salesTaxRegistration : '',
        address: vendor ? vendor.address : {}
      },
      items: invoiceItems,
      subtotalPaisa,
      discountTotalPaisa: 0,
      taxTotalPaisa,
      grandTotalPaisa,
      paidPaisa: 0,
      outstandingPaisa: grandTotalPaisa,
      createdBy: actorId
    });
    await invoice.save({ session });

    return { challan, invoice, order };
  }

  /**
   * Confirm Delivery (partial or full)
   * Clears items from inTransit
   */
  static async confirmDelivery(challanId, {
    lineDeliveries = [], // optional array of { productId, deliveredQty }
    deliveryDate = new Date(),
    receiverName = '',
    proofAttachmentId = null,
    actorId = null,
    session = null
  }) {
    const challan = await DeliveryChallan.findById(challanId).session(session);
    if (!challan) throw new NotFoundError('DeliveryChallan', challanId);

    const order = await DistributionOrder.findById(challan.distributionOrderId).session(session);
    if (!order) throw new NotFoundError('DistributionOrder', challan.distributionOrderId);

    for (const item of challan.items) {
      let qtyToDeliver = item.dispatchedQty - item.deliveredQty;
      if (lineDeliveries.length > 0) {
        const spec = lineDeliveries.find(d => d.productId.toString() === item.productId.toString());
        if (spec) qtyToDeliver = spec.deliveredQty;
      }

      if (qtyToDeliver <= 0) continue;

      // Clear from inTransit
      await StockService.confirmDelivery({
        productId: item.productId,
        warehouseId: challan.warehouseId,
        batchId: item.batchId,
        quantity: qtyToDeliver,
        sourceDocumentType: SOURCE_DOC_TYPES.DELIVERY_CHALLAN,
        sourceDocumentId: challan._id,
        actorId,
        reason: `Delivery confirmation for challan ${challan.challanNumber}`,
        session
      });

      item.deliveredQty += qtyToDeliver;
      item.deliveryDate = deliveryDate;
      item.receiverName = receiverName;
      if (proofAttachmentId) item.proofImageAttachmentId = proofAttachmentId;

      // Update linked order line
      const orderItem = order.items.find(i => i.productId.toString() === item.productId.toString());
      if (orderItem) {
        orderItem.deliveredQty += qtyToDeliver;
      }
    }

    const allDelivered = challan.items.every(i => i.deliveredQty === i.dispatchedQty);
    challan.status = allDelivered ? 'DELIVERED' : 'PARTIALLY_DELIVERED';
    await challan.save({ session });

    const allOrderDelivered = order.items.every(i => i.deliveredQty === i.quantity);
    order.status = allOrderDelivered ? ORDER_STATUS.DELIVERED : ORDER_STATUS.PARTIALLY_DELIVERED;
    await order.save({ session });

    return { challan, order };
  }
}
