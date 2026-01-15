const db = require('../config/db');
const { sendMail } = require('../utils/mailer');
const { createAuditLog } = require('../utils/audit');
const logger = require('../utils/logger');

/**
 * NOTIFICATIONS CONTROLLER
 * Auto-trigger and manual notifications with Real-time support
 */

exports.sendNotification = async (req, res) => {
  try {
    const { userId, type, title, message } = req.body;

    if (!userId || !title || !message) {
      return res.status(400).json({ success: false, error: 'User ID, title, and message required' });
    }

    // Create notification
    await db.query(
      `INSERT INTO notifications (user_id, type, title, message, is_read, created_at)
       VALUES (?, ?, ?, ?, 0, NOW())`,
      [userId, type || 'info', title, message]
    );

    res.json({ success: true, message: 'Notification sent' });
  } catch (error) {
    logger.error(`Error sending notification: ${error && error.message ? error.message : error}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    const { page = 0, unread, type, limit: queryLimit } = req.query;
    const limit = parseInt(queryLimit) || 20;
    const offset = page * limit;
    const userId = req.user.user_id;

    let whereClause = 'user_id = ?';
    let params = [userId];

    // Filter by unread only
    if (unread === 'true') {
      whereClause += ' AND is_read = 0';
    }

    // Filter by notification type
    if (type && type !== 'all') {
      whereClause += ' AND type = ?';
      params.push(type);
    }

    const [notifications] = await db.query(
      `SELECT notification_id, type, title, message, link_url, is_read, created_at
       FROM notifications
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM notifications WHERE ${whereClause}`,
      params
    );

    res.json({
      success: true,
      notifications,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    logger.error(`Error getting notifications: ${error && error.message ? error.message : error}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [[{ unread }]] = await db.query(
      `SELECT COUNT(*) as unread FROM notifications WHERE user_id = ? AND is_read = 0`,
      [userId]
    );

    res.json({ success: true, unread });
  } catch (error) {
    logger.error(`Error getting unread count: ${error && error.message ? error.message : error}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    // Validate notificationId is a number
    const id = parseInt(notificationId, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid notification ID' });
    }

    await db.query(
      `UPDATE notifications SET is_read = 1 WHERE notification_id = ?`,
      [id]
    );
    res.json({ success: true, message: 'Marked as read' });
  } catch (error) {
    logger.error(`Error marking notification as read: ${error && error.message ? error.message : error}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.user_id;

    await db.query(
      `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`,
      [userId]
    );
    res.json({ success: true, message: 'All marked as read' });
  } catch (error) {
    logger.error(`Error marking all as read: ${error && error.message ? error.message : error}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;

    await db.query(
      `DELETE FROM notifications WHERE notification_id = ?`,
      [notificationId]
    );
    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    logger.error(`Error deleting notification: ${error && error.message ? error.message : error}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Auto-trigger: Payment uploaded
exports.notifyPaymentUploaded = async (orderId, userId, io) => {
  try {
    const targetUser = process.env.ADMIN_USER_ID || 1;
    const title = 'Payment Verification Required';
    const message = `Payment uploaded for order ${orderId}`;

    // If io provided, use realtime helper to create + emit
    if (io) {
      await exports.createNotificationWithRealtime(io, {
        user_id: targetUser,
        type: 'warning',
        title,
        message,
        context_code: null
      });
      return;
    }

    await db.query(
      `INSERT INTO notifications (user_id, type, title, message, is_read, created_at)
       VALUES (?, 'warning', ?, ?, 0, NOW())`,
      [targetUser, title, message]
    );
  } catch (error) {
    logger.error(`Error notifying payment uploaded: ${error && error.message ? error.message : error}`);
  }
};

// Auto-trigger: Draft submitted
exports.notifyDraftSubmitted = async (orderId, writerId, io) => {
  try {
    const targetUser = process.env.ADMIN_USER_ID || 1;
    const title = 'New Submission';
    const message = `Writer submitted work for order ${orderId}`;

    if (io) {
      await exports.createNotificationWithRealtime(io, {
        user_id: targetUser,
        type: 'info',
        title,
        message
      });
      return;
    }

    await db.query(
      `INSERT INTO notifications (user_id, type, title, message, is_read, created_at)
       VALUES (?, 'info', ?, ?, 0, NOW())`,
      [targetUser, title, message]
    );
  } catch (error) {
    logger.error(`Error notifying draft submitted: ${error && error.message ? error.message : error}`);
  }
};

// Auto-trigger: Assignment rejected
exports.notifyAssignmentRejected = async (workCode, writerId) => {
  try {
    const [[writer]] = await db.query(
      `SELECT full_name FROM users WHERE user_id = ?`,
      [writerId]
    );

    await db.query(
      `INSERT INTO notifications (user_id, type, title, message, created_at)
       VALUES (?, 'critical', 'Assignment Rejected', ?, NOW())`,
      [process.env.ADMIN_USER_ID || 1, `Writer ${writer?.full_name || 'Unknown'} rejected assignment for ${workCode}`]
    );
  } catch (error) {
    logger.error(`Error notifying assignment rejected: ${error && error.message ? error.message : error}`);
  }
};

// Auto-trigger: Overdue task
exports.notifyOverdueTask = async (workCode, io) => {
  try {
    const targetUser = process.env.ADMIN_USER_ID || 1;
    const title = 'Overdue Task Alert';
    const message = `Task ${workCode} is overdue`;

    if (io) {
      await exports.createNotificationWithRealtime(io, {
        user_id: targetUser,
        type: 'critical',
        title,
        message
      });
      return;
    }

    await db.query(
      `INSERT INTO notifications (user_id, type, title, message, created_at)
       VALUES (?, 'critical', ?, NOW())`,
      [targetUser, message]
    );
  } catch (error) {
    logger.error(`Error notifying overdue task: ${error && error.message ? error.message : error}`);
  }
};

exports.getCriticalAlerts = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [alerts] = await db.query(
      `SELECT notification_id, type, title, message, created_at
       FROM notifications
       WHERE user_id = ? AND type = 'critical' AND is_read = 0
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ success: true, alerts });
  } catch (error) {
    console.error('Error getting critical alerts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
/**
 * REAL-TIME NOTIFICATION CREATION
 * Internal function called by business logic
 * Creates notification in DB + emits realtime event
 * 
 * @param {object} io Socket.IO instance
 * @param {object} data Notification data
 * @param {number} data.user_id Target user
 * @param {string} data.type success|warning|critical
 * @param {string} data.title Notification title
 * @param {string} data.message Notification message
 * @param {string} data.link_url Optional link
 * @param {string} data.context_code Optional query_code or work_code for channel emission
 * @returns {Promise<number>} notification_id
 */
exports.createNotificationWithRealtime = async (io, data) => {
  const {
    user_id,
    type = 'info',
    title,
    message,
    link_url,
    context_code,
    triggered_by = null
  } = data;

  try {
    // =======================
    // CREATE NOTIFICATION IN DB
    // =======================
    const [result] = await db.query(
      `INSERT INTO notifications 
       (user_id, type, title, message, link_url, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, 0, NOW())`,
      [user_id, type, title, message, link_url || null]
    );

    const notificationId = result.insertId;
    const createdAt = new Date().toISOString();

    // =======================
    // AUDIT LOG
    // =======================
    if (triggered_by) {
      await createAuditLog({
        user_id: triggered_by.user_id || null,
        role: triggered_by.role || 'system',
        event_type: 'NOTIFICATION_CREATED',
        resource_type: 'notification',
        resource_id: notificationId,
        details: `Notification: ${title}`,
        ip_address: triggered_by.ip_address || null,
        user_agent: triggered_by.user_agent || null,
        event_data: { type, user_id, context_code }
      });
    }

    // =======================
    // EMIT REALTIME EVENT
    // =======================
    const notificationEvent = {
      notification_id: notificationId,
      user_id,
      type,
      title,
      message,
      link_url: link_url || null,
      is_read: false,
      created_at: createdAt
    };

    // Emit to user's personal channel
    logger.debug(`[Realtime Notification] Emitting to user:${user_id} - ${notificationId}`);
    io.to(`user:${user_id}`).emit('notification:new', notificationEvent);

    // If context provided, also emit to context channel
    if (context_code) {
      logger.debug(`[Realtime Notification] Emitting to context:${context_code} - ${notificationId}`);
      io.to(`context:${context_code}`).emit('notification:new', notificationEvent);
    }

    return notificationId;

  } catch (error) {
    logger.error(`Failed to create notification with realtime: ${error && error.message ? error.message : error}`);
    // Don't throw - log and continue so UI doesn't break
    logger.error('Notification creation failed but order processing continues');
  }
};

/**
 * BROADCAST NOTIFICATION TO ROLE
 * Used for system-wide announcements
 * 
 * @param {object} io Socket.IO instance
 * @param {string} role Role to notify (e.g., 'admin')
 * @param {object} data Notification data
 */
exports.broadcastNotificationToRole = async (io, role, data) => {
  try {
    // Get all users with this role
    const [users] = await db.query(
      `SELECT user_id FROM users WHERE role = ? AND is_active = 1`,
      [role]
    );

    for (const user of users) {
      await exports.createNotificationWithRealtime(io, {
        ...data,
        user_id: user.user_id
      });
    }
  } catch (error) {
    logger.error(`Failed to broadcast notification: ${error && error.message ? error.message : error}`);
  }
};

module.exports = exports;