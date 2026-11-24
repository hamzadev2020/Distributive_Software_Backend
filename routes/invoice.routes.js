import express from 'express';
import { Invoice } from '../models/Invoice.js';
import { InvoiceService } from '../services/invoice.service.js';
import { PdfService } from '../services/pdf.service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// List invoices (restricted from WAREHOUSE_STAFF)
router.get('/', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.ACCOUNTANT), async (req, res, next) => {
  try {
    const { vendorId, documentStatus, paymentStatus, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (vendorId) filter.vendorId = vendorId;
    if (documentStatus) filter.documentStatus = documentStatus;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    const invoices = await Invoice.find(filter)
      .populate('vendorId', 'code name')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    const total = await Invoice.countDocuments(filter);

    res.json({
      success: true,
      data: invoices,
      pagination: { total, page: Number(page), limit: Number(limit) }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.ACCOUNTANT), async (req, res, next) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('vendorId', 'code name phone address')
      .populate('distributionOrderId', 'orderNumber');
    if (!invoice) {
      return res.status(404).json({ success: false, error: { message: 'Invoice not found' } });
    }
    res.json({ success: true, data: invoice });
  } catch (err) {
    next(err);
  }
});

// Issue invoice
router.post('/:id/issue', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.ACCOUNTANT), requireIdempotency, async (req, res, next) => {
  try {
    const invoice = await InvoiceService.issueInvoice(req.params.id, { actorId: req.user._id });
    res.json({ success: true, data: invoice });
  } catch (err) {
    next(err);
  }
});

// Cancel invoice
router.post('/:id/cancel', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN), async (req, res, next) => {
  try {
    const { reason } = req.body;
    const invoice = await InvoiceService.cancelInvoice(req.params.id, { reason, actorId: req.user._id });
    res.json({ success: true, data: invoice });
  } catch (err) {
    next(err);
  }
});

// Download PDF
router.get('/:id/pdf', requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.ACCOUNTANT), async (req, res, next) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, error: { message: 'Invoice not found' } });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNumber}.pdf"`);

    const pdfStream = PdfService.generateInvoicePdf(invoice, req.query.duplicate === 'true');
    pdfStream.pipe(res);
    pdfStream.end();
  } catch (err) {
    next(err);
  }
});

export default router;
