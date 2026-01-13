const db = require("../config/db");

/**
 * Send notification to user(s)
 * @param {number|null} userId - User ID (null for admin)
 * @param {string} message - Notification message
 * @param {string} type - Notification type (quotation-generated, payment-reminder, etc.)
 * @param {object} metadata - Additional metadata to store
 */
async function sendNotification(userId, message, type, metadata = {}) {
  try {
    // If userId is null, send to all admins
    if (userId === null) {
      const [admins] = await db.query(
        "SELECT user_id FROM users WHERE role = 'admin' LIMIT 1"
      );
      
      if (admins.length > 0) {
        userId = admins[0].user_id;
      } else {
        console.warn("No admin found for notification");
        return;
      }
    }

    // Insert notification into database
    const [result] = await db.query(
      `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
       VALUES (?, ?, ?, ?, 0, NOW())`,
      [userId, message, message, type]
    );

    console.log(`Notification sent to user ${userId}: ${message}`);
    return result;
  } catch (error) {
    console.error("Error sending notification:", error.message);
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
    console.error("Error fetching notifications:", error.message);
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
    console.error("Error marking notification as read:", error.message);
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
    console.error("Error marking all notifications as read:", error.message);
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
    console.error("Error deleting notification:", error.message);
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
