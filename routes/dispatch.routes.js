import express from 'express';
import { DeliveryChallan } from '../models/DeliveryChallan.js';
import { DispatchService } from '../services/dispatch.service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

router.get('/challans', requireAuth, async (req, res, next) => {
  try {
    const { status, vendorId, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (vendorId) filter.vendorId = vendorId;

    const challans = await DeliveryChallan.find(filter)
      .populate('vendorId', 'code name')
      .populate('warehouseId', 'code name')
      .populate('distributionOrderId', 'orderNumber')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    const total = await DeliveryChallan.countDocuments(filter);

    res.json({
      success: true,
      data: challans,
      pagination: { total, page: Number(page), limit: Number(limit) }
    });
  } catch (err) {
    next(err);
  }
});

// Dispatch order
router.post('/dispatch', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.WAREHOUSE_STAFF), requireIdempotency, async (req, res, next) => {
  try {
    const { orderId, transporterName, vehicleNumber, driverName, driverPhone } = req.body;
    const result = await DispatchService.dispatchOrder(orderId, {
      transporterName,
      vehicleNumber,
      driverName,
      driverPhone,
      actorId: req.user._id
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// Confirm delivery
router.post('/confirm-delivery', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.WAREHOUSE_STAFF), requireIdempotency, async (req, res, next) => {
  try {
    const { challanId, lineDeliveries, receiverName } = req.body;
    const result = await DispatchService.confirmDelivery(challanId, {
      lineDeliveries,
      receiverName,
      actorId: req.user._id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
