const jwt = require('jsonwebtoken');

/**
 * RBAC Authorization Middleware
 * Validates JWT token and checks user role against allowed roles
 * 
 * Usage:
 * router.get('/admin-route', requireRole(['admin']), controller);
 * router.get('/shared-route', requireRole(['client', 'bde']), controller);
 */

const requireRole = (allowedRoles = []) => {
  return (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;

      // =======================
      // TOKEN VALIDATION
      // =======================
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          message: 'Authorization token missing or invalid format'
        });
      }

      const token = authHeader.split(' ')[1];
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
