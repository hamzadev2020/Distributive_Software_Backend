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
      .populate('items.productId', 'sku name salePricePaisa baseUnit')
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

// Edit draft order
router.put('/:id', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.WAREHOUSE_STAFF), async (req, res, next) => {
  try {
    const order = await DistributionOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: { message: 'Order not found' } });
    if (order.status !== 'DRAFT') {
      return res.status(400).json({ success: false, error: { message: 'Only DRAFT orders can be edited' } });
    }
    const { vendorId, warehouseId, quantity, productId, unitPricePaisa, discountPercent, discountFlatPaisa } = req.body;
    if (vendorId) order.vendorId = vendorId;
    if (warehouseId) order.warehouseId = warehouseId;
    if (order.items && order.items.length > 0) {
      if (quantity) order.items[0].quantity = Number(quantity);
      if (productId) order.items[0].productId = productId;
      if (unitPricePaisa !== undefined && unitPricePaisa !== null) {
        order.items[0].unitPricePaisa = Math.round(Number(unitPricePaisa));
      }
      if (discountPercent !== undefined) {
        const bp = Number(discountPercent) > 0 && Number(discountPercent) <= 100 
          ? Math.round(Number(discountPercent) * 100) 
          : Math.round(Number(discountPercent));
        order.items[0].discountPercent = bp;
      }
      if (discountFlatPaisa !== undefined) {
        order.items[0].discountFlatPaisa = Math.round(Number(discountFlatPaisa));
      }

      const q = order.items[0].quantity;
      const unitP = order.items[0].unitPricePaisa || 0;
      const discPercent = order.items[0].discountPercent || 0;
      const discFlat = order.items[0].discountFlatPaisa || 0;
      const taxRate = order.items[0].taxRateBasisPoints || 100;

      const lineGross = q * unitP;
      const percentDiscount = discPercent > 0 ? Math.round((lineGross * discPercent) / 10000) : 0;
      const lineNet = Math.max(0, lineGross - percentDiscount - discFlat);
      const lineTax = Math.round((lineNet * taxRate) / 10000);
      const lineTotal = lineNet + lineTax;

      order.items[0].lineNetPaisa = lineNet;
      order.items[0].lineTaxPaisa = lineTax;
      order.items[0].lineTotalPaisa = lineTotal;

      order.subtotalPaisa = lineNet;
      order.taxTotalPaisa = lineTax;
      order.grandTotalPaisa = lineTotal;
    }
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
});

// Delete draft/cancelled order
router.delete('/:id', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.WAREHOUSE_STAFF), async (req, res, next) => {
  try {
    const order = await DistributionOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: { message: 'Order not found' } });
    if (order.status !== 'DRAFT' && order.status !== 'CANCELLED') {
      return res.status(400).json({ success: false, error: { message: 'Only DRAFT or CANCELLED orders can be deleted' } });
    }
    await DistributionOrder.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Order deleted successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
