import express from 'express';
import { StockBalance } from '../models/StockBalance.js';
import { StockService } from '../services/stock.service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// List balances
router.get('/balances', requireAuth, async (req, res, next) => {
  try {
    const { productId, warehouseId } = req.query;
    const filter = {};
    if (productId) filter.productId = productId;
    if (warehouseId) filter.warehouseId = warehouseId;

    const balances = await StockBalance.find(filter)
      .populate('productId', 'sku name baseUnit')
      .populate('warehouseId', 'code name')
      .populate('batchId', 'batchNumber expiryDate');

    res.json({ success: true, data: balances });
  } catch (err) {
    next(err);
  }
});

// Goods receipt (Stock-In)
router.post('/goods-receipt', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.WAREHOUSE_STAFF), requireIdempotency, async (req, res, next) => {
  try {
    const { productId, warehouseId, batchId, quantity, unitCostPaisa, reason } = req.body;
    const result = await StockService.receiveStock({
      productId,
      warehouseId,
      batchId,
      quantity,
      unitCostPaisa,
      reason,
      actorId: req.user._id
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// Transfer stock
router.post('/transfer', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.WAREHOUSE_STAFF), requireIdempotency, async (req, res, next) => {
  try {
    const { productId, fromWarehouseId, toWarehouseId, batchId, quantity, reason } = req.body;
    const result = await StockService.transferStock({
      productId,
      fromWarehouseId,
      toWarehouseId,
      batchId,
      quantity,
      reason,
      actorId: req.user._id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// Reconciliation check
router.get('/reconcile', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN), async (req, res, next) => {
  try {
    const { productId, warehouseId, batchId } = req.query;
    if (!productId || !warehouseId) {
      return res.status(400).json({ success: false, error: { message: 'productId and warehouseId are required' } });
    }
    const result = await StockService.reconcileStock(productId, warehouseId, batchId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
