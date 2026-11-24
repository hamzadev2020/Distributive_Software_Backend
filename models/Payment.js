import mongoose from 'mongoose';
import { PAYMENT_METHODS, CHEQUE_STATUS } from '../config/constants.js';

const paymentSchema = new mongoose.Schema(
  {
    paymentNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    amountPaisa: { type: Number, required: true, min: 1 },
    method: {
      type: String,
      enum: Object.values(PAYMENT_METHODS),
      required: true
    },
    chequeDetails: {
      chequeNumber: { type: String, trim: true },
      bankName: { type: String, trim: true },
      chequeDate: { type: Date },
      clearingStatus: {
        type: String,
        enum: Object.values(CHEQUE_STATUS),
        default: CHEQUE_STATUS.PENDING
      },
      clearedAt: { type: Date },
      bounceReason: { type: String, trim: true }
    },
    withholdingTaxPaisa: { type: Number, default: 0, min: 0 },
    receivedDate: { type: Date, required: true, default: Date.now },
    referenceNumber: { type: String, trim: true },
    status: {
      type: String,
      enum: ['RECEIVED', 'CLEARED', 'BOUNCED', 'REVERSED'],
      default: 'RECEIVED',
      required: true
    },
    reversalReason: { type: String, trim: true },
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reversedAt: { type: Date },
    allocatedPaisa: { type: Number, default: 0, min: 0 },
    unallocatedPaisa: { type: Number, required: true, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true,
    versionKey: '__v'
  }
);


paymentSchema.index({ vendorId: 1, status: 1, receivedDate: -1 });

export const Payment = mongoose.model('Payment', paymentSchema);
