import mongoose from 'mongoose';
import { LEDGER_ENTRY_TYPES } from '../config/constants.js';

const ledgerEntrySchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true
    },
    sequenceNumber: {
      type: Number,
      required: true,
      min: 1
    },
    entryType: {
      type: String,
      enum: Object.values(LEDGER_ENTRY_TYPES),
      required: true
    },
    debitPaisa: {
      type: Number,
      required: true,
      default: 0,
      min: 0
    },
    creditPaisa: {
      type: Number,
      required: true,
      default: 0,
      min: 0
    },
    sourceDocumentType: {
      type: String,
      required: true
    },
    sourceDocumentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },
    description: {
      type: String,
      trim: true
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false } // Append-only
  }
);

ledgerEntrySchema.index({ vendorId: 1, sequenceNumber: 1 }, { unique: true });
ledgerEntrySchema.index({ vendorId: 1, createdAt: -1 });

// Guard against updates/deletes in Mongoose layer
ledgerEntrySchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], function () {
  throw new Error('FATAL: LedgerEntry is append-only. Updates are strictly forbidden.');
});

ledgerEntrySchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  throw new Error('FATAL: LedgerEntry is append-only. Deletes are strictly forbidden.');
});

export const LedgerEntry = mongoose.model('LedgerEntry', ledgerEntrySchema);
