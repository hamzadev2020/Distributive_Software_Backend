import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { User } from '../models/User.js';
import { Warehouse } from '../models/Warehouse.js';
import { Product } from '../models/Product.js';
import { Batch } from '../models/Batch.js';
import { StockBalance } from '../models/StockBalance.js';
import { StockMovement } from '../models/StockMovement.js';
import { DistributionOrder } from '../models/DistributionOrder.js';
import { DeliveryChallan } from '../models/DeliveryChallan.js';
import { Invoice } from '../models/Invoice.js';
import { Payment } from '../models/Payment.js';
import { PaymentAllocation } from '../models/PaymentAllocation.js';
import { LedgerEntry } from '../models/LedgerEntry.js';
import { Return } from '../models/Return.js';
import { CreditNote } from '../models/CreditNote.js';
import { Counter } from '../models/Counter.js';
import { Vendor } from '../models/Vendor.js';
import { AuditLog } from '../models/AuditLog.js';

async function resetAndSeed() {
  const uri = process.env.MongoUri || process.env.MONGODB_URI;
  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);

  console.log('Cleaning up all messy test data...');
  // Use raw collection methods to bypass append-only hooks
  await StockMovement.collection.deleteMany({});
  await LedgerEntry.collection.deleteMany({});
  await AuditLog.collection.deleteMany({});
  
  await PaymentAllocation.deleteMany({});
  await Payment.deleteMany({});
  await CreditNote.deleteMany({});
  await Return.deleteMany({});
  await Invoice.deleteMany({});
  await DeliveryChallan.deleteMany({});
  await DistributionOrder.deleteMany({});
  await StockBalance.deleteMany({});
  await Batch.deleteMany({});
  await Product.deleteMany({});
  await Warehouse.deleteMany({});
  await Vendor.deleteMany({});
  await Counter.deleteMany({});

  console.log('Inserting 1 clean Warehouse...');
  const warehouse = await Warehouse.create({
    code: 'WH-HARIPUR-01',
    name: 'RZ Pharma Main Depot (Haripur)',
    address: 'Baldher Road, Haripur, KPK',
    isActive: true
  });

  console.log('Inserting 1 clean Product...');
  const product = await Product.create({
    sku: 'SAYX-1G',
    name: 'SAYXONE 1G INJECTION',
    description: 'Ceftriaxone 1g IV/IM Injection',
    baseUnit: 'vial',
    cartonSize: 10,
    salePricePaisa: 12000, // 120 PKR
    costPricePaisa: 10000, // 100 PKR
    taxRatePercent: 100, // 1%
    trackBatch: true,
    trackExpiry: true,
    reorderLevel: 20,
    isActive: true
  });

  console.log('Inserting 1 clean Batch & Stock Balance...');
  const batch = await Batch.create({
    productId: product._id,
    batchNumber: 'J-293',
    expiryDate: new Date('2027-12-31'),
    notes: 'Primary Company Stock'
  });

  await StockBalance.create({
    productId: product._id,
    warehouseId: warehouse._id,
    batchId: batch._id,
    onHand: 100,
    reserved: 0,
    available: 100,
    inTransit: 0,
    quarantined: 0,
    weightedAvgCostPaisa: 10000
  });

  console.log('Inserting 1 clean Customer (Saleem Medical Store)...');
  const vendor = await Vendor.create({
    code: '701',
    name: 'SALEEM MEDICAL STORE DONALI HURIPUR',
    contactPerson: 'Muhammad Saleem',
    phone: '0336-7388274',
    address: {
      street: 'Main Bazar',
      city: 'Donali Haripur',
      province: 'KPK'
    },
    paymentTermsDays: 30,
    creditLimitPaisa: 50000000,
    isActive: true
  });

  console.log('Initializing Customer Code Counter at 701...');
  await Counter.create({
    key: 'CUSTOMER_CODE',
    sequenceValue: 701
  });

  console.log('Database reset and seeded with 1-1 clean RZ Pharma data successfully!');
  await mongoose.disconnect();
}

resetAndSeed().catch(err => {
  console.error('Error resetting database:', err);
  process.exit(1);
});
