const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // =======================
    // CHECK TOKEN EXISTENCE
    // =======================
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token missing'
      });
    }

    const token = authHeader.split(' ')[1];

    // =======================
    // VERIFY TOKEN
    // =======================
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // =======================
    // ROLE CHECK (CLIENT ONLY)
    // =======================
    if (decoded.role !== 'client') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // =======================
    // ATTACH USER TO REQUEST
    // =======================
    req.user = {
      user_id: decoded.user_id,
      role: decoded.role
    };

    next();

  } catch (err) {
    console.error('Client auth middleware error:', err);

    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};
