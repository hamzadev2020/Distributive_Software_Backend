import PDFDocument from 'pdfkit';
import { formatPaisa } from '../utils/money.js';

export class PdfService {
  /**
   * Generate Invoice PDF stream
   */
  static generateInvoicePdf(invoice, isReprint = false) {
    const doc = new PDFDocument({ margin: 50 });

    if (isReprint) {
      doc.save();
      doc.fontSize(60).fillColor('#e2e8f0').rotate(-45, { origin: [300, 300] });
      doc.text('DUPLICATE', 150, 300);
      doc.restore();
    }

    // Header
    doc.fontSize(20).fillColor('#1e293b').text('TAX INVOICE', { align: 'right' });
    doc.fontSize(10).fillColor('#64748b').text(`Invoice #: ${invoice.invoiceNumber}`, { align: 'right' });
    doc.text(`Issue Date: ${invoice.issueDate ? new Date(invoice.issueDate).toLocaleDateString() : 'N/A'}`, { align: 'right' });
    doc.text(`Due Date: ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'N/A'}`, { align: 'right' });

    doc.moveDown();

    // Company & Vendor Info
    doc.fontSize(12).fillColor('#0f172a').text(invoice.companySnapshot?.name || 'Distribution Co.');
    doc.fontSize(9).fillColor('#475569');
    doc.text(`NTN: ${invoice.companySnapshot?.ntn || 'N/A'}`);
    doc.text(`STRN: ${invoice.companySnapshot?.salesTaxReg || 'N/A'}`);
    doc.text(invoice.companySnapshot?.address || '');

    doc.moveDown();
    doc.fontSize(11).fillColor('#0f172a').text('BILL TO:');
    doc.fontSize(9).fillColor('#475569');
    doc.text(invoice.vendorSnapshot?.name || 'Customer');
    doc.text(`Code: ${invoice.vendorSnapshot?.code || 'N/A'}`);
    if (invoice.vendorSnapshot?.ntn) doc.text(`NTN: ${invoice.vendorSnapshot.ntn}`);
    if (invoice.vendorSnapshot?.salesTaxReg) doc.text(`STRN: ${invoice.vendorSnapshot.salesTaxReg}`);

    doc.moveDown(2);

    // Items Table Header
    const tableTop = doc.y;
    doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold');
    doc.text('Item Description', 50, tableTop);
    doc.text('Qty', 260, tableTop, { width: 40, align: 'right' });
    doc.text('Unit Price', 310, tableTop, { width: 70, align: 'right' });
    doc.text('Tax', 390, tableTop, { width: 60, align: 'right' });
    doc.text('Total', 460, tableTop, { width: 80, align: 'right' });

    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).strokeColor('#cbd5e1').stroke();

    let y = tableTop + 25;
    doc.font('Helvetica').fontSize(9).fillColor('#334155');

    for (const item of invoice.items) {
      doc.text(`${item.productName} (${item.sku})`, 50, y, { width: 200 });
      doc.text(String(item.quantity), 260, y, { width: 40, align: 'right' });
      doc.text(formatPaisa(item.unitPricePaisa), 310, y, { width: 70, align: 'right' });
      doc.text(formatPaisa(item.lineTaxPaisa), 390, y, { width: 60, align: 'right' });
      doc.text(formatPaisa(item.lineTotalPaisa), 460, y, { width: 80, align: 'right' });
      y += 20;
    }

    doc.moveTo(50, y + 5).lineTo(550, y + 5).strokeColor('#cbd5e1').stroke();
    y += 15;

    // Totals
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a');
    doc.text('Subtotal:', 350, y, { width: 100, align: 'right' });
    doc.text(formatPaisa(invoice.subtotalPaisa), 460, y, { width: 80, align: 'right' });

    y += 18;
    doc.text('Sales Tax Total:', 350, y, { width: 100, align: 'right' });
    doc.text(formatPaisa(invoice.taxTotalPaisa), 460, y, { width: 80, align: 'right' });

    y += 18;
    doc.fontSize(11).text('Grand Total:', 350, y, { width: 100, align: 'right' });
    doc.text(formatPaisa(invoice.grandTotalPaisa), 460, y, { width: 80, align: 'right' });

    y += 20;
    doc.fontSize(9).fillColor('#059669').text(`Amount Paid: ${formatPaisa(invoice.paidPaisa)}`, 350, y, { width: 190, align: 'right' });
    y += 15;
    doc.fillColor('#dc2626').text(`Balance Due: ${formatPaisa(invoice.outstandingPaisa)}`, 350, y, { width: 190, align: 'right' });

    return doc;
  }
}
