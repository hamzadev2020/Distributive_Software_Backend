import mongoose from 'mongoose';

const challanItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', default: null },
    dispatchedQty: { type: Number, required: true, min: 1 },
    deliveredQty: { type: Number, default: 0, min: 0 },
    deliveryDate: { type: Date },
    receiverName: { type: String, trim: true },
    proofImageAttachmentId: { type: mongoose.Schema.Types.ObjectId, default: null }
  },
  { _id: true }
);

const deliveryChallanSchema = new mongoose.Schema(
  {
    challanNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    distributionOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'DistributionOrder', required: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    items: [challanItemSchema],
    transporterName: { type: String, trim: true },
    vehicleNumber: { type: String, trim: true },
    driverName: { type: String, trim: true },
    driverPhone: { type: String, trim: true },
    dispatchDate: { type: Date, required: true, default: Date.now },
    status: {
      type: String,
      enum: ['DISPATCHED', 'PARTIALLY_DELIVERED', 'DELIVERED'],
      default: 'DISPATCHED',
      required: true
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true,
    versionKey: '__v'
  }
);


deliveryChallanSchema.index({ distributionOrderId: 1 });
deliveryChallanSchema.index({ vendorId: 1, status: 1 });

export const DeliveryChallan = mongoose.model('DeliveryChallan', deliveryChallanSchema);
