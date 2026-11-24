import mongoose from 'mongoose';
import { Payment } from '../models/Payment.js';
import { PaymentAllocation } from '../models/PaymentAllocation.js';
import { Invoice } from '../models/Invoice.js';
import { LedgerService } from './ledger.service.js';
import { CounterService } from './counter.service.js';
import { PAYMENT_METHODS, CHEQUE_STATUS, PAYMENT_STATUS, DOCUMENT_STATUS, LEDGER_ENTRY_TYPES, SOURCE_DOC_TYPES } from '../config/constants.js';
import { ValidationError, NotFoundError, StateTransitionError } from '../utils/errors.js';

export class PaymentService {
  /**
   * Record a Payment
   * BR13: Cheques start PENDING; non-cheque payments clear immediately
   * BR14: Allocates to invoices (oldest-first or specified); overpayment remains as advance
   */
  static async recordPayment({
    vendorId,
    amountPaisa,
    method = PAYMENT_METHODS.CASH,
    chequeDetails = null,
    allocations = [], // optional array of { invoiceId, amountPaisa }
    withholdingTaxPaisa = 0,
    referenceNumber = '',
    actorId = null,
    session = null
  }) {
    if (!vendorId) throw new ValidationError('vendorId is required');
    if (!Number.isInteger(amountPaisa) || amountPaisa <= 0) {
      throw new ValidationError('Payment amount must be a positive integer in paisa');
    }

    const paymentNumber = await CounterService.getNextNumber('PAY', session);
    const isCheque = method === PAYMENT_METHODS.CHEQUE;

    const initialStatus = isCheque ? 'RECEIVED' : 'CLEARED';
    const initialClearingStatus = isCheque ? CHEQUE_STATUS.PENDING : CHEQUE_STATUS.CLEARED;

    const payment = new Payment({
      paymentNumber,
      vendorId,
      amountPaisa,
      method,
      chequeDetails: {
        ...(chequeDetails || {}),
        clearingStatus: initialClearingStatus,
        clearedAt: isCheque ? null : new Date()
      },
      withholdingTaxPaisa,
      receivedDate: new Date(),
      referenceNumber,
      status: initialStatus,
      allocatedPaisa: 0,
      unallocatedPaisa: amountPaisa,
      createdBy: actorId
    });

    await payment.save({ session });

    // If payment is already CLEARED (cash, bank transfer, online), apply allocations immediately
    if (!isCheque) {
      await this.applyAllocations(payment, allocations, actorId, session);

      // Post credit entry to Vendor Ledger
      await LedgerService.postEntry({
        vendorId,
        entryType: LEDGER_ENTRY_TYPES.PAYMENT,
        debitPaisa: 0,
        creditPaisa: amountPaisa,
        sourceDocumentType: SOURCE_DOC_TYPES.DISTRIBUTION_ORDER,
        sourceDocumentId: payment._id,
        description: `Payment ${payment.paymentNumber} (${method})`,
        actorId,
        session
      });
    }

    return payment;
  }

  /**
   * Apply allocations from a cleared payment to invoices
   */
  static async applyAllocations(payment, customAllocations = [], actorId = null, session = null) {
    let unallocatedPaisa = payment.amountPaisa;
    let totalAllocatedPaisa = 0;

    if (customAllocations.length > 0) {
      // Allocate specific invoices
      for (const alloc of customAllocations) {
        if (unallocatedPaisa <= 0) break;

        const invoice = await Invoice.findById(alloc.invoiceId).session(session);
        if (!invoice || invoice.documentStatus !== DOCUMENT_STATUS.ISSUED) continue;

        const maxCanPay = Math.min(alloc.amountPaisa, invoice.outstandingPaisa, unallocatedPaisa);
        if (maxCanPay <= 0) continue;

        invoice.paidPaisa += maxCanPay;
        invoice.outstandingPaisa -= maxCanPay;
        invoice.paymentStatus = invoice.outstandingPaisa === 0 ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PARTIALLY_PAID;
        await invoice.save({ session });

        const pa = new PaymentAllocation({
          paymentId: payment._id,
          invoiceId: invoice._id,
          amountPaisa: maxCanPay
        });
        await pa.save({ session });

        unallocatedPaisa -= maxCanPay;
        totalAllocatedPaisa += maxCanPay;
      }
    } else {
      // Oldest-first automatic allocation across unpaid issued invoices
      const outstandingInvoices = await Invoice.find({
        vendorId: payment.vendorId,
        documentStatus: DOCUMENT_STATUS.ISSUED,
        outstandingPaisa: { $gt: 0 }
      })
        .sort({ issueDate: 1 })
        .session(session);

      for (const invoice of outstandingInvoices) {
        if (unallocatedPaisa <= 0) break;

        const allocAmount = Math.min(unallocatedPaisa, invoice.outstandingPaisa);
        invoice.paidPaisa += allocAmount;
        invoice.outstandingPaisa -= allocAmount;
        invoice.paymentStatus = invoice.outstandingPaisa === 0 ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PARTIALLY_PAID;
        await invoice.save({ session });

        const pa = new PaymentAllocation({
          paymentId: payment._id,
          invoiceId: invoice._id,
          amountPaisa: allocAmount
        });
        await pa.save({ session });

        unallocatedPaisa -= allocAmount;
        totalAllocatedPaisa += allocAmount;
      }
    }

    payment.allocatedPaisa = totalAllocatedPaisa;
    payment.unallocatedPaisa = unallocatedPaisa;
    await payment.save({ session });
  }

  /**
   * Clear Cheque
   * Reduces invoice outstanding and posts to Vendor Ledger
   */
  static async clearCheque(paymentId, { actorId = null, session = null }) {
    const payment = await Payment.findById(paymentId).session(session);
    if (!payment) throw new NotFoundError('Payment', paymentId);

    if (payment.chequeDetails?.clearingStatus !== CHEQUE_STATUS.PENDING) {
      throw new StateTransitionError('Cheque', payment.chequeDetails?.clearingStatus, CHEQUE_STATUS.CLEARED);
    }

    payment.status = 'CLEARED';
    payment.chequeDetails.clearingStatus = CHEQUE_STATUS.CLEARED;
    payment.chequeDetails.clearedAt = new Date();
    await payment.save({ session });

    // Apply allocations
    await this.applyAllocations(payment, [], actorId, session);

    // Post to Vendor Ledger
    await LedgerService.postEntry({
      vendorId: payment.vendorId,
      entryType: LEDGER_ENTRY_TYPES.PAYMENT,
      debitPaisa: 0,
      creditPaisa: payment.amountPaisa,
      sourceDocumentType: SOURCE_DOC_TYPES.DISTRIBUTION_ORDER,
      sourceDocumentId: payment._id,
      description: `Cheque Cleared ${payment.paymentNumber}`,
      actorId,
      session
    });

    return payment;
  }

  /**
   * Bounce Cheque
   */
  static async bounceCheque(paymentId, { reason = 'Cheque Bounced', actorId = null, session = null }) {
    const payment = await Payment.findById(paymentId).session(session);
    if (!payment) throw new NotFoundError('Payment', paymentId);

    if (payment.chequeDetails?.clearingStatus !== CHEQUE_STATUS.PENDING) {
      throw new StateTransitionError('Cheque', payment.chequeDetails?.clearingStatus, CHEQUE_STATUS.BOUNCED);
    }

    payment.status = 'BOUNCED';
    payment.chequeDetails.clearingStatus = CHEQUE_STATUS.BOUNCED;
    payment.chequeDetails.bounceReason = reason;
    await payment.save({ session });

    return payment;
  }
}
