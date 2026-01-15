const jwt = require('jsonwebtoken');

/**
 * RBAC Authorization Middleware
 * Validates JWT token and checks user role against allowed roles
 * Supports both Authorization header (Bearer token) and cookie-based auth
 * 
 * Usage:
 * router.get('/admin-route', requireRole(['admin']), controller);
 * router.get('/shared-route', requireRole(['client', 'bde']), controller);
 */

const requireRole = (allowedRoles = []) => {
  return (req, res, next) => {
    try {
      let token = null;
      
      // =======================
      // TOKEN EXTRACTION
      // =======================
      // 1. Try Authorization header first (Bearer token)
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
      
      // 2. Fall back to cookie-based auth
      if (!token && req.cookies && req.cookies.token) {
        token = req.cookies.token;
      }

      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Authorization token missing'
        });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // =======================
      // ROLE VALIDATION
      // =======================
      const userRole = decoded.role?.toLowerCase();
      
      if (!userRole || !allowedRoles.map(r => r.toLowerCase()).includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: `Access denied. Required roles: ${allowedRoles.join(', ')}`
        });
      }

      // =======================
      // ATTACH USER TO REQUEST
      // =======================
      req.user = {
        user_id: decoded.user_id,
        role: userRole,
        email: decoded.email
      };

      next();

    } catch (err) {
      console.error('RBAC middleware error:', err.message);

      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired. Please login again'
        });
      }

      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
  };
};

module.exports = { requireRole };
