import PDFDocument from 'pdfkit';
import { formatPaisa } from '../utils/money.js';

export class PdfService {
  /**
   * Generate Invoice PDF stream matching RZ PHARMA DISTRIBUTORS format
   */
  static generateInvoicePdf(invoice, isReprint = false) {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    if (isReprint) {
      doc.save();
      doc.fontSize(50).fillColor('#e2e8f0').rotate(-45, { origin: [300, 350] });
      doc.text('DUPLICATE', 120, 350);
      doc.restore();
    }

    const startX = 40;
    const contentWidth = 515;
    const endX = startX + contentWidth;

    // Outer border
    doc.rect(startX, 35, contentWidth, 755).strokeColor('#cbd5e1').lineWidth(1).stroke();

    // 1. Company Header
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(16).text('RZ PHARMA DISTRIBUTORS', startX + 15, 50);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569');
    doc.text('BALDHER HARIPUR', startX + 15, 72);
    doc.font('Helvetica').text('Mobile: 0336-7388274', startX + 15, 86);

    // Invoice Meta on Right
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text('INVOICE', endX - 165, 50, { width: 150, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e293b');
    doc.text(`Invoice No: ${invoice.invoiceNumber || 'DRAFT'}`, endX - 165, 72, { width: 150, align: 'right' });
    
    const invoiceDate = invoice.issueDate ? new Date(invoice.issueDate) : (invoice.createdAt ? new Date(invoice.createdAt) : new Date());
    const formattedDate = `${String(invoiceDate.getDate()).padStart(2, '0')}-${String(invoiceDate.getMonth() + 1).padStart(2, '0')}-${invoiceDate.getFullYear()}`;
    doc.font('Helvetica').fontSize(9).fillColor('#475569');
    doc.text(`Date: ${formattedDate}`, endX - 165, 86, { width: 150, align: 'right' });

    // Header divider line
    doc.moveTo(startX, 108).lineTo(endX, 108).strokeColor('#cbd5e1').stroke();

    // 2. Bill To Box
    doc.rect(startX, 108, contentWidth, 54).fillColor('#f8fafc').fill();
    doc.moveTo(startX, 162).lineTo(endX, 162).strokeColor('#cbd5e1').stroke();

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9).text('BILL TO:', startX + 15, 116);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(invoice.vendorSnapshot?.name || 'Customer', startX + 15, 130);
    
    // Address if available
    const addr = invoice.vendorSnapshot?.address;
    const addressStr = typeof addr === 'string' ? addr : (addr ? [addr.street, addr.city, addr.province].filter(Boolean).join(', ') : '');
    if (addressStr) {
      doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(addressStr, startX + 15, 145);
    }

    // Customer ID & Phone on Right of Bill To
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(`Customer ID: ${invoice.vendorSnapshot?.code || 'N/A'}`, endX - 175, 118, { width: 160, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#475569').text(`Phone No: ${invoice.vendorSnapshot?.phone || '—'}`, endX - 175, 134, { width: 160, align: 'right' });

    // 3. Table Header
    const tableTop = 162;
    doc.rect(startX, tableTop, contentWidth, 22).fillColor('#f1f5f9').fill();
    doc.moveTo(startX, tableTop + 22).lineTo(endX, tableTop + 22).strokeColor('#cbd5e1').stroke();

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f172a');
    doc.text('Qty', startX + 10, tableTop + 7, { width: 35, align: 'center' });
    doc.text('Description', startX + 55, tableTop + 7, { width: 190, align: 'left' });
    doc.text('Batch No.', startX + 250, tableTop + 7, { width: 85, align: 'center' });
    doc.text('TP (PKR)', startX + 340, tableTop + 7, { width: 75, align: 'right' });
    doc.text('Amount (PKR)', startX + 420, tableTop + 7, { width: 85, align: 'right' });

    // 4. Items Rows
    let y = tableTop + 22;
    doc.font('Helvetica').fontSize(8.5).fillColor('#1e293b');

    for (const item of invoice.items || []) {
      const rowHeight = 20;
      doc.text(String(item.quantity), startX + 10, y + 5, { width: 35, align: 'center' });
      doc.text(item.productName || 'Product', startX + 55, y + 5, { width: 190, align: 'left' });
      doc.text(item.batchNumber || '—', startX + 250, y + 5, { width: 85, align: 'center' });
      
      const tpFormatted = ((item.unitPricePaisa || 0) / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      doc.text(tpFormatted, startX + 340, y + 5, { width: 75, align: 'right' });
      
      const amountPaisa = item.lineNetPaisa || ((item.quantity || 1) * (item.unitPricePaisa || 0));
      const amountFormatted = (amountPaisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      doc.text(amountFormatted, startX + 420, y + 5, { width: 85, align: 'right' });

      y += rowHeight;
      doc.moveTo(startX, y).lineTo(endX, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    }

    // 5. Totals Section
    const totalsY = Math.max(y + 10, 480);
    const totalsBoxWidth = 220;
    const totalsBoxX = endX - totalsBoxWidth - 15;

    doc.moveTo(startX, totalsY - 8).lineTo(endX, totalsY - 8).strokeColor('#cbd5e1').lineWidth(1).stroke();

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#334155');
    doc.text('Subtotal:', totalsBoxX, totalsY, { width: 110, align: 'right' });
    doc.font('Helvetica').text(formatPaisa(invoice.subtotalPaisa), totalsBoxX + 115, totalsY, { width: 105, align: 'right' });

    doc.font('Helvetica-Bold').text('Tax (1%):', totalsBoxX, totalsY + 16, { width: 110, align: 'right' });
    doc.font('Helvetica').text(formatPaisa(invoice.taxTotalPaisa), totalsBoxX + 115, totalsY + 16, { width: 105, align: 'right' });

    doc.moveTo(totalsBoxX + 20, totalsY + 32).lineTo(endX - 15, totalsY + 32).strokeColor('#cbd5e1').stroke();

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a');
    doc.text('Total:', totalsBoxX, totalsY + 36, { width: 110, align: 'right' });
    doc.text(formatPaisa(invoice.grandTotalPaisa), totalsBoxX + 115, totalsY + 36, { width: 105, align: 'right' });

    if (invoice.paidPaisa > 0) {
      doc.font('Helvetica').fontSize(9).fillColor('#059669');
      doc.text('Amount Paid:', totalsBoxX, totalsY + 54, { width: 110, align: 'right' });
      doc.text(formatPaisa(invoice.paidPaisa), totalsBoxX + 115, totalsY + 54, { width: 105, align: 'right' });

      doc.font('Helvetica-Bold').fontSize(9).fillColor('#dc2626');
      doc.text('Balance Due:', totalsBoxX, totalsY + 68, { width: 110, align: 'right' });
      doc.text(formatPaisa(invoice.outstandingPaisa), totalsBoxX + 115, totalsY + 68, { width: 105, align: 'right' });
    }

    // 6. Warranty & Signature Footer
    const footerY = 670;
    doc.moveTo(startX, footerY).lineTo(endX, footerY).strokeColor('#cbd5e1').lineWidth(1).stroke();

    // Warranty Box
    const warrantyText = 'Warranty: I RANA ABDUL REHMAN ASLAM being a person resident in PAKISTAN carrying a business Under the name of RZ PHARMA DISTRIBUTORS do hereby give this warranty That the drugs described as sold and contained in this invoice do not contravene in any provision of section 23 of drug act 1976.';
    
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#1e293b');
    doc.text('WARRANTY UNDER SECTION 23 OF DRUG ACT 1976:', startX + 15, footerY + 10);
    doc.font('Helvetica').fontSize(7.5).fillColor('#475569');
    doc.text(warrantyText, startX + 15, footerY + 22, { width: 330, align: 'justify' });

    // Signature Box
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
    doc.moveTo(endX - 150, footerY + 80).lineTo(endX - 15, footerY + 80).strokeColor('#0f172a').lineWidth(1).stroke();
    doc.text('AUTHORIZED SIGNATURE', endX - 150, footerY + 85, { width: 135, align: 'center' });

    return doc;
  }
}
