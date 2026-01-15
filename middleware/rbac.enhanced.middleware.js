const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { createAuditLog } = require('../utils/audit');

/**
 * ENTERPRISE RBAC MIDDLEWARE
 * Strict role-based access control with:
 * - Token validation
 * - Role verification
 * - Resource ownership validation
 * - Rate limiting per role
 * - Audit logging for unauthorized access
 */

// Role hierarchy and permissions matrix
const ROLE_PERMISSIONS = {
  admin: {
    canAccessAll: true,
    canVerifyPayments: true,
    canApproveQC: true,
    canAssignWriters: true,
    canCloseOrders: true,
    canRestrictChat: true,
    canOverrideStatus: true,
    canViewAuditLogs: true,
    canManageUsers: true
  },
  bde: {
    canAccessAll: false,
    canVerifyPayments: false,
    canApproveQC: false,
    canAssignWriters: false,
    canCloseOrders: false,
    canRestrictChat: false,
    canOverrideStatus: false,
    canViewAuditLogs: false,
    canManageUsers: false,
    canGenerateQuotations: true,
    canViewOwnClients: true,
    canSendPaymentReminders: true
  },
  writer: {
    canAccessAll: false,
    canVerifyPayments: false,
    canApproveQC: false,
    canAssignWriters: false,
    canCloseOrders: false,
    canRestrictChat: false,
    canOverrideStatus: false,
    canViewAuditLogs: false,
    canManageUsers: false,
    canAcceptTasks: true,
    canUploadDrafts: true,
    canSubmitForQC: true,
    canViewOwnTasks: true
  },
  client: {
    canAccessAll: false,
    canVerifyPayments: false,
    canApproveQC: false,
    canAssignWriters: false,
    canCloseOrders: false,
    canRestrictChat: false,
    canOverrideStatus: false,
    canViewAuditLogs: false,
    canManageUsers: false,
    canCreateQueries: true,
    canAcceptQuotations: true,
    canUploadPayments: true,
    canSubmitFeedback: true,
    canViewOwnOrders: true
  }
};

// Rate limiting configuration per role (requests per minute)
const RATE_LIMITS = {
  admin: 200,
  bde: 100,
  writer: 100,
  client: 60
};

// In-memory rate limit store (use Redis in production)
const rateLimitStore = new Map();

/**
 * Check rate limit for user
 */
function checkRateLimit(userId, role) {
  const key = `${userId}:${role}`;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const limit = RATE_LIMITS[role] || 60;

  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }

  const entry = rateLimitStore.get(key);

  if (now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count };
}

/**
 * Enhanced role validation middleware
 */
const requireRole = (allowedRoles = [], options = {}) => {
  const { requireVerified = true, skipRateLimit = false, logAccess = false } = options;

  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;

      // =======================
      // TOKEN VALIDATION
      // =======================
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        await logUnauthorizedAccess(req, null, 'MISSING_TOKEN');
        return res.status(401).json({
          success: false,
          code: 'AUTH_TOKEN_MISSING',
          message: 'Authorization token missing or invalid format'
        });
      }

      const token = authHeader.split(' ')[1];
      
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (jwtError) {
        await logUnauthorizedAccess(req, null, 'INVALID_TOKEN', jwtError.message);
        
        if (jwtError.name === 'TokenExpiredError') {
          return res.status(401).json({
            success: false,
            code: 'AUTH_TOKEN_EXPIRED',
            message: 'Token expired. Please login again'
          });
        }
        
        return res.status(401).json({
          success: false,
          code: 'AUTH_TOKEN_INVALID',
          message: 'Invalid token'
        });
      }

      // =======================
      // ROLE VALIDATION
      // =======================
      const userRole = decoded.role?.toLowerCase();

      if (!userRole || !allowedRoles.map(r => r.toLowerCase()).includes(userRole)) {
        await logUnauthorizedAccess(req, decoded.user_id, 'ROLE_DENIED', 
          `Role ${userRole} attempted to access route requiring ${allowedRoles.join(', ')}`);
        
        return res.status(403).json({
          success: false,
          code: 'AUTH_ROLE_DENIED',
          message: `Access denied. Required roles: ${allowedRoles.join(', ')}`
        });
      }

      // =======================
      // RATE LIMITING
      // =======================
      if (!skipRateLimit) {
        const rateCheck = checkRateLimit(decoded.user_id, userRole);
        
        res.set('X-RateLimit-Remaining', rateCheck.remaining);
        
        if (!rateCheck.allowed) {
          await logUnauthorizedAccess(req, decoded.user_id, 'RATE_LIMITED');
          return res.status(429).json({
            success: false,
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests. Please try again later.',
            retryAfter: rateCheck.retryAfter
          });
        }
      }

      // =======================
      // USER VERIFICATION CHECK
      // =======================
      if (requireVerified) {
        const [[user]] = await db.query(
          `SELECT user_id, is_active, is_verified, role FROM users WHERE user_id = ? LIMIT 1`,
          [decoded.user_id]
        );

        if (!user) {
          return res.status(401).json({
            success: false,
            code: 'AUTH_USER_NOT_FOUND',
            message: 'User not found'
          });
        }

        if (!user.is_active) {
          return res.status(403).json({
            success: false,
            code: 'AUTH_USER_INACTIVE',
            message: 'Account is inactive. Please contact support.'
          });
        }

        // Verify role hasn't changed in DB
        if (user.role.toLowerCase() !== userRole) {
          return res.status(403).json({
            success: false,
            code: 'AUTH_ROLE_MISMATCH',
            message: 'Role mismatch. Please login again.'
          });
        }
      }

      // =======================
      // ATTACH USER TO REQUEST
      // =======================
      req.user = {
        user_id: decoded.user_id,
        role: userRole,
        email: decoded.email,
        permissions: ROLE_PERMISSIONS[userRole] || {}
      };

      // =======================
      // ACCESS LOGGING (optional)
      // =======================
      if (logAccess) {
        await createAuditLog({
          user_id: decoded.user_id,
          role: userRole,
          event_type: 'API_ACCESS',
          resource_type: 'endpoint',
          resource_id: req.originalUrl,
          details: `${req.method} ${req.originalUrl}`,
          ip_address: req.ip,
          user_agent: req.get('User-Agent')
        });
      }

      next();

    } catch (err) {
      console.error('RBAC middleware error:', err);
      return res.status(500).json({
        success: false,
        code: 'AUTH_ERROR',
        message: 'Authentication error'
      });
    }
  };
};

/**
 * Check specific permission for current user
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required'
      });
    }

    const userPermissions = req.user.permissions;

    if (!userPermissions || (!userPermissions.canAccessAll && !userPermissions[permission])) {
      createAuditLog({
        user_id: req.user.user_id,
        role: req.user.role,
        event_type: 'PERMISSION_DENIED',
        resource_type: 'permission',
        resource_id: permission,
        details: `User attempted action requiring ${permission}`,
        ip_address: req.ip,
        user_agent: req.get('User-Agent')
      });

      return res.status(403).json({
        success: false,
        code: 'PERMISSION_DENIED',
        message: `This action requires ${permission} permission`
      });
    }

    next();
  };
};

/**
 * Validate resource ownership
 * Ensures user can only access their own resources (unless admin)
 */
const validateResourceOwnership = (resourceType, paramName = 'id') => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Admin can access all resources
    if (req.user.role === 'admin') {
      return next();
    }

    const resourceId = req.params[paramName] || req.body[paramName];

    if (!resourceId) {
      return res.status(400).json({
        success: false,
        message: `${paramName} required`
      });
    }

    try {
      let query;
      let params;

      switch (resourceType) {
        case 'order':
          // Check if user owns the order or is assigned writer/BDE
          query = `
            SELECT o.order_id, o.user_id, o.writer_id, u.bde 
            FROM orders o 
            LEFT JOIN users u ON o.user_id = u.user_id
            WHERE o.order_id = ? OR o.query_code = ? OR o.work_code = ?
            LIMIT 1
          `;
          params = [resourceId, resourceId, resourceId];
          break;

        case 'query':
          query = `
            SELECT o.order_id, o.user_id, u.bde 
            FROM orders o 
            LEFT JOIN users u ON o.user_id = u.user_id
            WHERE o.query_code = ?
            LIMIT 1
          `;
          params = [resourceId];
          break;

        case 'task':
          query = `
            SELECT te.id, te.order_id, te.writer_id 
            FROM task_evaluations te
            WHERE te.id = ?
            LIMIT 1
          `;
          params = [resourceId];
          break;

        case 'notification':
          query = `SELECT notification_id, user_id FROM notifications WHERE notification_id = ? LIMIT 1`;
          params = [resourceId];
          break;

        default:
          return next();
      }

      const [[resource]] = await db.query(query, params);

      if (!resource) {
        return res.status(404).json({
          success: false,
          message: `${resourceType} not found`
        });
      }

      // Check ownership based on role
      let hasAccess = false;

      switch (req.user.role) {
        case 'client':
          hasAccess = resource.user_id === req.user.user_id;
          break;
        case 'bde':
          hasAccess = resource.bde === req.user.user_id || resource.user_id === req.user.user_id;
          break;
        case 'writer':
          hasAccess = resource.writer_id === req.user.user_id;
          break;
      }

      if (!hasAccess) {
        await createAuditLog({
          user_id: req.user.user_id,
          role: req.user.role,
          event_type: 'UNAUTHORIZED_RESOURCE_ACCESS',
          resource_type: resourceType,
          resource_id: resourceId,
          details: `User attempted to access ${resourceType} they don't own`,
          ip_address: req.ip,
          user_agent: req.get('User-Agent')
        });

        return res.status(403).json({
          success: false,
          message: 'Access denied to this resource'
        });
      }

      // Attach resource to request for controller use
      req.resource = resource;
      next();

    } catch (err) {
      console.error('Resource ownership check error:', err);
      return res.status(500).json({
        success: false,
        message: 'Error validating resource access'
      });
    }
  };
};

/**
 * Log unauthorized access attempts
 */
async function logUnauthorizedAccess(req, userId, type, details = '') {
  try {
    await createAuditLog({
      user_id: userId,
      role: 'unknown',
      event_type: `UNAUTHORIZED_${type}`,
      resource_type: 'endpoint',
      resource_id: req.originalUrl,
      details: details || `Unauthorized access attempt: ${req.method} ${req.originalUrl}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });
  } catch (err) {
    console.error('Failed to log unauthorized access:', err);
  }
}

/**
 * Admin-only action guard
 * Strict middleware for admin-exclusive actions
 */
const adminOnly = () => {
  return async (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
      await createAuditLog({
        user_id: req.user?.user_id,
        role: req.user?.role || 'unknown',
        event_type: 'ADMIN_ACTION_BLOCKED',
        resource_type: 'endpoint',
        resource_id: req.originalUrl,
        details: `Non-admin attempted admin-only action`,
        ip_address: req.ip,
        user_agent: req.get('User-Agent')
      });

      return res.status(403).json({
        success: false,
        code: 'ADMIN_ONLY',
        message: 'This action requires administrator privileges'
      });
    }
    next();
  };
};

/**
 * Idempotency middleware for critical operations
 */
const idempotent = (keyPrefix = 'op') => {
  const processedKeys = new Map();

  return (req, res, next) => {
    const idempotencyKey = req.headers['x-idempotency-key'];

    if (!idempotencyKey) {
      return next(); // No key, proceed normally
    }

    const fullKey = `${keyPrefix}:${req.user?.user_id}:${idempotencyKey}`;

    if (processedKeys.has(fullKey)) {
      const cached = processedKeys.get(fullKey);
      return res.status(200).json({
        ...cached,
        _idempotent: true
      });
    }

    // Capture response
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        processedKeys.set(fullKey, data);
        // Expire after 24 hours
        setTimeout(() => processedKeys.delete(fullKey), 24 * 60 * 60 * 1000);
      }
      return originalJson(data);
    };

    next();
  };
};

module.exports = {
  requireRole,
  requirePermission,
  validateResourceOwnership,
  adminOnly,
  idempotent,
  ROLE_PERMISSIONS,
  RATE_LIMITS
};
