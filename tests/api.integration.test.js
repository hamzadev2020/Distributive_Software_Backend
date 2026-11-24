import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { app } from '../app.js';
import { User } from '../models/User.js';
import { Vendor } from '../models/Vendor.js';
import { Product } from '../models/Product.js';
import { Warehouse } from '../models/Warehouse.js';
import { ROLES } from '../config/constants.js';

dotenv.config();

describe('Phase 4: REST API, Security, RBAC & Reports Integration Tests', () => {
  let adminToken;
  let warehouseStaffToken;
  let adminUser;
  let whUser;
  let testVendor;
  let testProduct;
  let testWarehouse;

  beforeAll(async () => {
    if (!process.env.MongoUri) throw new Error('MongoUri missing in .env');
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MongoUri);
    }

    const ts = Date.now() + Math.floor(Math.random() * 10000);
    const hash = await bcrypt.hash('Secret123!', 10);

    adminUser = await User.create({
      name: `Admin ${ts}`,
      email: `admin_${ts}@test.com`,
      passwordHash: hash,
      role: ROLES.ADMIN
    });

    whUser = await User.create({
      name: `WH Staff ${ts}`,
      email: `wh_${ts}@test.com`,
      passwordHash: hash,
      role: ROLES.WAREHOUSE_STAFF
    });

    testWarehouse = await Warehouse.create({
      code: `WH-API-${ts}`,
      name: `API Test WH ${ts}`
    });

    testProduct = await Product.create({
      sku: `SKU-API-${ts}`,
      name: `API Test Product ${ts}`,
      salePricePaisa: 100000,
      costPricePaisa: 60000,
      taxRatePercent: 1800
    });

    testVendor = await Vendor.create({
      code: `VEND-API-${ts}`,
      name: `API Test Vendor ${ts}`,
      paymentTermsDays: 30
    });

    // Login Admin
    const adminLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: adminUser.email, password: 'Secret123!' });
    adminToken = adminLoginRes.body.data.accessToken;

    // Login Warehouse Staff
    const whLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: whUser.email, password: 'Secret123!' });
    warehouseStaffToken = whLoginRes.body.data.accessToken;
  });

  afterAll(async () => {
    if (adminUser) await User.findByIdAndDelete(adminUser._id);
    if (whUser) await User.findByIdAndDelete(whUser._id);
    if (testWarehouse) await Warehouse.findByIdAndDelete(testWarehouse._id);
    if (testProduct) await Product.findByIdAndDelete(testProduct._id);
    if (testVendor) await Vendor.findByIdAndDelete(testVendor._id);
    await mongoose.disconnect();
  });

  it('1. GET /health returns 200 with database status UP and replicaSet', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UP');
    expect(res.body.database).toBe('CONNECTED');
    expect(res.body.replicaSet).toBe(true);
  });

  it('2. Auth Security: Bad password rejects with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: adminUser.email, password: 'WrongPassword' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('3. RBAC Isolation: Warehouse Staff cannot access /api/invoices (403 Forbidden)', async () => {
    const res = await request(app)
      .get('/api/invoices')
      .set('Authorization', `Bearer ${warehouseStaffToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('4. Data Isolation: Warehouse Staff sees products but price fields are stripped', async () => {
    const res = await request(app)
      .get(`/api/products/${testProduct._id}`)
      .set('Authorization', `Bearer ${warehouseStaffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.product.sku).toBe(testProduct.sku);
    // Pricing fields must be omitted
    expect(res.body.data.product.salePricePaisa).toBeUndefined();
    expect(res.body.data.product.costPricePaisa).toBeUndefined();
  });

  it('5. Idempotency: Mutating endpoint rejects request without Idempotency-Key', async () => {
    const res = await request(app)
      .post('/api/stock/goods-receipt')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        productId: testProduct._id,
        warehouseId: testWarehouse._id,
        quantity: 10,
        unitCostPaisa: 60000
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('6. Idempotency: Repeated request with same Idempotency-Key returns cached response without duplicate execution', async () => {
    const idempotencyKey = `KEY-TEST-${Date.now()}`;
    const payload = {
      productId: testProduct._id,
      warehouseId: testWarehouse._id,
      quantity: 5,
      unitCostPaisa: 60000,
      reason: 'Idempotency test stock'
    };

    // First request
    const firstRes = await request(app)
      .post('/api/stock/goods-receipt')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(firstRes.status).toBe(201);
    expect(firstRes.body.success).toBe(true);

    // Second request with SAME key
    const secondRes = await request(app)
      .post('/api/stock/goods-receipt')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    // Must return identical cached response
    expect(secondRes.status).toBe(201);
    expect(secondRes.body.data.balance._id).toBe(firstRes.body.data.balance._id);
  });

  it('7. Reports: Not-Received Report returns segmented active vendors', async () => {
    const fromDate = '2026-01-01';
    const toDate = '2026-12-31';

    const res = await request(app)
      .get(`/api/reports/not-received?fromDate=${fromDate}&toDate=${toDate}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.summary).toBeDefined();
    expect(Array.isArray(res.body.data.neverOrdered)).toBe(true);
    expect(Array.isArray(res.body.data.orderedZeroDelivered)).toBe(true);
  });

  it('8. Dashboard: Summary returns aggregated metrics', async () => {
    const res = await request(app)
      .get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.todayOrdersCount).toBeDefined();
    expect(res.body.data.financial).toBeDefined();
  });
});
