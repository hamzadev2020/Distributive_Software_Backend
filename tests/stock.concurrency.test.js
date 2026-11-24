import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { StockService } from '../services/stock.service.js';
import { Product } from '../models/Product.js';
import { Warehouse } from '../models/Warehouse.js';
import { Batch } from '../models/Batch.js';
import { StockBalance } from '../models/StockBalance.js';
import { StockMovement } from '../models/StockMovement.js';
import { InsufficientStockError } from '../utils/errors.js';

dotenv.config();

describe('Phase 2: Stock Core & Concurrency Tests', () => {
  let testWarehouse;
  let testProduct;

  beforeAll(async () => {
    if (!process.env.MongoUri) {
      throw new Error('MongoUri not defined in .env');
    }
    await mongoose.connect(process.env.MongoUri);
  });

  afterAll(async () => {
    // Cleanup test collections
    if (testWarehouse) {
      await Warehouse.findByIdAndDelete(testWarehouse._id);
    }
    if (testProduct) {
      await Product.findByIdAndDelete(testProduct._id);
      await StockBalance.deleteMany({ productId: testProduct._id });
      await StockMovement.collection.deleteMany({ productId: testProduct._id });
      await Batch.deleteMany({ productId: testProduct._id });
    }
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    const timestamp = Date.now() + Math.floor(Math.random() * 10000);
    testWarehouse = await Warehouse.create({
      code: `WH-TEST-${timestamp}`,
      name: `Test Warehouse ${timestamp}`
    });

    testProduct = await Product.create({
      sku: `SKU-TEST-${timestamp}`,
      name: `Test Product ${timestamp}`,
      baseUnit: 'piece',
      cartonSize: 10,
      salePricePaisa: 50000, // 500 PKR
      costPricePaisa: 30000, // 300 PKR
      taxRatePercent: 1800   // 18%
    });
  });

  it('T1: Two concurrent allocations for the last 10 units: exactly one succeeds and available never goes negative', async () => {
    // 1. Initial stock receipt of exactly 10 units
    await StockService.receiveStock({
      productId: testProduct._id,
      warehouseId: testWarehouse._id,
      quantity: 10,
      unitCostPaisa: 30000,
      reason: 'Initial test stock'
    });

    // Verify initial balance
    const initialBalance = await StockBalance.findOne({
      productId: testProduct._id,
      warehouseId: testWarehouse._id
    });
    expect(initialBalance.onHand).toBe(10);
    expect(initialBalance.reserved).toBe(0);
    expect(initialBalance.available).toBe(10);

    // 2. Launch TWO concurrent requests to reserve 10 units simultaneously
    const results = await Promise.allSettled([
      StockService.reserveStock({
        productId: testProduct._id,
        warehouseId: testWarehouse._id,
        quantity: 10,
        reason: 'Concurrent reservation A'
      }),
      StockService.reserveStock({
        productId: testProduct._id,
        warehouseId: testWarehouse._id,
        quantity: 10,
        reason: 'Concurrent reservation B'
      })
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    // Exactly one must succeed, one must fail
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBeInstanceOf(InsufficientStockError);

    // Verify final state: available must be 0, reserved must be 10, never negative
    const finalBalance = await StockBalance.findOne({
      productId: testProduct._id,
      warehouseId: testWarehouse._id
    });
    expect(finalBalance.onHand).toBe(10);
    expect(finalBalance.reserved).toBe(10);
    expect(finalBalance.available).toBe(0);
  });

  it('T2: A failure injected mid-transaction leaves no partial stock writes (Transaction Rollback)', async () => {
    // Initial stock receipt
    await StockService.receiveStock({
      productId: testProduct._id,
      warehouseId: testWarehouse._id,
      quantity: 50,
      unitCostPaisa: 25000,
      reason: 'Stock for rollback test'
    });

    const balanceBefore = await StockBalance.findOne({
      productId: testProduct._id,
      warehouseId: testWarehouse._id
    });
    const movementsBeforeCount = await StockMovement.countDocuments({
      productId: testProduct._id
    });

    // Execute transaction that fails midway
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Step 1: Reserve 20 units
        await StockService.reserveStock({
          productId: testProduct._id,
          warehouseId: testWarehouse._id,
          quantity: 20,
          session
        });

        // Step 2: Inject simulated failure
        throw new Error('SIMULATED_TRANSACTION_FAILURE');
      });
    } catch (err) {
      expect(err.message).toBe('SIMULATED_TRANSACTION_FAILURE');
    } finally {
      await session.endSession();
    }

    // Verify full rollback: no changes to stock balances or movements
    const balanceAfter = await StockBalance.findOne({
      productId: testProduct._id,
      warehouseId: testWarehouse._id
    });
    const movementsAfterCount = await StockMovement.countDocuments({
      productId: testProduct._id
    });

    expect(balanceAfter.reserved).toBe(balanceBefore.reserved);
    expect(balanceAfter.onHand).toBe(balanceBefore.onHand);
    expect(movementsAfterCount).toBe(movementsBeforeCount);
  });

  it('T3: Full Stock Lifecycle & Nightly Reconciliation verification', async () => {
    // 1. Goods Receipt: 100 units
    await StockService.receiveStock({
      productId: testProduct._id,
      warehouseId: testWarehouse._id,
      quantity: 100,
      unitCostPaisa: 20000,
      reason: 'Batch delivery'
    });

    // 2. Reserve 40 units
    await StockService.reserveStock({
      productId: testProduct._id,
      warehouseId: testWarehouse._id,
      quantity: 40,
      reason: 'Order 101'
    });

    // 3. Dispatch 30 units (from the 40 reserved)
    await StockService.dispatchStock({
      productId: testProduct._id,
      warehouseId: testWarehouse._id,
      quantity: 30,
      costPaisaPerUnit: 20000,
      reason: 'Challan DC-001'
    });

    // 4. Confirm Delivery of 25 units
    await StockService.confirmDelivery({
      productId: testProduct._id,
      warehouseId: testWarehouse._id,
      quantity: 25,
      reason: 'Delivered to vendor'
    });

    // 5. Customer Return: 3 units resalable, 2 units damaged
    await StockService.returnResalable({
      productId: testProduct._id,
      warehouseId: testWarehouse._id,
      quantity: 3,
      reason: 'Vendor surplus return'
    });

    await StockService.returnDamaged({
      productId: testProduct._id,
      warehouseId: testWarehouse._id,
      quantity: 2,
      reason: 'Damaged in transit'
    });

    // 6. Write off 1 damaged unit from quarantine
    await StockService.writeOffQuarantined({
      productId: testProduct._id,
      warehouseId: testWarehouse._id,
      quantity: 1,
      reason: 'Scrapped'
    });

    // 7. Verify Reconciliation: sum(stockMovements) MUST equal stockBalances
    const recon = await StockService.reconcileStock(testProduct._id, testWarehouse._id);

    expect(recon.matches).toBe(true);
    expect(recon.diff.onHand).toBe(0);
    expect(recon.diff.reserved).toBe(0);
    expect(recon.diff.inTransit).toBe(0);
    expect(recon.diff.quarantined).toBe(0);

    // Verify exact expected numbers:
    // onHand: 100 (received) - 30 (dispatched) + 3 (returned resalable) = 73
    // reserved: 40 (reserved) - 30 (dispatched) = 10
    // inTransit: 30 (dispatched) - 25 (delivered) = 5
    // quarantined: 2 (damaged) - 1 (scrapped) = 1
    // available = 73 - 10 = 63
    expect(recon.balance.onHand).toBe(73);
    expect(recon.balance.reserved).toBe(10);
    expect(recon.balance.inTransit).toBe(5);
    expect(recon.balance.quarantined).toBe(1);
    expect(recon.balance.available).toBe(63);
  });

  it('T4: FEFO Batch Allocation picks earliest expiry first and skips expired batches', async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Batch A: Expired 5 days ago
    const batchExpired = await Batch.create({
      productId: testProduct._id,
      batchNumber: 'BATCH-EXPIRED',
      expiryDate: new Date(now - 5 * day)
    });
    await StockService.receiveStock({
      productId: testProduct._id,
      warehouseId: testWarehouse._id,
      batchId: batchExpired._id,
      quantity: 50
    });

    // Batch B: Expires in 10 days
    const batchNear = await Batch.create({
      productId: testProduct._id,
      batchNumber: 'BATCH-NEAR',
      expiryDate: new Date(now + 10 * day)
    });
    await StockService.receiveStock({
      productId: testProduct._id,
      warehouseId: testWarehouse._id,
      batchId: batchNear._id,
      quantity: 20
    });

    // Batch C: Expires in 60 days
    const batchFar = await Batch.create({
      productId: testProduct._id,
      batchNumber: 'BATCH-FAR',
      expiryDate: new Date(now + 60 * day)
    });
    await StockService.receiveStock({
      productId: testProduct._id,
      warehouseId: testWarehouse._id,
      batchId: batchFar._id,
      quantity: 40
    });

    // Request 25 units via FEFO
    const allocations = await StockService.allocateFEFO({
      productId: testProduct._id,
      warehouseId: testWarehouse._id,
      requiredQuantity: 25
    });

    // Should pick:
    // 1. All 20 units from BATCH-NEAR (expires first)
    // 2. Remaining 5 units from BATCH-FAR
    // 3. ZERO units from BATCH-EXPIRED
    expect(allocations.length).toBe(2);
    expect(allocations[0].batchNumber).toBe('BATCH-NEAR');
    expect(allocations[0].quantity).toBe(20);
    expect(allocations[1].batchNumber).toBe('BATCH-FAR');
    expect(allocations[1].quantity).toBe(5);
  });
});
