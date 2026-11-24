import express from 'express';
import { Product } from '../models/Product.js';
import { StockBalance } from '../models/StockBalance.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole, sanitizeWarehouseStaffPrices } from '../middleware/rbac.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

router.get('/', requireAuth, sanitizeWarehouseStaffPrices, async (req, res, next) => {
  try {
    const { page = 1, limit = 50, search = '' } = req.query;
    const query = { deletedAt: null };
    if (search) {
      query.$or = [
        { name: new RegExp(search, 'i') },
        { sku: new RegExp(search, 'i') }
      ];
    }

    const products = await Product.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ name: 1 });

    const total = await Product.countDocuments(query);

    res.json({
      success: true,
      data: products,
      pagination: { total, page: Number(page), limit: Number(limit) }
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN), async (req, res, next) => {
  try {
    const product = new Product(req.body);
    await product.save();
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, sanitizeWarehouseStaffPrices, async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Product not found' } });
    }

    const balances = await StockBalance.find({ productId: product._id }).populate('warehouseId', 'code name');

    res.json({
      success: true,
      data: {
        product,
        stockBalances: balances
      }
    });
  } catch (err) {
    next(err);
  }
});

// Update product
router.put('/:id', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN), async (req, res, next) => {
  try {
    const { name, baseUnit, cartonSize, salePricePaisa, costPricePaisa, taxRatePercent, reorderLevel, isActive } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product || product.deletedAt) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Product not found' } });
    }

    if (name) product.name = name.trim();
    if (baseUnit) product.baseUnit = baseUnit.trim();
    if (cartonSize !== undefined) product.cartonSize = Number(cartonSize);
    if (salePricePaisa !== undefined) product.salePricePaisa = Number(salePricePaisa);
    if (costPricePaisa !== undefined) product.costPricePaisa = Number(costPricePaisa);
    if (taxRatePercent !== undefined) product.taxRatePercent = Number(taxRatePercent);
    if (reorderLevel !== undefined) product.reorderLevel = Number(reorderLevel);
    if (isActive !== undefined) product.isActive = Boolean(isActive);

    await product.save();
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
});

// Soft delete product
router.delete('/:id', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN), async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product || product.deletedAt) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Product not found' } });
    }

    product.deletedAt = new Date();
    product.isActive = false;
    await product.save();

    res.json({ success: true, message: 'Product successfully deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
