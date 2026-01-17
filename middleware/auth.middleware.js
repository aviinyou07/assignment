const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { createAuditLog } = require('../utils/audit');
const ROLE_PERMISSIONS = {
  admin: {
    canAccessAll: true,
    canVerifyPayments: true,
    canRejectPayments: true,
    canApproveQC: true,
    canRejectQC: true,
    canAssignWriters: true,
    canReassignWriters: true,
    canCloseOrders: true,
    canCancelOrders: true,
    canRestrictChat: true,
    canCloseChat: true,
    canInitiateChat: true,
    canOverrideStatus: true,
    canViewAuditLogs: true,
    canManageUsers: true,
    canGenerateQuotations: true,
    canDeliverOrders: true,
    canCompleteOrders: true,
    canRequestRevisions: true,
    canForwardMessages: true,
    canTagImportantMessages: true
  },
  bde: {
    canAccessAll: false,
    canGenerateQuotations: true,
    canViewOwnClients: true,
    canSendPaymentReminders: true,
    canRequestChat: true,
    canSendNotifications: true
  },
  writer: {
    canAccessAll: false,
    canAcceptTasks: true,
    canRejectTasks: true,
    canUploadDrafts: true,
    canSubmitForQC: true,
    canViewOwnTasks: true,
    canRequestChat: true
  },
  client: {
    canAccessAll: false,
    canCreateQueries: true,
    canAcceptQuotations: true,
    canUploadPayments: true,
    canSubmitFeedback: true,
    canViewOwnOrders: true,
    canRequestChat: true,
    canRequestRevision: true
  }
};

// Rate limiting config (requests per minute)
const RATE_LIMITS = { admin: 200, bde: 100, writer: 100, client: 60 };
const rateLimitStore = new Map();

// Idempotency store
const idempotencyStore = new Map();

// =======================
// HELPER FUNCTIONS
// =======================

/**
 * Extract token from request (Cookie or Bearer)
 */
function extractToken(req) {
  // 1. Try Authorization header (Bearer token) - for API requests
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return { token: authHeader.split(' ')[1], source: 'bearer' };
  }
  
  // 2. Try cookie - for web requests
  if (req.cookies && req.cookies.token) {
    return { token: req.cookies.token, source: 'cookie' };
  }
  
  return { token: null, source: null };
}

/**
 * Check if request expects JSON response (API) or HTML (web)
 */
function isApiRequest(req) {
  return req.xhr || 
         req.path.includes('/api/') || 
         req.headers.accept?.includes('application/json') ||
         req.headers['content-type']?.includes('application/json');
}

/**
 * Check rate limit for user
 */
function checkRateLimit(userId, role) {
  const key = `${userId}:${role}`;
  const now = Date.now();
  const windowMs = 60 * 1000;
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
 * Log unauthorized access attempt
 */
async function logUnauthorizedAccess(req, userId, reason, details = null) {
  try {
    await createAuditLog({
      user_id: userId || 0,
      role: 'unknown',
      event_type: 'UNAUTHORIZED_ACCESS',
      resource_type: 'endpoint',
      resource_id: req.originalUrl,
      details: details || `${reason}: ${req.method} ${req.originalUrl}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });
  } catch (err) {
    console.error('Failed to log unauthorized access:', err);
  }
}

// =======================
// MAIN AUTH MIDDLEWARE
// =======================

/**
 * Universal authentication guard
 * Works for all roles with both cookie and bearer token
 * 
 * @param {string[]} allowedRoles - Roles allowed to access the route
 * @param {object} options - Additional options
 * @param {boolean} options.requireVerified - Check if user is verified in DB
 * @param {boolean} options.skipRateLimit - Skip rate limiting
 * @param {boolean} options.redirectOnFail - Redirect to login on failure (for web pages)
 */
const authGuard = (allowedRoles = [], options = {}) => {
  const { requireVerified = false, skipRateLimit = false, redirectOnFail = null } = options;

  return async (req, res, next) => {
    try {
      const { token, source } = extractToken(req);
      const isApi = isApiRequest(req);
      const shouldRedirect = redirectOnFail !== null ? redirectOnFail : !isApi;

      // =======================
      // TOKEN VALIDATION
      // =======================
      if (!token) {
        if (shouldRedirect) {
          return res.redirect('/login');
        }
        return res.status(401).json({
          success: false,
          code: 'AUTH_TOKEN_MISSING',
          message: 'Authorization token missing'
        });
      }

      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (jwtError) {
        if (shouldRedirect) {
          res.clearCookie('token');
          return res.redirect('/login');
        }
        
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
      
      if (allowedRoles.length > 0 && !allowedRoles.map(r => r.toLowerCase()).includes(userRole)) {
        await logUnauthorizedAccess(req, decoded.user_id, 'ROLE_DENIED');
        
        if (shouldRedirect) {
          return res.status(403).render('errors/403', {
            title: 'Forbidden',
            layout: false
          });
        }
        
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
          return res.status(429).json({
            success: false,
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests',
            retryAfter: rateCheck.retryAfter
          });
        }
      }

      // =======================
      // USER VERIFICATION (optional)
      // =======================
      if (requireVerified) {
        const [[user]] = await db.query(
          `SELECT user_id, is_active, is_verified, role FROM users WHERE user_id = ? LIMIT 1`,
          [decoded.user_id]
        );

        if (!user || !user.is_active) {
          if (shouldRedirect) {
            res.clearCookie('token');
            return res.redirect('/login');
          }
          return res.status(403).json({
            success: false,
            code: 'AUTH_USER_INACTIVE',
            message: 'Account is inactive'
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

      // Make auth info available to templates
      res.locals.authToken = token;
      res.locals.user = decoded;

      next();
    } catch (err) {
      console.error('Auth middleware error:', err);
      
      if (!isApiRequest(req)) {
        res.clearCookie('token');
        return res.redirect('/login');
      }
      
      return res.status(500).json({
        success: false,
        code: 'AUTH_ERROR',
        message: 'Authentication error'
      });
    }
  };
};

/**
 * Shorthand for role-specific guards (backward compatibility)
 */
const requireRole = authGuard;

// =======================
// PERMISSION MIDDLEWARE
// =======================

/**
 * Check specific permission for current user
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userPermissions = req.user.permissions;
    
    if (!userPermissions || (!userPermissions.canAccessAll && !userPermissions[permission])) {
      return res.status(403).json({
        success: false,
        code: 'PERMISSION_DENIED',
        message: `This action requires ${permission} permission`
      });
    }

    next();
  };
};

// =======================
// RESOURCE OWNERSHIP
// =======================

/**
 * Validate resource ownership (user can only access their own resources)
 */
const validateResourceOwnership = (resourceType, paramName = 'id') => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Admin can access all resources
    if (req.user.role === 'admin') {
      return next();
    }

    const resourceId = req.params[paramName] || req.body[paramName];
    if (!resourceId) {
      return res.status(400).json({ success: false, message: `${paramName} required` });
    }

    try {
      let query, params;

      switch (resourceType) {
        case 'order':
        case 'query':
          query = `
            SELECT o.order_id, o.user_id, o.writer_id, u.bde 
            FROM orders o 
            LEFT JOIN users u ON o.user_id = u.user_id
            WHERE o.order_id = ? OR o.query_code = ? OR o.work_code = ?
            LIMIT 1
          `;
          params = [resourceId, resourceId, resourceId];
          break;

        case 'task':
          query = `SELECT id, order_id, writer_id FROM task_evaluations WHERE id = ? LIMIT 1`;
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
        return res.status(404).json({ success: false, message: `${resourceType} not found` });
      }

      // Check ownership based on role
      let hasAccess = false;
      switch (req.user.role) {
        case 'client':
          hasAccess = resource.user_id === req.user.user_id;
          break;
        case 'bde':
          hasAccess = resource.bde === req.user.user_id;
          break;
        case 'writer':
          hasAccess = resource.writer_id === req.user.user_id;
          break;
      }

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: `You don't have access to this ${resourceType}`
        });
      }

      req.resourceId = resource.order_id || resource.id;
      next();
    } catch (err) {
      console.error('Resource ownership validation error:', err);
      return res.status(500).json({ success: false, message: 'Error validating access' });
    }
  };
};

// =======================
// IDEMPOTENCY MIDDLEWARE
// =======================

/**
 * Prevent duplicate submissions using idempotency key
 */
const idempotent = (resourceType) => {
  return async (req, res, next) => {
    const idempotencyKey = req.headers['x-idempotency-key'];
    
    if (!idempotencyKey) {
      return next(); // No key provided, proceed normally
    }

    const userId = req.user?.user_id || 'anonymous';
    const cacheKey = `${userId}:${resourceType}:${idempotencyKey}`;

    // Check if this request was already processed
    if (idempotencyStore.has(cacheKey)) {
      const cached = idempotencyStore.get(cacheKey);
      
      // Return cached response if within 24 hours
      if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
        return res.status(cached.statusCode).json(cached.body);
      }
      
      // Remove stale entry
      idempotencyStore.delete(cacheKey);
    }

    // Store original res.json to intercept response
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      idempotencyStore.set(cacheKey, {
        timestamp: Date.now(),
        statusCode: res.statusCode,
        body
      });
      return originalJson(body);
    };

    next();
  };
};

// =======================
// PROFILE FETCHERS
// =======================

/**
 * Fetch user profile and attach to res.locals (for templates)
 */
const fetchProfile = async (req, res, next) => {
  try {
    if (!req.user) return next();
    
    const [rows] = await db.query(
      `SELECT user_id, full_name, email, mobile_number, whatsapp, 
              university, country, currency_code, role, is_verified, created_at
       FROM users WHERE user_id = ? AND is_active = 1`,
      [req.user.user_id]
    );

    if (rows.length) {
      const profile = rows[0];
      const initials = profile.full_name
        ? profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)
        : profile.role.substring(0, 2).toUpperCase();
      
      res.locals.profile = profile;
      res.locals.initials = initials;
    }
    
    next();
  } catch (err) {
    console.error('Error fetching profile:', err);
    next();
  }
};

// =======================
// BDE ACCESS VERIFICATION
// =======================

/**
 * Verify BDE has access to resource through client referral
 */
const verifyBDEAccess = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'bde') {
      return next();
    }

    const bdeId = req.user.user_id;
    const { queryCode, workCode } = req.params;
    const code = queryCode || workCode;

    if (!code) return next();

    const [rows] = await db.query(
      `SELECT o.order_id, u.bde
       FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE o.query_code = ? OR o.work_code = ?`,
      [code, code]
    );

    if (!rows.length || rows[0].bde !== bdeId) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this resource"
      });
    }

    req.orderId = rows[0].order_id;
    next();
  } catch (err) {
    console.error('BDE access verification error:', err);
    res.status(500).json({ success: false, message: 'Error verifying access' });
  }
};

// =======================
// EXPORTS
// =======================
module.exports = {
  // Main auth
  authGuard,
  requireRole,
  
  // Permissions
  requirePermission,
  ROLE_PERMISSIONS,
  
  // Resource validation
  validateResourceOwnership,
  verifyBDEAccess,
  
  // Utilities
  idempotent,
  fetchProfile,
  
  // Helpers
  extractToken,
  isApiRequest
};
