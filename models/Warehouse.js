import mongoose from 'mongoose';

const warehouseSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    address: { type: String, trim: true },
    isActive: { type: Boolean, default: true, required: true },
    deletedAt: { type: Date, default: null }
  },
  {
    timestamps: true,
    versionKey: '__v'
  }
);

warehouseSchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);

export const Warehouse = mongoose.model('Warehouse', warehouseSchema);
