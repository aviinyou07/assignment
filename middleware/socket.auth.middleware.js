const jwt = require('jsonwebtoken');
const db = require('../config/db');

/**
 * Socket.IO Authentication Middleware
 * Validates JWT token and attaches user info to socket
 * 
 * Usage:
 * io.use(socketAuthMiddleware);
 */
const socketAuthMiddleware = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

    if (!token) {
      return next(new Error('Authentication error: Missing token'));
    }

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.user_id || !decoded.role) {
      return next(new Error('Authentication error: Invalid token structure'));
    }

    // Attach user info to socket
    socket.user = {
      user_id: decoded.user_id,
      role: decoded.role,
      email: decoded.email
    };

    // Optional: Verify user still exists and is active
    const [[user]] = await db.query(
      `SELECT user_id, role, is_active FROM users WHERE user_id = ? LIMIT 1`,
      [socket.user.user_id]
    );

    if (!user || !user.is_active) {
      return next(new Error('Authentication error: User not active'));
    }

    next();
  } catch (err) {
    console.error('Socket auth error:', err.message);
    next(new Error(`Authentication error: ${err.message}`));
  }
};

/**
 * Channel Access Validator
 * Validates if user can access specific channel
 * 
 * Channel Types:
 * - user:{user_id}        → Only that user
 * - role:{role}           → Any user with that role
 * - context:{query_code}  → Users involved in that query
 * - context:{work_code}   → Users involved in that order
 */
const validateChannelAccess = async (socket, channel) => {
  try {
    const parts = channel.split(':')[0];
    const identifier = channel.split(':')[1];

    // User can always access their own channel
    if (parts === 'user' && parseInt(identifier) === socket.user.user_id) {
      return true;
    }

    // All users can access role channels (broadcasting)
    if (parts === 'role' && identifier === socket.user.role) {
      return true;
    }

    // Context channels require validation
    if (parts === 'context') {
      // Check if user is involved in this query/order
      if (identifier.startsWith('QUERY_')) {
        // Query access: Client, BDE, Admin
        const [[query]] = await db.query(
          `SELECT o.user_id, u.bde FROM orders o
           JOIN users u ON o.user_id = u.user_id
           WHERE o.query_code = ? 
           AND (o.user_id = ? OR u.bde = ? OR ? = 'admin')
           LIMIT 1`,
          [identifier, socket.user.user_id, socket.user.user_id, socket.user.role]
        );
        return !!query;
      }

      if (identifier.startsWith('WORK_')) {
        // Work code access: Client, BDE, Writer, Admin
        const [[order]] = await db.query(
          `SELECT o.user_id, o.writer_id, u.bde FROM orders o
           JOIN users u ON o.user_id = u.user_id
           WHERE o.work_code = ? 
           AND (o.user_id = ? OR o.writer_id = ? OR u.bde = ? OR ? = 'admin')
           LIMIT 1`,
          [identifier, socket.user.user_id, socket.user.user_id, socket.user.user_id, socket.user.role]
        );
        return !!order;
      }
    }

    return false;
  } catch (err) {
    console.error('Channel access validation error:', err);
    return false;
  }
};

module.exports = {
  socketAuthMiddleware,
  validateChannelAccess
};
