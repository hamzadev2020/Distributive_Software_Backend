import express from 'express';
import { Return } from '../models/Return.js';
import { ReturnService } from '../services/return.service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { vendorId, status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (vendorId) filter.vendorId = vendorId;
    if (status) filter.status = status;

    const returns = await Return.find(filter)
      .populate('vendorId', 'code name')
      .populate('distributionOrderId', 'orderNumber')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    const total = await Return.countDocuments(filter);

    res.json({
      success: true,
      data: returns,
      pagination: { total, page: Number(page), limit: Number(limit) }
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.WAREHOUSE_STAFF), async (req, res, next) => {
  try {
    const ret = await ReturnService.createReturn({
      ...req.body,
      actorId: req.user._id
    });
    res.status(201).json({ success: true, data: ret });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/approve', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN), async (req, res, next) => {
  try {
    const ret = await ReturnService.approveReturn(req.params.id, {
      approverId: req.user._id
    });
    res.json({ success: true, data: ret });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/process', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN), requireIdempotency, async (req, res, next) => {
  try {
    const result = await ReturnService.processReturn(req.params.id, {
      actorId: req.user._id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
