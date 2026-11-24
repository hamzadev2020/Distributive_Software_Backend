import mongoose from 'mongoose';
import { LedgerEntry } from '../models/LedgerEntry.js';
import { LEDGER_ENTRY_TYPES } from '../config/constants.js';
import { ValidationError } from '../utils/errors.js';

export class LedgerService {
  /**
   * Append an immutable ledger entry for a vendor with next per-vendor sequence number
   */
  static async postEntry({
    vendorId,
    entryType,
    debitPaisa = 0,
    creditPaisa = 0,
    sourceDocumentType,
    sourceDocumentId = null,
    description = '',
    actorId = null,
    session = null
  }) {
    if (!vendorId) throw new ValidationError('vendorId is required for ledger entry');
    if (!Number.isInteger(debitPaisa) || debitPaisa < 0) {
      throw new ValidationError('debitPaisa must be a non-negative integer');
    }
    if (!Number.isInteger(creditPaisa) || creditPaisa < 0) {
      throw new ValidationError('creditPaisa must be a non-negative integer');
    }
    if (debitPaisa === 0 && creditPaisa === 0) {
      throw new ValidationError('At least one of debitPaisa or creditPaisa must be positive');
    }

    // Get last sequence number for this vendor
    const lastEntry = await LedgerEntry.findOne({ vendorId })
      .sort({ sequenceNumber: -1 })
      .session(session);

    const nextSeq = lastEntry ? lastEntry.sequenceNumber + 1 : 1;

    const entry = new LedgerEntry({
      vendorId,
      sequenceNumber: nextSeq,
      entryType,
      debitPaisa,
      creditPaisa,
      sourceDocumentType,
      sourceDocumentId,
      description,
      actorId
    });

    await entry.save({ session });
    return entry;
  }

  /**
   * Get vendor outstanding balance: sum(debits) - sum(credits)
   * A positive balance means the vendor owes money (Accounts Receivable)
   */
  static async getVendorBalance(vendorId, session = null) {
    const vId = new mongoose.Types.ObjectId(vendorId);
    const [result] = await LedgerEntry.aggregate([
      { $match: { vendorId: vId } },
      {
        $group: {
          _id: null,
          totalDebit: { $sum: '$debitPaisa' },
          totalCredit: { $sum: '$creditPaisa' }
        }
      }
    ]).session(session);

    const totalDebit = result ? result.totalDebit : 0;
    const totalCredit = result ? result.totalCredit : 0;
    const balancePaisa = totalDebit - totalCredit;

    return {
      vendorId,
      totalDebitPaisa: totalDebit,
      totalCreditPaisa: totalCredit,
      balancePaisa
    };
  }
}
