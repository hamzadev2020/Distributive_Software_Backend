import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true, required: true }
  },
  {
    timestamps: true,
    versionKey: '__v'
  }
);



export const Category = mongoose.model('Category', categorySchema);
