import { AppError } from '../utils/errors.js';

export function errorHandler(err, req, res, next) {
  // Structured error logging
  console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, {
    name: err.name,
    message: err.message,
    code: err.code,
    statusCode: err.statusCode
  });

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details || null
      }
    });
  }

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors).map(e => ({
      field: e.path,
      message: e.message
    }));
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Schema validation failed',
        details
      }
    });
  }

  // MongoDB duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_KEY',
        message: `A record with this ${field} already exists`,
        details: err.keyValue
      }
    });
  }

  // Never leak internal stack trace in production responses
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred'
    }
  });
}
