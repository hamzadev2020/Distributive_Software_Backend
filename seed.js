import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { User } from './models/User.js';
import { Warehouse } from './models/Warehouse.js';
import { Category } from './models/Category.js';
import { Product } from './models/Product.js';
import { Vendor } from './models/Vendor.js';
import { StockService } from './services/stock.service.js';
import { ROLES } from './config/constants.js';

dotenv.config();

export async function seedDatabase() {
  if (!process.env.MongoUri) throw new Error('MongoUri missing in .env');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MongoUri);
  }

  console.log('Seeding initial data...');

  const passwordHash = await bcrypt.hash('Admin@123456', 10);

  // 1. Seed Users (All 4 roles)
  const users = [
    { name: 'Super Admin User', email: 'superadmin@dms.com', role: ROLES.SUPER_ADMIN },
    { name: 'Operations Admin', email: 'admin@dms.com', role: ROLES.ADMIN },
    { name: 'Warehouse Staff', email: 'warehouse@dms.com', role: ROLES.WAREHOUSE_STAFF },
    { name: 'Head Accountant', email: 'accountant@dms.com', role: ROLES.ACCOUNTANT }
  ];

  for (const u of users) {
    await User.findOneAndUpdate(
      { email: u.email },
      { ...u, passwordHash, isActive: true },
      { upsert: true, returnDocument: 'after' }
    );
  }

  // 2. Seed Warehouses
  const warehousesData = [
    { code: 'WH-KHI-01', name: 'Karachi Central Warehouse', address: 'Plot 45, SITE Area, Karachi' },
    { code: 'WH-LHR-01', name: 'Lahore Regional Depot', address: 'Multan Road Industrial Estate, Lahore' },
    { code: 'WH-ISB-01', name: 'Islamabad Distribution Hub', address: 'Sector I-9/2, Islamabad' }
  ];

  const warehouses = [];
  for (const w of warehousesData) {
    const doc = await Warehouse.findOneAndUpdate(
      { code: w.code },
      { ...w, isActive: true, deletedAt: null },
      { upsert: true, returnDocument: 'after' }
    );
    warehouses.push(doc);
  }

  // 3. Seed Category
  const cat = await Category.findOneAndUpdate(
    { name: 'FMCG - Beverages' },
    { name: 'FMCG - Beverages', description: 'Packaged juices and drinks', isActive: true },
    { upsert: true, returnDocument: 'after' }
  );

  // 4. Seed Products
  const productsData = [
    {
      sku: 'PRD-MANGO-JUICE-1L',
      name: 'Pure Mango Juice 1 Litre',
      categoryId: cat._id,
      baseUnit: 'carton',
      cartonSize: 12,
      salePricePaisa: 360000, // 3,600 PKR per carton
      costPricePaisa: 280000, // 2,800 PKR
      taxRatePercent: 1800,   // 18%
      reorderLevel: 20
    },
    {
      sku: 'PRD-APPLE-JUICE-1L',
      name: 'Fresh Apple Juice 1 Litre',
      categoryId: cat._id,
      baseUnit: 'carton',
      cartonSize: 12,
      salePricePaisa: 380000, // 3,800 PKR per carton
      costPricePaisa: 300000, // 3,000 PKR
      taxRatePercent: 1800,
      reorderLevel: 20
    },
    {
      sku: 'PRD-ORANGE-JUICE-250ML',
      name: 'Orange Nectar 250ml Pack',
      categoryId: cat._id,
      baseUnit: 'carton',
      cartonSize: 24,
      salePricePaisa: 240000, // 2,400 PKR per carton
      costPricePaisa: 190000, // 1,900 PKR
      taxRatePercent: 1800,
      reorderLevel: 50
    }
  ];

  const products = [];
  for (const p of productsData) {
    const doc = await Product.findOneAndUpdate(
      { sku: p.sku },
      { ...p, isActive: true, deletedAt: null },
      { upsert: true, returnDocument: 'after' }
    );
    products.push(doc);
  }

  // 5. Seed Initial Stock
  for (const p of products) {
    await StockService.receiveStock({
      productId: p._id,
      warehouseId: warehouses[0]._id,
      quantity: 150,
      unitCostPaisa: p.costPricePaisa,
      reason: 'Opening seed inventory'
    });
  }

  // 6. Seed Vendors (Downstream debtors)
  const vendorsData = [
    {
      code: 'VEND-SUPER-MART-KHI',
      name: 'Al-Madina Super Mart',
      contactPerson: 'Muhammad Tariq',
      phone: '+92 300 1234567',
      email: 'tariq@almadinamart.com',
      address: { street: 'Main Clifton Block 5', city: 'Karachi', province: 'Sindh' },
      ntn: '1234567-1',
      salesTaxRegistration: '12-34-5678-001',
      paymentTermsDays: 15,
      creditLimitPaisa: 50000000 // 500,000 PKR
    },
    {
      code: 'VEND-METRO-RETAIL-LHR',
      name: 'Metro Retailers Lahore',
      contactPerson: 'Usman Ali',
      phone: '+92 321 9876543',
      email: 'usman@metroretail.pk',
      address: { street: 'Gulberg III', city: 'Lahore', province: 'Punjab' },
      ntn: '2345678-2',
      salesTaxRegistration: '23-45-6789-002',
      paymentTermsDays: 30,
      creditLimitPaisa: 100000000 // 1,000,000 PKR
    },
    {
      code: 'VEND-ISB-GROCERS',
      name: 'Capital Grocers F-7',
      contactPerson: 'Zubair Khan',
      phone: '+92 333 5551234',
      email: 'zubair@capitalgrocers.com',
      address: { street: 'Jinnah Super Market F-7', city: 'Islamabad', province: 'ICT' },
      ntn: '3456789-3',
      salesTaxRegistration: '34-56-7890-003',
      paymentTermsDays: 20,
      creditLimitPaisa: 30000000 // 300,000 PKR
    }
  ];

  for (const v of vendorsData) {
    await Vendor.findOneAndUpdate(
      { code: v.code },
      { ...v, isActive: true, deletedAt: null },
      { upsert: true, returnDocument: 'after' }
    );
  }

  console.log('Seed completed successfully!');
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seedDatabase().then(() => mongoose.disconnect().then(() => process.exit(0)));
}
