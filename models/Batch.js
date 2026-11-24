import mongoose from 'mongoose';

const batchSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    batchNumber: { type: String, required: true, uppercase: true, trim: true },
    manufacturingDate: { type: Date },
    expiryDate: { type: Date },
    notes: { type: String, trim: true }
  },
  {
    timestamps: true,
    versionKey: '__v'
  }
);

batchSchema.index({ productId: 1, batchNumber: 1 }, { unique: true });
batchSchema.index({ productId: 1, expiryDate: 1 });

export const Batch = mongoose.model('Batch', batchSchema);
