import mongoose from 'mongoose';
import { RETURN_CONDITIONS, RETURN_LIABILITIES } from '../config/constants.js';

const returnItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', default: null },
    deliveredLineIndex: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    condition: {
      type: String,
      enum: Object.values(RETURN_CONDITIONS),
      required: true
    },
    liability: {
      type: String,
      enum: Object.values(RETURN_LIABILITIES),
      required: true
    },
    unitPricePaisa: { type: Number, required: true, min: 0 },
    taxRateBasisPoints: { type: Number, default: 0, min: 0 },
    lineNetPaisa: { type: Number, required: true, min: 0 },
    lineTaxPaisa: { type: Number, required: true, default: 0, min: 0 },
    lineTotalPaisa: { type: Number, required: true, min: 0 },
    reason: { type: String, trim: true },
    imageAttachmentIds: [{ type: mongoose.Schema.Types.ObjectId }]
  },
  { _id: true }
);

const returnSchema = new mongoose.Schema(
  {
    returnNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    distributionOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'DistributionOrder', required: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    items: [returnItemSchema],
    subtotalPaisa: { type: Number, required: true, default: 0, min: 0 },
    taxTotalPaisa: { type: Number, required: true, default: 0, min: 0 },
    grandTotalPaisa: { type: Number, required: true, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'PROCESSED'],
      default: 'PENDING',
      required: true
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    creditNoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditNote', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true,
    versionKey: '__v'
  }
);


returnSchema.index({ distributionOrderId: 1 });
returnSchema.index({ vendorId: 1, status: 1 });

export const Return = mongoose.model('Return', returnSchema);
