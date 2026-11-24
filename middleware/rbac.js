import { ROLES } from '../config/constants.js';

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Access denied. Requires one of roles: ${allowedRoles.join(', ')}`
        }
      });
    }

    next();
  };
}

export function sanitizeWarehouseStaffPrices(req, res, next) {
  // If user is WAREHOUSE_STAFF, strip pricing fields from JSON responses
  if (req.user && req.user.role === ROLES.WAREHOUSE_STAFF) {
    const originalJson = res.json;
    res.json = function (body) {
      if (body && body.data) {
        body.data = stripPrices(body.data);
      }
      return originalJson.call(this, body);
    };
  }
  next();
}

function stripPrices(obj) {
  if (obj && typeof obj.toJSON === 'function') {
    obj = obj.toJSON();
  } else if (obj && typeof obj.toObject === 'function') {
    obj = obj.toObject();
  }

  if (Array.isArray(obj)) {
    return obj.map(stripPrices);
  } else if (obj !== null && typeof obj === 'object') {
    const clean = {};
    for (const [key, val] of Object.entries(obj)) {
      const lower = key.toLowerCase();
      if (
        lower.includes('price') ||
        lower.includes('paisa') ||
        lower.includes('total') ||
        lower.includes('discount') ||
        lower.includes('tax')
      ) {
        continue; // Omit sensitive price fields for warehouse staff
      }
      clean[key] = stripPrices(val);
    }
    return clean;
  }
  return obj;
}
