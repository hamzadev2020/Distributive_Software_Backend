import mongoose from 'mongoose';
import { Return } from '../models/Return.js';
import { DistributionOrder } from '../models/DistributionOrder.js';
import { CreditNote } from '../models/CreditNote.js';
import { Invoice } from '../models/Invoice.js';
import { StockService } from './stock.service.js';
import { LedgerService } from './ledger.service.js';
import { CounterService } from './counter.service.js';
import { RETURN_CONDITIONS, RETURN_LIABILITIES, LEDGER_ENTRY_TYPES, SOURCE_DOC_TYPES } from '../config/constants.js';
import { ValidationError, NotFoundError, StateTransitionError } from '../utils/errors.js';

export class ReturnService {
  /**
   * Create Return Request (in PENDING status)
   * BR11: Validates cumulative returned + lost + damaged <= delivered
   */
  static async createReturn({
    orderId,
    items, // array of { deliveredLineIndex, quantity, condition, liability, reason }
    actorId = null,
    session = null
  }) {
    const order = await DistributionOrder.findById(orderId).session(session);
    if (!order) throw new NotFoundError('DistributionOrder', orderId);

    const returnNumber = await CounterService.getNextNumber('RET', session);
    let subtotalPaisa = 0;
    let taxTotalPaisa = 0;
    const returnItems = [];

    for (const item of items) {
      const orderLine = order.items[item.deliveredLineIndex];
      if (!orderLine) {
        throw new ValidationError(`Invalid delivered line index ${item.deliveredLineIndex}`);
      }

      // Check return guard: cumulative returned + lost + damaged <= delivered
      const cumulativeProcessed = orderLine.returnedQty + orderLine.lostQty + orderLine.damagedQty;
      const maxReturnable = orderLine.deliveredQty - cumulativeProcessed;

      if (item.quantity > maxReturnable) {
        throw new ValidationError(
          `Cannot return ${item.quantity} units for product ${orderLine.productId}. Delivered: ${orderLine.deliveredQty}, already returned/lost/damaged: ${cumulativeProcessed}, max returnable: ${maxReturnable}`
        );
      }

      const unitPricePaisa = orderLine.unitPricePaisa;
      const taxRateBasisPoints = orderLine.taxRateBasisPoints;

      const lineNetPaisa = item.quantity * unitPricePaisa;
      const lineTaxPaisa = Math.round((lineNetPaisa * taxRateBasisPoints) / 10000);
      const lineTotalPaisa = lineNetPaisa + lineTaxPaisa;

      subtotalPaisa += lineNetPaisa;
      taxTotalPaisa += lineTaxPaisa;

      returnItems.push({
        productId: orderLine.productId,
        batchId: orderLine.batchId,
        deliveredLineIndex: item.deliveredLineIndex,
        quantity: item.quantity,
        condition: item.condition,
        liability: item.liability,
        unitPricePaisa,
        taxRateBasisPoints,
        lineNetPaisa,
        lineTaxPaisa,
        lineTotalPaisa,
        reason: item.reason || ''
      });
    }

    const grandTotalPaisa = subtotalPaisa + taxTotalPaisa;

    // Find linked invoice if exists
    const invoice = await Invoice.findOne({ distributionOrderId: order._id }).session(session);

    const ret = new Return({
      returnNumber,
      distributionOrderId: order._id,
      vendorId: order.vendorId,
      invoiceId: invoice ? invoice._id : null,
      items: returnItems,
      subtotalPaisa,
      taxTotalPaisa,
      grandTotalPaisa,
      status: 'PENDING',
      createdBy: actorId
    });

    await ret.save({ session });
    return ret;
  }

  /**
   * Approve Return
   * Segregation of duties: maker cannot be approver
   */
  static async approveReturn(returnId, { approverId, session = null }) {
    const ret = await Return.findById(returnId).session(session);
    if (!ret) throw new NotFoundError('Return', returnId);

    if (ret.status !== 'PENDING') {
      throw new StateTransitionError('Return', ret.status, 'APPROVED');
    }

    if (ret.createdBy && approverId && ret.createdBy.toString() === approverId.toString()) {
      throw new ValidationError('Segregation of duties violation: Return creator cannot approve their own return');
    }

    ret.status = 'APPROVED';
    ret.approvedBy = approverId;
    ret.approvedAt = new Date();
    await ret.save({ session });

    return ret;
  }

  /**
   * Process Approved Return
   * Stock routing + Credit Note generation for company-liability items
   */
  static async processReturn(returnId, { actorId = null, session = null }) {
    const ret = await Return.findById(returnId).session(session);
    if (!ret) throw new NotFoundError('Return', returnId);

    if (ret.status !== 'APPROVED') {
      throw new StateTransitionError('Return', ret.status, 'PROCESSED');
    }

    const order = await DistributionOrder.findById(ret.distributionOrderId).session(session);
    if (!order) throw new NotFoundError('DistributionOrder', ret.distributionOrderId);

    let companyCreditTotalPaisa = 0;
    const creditNoteItems = [];

    for (const item of ret.items) {
      const orderLine = order.items[item.deliveredLineIndex];

      // Route stock according to condition
      if (item.condition === RETURN_CONDITIONS.RESALABLE) {
        // Return to warehouse onHand
        await StockService.returnResalable({
          productId: item.productId,
          warehouseId: order.warehouseId,
          batchId: item.batchId,
          quantity: item.quantity,
          sourceDocumentType: SOURCE_DOC_TYPES.RETURN,
          sourceDocumentId: ret._id,
          actorId,
          reason: `Customer return ${ret.returnNumber}`,
          session
        });
        if (orderLine) orderLine.returnedQty += item.quantity;
      } else if (item.condition === RETURN_CONDITIONS.DAMAGED) {
        // Return to quarantined
        await StockService.returnDamaged({
          productId: item.productId,
          warehouseId: order.warehouseId,
          batchId: item.batchId,
          quantity: item.quantity,
          sourceDocumentType: SOURCE_DOC_TYPES.RETURN,
          sourceDocumentId: ret._id,
          actorId,
          reason: `Customer damaged return ${ret.returnNumber}`,
          session
        });
        if (orderLine) orderLine.damagedQty += item.quantity;
      } else if (item.condition === RETURN_CONDITIONS.LOST) {
        if (orderLine) orderLine.lostQty += item.quantity;
      }

      // Check liability: Company liability -> credit the vendor
      if (item.liability === RETURN_LIABILITIES.TRANSIT) {
        companyCreditTotalPaisa += item.lineTotalPaisa;
        creditNoteItems.push({
          productId: item.productId,
          batchId: item.batchId,
          quantity: item.quantity,
          unitPricePaisa: item.unitPricePaisa,
          taxRateBasisPoints: item.taxRateBasisPoints,
          lineNetPaisa: item.lineNetPaisa,
          lineTaxPaisa: item.lineTaxPaisa,
          lineTotalPaisa: item.lineTotalPaisa,
          reason: item.reason
        });
      }
    }

    await order.save({ session });

    // If company liability, issue Credit Note and post to Vendor Ledger
    let creditNote = null;
    if (companyCreditTotalPaisa > 0 && ret.invoiceId) {
      const creditNoteNumber = await CounterService.getNextNumber('CN', session);

      creditNote = new CreditNote({
        creditNoteNumber,
        invoiceId: ret.invoiceId,
        returnId: ret._id,
        vendorId: ret.vendorId,
        items: creditNoteItems,
        totalPaisa: companyCreditTotalPaisa,
        status: 'ISSUED',
        createdBy: actorId,
        approvedBy: ret.approvedBy
      });
      await creditNote.save({ session });

      ret.creditNoteId = creditNote._id;

      // Post CREDIT_NOTE credit entry in Vendor Ledger
      await LedgerService.postEntry({
        vendorId: ret.vendorId,
        entryType: LEDGER_ENTRY_TYPES.CREDIT_NOTE,
        debitPaisa: 0,
        creditPaisa: companyCreditTotalPaisa,
        sourceDocumentType: SOURCE_DOC_TYPES.RETURN,
        sourceDocumentId: creditNote._id,
        description: `Credit Note ${creditNote.creditNoteNumber} for return ${ret.returnNumber}`,
        actorId,
        session
      });
    }

    ret.status = 'PROCESSED';
    await ret.save({ session });

    return { returnRecord: ret, creditNote };
  }
}
