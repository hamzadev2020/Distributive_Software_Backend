import express from 'express';
import { DistributionOrder } from '../models/DistributionOrder.js';
import { OrderService } from '../services/order.service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole, sanitizeWarehouseStaffPrices } from '../middleware/rbac.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

router.get('/', requireAuth, sanitizeWarehouseStaffPrices, async (req, res, next) => {
  try {
    const { status, vendorId, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (vendorId) filter.vendorId = vendorId;

    const orders = await DistributionOrder.find(filter)
      .populate('vendorId', 'code name')
      .populate('warehouseId', 'code name')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    const total = await DistributionOrder.countDocuments(filter);

    res.json({
      success: true,
      data: orders,
      pagination: { total, page: Number(page), limit: Number(limit) }
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.WAREHOUSE_STAFF), async (req, res, next) => {
  try {
    const order = await OrderService.createOrder({
      ...req.body,
      actorId: req.user._id
    });
    res.status(201).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, sanitizeWarehouseStaffPrices, async (req, res, next) => {
  try {
    const order = await DistributionOrder.findById(req.params.id)
      .populate('vendorId', 'code name phone address')
      .populate('warehouseId', 'code name')
      .populate('items.productId', 'sku name baseUnit');
    if (!order) {
      return res.status(404).json({ success: false, error: { message: 'Order not found' } });
    }
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/allocate', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.WAREHOUSE_STAFF), requireIdempotency, async (req, res, next) => {
  try {
    const order = await OrderService.allocateOrder(req.params.id, { actorId: req.user._id });
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN), async (req, res, next) => {
  try {
    const { reason } = req.body;
    const order = await OrderService.cancelOrder(req.params.id, { reason, actorId: req.user._id });
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
});

export default router;
