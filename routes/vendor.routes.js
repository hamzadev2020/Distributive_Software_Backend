import express from 'express';
import { Vendor } from '../models/Vendor.js';
import { LedgerService } from '../services/ledger.service.js';
import { CounterService } from '../services/counter.service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole, sanitizeWarehouseStaffPrices } from '../middleware/rbac.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// List vendors
router.get('/', requireAuth, sanitizeWarehouseStaffPrices, async (req, res, next) => {
  try {
    const { page = 1, limit = 50, search = '' } = req.query;
    const query = { deletedAt: null };
    if (search) {
      query.$or = [
        { name: new RegExp(search, 'i') },
        { code: new RegExp(search, 'i') },
        { phone: new RegExp(search, 'i') }
      ];
    }

    const vendors = await Vendor.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ name: 1 });

    const total = await Vendor.countDocuments(query);

    res.json({
      success: true,
      data: vendors,
      pagination: { total, page: Number(page), limit: Number(limit) }
    });
  } catch (err) {
    next(err);
  }
});

// Preview next customer code (starts from 700)
router.get('/next-code', requireAuth, async (req, res, next) => {
  try {
    const nextCode = await CounterService.previewNextCustomerCode();
    res.json({ success: true, data: { nextCode } });
  } catch (err) {
    next(err);
  }
});

// Create vendor / customer
router.post('/', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN), async (req, res, next) => {
  try {
    if (!req.body.code || String(req.body.code).trim() === '') {
      req.body.code = await CounterService.getNextCustomerCode();
    } else {
      const existing = await Vendor.findOne({ code: String(req.body.code).trim().toUpperCase(), deletedAt: null });
      if (existing) {
        req.body.code = await CounterService.getNextCustomerCode();
      }
    }
    const vendor = new Vendor(req.body);
    await vendor.save();
    res.status(201).json({ success: true, data: vendor });
  } catch (err) {
    next(err);
  }
});

// Update vendor / customer
router.put('/:id', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN), async (req, res, next) => {
  try {
    const { name, contactPerson, phone, address, paymentTermsDays, creditLimitPaisa, isActive } = req.body;
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor || vendor.deletedAt) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Customer not found' } });
    }

    if (name) vendor.name = name.trim();
    if (contactPerson !== undefined) vendor.contactPerson = contactPerson ? contactPerson.trim() : '';
    if (phone !== undefined) vendor.phone = phone ? phone.trim() : '';
    if (address !== undefined) vendor.address = address;
    if (paymentTermsDays !== undefined) vendor.paymentTermsDays = Number(paymentTermsDays);
    if (creditLimitPaisa !== undefined) vendor.creditLimitPaisa = Number(creditLimitPaisa);
    if (isActive !== undefined) vendor.isActive = Boolean(isActive);

    await vendor.save();
    res.json({ success: true, data: vendor });
  } catch (err) {
    next(err);
  }
});

// Soft delete vendor / customer
router.delete('/:id', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN), async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor || vendor.deletedAt) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Customer not found' } });
    }

    vendor.deletedAt = new Date();
    vendor.isActive = false;
    await vendor.save();

    res.json({ success: true, message: 'Customer successfully deleted' });
  } catch (err) {
    next(err);
  }
});

// Get vendor by ID with balance
router.get('/:id', requireAuth, sanitizeWarehouseStaffPrices, async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Vendor not found' } });
    }

    let ledgerBalance = null;
    if (req.user.role !== ROLES.WAREHOUSE_STAFF) {
      ledgerBalance = await LedgerService.getVendorBalance(vendor._id);
    }

    res.json({
      success: true,
      data: {
        vendor,
        ledger: ledgerBalance
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;
