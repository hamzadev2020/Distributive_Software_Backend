import mongoose from 'mongoose';

const paymentAllocationSchema = new mongoose.Schema(
  {
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    amountPaisa: { type: Number, required: true, min: 1 }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

paymentAllocationSchema.index({ paymentId: 1, invoiceId: 1 }, { unique: true });
paymentAllocationSchema.index({ invoiceId: 1 });

export const PaymentAllocation = mongoose.model('PaymentAllocation', paymentAllocationSchema);
