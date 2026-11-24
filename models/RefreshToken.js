import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    family: { type: String, required: true }, // Family UUID for reuse detection
    expiresAt: { type: Date, required: true },
    createdByIp: { type: String },
    revokedAt: { type: Date, default: null },
    replacedByTokenHash: { type: String, default: null }
  },
  {
    timestamps: true
  }
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ family: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
