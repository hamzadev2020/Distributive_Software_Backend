import { IdempotencyKey } from '../models/IdempotencyKey.js';

export function requireIdempotency(req, res, next) {
  const key = req.headers['idempotency-key'];
  if (!key) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required for this operation'
      }
    });
  }

  // Intercept response to store result
  IdempotencyKey.findOne({ key })
    .then(existing => {
      if (existing) {
        // Return previously stored response
        return res.status(existing.statusCode).json(existing.responseBody);
      }

      // Capture original json method
      const originalJson = res.json;
      res.json = function (body) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          IdempotencyKey.create({
            key,
            userId: req.user?._id || null,
            path: req.originalUrl,
            method: req.method,
            statusCode: res.statusCode,
            responseBody: body
          }).catch(err => {
            console.error('Failed to save idempotency key:', err.message);
          });
        }
        return originalJson.call(this, body);
      };

      next();
    })
    .catch(err => next(err));
}
