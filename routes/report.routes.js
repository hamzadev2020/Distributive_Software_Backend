import express from 'express';
import { ReportService } from '../services/report.service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// BR19: Not-received report
router.get('/not-received', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN), async (req, res, next) => {
  try {
    const { fromDate, toDate } = req.query;
    if (!fromDate || !toDate) {
      return res.status(400).json({ success: false, error: { message: 'fromDate and toDate query parameters are required' } });
    }
    const report = await ReportService.getNotReceivedReport({ fromDate, toDate });
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

// Receivables aging
router.get('/aging', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.ACCOUNTANT), async (req, res, next) => {
  try {
    const aging = await ReportService.getAgingReport();
    res.json({ success: true, data: aging });
  } catch (err) {
    next(err);
  }
});

// Stock valuation
router.get('/valuation', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.ACCOUNTANT), async (req, res, next) => {
  try {
    const valuation = await ReportService.getStockValuation();
    res.json({ success: true, data: valuation });
  } catch (err) {
    next(err);
  }
});

export default router;
