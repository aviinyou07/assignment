const jwt = require("jsonwebtoken");
const db = require("../config/db");

/**
 * BDE Authentication Middleware
 * Verifies JWT token and validates BDE role
 */
const authGuardBDE = (requiredRoles = ["bde"]) => {
  return async (req, res, next) => {
    try {
      // Get token from cookies
      const token = req.cookies.token;

      // Check if request is API or page request
      const isApiRequest = req.xhr || req.path.includes('/api/') || req.headers.accept?.includes('application/json');

      if (!token) {
        if (isApiRequest) {
          return res.status(401).json({
            success: false,
            message: "No authentication token provided"
          });
        }
        return res.redirect("/login");
      }

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "your_secret_key");
      
      // Validate role
      if (!requiredRoles.includes(decoded.role)) {
        if (isApiRequest) {
          return res.status(403).json({
            success: false,
            message: "Insufficient permissions for this action"
          });
        }
        return res.status(403).render("errors/403", {
          title: "Forbidden",
          layout: false
        });
      }

      // Attach user info to request
      req.user = decoded;
      next();
    } catch (err) {
      console.error("Authentication error:", err);
      
      const isApiRequest = req.xhr || req.path.includes('/api/') || req.headers.accept?.includes('application/json');
      
      if (err.name === "TokenExpiredError") {
        if (isApiRequest) {
          return res.status(401).json({
            success: false,
            message: "Token has expired. Please log in again."
          });
        }
        res.clearCookie("token");
        return res.redirect("/login");
      }

      if (isApiRequest) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired authentication token"
        });
      }
      res.clearCookie("token");
      return res.redirect("/login");
    }
  };
};

/**
 * Fetch BDE Profile
 * Retrieves current BDE's profile information from database
 */
const fetchBDEProfile = async (req, res, next) => {
  try {
    const userId = req.user.user_id;
    
    const [rows] = await db.query(
      `SELECT 
        user_id, 
        full_name, 
        email, 
        mobile_number, 
        whatsapp, 
        university, 
        country, 
        currency_code, 
        role, 
        is_verified, 
        created_at
      FROM users
      WHERE user_id = ? AND role = 'bde' AND is_active = 1`,
      [userId]
    );

    if (rows.length) {
      const profile = rows[0];
      const initials = profile.full_name
        ? profile.full_name
            .split(" ")
            .map(n => n[0])
            .join("")
            .toUpperCase()
        : "BD";

      res.locals.profile = profile;
      res.locals.initials = initials;
    }
    
    next();
  } catch (err) {
    console.error("Error fetching BDE profile:", err);
    next();
  }
};

/**
 * Check if BDE owns the resource
 * Verifies that the BDE has access to the query/order through referral
 */
const verifyBDEAccess = async (req, res, next) => {
  try {
    const bdeId = req.user.user_id;
    const { queryCode, workCode } = req.params;

    if (queryCode) {
      // Verify BDE owns this query through referral
      const [rows] = await db.query(
        `SELECT o.order_id, o.user_id, u.bde
         FROM orders o
         JOIN users u ON o.user_id = u.user_id
         WHERE o.query_code = ?`,
        [queryCode]
      );

      if (!rows.length || rows[0].bde !== bdeId) {
        return res.status(403).json({
          success: false,
          message: "You don't have access to this query"
        });
      }

      req.orderId = rows[0].order_id;
    } else if (workCode) {
      // Verify BDE owns this work code through referral
      const [rows] = await db.query(
        `SELECT o.order_id, o.user_id, u.bde
         FROM orders o
         JOIN users u ON o.user_id = u.user_id
         WHERE o.work_code = ?`,
        [workCode]
      );

      if (!rows.length || rows[0].bde !== bdeId) {
        return res.status(403).json({
          success: false,
          message: "You don't have access to this order"
        });
      }

      req.orderId = rows[0].order_id;
    }

    next();
  } catch (err) {
    console.error("Error verifying BDE access:", err);
    res.status(500).json({
      success: false,
      message: "Error verifying access"
    });
  }
};

module.exports = {
  authGuardBDE,
  fetchBDEProfile,
  verifyBDEAccess
};
