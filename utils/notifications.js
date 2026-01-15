const db = require("../config/db");
const logger = require('./logger');

/**
 * Send notification to user(s) with optional real-time Socket.IO emission
 * @param {number|null} userId - User ID (null for admin)
 * @param {string} message - Notification message
 * @param {string} type - Notification type (quotation-generated, payment-reminder, etc.)
 * @param {object} metadata - Additional metadata to store
 * @param {object} io - Optional Socket.IO instance for real-time emission
 */
async function sendNotification(userId, message, type, metadata = {}, io = null) {
  try {
    let targetUserId = userId;
    
    // If userId is null, send to all admins
    if (userId === null) {
      const [admins] = await db.query(
        "SELECT user_id FROM users WHERE role = 'admin' LIMIT 1"
      );
      
      if (admins.length > 0) {
        targetUserId = admins[0].user_id;
      } else {
        logger.warn('No admin found for notification');
        return;
      }
    }

    // Insert notification into database
    const [result] = await db.query(
      `INSERT INTO notifications (user_id, title, message, type, link_url, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, 0, NOW())`,
      [targetUserId, message, message, type, metadata.link_url || null]
    );

    // Emit real-time notification via Socket.IO if io instance provided
    if (io && result.insertId) {
      const notificationPayload = {
        notification_id: result.insertId,
        user_id: targetUserId,
        title: message,
        message: message,
        type: type,
        link_url: metadata.link_url || null,
        is_read: 0,
        created_at: new Date().toISOString()
      };
      
      // Emit to user's personal channel
      io.to(`user:${targetUserId}`).emit('notification:new', notificationPayload);
      
      // Also emit to role channel if specified
      if (metadata.role) {
        io.to(`role:${metadata.role}`).emit('notification:new', notificationPayload);
      }
    }

    logger.info(`Notification sent to user ${targetUserId}: ${message}`);
    return result;
  } catch (error) {
    logger.error(`Error sending notification: ${error && error.message ? error.message : error}`);
    // Don't throw - notifications should not break main flow
  }
}

/**
 * Get unread notifications for a user
 * @param {number} userId - User ID
 * @param {number} limit - Number of notifications to fetch (default: 10)
 */
async function getNotifications(userId, limit = 10) {
  try {
    const [notifications] = await db.query(
      `SELECT * FROM notifications 
       WHERE user_id = ? AND is_read = 0
       ORDER BY created_at DESC
       LIMIT ?`,
      [userId, limit]
    );

    return notifications;
  } catch (error) {
    logger.error(`Error fetching notifications: ${error && error.message ? error.message : error}`);
    return [];
  }
}

/**
 * Mark notification as read
 * @param {number} notificationId - Notification ID
 */
async function markAsRead(notificationId) {
  try {
    const [result] = await db.query(
      `UPDATE notifications SET is_read = 1 WHERE notification_id = ?`,
      [notificationId]
    );

    return result;
  } catch (error) {
    logger.error(`Error marking notification as read: ${error && error.message ? error.message : error}`);
  }
}

/**
 * Mark all notifications as read for a user
 * @param {number} userId - User ID
 */
async function markAllAsRead(userId) {
  try {
    const [result] = await db.query(
      `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`,
      [userId]
    );

    return result;
  } catch (error) {
    logger.error(`Error marking all notifications as read: ${error && error.message ? error.message : error}`);
  }
}

/**
 * Delete a notification
 * @param {number} notificationId - Notification ID
 */
async function deleteNotification(notificationId) {
  try {
    const [result] = await db.query(
      `DELETE FROM notifications WHERE notification_id = ?`,
      [notificationId]
    );

    return result;
  } catch (error) {
    logger.error(`Error deleting notification: ${error && error.message ? error.message : error}`);
  }
}

/**
 * Clear all notifications for a user
 * @param {number} userId - User ID
 */
async function clearAllNotifications(userId) {
  try {
    const [result] = await db.query(
      `DELETE FROM notifications WHERE user_id = ?`,
      [userId]
    );

    return result;
  } catch (error) {
    console.error("Error clearing notifications:", error.message);
  }
}

module.exports = {
  sendNotification,
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications
};
