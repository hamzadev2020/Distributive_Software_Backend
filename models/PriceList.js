import mongoose from 'mongoose';

const priceListSchema = new mongoose.Schema(
  {
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    pricePaisa: { type: Number, required: true, min: 0 },
    effectiveFrom: { type: Date, required: true, default: Date.now },
    effectiveTo: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true,
    versionKey: '__v'
  }
);

priceListSchema.index({ vendorId: 1, productId: 1, effectiveFrom: -1 });

export const PriceList = mongoose.model('PriceList', priceListSchema);
