import mongoose from 'mongoose';

const creditNoteItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', default: null },
    quantity: { type: Number, required: true, min: 1 },
    unitPricePaisa: { type: Number, required: true, min: 0 },
    taxRateBasisPoints: { type: Number, default: 0, min: 0 },
    lineNetPaisa: { type: Number, required: true, min: 0 },
    lineTaxPaisa: { type: Number, required: true, default: 0, min: 0 },
    lineTotalPaisa: { type: Number, required: true, min: 0 },
    reason: { type: String, trim: true }
  },
  { _id: true }
);

const creditNoteSchema = new mongoose.Schema(
  {
    creditNoteNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    returnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Return', default: null },
    adjustmentId: { type: mongoose.Schema.Types.ObjectId, default: null },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    items: [creditNoteItemSchema],
    totalPaisa: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['DRAFT', 'ISSUED', 'APPLIED', 'CANCELLED'],
      default: 'DRAFT',
      required: true
    },
    appliedToInvoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    appliedAsVendorCredit: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true,
    versionKey: '__v'
  }
);


creditNoteSchema.index({ vendorId: 1, status: 1 });
creditNoteSchema.index({ invoiceId: 1 });

export const CreditNote = mongoose.model('CreditNote', creditNoteSchema);
