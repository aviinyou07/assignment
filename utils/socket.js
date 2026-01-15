/**
 * SOCKET.IO SINGLETON
 * Stores global reference to Socket.IO instance
 * for use in controllers/services that don't have req.io
 */

let ioInstance = null;

/**
 * Set the Socket.IO instance
 * Called once from server.js after io is created
 */
function setIO(io) {
  ioInstance = io;
}

/**
 * Get the Socket.IO instance
 * Returns null if not set yet
 */
function getIO() {
  return ioInstance;
}

/**
 * Emit notification to user
 * Convenience function for emitting real-time notifications
 */
function emitToUser(userId, event, data) {
  if (ioInstance) {
    ioInstance.to(`user:${userId}`).emit(event, data);
  }
}

/**
 * Emit notification to role
 */
function emitToRole(role, event, data) {
  if (ioInstance) {
    ioInstance.to(`role:${role}`).emit(event, data);
  }
}

/**
 * Emit notification to context
 */
function emitToContext(contextCode, event, data) {
  if (ioInstance) {
    ioInstance.to(`context:${contextCode}`).emit(event, data);
  }
}

module.exports = {
  setIO,
  getIO,
  emitToUser,
  emitToRole,
  emitToContext
};
