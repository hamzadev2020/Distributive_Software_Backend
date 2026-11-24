import express from 'express';
import { Payment } from '../models/Payment.js';
import { PaymentService } from '../services/payment.service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

router.get('/', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.ACCOUNTANT), async (req, res, next) => {
  try {
    const { vendorId, method, status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (vendorId) filter.vendorId = vendorId;
    if (method) filter.method = method;
    if (status) filter.status = status;

    const payments = await Payment.find(filter)
      .populate('vendorId', 'code name')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    const total = await Payment.countDocuments(filter);

    res.json({
      success: true,
      data: payments,
      pagination: { total, page: Number(page), limit: Number(limit) }
    });
  } catch (err) {
    next(err);
  }
});

// Record Payment
router.post('/', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.ACCOUNTANT), requireIdempotency, async (req, res, next) => {
  try {
    const payment = await PaymentService.recordPayment({
      ...req.body,
      actorId: req.user._id
    });
    res.status(201).json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
});

// Clear cheque
router.post('/:id/clear-cheque', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.ACCOUNTANT), requireIdempotency, async (req, res, next) => {
  try {
    const payment = await PaymentService.clearCheque(req.params.id, { actorId: req.user._id });
    res.json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
});

// Bounce cheque
router.post('/:id/bounce-cheque', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.ACCOUNTANT), requireIdempotency, async (req, res, next) => {
  try {
    const { reason } = req.body;
    const payment = await PaymentService.bounceCheque(req.params.id, { reason, actorId: req.user._id });
    res.json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
});

export default router;
