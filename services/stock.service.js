import mongoose from 'mongoose';
import { StockBalance } from '../models/StockBalance.js';
import { StockMovement } from '../models/StockMovement.js';
import { Product } from '../models/Product.js';
import { Batch } from '../models/Batch.js';
import { STOCK_MOVEMENT_TYPES, SOURCE_DOC_TYPES } from '../config/constants.js';
import { InsufficientStockError, NotFoundError, ValidationError } from '../utils/errors.js';
import { roundHalfUp } from '../utils/money.js';

export class StockService {
  /**
   * Ensure a StockBalance record exists for the given combination
   */
  static async ensureBalanceRecord(productId, warehouseId, batchId = null, session = null) {
    const filter = { productId, warehouseId, batchId: batchId || null };
    let balance = await StockBalance.findOne(filter).session(session);
    if (!balance) {
      try {
        const [created] = await StockBalance.create([filter], { session });
        balance = created;
      } catch (err) {
        // Handle race condition on unique index
        if (err.code === 11000) {
          balance = await StockBalance.findOne(filter).session(session);
        } else {
          throw err;
        }
      }
    }
    return balance;
  }

  /**
   * Goods Receipt / Stock-In
   * Increases onHand, logs RECEIPT movement, and recalculates weighted average cost
   */
  static async receiveStock({
    productId,
    warehouseId,
    batchId = null,
    quantity,
    unitCostPaisa = 0,
    sourceDocumentType = SOURCE_DOC_TYPES.GOODS_RECEIPT,
    sourceDocumentId = null,
    actorId = null,
    reason = 'Goods Receipt',
    session = null
  }) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Quantity received must be a positive integer');
    }
    if (!Number.isInteger(unitCostPaisa) || unitCostPaisa < 0) {
      throw new ValidationError('unitCostPaisa must be a non-negative integer');
    }

    // Ensure balance record exists
    await this.ensureBalanceRecord(productId, warehouseId, batchId, session);

    // Atomic update of onHand
    const updatedBalance = await StockBalance.findOneAndUpdate(
      { productId, warehouseId, batchId: batchId || null },
      { $inc: { onHand: quantity } },
      { session, returnDocument: 'after' }
    );

    // Append-only stock movement
    const movement = new StockMovement({
      type: STOCK_MOVEMENT_TYPES.RECEIPT,
      productId,
      warehouseId,
      batchId: batchId || null,
      quantityOnHand: quantity,
      quantityReserved: 0,
      quantityInTransit: 0,
      quantityQuarantined: 0,
      sourceDocumentType,
      sourceDocumentId,
      reason,
      actorId,
      costPaisaPerUnit: unitCostPaisa
    });
    await movement.save({ session });

    // Recalculate Weighted Average Cost for the product
    if (unitCostPaisa > 0) {
      const product = await Product.findById(productId).session(session);
      if (product) {
        // Aggregate total onHand across all warehouses to calculate weighted average
        const allBalances = await StockBalance.find({ productId }).session(session);
        const totalOnHandPrior = allBalances.reduce((sum, b) => sum + (b.onHand || 0), 0) - quantity;
        
        let newAverageCost = unitCostPaisa;
        if (totalOnHandPrior > 0 && product.costPricePaisa > 0) {
          const priorTotalValuation = totalOnHandPrior * product.costPricePaisa;
          const incomingValuation = quantity * unitCostPaisa;
          newAverageCost = roundHalfUp((priorTotalValuation + incomingValuation) / (totalOnHandPrior + quantity));
        }

        product.costPricePaisa = newAverageCost;
        await product.save({ session });
      }
    }

    return { balance: updatedBalance, movement };
  }

  /**
   * Reserve Stock (Atomic Conditional Update)
   * Enforces: available (onHand - reserved) >= quantity
   * NEVER reads then writes — single atomic query
   */
  static async reserveStock({
    productId,
    warehouseId,
    batchId = null,
    quantity,
    sourceDocumentType = SOURCE_DOC_TYPES.DISTRIBUTION_ORDER,
    sourceDocumentId = null,
    actorId = null,
    reason = 'Order allocation',
    session = null
  }) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Quantity to reserve must be a positive integer');
    }

    // Ensure balance record exists first
    await this.ensureBalanceRecord(productId, warehouseId, batchId, session);

    // Atomic conditional update: available (onHand - reserved) >= quantity
    const updatedBalance = await StockBalance.findOneAndUpdate(
      {
        productId,
        warehouseId,
        batchId: batchId || null,
        $expr: {
          $gte: [{ $subtract: ['$onHand', '$reserved'] }, quantity]
        }
      },
      {
        $inc: { reserved: quantity }
      },
      { session, returnDocument: 'after' }
    );

    if (!updatedBalance) {
      // Find current available for diagnostic error message
      const current = await StockBalance.findOne({
        productId,
        warehouseId,
        batchId: batchId || null
      }).session(session);
      const available = current ? (current.onHand - current.reserved) : 0;
      throw new InsufficientStockError(productId, warehouseId, quantity, available);
    }

    // Append-only movement log
    const movement = new StockMovement({
      type: STOCK_MOVEMENT_TYPES.RESERVE,
      productId,
      warehouseId,
      batchId: batchId || null,
      quantityOnHand: 0,
      quantityReserved: quantity,
      quantityInTransit: 0,
      quantityQuarantined: 0,
      sourceDocumentType,
      sourceDocumentId,
      reason,
      actorId
    });
    await movement.save({ session });

    return { balance: updatedBalance, movement };
  }

  /**
   * Release Reservation
   * Enforces: reserved >= quantity
   */
  static async releaseReservation({
    productId,
    warehouseId,
    batchId = null,
    quantity,
    sourceDocumentType = SOURCE_DOC_TYPES.DISTRIBUTION_ORDER,
    sourceDocumentId = null,
    actorId = null,
    reason = 'Order cancellation / deallocation',
    session = null
  }) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Quantity to release must be a positive integer');
    }

    const updatedBalance = await StockBalance.findOneAndUpdate(
      {
        productId,
        warehouseId,
        batchId: batchId || null,
        $expr: { $gte: ['$reserved', quantity] }
      },
      {
        $inc: { reserved: -quantity }
      },
      { session, returnDocument: 'after' }
    );

    if (!updatedBalance) {
      throw new ValidationError(`Cannot release ${quantity} units: insufficient reserved stock`);
    }

    const movement = new StockMovement({
      type: STOCK_MOVEMENT_TYPES.RELEASE,
      productId,
      warehouseId,
      batchId: batchId || null,
      quantityOnHand: 0,
      quantityReserved: -quantity,
      quantityInTransit: 0,
      quantityQuarantined: 0,
      sourceDocumentType,
      sourceDocumentId,
      reason,
      actorId
    });
    await movement.save({ session });

    return { balance: updatedBalance, movement };
  }

  /**
   * Dispatch Stock
   * Moves stock from onHand & reserved to inTransit
   */
  static async dispatchStock({
    productId,
    warehouseId,
    batchId = null,
    quantity,
    sourceDocumentType = SOURCE_DOC_TYPES.DELIVERY_CHALLAN,
    sourceDocumentId = null,
    actorId = null,
    costPaisaPerUnit = 0,
    reason = 'Order dispatch',
    session = null
  }) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Quantity to dispatch must be a positive integer');
    }

    const updatedBalance = await StockBalance.findOneAndUpdate(
      {
        productId,
        warehouseId,
        batchId: batchId || null,
        $expr: {
          $and: [
            { $gte: ['$onHand', quantity] },
            { $gte: ['$reserved', quantity] }
          ]
        }
      },
      {
        $inc: {
          onHand: -quantity,
          reserved: -quantity,
          inTransit: quantity
        }
      },
      { session, returnDocument: 'after' }
    );

    if (!updatedBalance) {
      throw new ValidationError(`Cannot dispatch ${quantity} units: insufficient onHand or reserved stock`);
    }

    const movement = new StockMovement({
      type: STOCK_MOVEMENT_TYPES.DISPATCH,
      productId,
      warehouseId,
      batchId: batchId || null,
      quantityOnHand: -quantity,
      quantityReserved: -quantity,
      quantityInTransit: quantity,
      quantityQuarantined: 0,
      sourceDocumentType,
      sourceDocumentId,
      reason,
      actorId,
      costPaisaPerUnit
    });
    await movement.save({ session });

    return { balance: updatedBalance, movement };
  }

  /**
   * Confirm Delivery
   * Clears stock from inTransit
   */
  static async confirmDelivery({
    productId,
    warehouseId,
    batchId = null,
    quantity,
    sourceDocumentType = SOURCE_DOC_TYPES.DELIVERY_CHALLAN,
    sourceDocumentId = null,
    actorId = null,
    reason = 'Delivery confirmed',
    session = null
  }) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Quantity delivered must be a positive integer');
    }

    const updatedBalance = await StockBalance.findOneAndUpdate(
      {
        productId,
        warehouseId,
        batchId: batchId || null,
        $expr: { $gte: ['$inTransit', quantity] }
      },
      {
        $inc: { inTransit: -quantity }
      },
      { session, returnDocument: 'after' }
    );

    if (!updatedBalance) {
      throw new ValidationError(`Cannot confirm delivery of ${quantity} units: exceeds inTransit stock`);
    }

    const movement = new StockMovement({
      type: STOCK_MOVEMENT_TYPES.DELIVERY,
      productId,
      warehouseId,
      batchId: batchId || null,
      quantityOnHand: 0,
      quantityReserved: 0,
      quantityInTransit: -quantity,
      quantityQuarantined: 0,
      sourceDocumentType,
      sourceDocumentId,
      reason,
      actorId
    });
    await movement.save({ session });

    return { balance: updatedBalance, movement };
  }

  /**
   * Return Resalable Stock
   * Restores items to onHand in original batch/warehouse
   */
  static async returnResalable({
    productId,
    warehouseId,
    batchId = null,
    quantity,
    sourceDocumentType = SOURCE_DOC_TYPES.RETURN,
    sourceDocumentId = null,
    actorId = null,
    reason = 'Resalable return',
    session = null
  }) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Return quantity must be a positive integer');
    }

    await this.ensureBalanceRecord(productId, warehouseId, batchId, session);

    const updatedBalance = await StockBalance.findOneAndUpdate(
      { productId, warehouseId, batchId: batchId || null },
      { $inc: { onHand: quantity } },
      { session, returnDocument: 'after' }
    );

    const movement = new StockMovement({
      type: STOCK_MOVEMENT_TYPES.RETURN_RESALABLE,
      productId,
      warehouseId,
      batchId: batchId || null,
      quantityOnHand: quantity,
      quantityReserved: 0,
      quantityInTransit: 0,
      quantityQuarantined: 0,
      sourceDocumentType,
      sourceDocumentId,
      reason,
      actorId
    });
    await movement.save({ session });

    return { balance: updatedBalance, movement };
  }

  /**
   * Return Damaged Stock
   * Moves returned damaged items into quarantined bucket
   */
  static async returnDamaged({
    productId,
    warehouseId,
    batchId = null,
    quantity,
    sourceDocumentType = SOURCE_DOC_TYPES.RETURN,
    sourceDocumentId = null,
    actorId = null,
    reason = 'Damaged return to quarantine',
    session = null
  }) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Return quantity must be a positive integer');
    }

    await this.ensureBalanceRecord(productId, warehouseId, batchId, session);

    const updatedBalance = await StockBalance.findOneAndUpdate(
      { productId, warehouseId, batchId: batchId || null },
      { $inc: { quarantined: quantity } },
      { session, returnDocument: 'after' }
    );

    const movement = new StockMovement({
      type: STOCK_MOVEMENT_TYPES.RETURN_DAMAGED,
      productId,
      warehouseId,
      batchId: batchId || null,
      quantityOnHand: 0,
      quantityReserved: 0,
      quantityInTransit: 0,
      quantityQuarantined: quantity,
      sourceDocumentType,
      sourceDocumentId,
      reason,
      actorId
    });
    await movement.save({ session });

    return { balance: updatedBalance, movement };
  }

  /**
   * Write-Off Quarantined Stock
   */
  static async writeOffQuarantined({
    productId,
    warehouseId,
    batchId = null,
    quantity,
    sourceDocumentType = SOURCE_DOC_TYPES.WRITE_OFF,
    sourceDocumentId = null,
    actorId = null,
    reason = 'Disposal write-off',
    session = null
  }) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Write-off quantity must be a positive integer');
    }

    const updatedBalance = await StockBalance.findOneAndUpdate(
      {
        productId,
        warehouseId,
        batchId: batchId || null,
        $expr: { $gte: ['$quarantined', quantity] }
      },
      {
        $inc: { quarantined: -quantity }
      },
      { session, returnDocument: 'after' }
    );

    if (!updatedBalance) {
      throw new ValidationError(`Cannot write-off ${quantity} units: exceeds quarantined stock`);
    }

    const movement = new StockMovement({
      type: STOCK_MOVEMENT_TYPES.WRITE_OFF,
      productId,
      warehouseId,
      batchId: batchId || null,
      quantityOnHand: 0,
      quantityReserved: 0,
      quantityInTransit: 0,
      quantityQuarantined: -quantity,
      sourceDocumentType,
      sourceDocumentId,
      reason,
      actorId
    });
    await movement.save({ session });

    return { balance: updatedBalance, movement };
  }

  /**
   * Transfer Stock Between Warehouses
   * Executes TRANSFER_OUT and TRANSFER_IN in a single atomic transaction
   */
  static async transferStock({
    productId,
    fromWarehouseId,
    toWarehouseId,
    batchId = null,
    quantity,
    actorId = null,
    reason = 'Warehouse transfer',
    session = null
  }) {
    if (fromWarehouseId.toString() === toWarehouseId.toString()) {
      throw new ValidationError('Source and destination warehouses cannot be the same');
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Transfer quantity must be a positive integer');
    }

    // Atomic conditional decrement from source warehouse
    const fromBalance = await StockBalance.findOneAndUpdate(
      {
        productId,
        warehouseId: fromWarehouseId,
        batchId: batchId || null,
        $expr: { $gte: [{ $subtract: ['$onHand', '$reserved'] }, quantity] }
      },
      { $inc: { onHand: -quantity } },
      { session, returnDocument: 'after' }
    );

    if (!fromBalance) {
      throw new InsufficientStockError(productId, fromWarehouseId, quantity, 0);
    }

    // Ensure destination record exists
    await this.ensureBalanceRecord(productId, toWarehouseId, batchId, session);

    // Atomic increment in destination warehouse
    const toBalance = await StockBalance.findOneAndUpdate(
      { productId, warehouseId: toWarehouseId, batchId: batchId || null },
      { $inc: { onHand: quantity } },
      { session, returnDocument: 'after' }
    );

    // Write both movements
    const transferDocId = new mongoose.Types.ObjectId();

    const outMovement = new StockMovement({
      type: STOCK_MOVEMENT_TYPES.TRANSFER_OUT,
      productId,
      warehouseId: fromWarehouseId,
      batchId: batchId || null,
      quantityOnHand: -quantity,
      sourceDocumentType: SOURCE_DOC_TYPES.TRANSFER,
      sourceDocumentId: transferDocId,
      reason: `${reason} to warehouse ${toWarehouseId}`,
      actorId
    });
    await outMovement.save({ session });

    const inMovement = new StockMovement({
      type: STOCK_MOVEMENT_TYPES.TRANSFER_IN,
      productId,
      warehouseId: toWarehouseId,
      batchId: batchId || null,
      quantityOnHand: quantity,
      sourceDocumentType: SOURCE_DOC_TYPES.TRANSFER,
      sourceDocumentId: transferDocId,
      reason: `${reason} from warehouse ${fromWarehouseId}`,
      actorId
    });
    await inMovement.save({ session });

    return { fromBalance, toBalance, transferDocId };
  }

  /**
   * FEFO Batch Allocation Helper (First Expired, First Out)
   * Returns list of { batchId, quantity } allocations
   */
  static async allocateFEFO({
    productId,
    warehouseId,
    requiredQuantity,
    minDaysToExpiry = 0,
    session = null
  }) {
    const now = new Date();
    const expiryThreshold = new Date(now.getTime() + minDaysToExpiry * 24 * 60 * 60 * 1000);

    // Find non-expired batches for this product, ordered by expiry date ASC
    const validBatches = await Batch.find({
      productId,
      expiryDate: { $gt: expiryThreshold }
    })
      .sort({ expiryDate: 1 })
      .session(session);

    let remainingNeeded = requiredQuantity;
    const allocations = [];

    for (const batch of validBatches) {
      if (remainingNeeded <= 0) break;

      const balance = await StockBalance.findOne({
        productId,
        warehouseId,
        batchId: batch._id
      }).session(session);

      if (!balance) continue;
      const available = balance.onHand - balance.reserved;
      if (available <= 0) continue;

      const allocQty = Math.min(remainingNeeded, available);
      allocations.push({
        batchId: batch._id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        quantity: allocQty
      });
      remainingNeeded -= allocQty;
    }

    if (remainingNeeded > 0) {
      throw new InsufficientStockError(
        productId,
        warehouseId,
        requiredQuantity,
        requiredQuantity - remainingNeeded
      );
    }

    return allocations;
  }

  /**
   * Stock Reconciliation Function
   * Verifies that for a given (product, warehouse, batch), sum(movements) === balance
   */
  static async reconcileStock(productId, warehouseId, batchId = null) {
    const filter = {
      productId: new mongoose.Types.ObjectId(productId),
      warehouseId: new mongoose.Types.ObjectId(warehouseId),
      batchId: batchId ? new mongoose.Types.ObjectId(batchId) : null
    };

    // Aggregate movements
    const [movementSums] = await StockMovement.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          sumOnHand: { $sum: '$quantityOnHand' },
          sumReserved: { $sum: '$quantityReserved' },
          sumInTransit: { $sum: '$quantityInTransit' },
          sumQuarantined: { $sum: '$quantityQuarantined' }
        }
      }
    ]);

    const sums = movementSums || {
      sumOnHand: 0,
      sumReserved: 0,
      sumInTransit: 0,
      sumQuarantined: 0
    };

    // Fetch actual balance
    const balance = await StockBalance.findOne(filter);
    const actual = balance || { onHand: 0, reserved: 0, inTransit: 0, quarantined: 0 };

    const matches =
      actual.onHand === sums.sumOnHand &&
      actual.reserved === sums.sumReserved &&
      actual.inTransit === sums.sumInTransit &&
      actual.quarantined === sums.sumQuarantined;

    return {
      matches,
      balance: {
        onHand: actual.onHand,
        reserved: actual.reserved,
        inTransit: actual.inTransit,
        quarantined: actual.quarantined,
        available: actual.onHand - actual.reserved
      },
      movements: {
        onHand: sums.sumOnHand,
        reserved: sums.sumReserved,
        inTransit: sums.sumInTransit,
        quarantined: sums.sumQuarantined
      },
      diff: {
        onHand: actual.onHand - sums.sumOnHand,
        reserved: actual.reserved - sums.sumReserved,
        inTransit: actual.inTransit - sums.sumInTransit,
        quarantined: actual.quarantined - sums.sumQuarantined
      }
    };
  }
}
