import express from 'express';
import { ReportService } from '../services/report.service.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const summary = await ReportService.getDashboardSummary(req.user.role);
    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
});

export default router;
