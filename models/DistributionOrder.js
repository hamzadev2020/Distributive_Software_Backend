import mongoose from 'mongoose';
import { ORDER_STATUS } from '../config/constants.js';

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', default: null },
    quantity: { type: Number, required: true, min: 1 },
    allocatedQty: { type: Number, default: 0, min: 0 },
    dispatchedQty: { type: Number, default: 0, min: 0 },
    deliveredQty: { type: Number, default: 0, min: 0 },
    returnedQty: { type: Number, default: 0, min: 0 },
    lostQty: { type: Number, default: 0, min: 0 },
    damagedQty: { type: Number, default: 0, min: 0 },
    unitPricePaisa: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0 }, // Basis points (500 = 5%)
    discountFlatPaisa: { type: Number, default: 0, min: 0 },
    taxRateBasisPoints: { type: Number, default: 0, min: 0 },
    lineNetPaisa: { type: Number, required: true, min: 0 },
    lineTaxPaisa: { type: Number, required: true, default: 0, min: 0 },
    lineTotalPaisa: { type: Number, required: true, min: 0 }
  },
  { _id: true }
);

const distributionOrderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    distributionRunId: { type: mongoose.Schema.Types.ObjectId, default: null },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.DRAFT,
      required: true
    },
    items: [orderItemSchema],
    orderDiscountFlatPaisa: { type: Number, default: 0, min: 0 },
    subtotalPaisa: { type: Number, required: true, default: 0, min: 0 },
    taxTotalPaisa: { type: Number, required: true, default: 0, min: 0 },
    grandTotalPaisa: { type: Number, required: true, default: 0, min: 0 },
    notes: { type: String, trim: true },
    cancellationReason: { type: String, trim: true },
    closedReason: { type: String, trim: true },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true,
    versionKey: '__v'
  }
);


distributionOrderSchema.index({ vendorId: 1, status: 1, createdAt: -1 });

export const DistributionOrder = mongoose.model('DistributionOrder', distributionOrderSchema);
