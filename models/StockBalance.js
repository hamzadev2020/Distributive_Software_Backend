import mongoose from 'mongoose';

const stockBalanceSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', default: null },
    onHand: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'onHand cannot be negative']
    },
    reserved: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'reserved cannot be negative']
    },
    inTransit: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'inTransit cannot be negative']
    },
    quarantined: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'quarantined cannot be negative']
    }
  },
  {
    timestamps: true,
    versionKey: '__v',
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual for available stock: onHand - reserved
stockBalanceSchema.virtual('available').get(function () {
  return (this.onHand || 0) - (this.reserved || 0);
});

// Unique compound index across product, warehouse, and batch
stockBalanceSchema.index({ productId: 1, warehouseId: 1, batchId: 1 }, { unique: true });
stockBalanceSchema.index({ warehouseId: 1, productId: 1 });

export const StockBalance = mongoose.model('StockBalance', stockBalanceSchema);
