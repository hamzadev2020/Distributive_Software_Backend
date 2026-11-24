import mongoose from 'mongoose';

const vendorSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    contactPerson: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      province: { type: String, trim: true },
      postalCode: { type: String, trim: true }
    },
    ntn: { type: String, trim: true, default: null },
    salesTaxRegistration: { type: String, trim: true },
    paymentTermsDays: { type: Number, required: true, default: 30, min: 0 },
    creditLimitPaisa: { type: Number, required: true, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null }
  },
  {
    timestamps: true,
    versionKey: '__v'
  }
);

vendorSchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);

vendorSchema.index(
  { ntn: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null, ntn: { $type: 'string' } } }
);

vendorSchema.index({ isActive: 1, name: 1 });

export const Vendor = mongoose.model('Vendor', vendorSchema);
