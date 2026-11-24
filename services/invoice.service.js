import mongoose from 'mongoose';
import { Invoice } from '../models/Invoice.js';
import { Vendor } from '../models/Vendor.js';
import { LedgerService } from './ledger.service.js';
import { CounterService } from './counter.service.js';
import { DOCUMENT_STATUS, PAYMENT_STATUS, LEDGER_ENTRY_TYPES, SOURCE_DOC_TYPES } from '../config/constants.js';
import { ValidationError, NotFoundError, StateTransitionError } from '../utils/errors.js';

export class InvoiceService {
  /**
   * Issue Invoice
   * BR8: Gapless sequence INV-YYYY-MM-NNNN
   * BR9: Issued invoices are immutable and snapshotted
   * BR15: Posts debit entry to Vendor Ledger
   */
  static async issueInvoice(invoiceId, { actorId = null, session = null }) {
    const invoice = await Invoice.findById(invoiceId).session(session);
    if (!invoice) throw new NotFoundError('Invoice', invoiceId);

    if (invoice.documentStatus !== DOCUMENT_STATUS.DRAFT) {
      throw new StateTransitionError('Invoice', invoice.documentStatus, DOCUMENT_STATUS.ISSUED);
    }

    const vendor = await Vendor.findById(invoice.vendorId).session(session);
    if (!vendor) throw new NotFoundError('Vendor', invoice.vendorId);

    // Official gapless invoice number
    const officialInvoiceNumber = await CounterService.getNextNumber('INV', session);

    const issueDate = new Date();
    const paymentTermsDays = vendor.paymentTermsDays || 30;
    const dueDate = new Date(issueDate.getTime() + paymentTermsDays * 24 * 60 * 60 * 1000);

    invoice.invoiceNumber = officialInvoiceNumber;
    invoice.documentStatus = DOCUMENT_STATUS.ISSUED;
    invoice.paymentStatus = PAYMENT_STATUS.UNPAID;
    invoice.issueDate = issueDate;
    invoice.dueDate = dueDate;
    invoice.outstandingPaisa = invoice.grandTotalPaisa;

    // Snapshot details
    invoice.vendorSnapshot = {
      code: vendor.code,
      name: vendor.name,
      phone: vendor.phone || '',
      address: vendor.address
    };

    await invoice.save({ session });

    // Append INVOICE debit entry in Vendor Ledger
    await LedgerService.postEntry({
      vendorId: invoice.vendorId,
      entryType: LEDGER_ENTRY_TYPES.INVOICE,
      debitPaisa: invoice.grandTotalPaisa,
      creditPaisa: 0,
      sourceDocumentType: SOURCE_DOC_TYPES.DISTRIBUTION_ORDER,
      sourceDocumentId: invoice._id,
      description: `Invoice ${invoice.invoiceNumber}`,
      actorId,
      session
    });

    return invoice;
  }

  /**
   * Cancel Invoice
   * BR9: Cancellation requires no payments applied; runs through reversal entries
   */
  static async cancelInvoice(invoiceId, { reason = 'Cancelled', actorId = null, session = null }) {
    const invoice = await Invoice.findById(invoiceId).session(session);
    if (!invoice) throw new NotFoundError('Invoice', invoiceId);

    if (invoice.documentStatus !== DOCUMENT_STATUS.ISSUED) {
      throw new StateTransitionError('Invoice', invoice.documentStatus, DOCUMENT_STATUS.CANCELLED);
    }

    if (invoice.paidPaisa > 0) {
      throw new ValidationError(
        `Cannot cancel invoice ${invoice.invoiceNumber}: payments are already applied (paid: ${invoice.paidPaisa} paisa)`
      );
    }

    invoice.documentStatus = DOCUMENT_STATUS.CANCELLED;
    invoice.cancellationReason = reason;
    invoice.cancelledBy = actorId;
    invoice.cancelledAt = new Date();
    await invoice.save({ session });

    // Post reversal credit entry in Vendor Ledger
    await LedgerService.postEntry({
      vendorId: invoice.vendorId,
      entryType: LEDGER_ENTRY_TYPES.REVERSAL,
      debitPaisa: 0,
      creditPaisa: invoice.grandTotalPaisa,
      sourceDocumentType: SOURCE_DOC_TYPES.DISTRIBUTION_ORDER,
      sourceDocumentId: invoice._id,
      description: `Reversal for cancelled invoice ${invoice.invoiceNumber}: ${reason}`,
      actorId,
      session
    });

    return invoice;
  }
}
