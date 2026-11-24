import mongoose from 'mongoose';

const idempotencyKeySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    path: { type: String, required: true },
    method: { type: String, required: true },
    statusCode: { type: Number, required: true },
    responseBody: { type: mongoose.Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) }
  },
  {
    timestamps: true
  }
);


idempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Auto-expire after 24h

export const IdempotencyKey = mongoose.model('IdempotencyKey', idempotencyKeySchema);
