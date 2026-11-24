import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: false },
    barcode: { type: String, trim: true, default: null },
    baseUnit: { type: String, required: true, default: 'piece', trim: true },
    cartonSize: { type: Number, required: true, default: 1, min: 1 },
    salePricePaisa: { type: Number, required: true, min: 0 },
    costPricePaisa: { type: Number, required: true, default: 0, min: 0 },
    taxRatePercent: { type: Number, required: true, default: 0, min: 0 }, // Basis points (1800 = 18.00%)
    trackBatch: { type: Boolean, default: false },
    trackExpiry: { type: Boolean, default: false },
    reorderLevel: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null }
  },
  {
    timestamps: true,
    versionKey: '__v'
  }
);

productSchema.index(
  { sku: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);

productSchema.index(
  { barcode: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null, barcode: { $type: 'string' } } }
);

productSchema.index({ name: 'text', sku: 'text' });
productSchema.index({ categoryId: 1 });

export const Product = mongoose.model('Product', productSchema);
