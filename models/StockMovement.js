import mongoose from 'mongoose';
import { STOCK_MOVEMENT_TYPES, SOURCE_DOC_TYPES } from '../config/constants.js';

const stockMovementSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: Object.values(STOCK_MOVEMENT_TYPES),
      required: true
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: true
    },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Batch',
      default: null
    },
    quantityOnHand: {
      type: Number,
      required: true,
      default: 0
    },
    quantityReserved: {
      type: Number,
      required: true,
      default: 0
    },
    quantityInTransit: {
      type: Number,
      required: true,
      default: 0
    },
    quantityQuarantined: {
      type: Number,
      required: true,
      default: 0
    },
    sourceDocumentType: {
      type: String,
      enum: Object.values(SOURCE_DOC_TYPES),
      required: true
    },
    sourceDocumentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
      default: null
    },
    reason: {
      type: String,
      trim: true
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      default: null
    },
    costPaisaPerUnit: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false } // Append-only: no updatedAt
  }
);

// Indexes
stockMovementSchema.index({ productId: 1, warehouseId: 1, createdAt: -1 });
stockMovementSchema.index({ sourceDocumentType: 1, sourceDocumentId: 1 });
stockMovementSchema.index({ createdAt: -1 });

// Guard against updates/deletes in Mongoose layer
stockMovementSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], function () {
  throw new Error('FATAL: StockMovement is append-only. Updates are strictly forbidden.');
});

stockMovementSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  throw new Error('FATAL: StockMovement is append-only. Deletes are strictly forbidden.');
});

export const StockMovement = mongoose.model('StockMovement', stockMovementSchema);
