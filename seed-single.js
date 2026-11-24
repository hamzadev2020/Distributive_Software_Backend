import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { User } from './models/User.js';
import { Warehouse } from './models/Warehouse.js';
import { Category } from './models/Category.js';
import { Product } from './models/Product.js';
import { Batch } from './models/Batch.js';
import { Vendor } from './models/Vendor.js';
import { StockBalance } from './models/StockBalance.js';
import { StockMovement } from './models/StockMovement.js';
import { DistributionOrder } from './models/DistributionOrder.js';
import { DeliveryChallan } from './models/DeliveryChallan.js';
import { Invoice } from './models/Invoice.js';
import { Payment } from './models/Payment.js';
import { PaymentAllocation } from './models/PaymentAllocation.js';
import { LedgerEntry } from './models/LedgerEntry.js';
import { Return } from './models/Return.js';
import { CreditNote } from './models/CreditNote.js';
import { AuditLog } from './models/AuditLog.js';
import { StockService } from './services/stock.service.js';
import { OrderService } from './services/order.service.js';
import { DispatchService } from './services/dispatch.service.js';
import { InvoiceService } from './services/invoice.service.js';
import { PaymentService } from './services/payment.service.js';
import { ReturnService } from './services/return.service.js';
import { ROLES, PAYMENT_METHODS, RETURN_CONDITIONS, RETURN_LIABILITIES } from './config/constants.js';

dotenv.config();

async function seedSingleRecordEach() {
  if (!process.env.MongoUri) throw new Error('MongoUri missing in .env');
  await mongoose.connect(process.env.MongoUri);

  console.log('Clearing old sample data for a pristine 1-record setup...');

  // Clean collections using raw driver calls so append-only hooks do not block
  await User.deleteMany({});
  await Warehouse.deleteMany({});
  await Category.deleteMany({});
  await Product.deleteMany({});
  await Batch.deleteMany({});
  await Vendor.deleteMany({});
  await StockBalance.deleteMany({});
  await StockMovement.collection.deleteMany({});
  await DistributionOrder.deleteMany({});
  await DeliveryChallan.deleteMany({});
  await Invoice.deleteMany({});
  await Payment.deleteMany({});
  await PaymentAllocation.deleteMany({});
  await LedgerEntry.collection.deleteMany({});
  await Return.deleteMany({});
  await CreditNote.deleteMany({});
  await AuditLog.collection.deleteMany({});

  console.log('Inserting exactly 1 record per entity...');

  // 1. Exactly 1 User (Admin)
  const passwordHash = await bcrypt.hash('Admin@123456', 10);
  const user = await User.create({
    name: 'Hamza Operations Admin',
    email: 'admin@dms.com',
    passwordHash,
    role: ROLES.ADMIN,
    isActive: true
  });
  console.log('✓ 1 User created: admin@dms.com');

  // 2. Exactly 1 Warehouse
  const warehouse = await Warehouse.create({
    code: 'WH-KHI-MAIN',
    name: 'Karachi Central Distribution Hub',
    address: 'Plot 45, Sector 15, Korangi Industrial Area, Karachi'
  });
  console.log('✓ 1 Warehouse created: WH-KHI-MAIN');

  // 3. Exactly 1 Category
  const category = await Category.create({
    name: 'Beverages & Juices',
    description: 'Packaged premium juices & energy drinks'
  });
  console.log('✓ 1 Category created: Beverages & Juices');

  // 4. Exactly 1 Product
  // Sale price: 3,500 PKR (350,000 paisa)
  // Cost price: 2,800 PKR (280,000 paisa)
  // Tax: 18% (1800 basis points)
  const product = await Product.create({
    sku: 'PRD-MANGO-1L',
    name: 'Pure Mango Nectar 1 Litre',
    categoryId: category._id,
    baseUnit: 'carton',
    cartonSize: 12,
    salePricePaisa: 350000,
    costPricePaisa: 280000,
    taxRatePercent: 1800,
    trackBatch: true,
    trackExpiry: true,
    reorderLevel: 25
  });
  console.log('✓ 1 Product created: PRD-MANGO-1L');

  // 5. Exactly 1 Batch
  const batch = await Batch.create({
    productId: product._id,
    batchNumber: 'BATCH-2026-MG01',
    manufacturingDate: new Date('2026-10-01'),
    expiryDate: new Date('2027-10-01'),
    notes: 'Standard production run'
  });
  console.log('✓ 1 Batch created: BATCH-2026-MG01');

  // 6. Exactly 1 Goods Receipt (Stock In of 100 cartons)
  await StockService.receiveStock({
    productId: product._id,
    warehouseId: warehouse._id,
    batchId: batch._id,
    quantity: 100,
    unitCostPaisa: 280000,
    reason: 'Initial warehouse stock receipt',
    actorId: user._id
  });
  console.log('✓ 1 Stock Balance initialized: 100 cartons in Karachi Hub');

  // 7. Exactly 1 Vendor (Debtor)
  const vendor = await Vendor.create({
    code: 'VEND-ALMADINA',
    name: 'Al-Madina Cash & Carry',
    contactPerson: 'Muhammad Tariq',
    phone: '+92 300 1234567',
    email: 'tariq@almadinamart.com',
    address: {
      street: 'Shop 12, Main Commercial Area, Clifton Block 5',
      city: 'Karachi',
      province: 'Sindh',
      postalCode: '75600'
    },
    ntn: '2345678-9',
    salesTaxRegistration: '12-34-5678-001',
    paymentTermsDays: 15,
    creditLimitPaisa: 50000000 // 500,000 PKR
  });
  console.log('✓ 1 Vendor created: VEND-ALMADINA (Al-Madina Cash & Carry)');

  // 8. Exactly 1 Distribution Order (Ordered 20 cartons)
  // 20 * 3,500 PKR = 70,000 PKR net (7,000,000 paisa)
  // 18% tax = 12,600 PKR (1,260,000 paisa)
  // Grand total = 82,600 PKR (8,260,000 paisa)
  const order = await OrderService.createOrder({
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    items: [{ productId: product._id, quantity: 20, batchId: batch._id }],
    actorId: user._id,
    notes: 'Urgent weekend restocking'
  });
  await OrderService.allocateOrder(order._id, { actorId: user._id });
  console.log('✓ 1 Order created & allocated: ' + order.orderNumber);

  // 9. Exactly 1 Delivery Challan (Dispatched and Delivered)
  const { challan, invoice: draftInvoice } = await DispatchService.dispatchOrder(order._id, {
    transporterName: 'Falcon Cargo Express',
    vehicleNumber: 'KHI-9812',
    driverName: 'Abdul Sattar',
    driverPhone: '+92 333 9998877',
    actorId: user._id
  });
  await DispatchService.confirmDelivery(challan._id, {
    receiverName: 'Tariq (Store Manager)',
    actorId: user._id
  });
  console.log('✓ 1 Delivery Challan confirmed delivered: ' + challan.challanNumber);

  // 10. Exactly 1 Invoice (Officially Issued)
  const issuedInvoice = await InvoiceService.issueInvoice(draftInvoice._id, { actorId: user._id });
  console.log('✓ 1 Invoice issued & posted: ' + issuedInvoice.invoiceNumber + ' (PKR 82,600.00)');

  // 11. Exactly 1 Payment Recorded (Partial payment of 50,000 PKR via Bank Transfer)
  const payment = await PaymentService.recordPayment({
    vendorId: vendor._id,
    amountPaisa: 5000000, // 50,000.00 PKR
    method: PAYMENT_METHODS.BANK_TRANSFER,
    referenceNumber: 'FT-MEEZAN-98231',
    actorId: user._id
  });
  console.log('✓ 1 Payment recorded: ' + payment.paymentNumber + ' (PKR 50,000.00 allocated, remaining due: PKR 32,600.00)');

  // 12. Exactly 1 Customer Return & 1 Credit Note
  const userApprover = await User.create({
    name: 'Audit Approver',
    email: 'approver@dms.com',
    passwordHash,
    role: ROLES.SUPER_ADMIN,
    isActive: true
  });

  const returnRecord = await ReturnService.createReturn({
    orderId: order._id,
    items: [{
      deliveredLineIndex: 0,
      quantity: 1, // 1 carton damaged in transit
      condition: RETURN_CONDITIONS.DAMAGED,
      liability: RETURN_LIABILITIES.TRANSIT,
      reason: 'Seal broken during highway transit'
    }],
    actorId: user._id
  });

  await ReturnService.approveReturn(returnRecord._id, { approverId: userApprover._id });
  const { creditNote } = await ReturnService.processReturn(returnRecord._id, { actorId: userApprover._id });
  console.log('✓ 1 Customer Return processed: ' + returnRecord.returnNumber);
  console.log('✓ 1 Credit Note issued: ' + creditNote?.creditNoteNumber);

  // 13. Exactly 1 Audit Log entry
  await AuditLog.create({
    actorId: user._id,
    actorRole: user.role,
    entity: 'distributionOrder',
    entityId: order._id,
    action: 'CREATE_AND_DISPATCH',
    reason: 'Initial system seed order',
    ipAddress: '127.0.0.1',
    requestId: 'REQ-SEED-001'
  });
  console.log('✓ 1 Audit Log entry recorded');

  console.log('\n========================================');
  console.log('ALL ENTITIES SEEDED WITH EXACTLY 1 RECORD!');
  console.log('Login: admin@dms.com | Password: Admin@123456');
  console.log('========================================\n');
}

seedSingleRecordEach()
  .then(() => mongoose.disconnect().then(() => process.exit(0)))
  .catch(err => {
    console.error('Seed error:', err);
    process.exit(1);
  });
