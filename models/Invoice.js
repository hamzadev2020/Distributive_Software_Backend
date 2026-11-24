import mongoose from 'mongoose';
import { DOCUMENT_STATUS, PAYMENT_STATUS } from '../config/constants.js';

const invoiceItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true },
    productName: { type: String, required: true },
    batchNumber: { type: String, default: null },
    quantity: { type: Number, required: true, min: 1 },
    unitPricePaisa: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0 },
    discountFlatPaisa: { type: Number, default: 0, min: 0 },
    taxRateBasisPoints: { type: Number, default: 0, min: 0 },
    lineNetPaisa: { type: Number, required: true, min: 0 },
    lineTaxPaisa: { type: Number, required: true, default: 0, min: 0 },
    lineTotalPaisa: { type: Number, required: true, min: 0 },
    cogsPaisaPerUnit: { type: Number, default: 0, min: 0 }
  },
  { _id: true }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    distributionOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'DistributionOrder', required: true },
    deliveryChallanId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryChallan', default: null },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    documentStatus: {
      type: String,
      enum: Object.values(DOCUMENT_STATUS),
      default: DOCUMENT_STATUS.DRAFT,
      required: true
    },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.UNPAID,
      required: true
    },
    vendorSnapshot: {
      code: String,
      name: String,
      ntn: String,
      salesTaxReg: String,
      address: mongoose.Schema.Types.Mixed
    },
    companySnapshot: {
      name: { type: String, default: 'RZ PHARMA DISTRIBUTORS' },
      phone: { type: String, default: '0336-7388274' },
      address: { type: String, default: 'BALDHER HARIPUR' }
    },
    items: [invoiceItemSchema],
    subtotalPaisa: { type: Number, required: true, default: 0, min: 0 },
    discountTotalPaisa: { type: Number, required: true, default: 0, min: 0 },
    taxTotalPaisa: { type: Number, required: true, default: 0, min: 0 },
    grandTotalPaisa: { type: Number, required: true, default: 0, min: 0 },
    paidPaisa: { type: Number, required: true, default: 0, min: 0 },
    outstandingPaisa: { type: Number, required: true, default: 0, min: 0 },
    issueDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    cancellationReason: { type: String, trim: true },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true,
    versionKey: '__v',
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual: isOverdue (Derived, never stored!)
invoiceSchema.virtual('isOverdue').get(function () {
  if (this.documentStatus !== DOCUMENT_STATUS.ISSUED) return false;
  if (this.outstandingPaisa <= 0) return false;
  if (!this.dueDate) return false;
  return new Date() > new Date(this.dueDate);
});


invoiceSchema.index({ vendorId: 1, paymentStatus: 1, dueDate: 1 });
invoiceSchema.index({ documentStatus: 1, dueDate: 1 });

export const Invoice = mongoose.model('Invoice', invoiceSchema);
