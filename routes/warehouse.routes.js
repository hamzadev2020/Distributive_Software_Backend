import express from 'express';
import { Warehouse } from '../models/Warehouse.js';
import { StockBalance } from '../models/StockBalance.js';
import { StockMovement } from '../models/StockMovement.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// List all active warehouses
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const warehouses = await Warehouse.find({ deletedAt: null }).sort({ name: 1 });
    
    // Attach stock counts per warehouse
    const enhanced = await Promise.all(
      warehouses.map(async (wh) => {
        const balances = await StockBalance.find({ warehouseId: wh._id });
        const totalOnHand = balances.reduce((sum, b) => sum + (b.onHand || 0), 0);
        const totalReserved = balances.reduce((sum, b) => sum + (b.reserved || 0), 0);
        const totalAvailable = balances.reduce((sum, b) => sum + (b.available || (b.onHand - b.reserved)), 0);

        return {
          ...wh.toObject(),
          totalOnHand,
          totalReserved,
          totalAvailable,
          skuCount: balances.length
        };
      })
    );

    res.json({
      success: true,
      data: enhanced
    });
  } catch (err) {
    next(err);
  }
});

// Create warehouse (Admin / Super Admin only)
router.post('/', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN), async (req, res, next) => {
  try {
    const { code, name, address } = req.body;
    if (!code || !name) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Warehouse code and name are required' }
      });
    }

    const warehouse = new Warehouse({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      address: address ? address.trim() : ''
    });

    await warehouse.save();
    res.status(201).json({ success: true, data: warehouse });
  } catch (err) {
    next(err);
  }
});

// Get warehouse details with current stock
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const warehouse = await Warehouse.findById(req.params.id);
    if (!warehouse || warehouse.deletedAt) {
      return res.status(404).json({ success: false, error: { message: 'Warehouse not found' } });
    }

    const balances = await StockBalance.find({ warehouseId: warehouse._id })
      .populate('productId', 'sku name baseUnit')
      .populate('batchId', 'batchNumber expiryDate');

    res.json({
      success: true,
      data: {
        warehouse,
        stockBalances: balances
      }
    });
  } catch (err) {
    next(err);
  }
});

// Soft delete warehouse (only if unreferenced by stock movements)
router.delete('/:id', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN), async (req, res, next) => {
  try {
    const warehouse = await Warehouse.findById(req.params.id);
    if (!warehouse) {
      return res.status(404).json({ success: false, error: { message: 'Warehouse not found' } });
    }

    const movementCount = await StockMovement.countDocuments({ warehouseId: warehouse._id });
    if (movementCount > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REFERENCED_ENTITY',
          message: 'Cannot delete warehouse because historical stock movements reference it. Deactivate instead.'
        }
      });
    }

    warehouse.deletedAt = new Date();
    warehouse.isActive = false;
    await warehouse.save();

    res.json({ success: true, message: 'Warehouse soft-deleted successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
