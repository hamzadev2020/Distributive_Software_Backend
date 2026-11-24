/**
 * Domain-specific error classes for DMS
 */

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class InsufficientStockError extends AppError {
  constructor(productId, warehouseId, requested, available) {
    super(
      `Insufficient available stock for product ${productId} in warehouse ${warehouseId}. Requested: ${requested}, Available: ${available}`,
      409,
      'INSUFFICIENT_STOCK',
      { productId, warehouseId, requested, available }
    );
  }
}

export class ConcurrencyError extends AppError {
  constructor(message = 'Document was modified by another operation. Please retry.') {
    super(message, 409, 'CONCURRENCY_CONFLICT');
  }
}

export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class NotFoundError extends AppError {
  constructor(entity, id) {
    super(`${entity} with ID ${id} not found`, 404, 'NOT_FOUND', { entity, id });
  }
}

export class StateTransitionError extends AppError {
  constructor(entity, fromState, toState) {
    super(
      `Illegal state transition for ${entity} from '${fromState}' to '${toState}'`,
      400,
      'ILLEGAL_STATE_TRANSITION',
      { entity, fromState, toState }
    );
  }
}

export class PeriodLockedError extends AppError {
  constructor(date, lockDate) {
    super(
      `Cannot post transaction on ${date}. Accounting period is locked up to ${lockDate}`,
      403,
      'PERIOD_LOCKED',
      { date, lockDate }
    );
  }
}
