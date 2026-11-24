import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { StockService } from '../services/stock.service.js';
import { OrderService } from '../services/order.service.js';
import { DispatchService } from '../services/dispatch.service.js';
import { InvoiceService } from '../services/invoice.service.js';
import { PaymentService } from '../services/payment.service.js';
import { ReturnService } from '../services/return.service.js';
import { LedgerService } from '../services/ledger.service.js';
import { Vendor } from '../models/Vendor.js';
import { Product } from '../models/Product.js';
import { Warehouse } from '../models/Warehouse.js';
import { StockBalance } from '../models/StockBalance.js';
import { StockMovement } from '../models/StockMovement.js';
import { DistributionOrder } from '../models/DistributionOrder.js';
import { DeliveryChallan } from '../models/DeliveryChallan.js';
import { Invoice } from '../models/Invoice.js';
import { Payment } from '../models/Payment.js';
import { LedgerEntry } from '../models/LedgerEntry.js';
import { Return } from '../models/Return.js';
import { CreditNote } from '../models/CreditNote.js';
import { ORDER_STATUS, DOCUMENT_STATUS, PAYMENT_STATUS, RETURN_CONDITIONS, RETURN_LIABILITIES, PAYMENT_METHODS } from '../config/constants.js';

dotenv.config();

describe('Phase 3: Orders, Challans, Invoicing, Returns, Payments & Ledger Tests', () => {
  let testWarehouse;
  let testProduct;
  let testVendor;
  const userCreatorId = new mongoose.Types.ObjectId();
  const userApproverId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    if (!process.env.MongoUri) throw new Error('MongoUri not defined in .env');
    await mongoose.connect(process.env.MongoUri);

    const ts = Date.now() + Math.floor(Math.random() * 10000);

    testWarehouse = await Warehouse.create({
      code: `WH-P3-${ts}`,
      name: `Phase 3 Warehouse ${ts}`
    });

    testProduct = await Product.create({
      sku: `SKU-P3-${ts}`,
      name: `Phase 3 Product ${ts}`,
      baseUnit: 'piece',
      cartonSize: 10,
      salePricePaisa: 50000, // 500.00 PKR
      costPricePaisa: 30000, // 300.00 PKR
      taxRatePercent: 1800   // 18.00% tax
    });

    testVendor = await Vendor.create({
      code: `VEND-P3-${ts}`,
      name: `Phase 3 Test Vendor ${ts}`,
      paymentTermsDays: 15,
      creditLimitPaisa: 10000000 // 100,000 PKR
    });
  });

  afterAll(async () => {
    // Teardown test documents
    if (testWarehouse) await Warehouse.findByIdAndDelete(testWarehouse._id);
    if (testProduct) {
      await Product.findByIdAndDelete(testProduct._id);
      await StockBalance.deleteMany({ productId: testProduct._id });
      await StockMovement.collection.deleteMany({ productId: testProduct._id });
    }
    if (testVendor) {
      await Vendor.findByIdAndDelete(testVendor._id);
      await DistributionOrder.deleteMany({ vendorId: testVendor._id });
      await DeliveryChallan.deleteMany({ vendorId: testVendor._id });
      await Invoice.deleteMany({ vendorId: testVendor._id });
      await Payment.deleteMany({ vendorId: testVendor._id });
      await LedgerEntry.collection.deleteMany({ vendorId: testVendor._id });
      await Return.deleteMany({ vendorId: testVendor._id });
      await CreditNote.deleteMany({ vendorId: testVendor._id });
    }
    await mongoose.disconnect();
  });

  it('Flow 1: Complete Order-to-Cash Lifecycle (Order -> Allocate -> Dispatch -> Deliver -> Invoice -> Pay)', async () => {
    // 1. Receive 100 units in warehouse
    await StockService.receiveStock({
      productId: testProduct._id,
      warehouseId: testWarehouse._id,
      quantity: 100,
      unitCostPaisa: 30000,
      reason: 'P3 Stock Receipt'
    });

    // 2. Create Order for 20 units
    // 20 * 50,000 paisa = 1,000,000 paisa net (10,000 PKR)
    // 18% tax = 180,000 paisa (1,800 PKR)
    // Total = 1,180,000 paisa (11,800 PKR)
    const order = await OrderService.createOrder({
      vendorId: testVendor._id,
      warehouseId: testWarehouse._id,
      items: [{ productId: testProduct._id, quantity: 20 }],
      actorId: userCreatorId
    });

    expect(order.status).toBe(ORDER_STATUS.DRAFT);
    expect(order.subtotalPaisa).toBe(1000000);
    expect(order.taxTotalPaisa).toBe(180000);
    expect(order.grandTotalPaisa).toBe(1180000);

    // 3. Allocate Order (reserves 20 units)
    const allocatedOrder = await OrderService.allocateOrder(order._id, { actorId: userCreatorId });
    expect(allocatedOrder.status).toBe(ORDER_STATUS.ALLOCATED);

    const balanceAfterAlloc = await StockBalance.findOne({
      productId: testProduct._id,
      warehouseId: testWarehouse._id
    });
    expect(balanceAfterAlloc.onHand).toBe(100);
    expect(balanceAfterAlloc.reserved).toBe(20);
    expect(balanceAfterAlloc.available).toBe(80);

    // 4. Dispatch Order (creates challan + draft invoice, stock -> inTransit)
    const { challan, invoice: draftInvoice } = await DispatchService.dispatchOrder(order._id, {
      transporterName: 'Express Cargo',
      vehicleNumber: 'KHI-9988',
      actorId: userCreatorId
    });

    expect(challan.status).toBe('DISPATCHED');
    expect(draftInvoice.documentStatus).toBe(DOCUMENT_STATUS.DRAFT);

    const balanceAfterDispatch = await StockBalance.findOne({
      productId: testProduct._id,
      warehouseId: testWarehouse._id
    });
    expect(balanceAfterDispatch.onHand).toBe(80);
    expect(balanceAfterDispatch.reserved).toBe(0);
    expect(balanceAfterDispatch.inTransit).toBe(20);

    // 5. Confirm Delivery
    await DispatchService.confirmDelivery(challan._id, {
      receiverName: 'Store Manager',
      actorId: userCreatorId
    });

    const balanceAfterDelivery = await StockBalance.findOne({
      productId: testProduct._id,
      warehouseId: testWarehouse._id
    });
    expect(balanceAfterDelivery.inTransit).toBe(0);

    // 6. Issue Invoice
    const issuedInvoice = await InvoiceService.issueInvoice(draftInvoice._id, { actorId: userCreatorId });
    expect(issuedInvoice.documentStatus).toBe(DOCUMENT_STATUS.ISSUED);
    expect(issuedInvoice.paymentStatus).toBe(PAYMENT_STATUS.UNPAID);
    expect(issuedInvoice.outstandingPaisa).toBe(1180000);
    expect(issuedInvoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{2}-\d{4}$/);

    // Verify Ledger Debit posted
    const ledgerAfterInvoice = await LedgerService.getVendorBalance(testVendor._id);
    expect(ledgerAfterInvoice.totalDebitPaisa).toBe(1180000);
    expect(ledgerAfterInvoice.totalCreditPaisa).toBe(0);
    expect(ledgerAfterInvoice.balancePaisa).toBe(1180000); // Vendor owes 11,800 PKR

    // 7. Record Full Payment (Bank Transfer)
    const payment = await PaymentService.recordPayment({
      vendorId: testVendor._id,
      amountPaisa: 1180000,
      method: PAYMENT_METHODS.BANK_TRANSFER,
      referenceNumber: 'TXN-ABC-12345',
      actorId: userCreatorId
    });

    expect(payment.status).toBe('CLEARED');
    expect(payment.allocatedPaisa).toBe(1180000);
    expect(payment.unallocatedPaisa).toBe(0);

    // Verify Invoice is now fully PAID
    const reloadedInvoice = await Invoice.findById(issuedInvoice._id);
    expect(reloadedInvoice.paymentStatus).toBe(PAYMENT_STATUS.PAID);
    expect(reloadedInvoice.paidPaisa).toBe(1180000);
    expect(reloadedInvoice.outstandingPaisa).toBe(0);

    // Verify Vendor Ledger Balance is exactly ZERO (0)!
    const finalLedger = await LedgerService.getVendorBalance(testVendor._id);
    expect(finalLedger.totalDebitPaisa).toBe(1180000);
    expect(finalLedger.totalCreditPaisa).toBe(1180000);
    expect(finalLedger.balancePaisa).toBe(0);
  });

  it('Flow 2: Customer Return Guard & Segregation of Duties', async () => {
    // Create and deliver order for 10 units
    const order = await OrderService.createOrder({
      vendorId: testVendor._id,
      warehouseId: testWarehouse._id,
      items: [{ productId: testProduct._id, quantity: 10 }],
      actorId: userCreatorId
    });
    await OrderService.allocateOrder(order._id, { actorId: userCreatorId });
    const { challan, invoice: draftInv } = await DispatchService.dispatchOrder(order._id, { actorId: userCreatorId });
    await DispatchService.confirmDelivery(challan._id, { actorId: userCreatorId });
    const issuedInv = await InvoiceService.issueInvoice(draftInv._id, { actorId: userCreatorId });

    // 1. Return Guard: Attempt to return 15 units when only 10 were delivered -> MUST FAIL
    await expect(
      ReturnService.createReturn({
        orderId: order._id,
        items: [{
          deliveredLineIndex: 0,
          quantity: 15, // Exceeds delivered!
          condition: RETURN_CONDITIONS.RESALABLE,
          liability: RETURN_LIABILITIES.TRANSIT
        }],
        actorId: userCreatorId
      })
    ).rejects.toThrow(/Cannot return 15 units/);

    // 2. Return 4 units (valid quantity: 4 <= 10)
    const ret = await ReturnService.createReturn({
      orderId: order._id,
      items: [
        {
          deliveredLineIndex: 0,
          quantity: 2,
          condition: RETURN_CONDITIONS.RESALABLE,
          liability: RETURN_LIABILITIES.TRANSIT
        },
        {
          deliveredLineIndex: 0,
          quantity: 2,
          condition: RETURN_CONDITIONS.DAMAGED,
          liability: RETURN_LIABILITIES.TRANSIT
        }
      ],
      actorId: userCreatorId
    });
    expect(ret.status).toBe('PENDING');

    // 3. Segregation of Duties: Creator cannot approve their own return!
    await expect(
      ReturnService.approveReturn(ret._id, { approverId: userCreatorId })
    ).rejects.toThrow(/Segregation of duties/);

    // Different approver approves
    const approvedReturn = await ReturnService.approveReturn(ret._id, { approverId: userApproverId });
    expect(approvedReturn.status).toBe('APPROVED');

    // 4. Process Return
    const { creditNote } = await ReturnService.processReturn(ret._id, { actorId: userApproverId });
    expect(creditNote).toBeDefined();
    expect(creditNote.status).toBe('ISSUED');
    expect(creditNote.creditNoteNumber).toMatch(/^CN-\d{4}-\d{2}-\d{4}$/);

    // Verify stock routed correctly:
    // 2 resalable went back to onHand
    // 2 damaged went to quarantined
    const balance = await StockBalance.findOne({
      productId: testProduct._id,
      warehouseId: testWarehouse._id
    });
    expect(balance.quarantined).toBeGreaterThanOrEqual(2);
  });

  it('Flow 3: Cheque Clearing & Bounce Lifecycle', async () => {
    // Record Cheque Payment (Pending)
    const chequePayment = await PaymentService.recordPayment({
      vendorId: testVendor._id,
      amountPaisa: 500000, // 5,000 PKR
      method: PAYMENT_METHODS.CHEQUE,
      chequeDetails: {
        chequeNumber: 'CHQ-100234',
        bankName: 'HBL',
        chequeDate: new Date()
      },
      actorId: userCreatorId
    });

    expect(chequePayment.status).toBe('RECEIVED');
    expect(chequePayment.chequeDetails.clearingStatus).toBe('PENDING');

    // Bouncing a pending cheque
    const bounced = await PaymentService.bounceCheque(chequePayment._id, {
      reason: 'Insufficient funds'
    });
    expect(bounced.status).toBe('BOUNCED');
    expect(bounced.chequeDetails.clearingStatus).toBe('BOUNCED');
  });

  it('Flow 4: Invoice Cancellation & Reversal', async () => {
    // Create, allocate, dispatch and issue an invoice
    const order = await OrderService.createOrder({
      vendorId: testVendor._id,
      warehouseId: testWarehouse._id,
      items: [{ productId: testProduct._id, quantity: 5 }],
      actorId: userCreatorId
    });
    await OrderService.allocateOrder(order._id, { actorId: userCreatorId });
    const { challan, invoice: draftInv } = await DispatchService.dispatchOrder(order._id, { actorId: userCreatorId });
    await DispatchService.confirmDelivery(challan._id, { actorId: userCreatorId });
    const issuedInv = await InvoiceService.issueInvoice(draftInv._id, { actorId: userCreatorId });

    const balanceBeforeCancel = await LedgerService.getVendorBalance(testVendor._id);

    // Cancel invoice (0 payments applied)
    const cancelledInv = await InvoiceService.cancelInvoice(issuedInv._id, {
      reason: 'Wrong customer billing',
      actorId: userCreatorId
    });

    expect(cancelledInv.documentStatus).toBe(DOCUMENT_STATUS.CANCELLED);

    // Reversal entry posted in ledger
    const balanceAfterCancel = await LedgerService.getVendorBalance(testVendor._id);
    expect(balanceAfterCancel.balancePaisa).toBe(balanceBeforeCancel.balancePaisa - issuedInv.grandTotalPaisa);
  });
});
