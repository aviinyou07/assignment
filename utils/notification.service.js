/**
 * ENTERPRISE NOTIFICATION SERVICE
 * Server-side notification engine with:
 * - Automatic notification triggering
 * - Escalation support
 * - Real-time delivery
 * - Retry mechanism
 * - Notification templates
 * - Multi-channel support (Push, In-app, WhatsApp)
 * - Severity-based prioritization
 * - Reminder intervals (30-120 mins)
 */

const db = require('../config/db');
const { createAuditLog } = require('./audit');

// Notification severity levels
const SEVERITY = {
  SUCCESS: 'success',
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical'
};

// Notification channels
const CHANNELS = {
  PUSH: 'push',
  IN_APP: 'in_app',
  WHATSAPP: 'whatsapp',
  EMAIL: 'email'
};

// Reminder intervals (in minutes)
const REMINDER_INTERVALS = {
  CRITICAL: [30, 60, 90, 120],  // Repeat every 30 mins up to 2 hours
  WARNING: [60, 120],            // Repeat every 60 mins up to 2 hours
  INFO: []                       // No reminders
};

// Notification types
const NOTIFICATION_TYPES = {
  SUCCESS: 'success',
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical'
};

// Notification event templates
const NOTIFICATION_TEMPLATES = {
  // Query events
  QUERY_CREATED: {
    client: {
      type: 'success',
      title: 'Query Created Successfully',
      message: 'Your query ({query_code}) has been created. A representative will contact you soon.'
    },
    admin: {
      type: 'info',
      title: 'New Query Received',
      message: 'New query ({query_code}) from {client_name}: {paper_topic}'
    },
    bde: {
      type: 'info',
      title: 'New Query Assigned',
      message: 'New query ({query_code}) requires quotation: {paper_topic}'
    }
  },

  // Quotation events
  QUOTATION_GENERATED: {
    client: {
      type: 'success',
      title: 'Quotation Ready',
      message: 'A quotation has been generated for your query ({query_code}). Amount: {currency}{amount}'
    },
    admin: {
      type: 'info',
      title: 'Quotation Generated',
      message: 'Quotation generated for {query_code} by {bde_name}'
    }
  },

  QUOTATION_ACCEPTED: {
    client: {
      type: 'success',
      title: 'Quotation Accepted',
      message: 'You have accepted the quotation. Please upload payment receipt to proceed.'
    },
    admin: {
      type: 'info',
      title: 'Quotation Accepted',
      message: 'Client accepted quotation for {query_code}. Awaiting payment.'
    },
    bde: {
      type: 'success',
      title: 'Quotation Accepted',
      message: 'Your quotation for {query_code} has been accepted!'
    }
  },

  // Payment events
  PAYMENT_UPLOADED: {
    client: {
      type: 'success',
      title: 'Payment Receipt Uploaded',
      message: 'Your payment receipt has been uploaded. We will verify it shortly.'
    },
    admin: {
      type: 'critical',
      title: 'Payment Pending Verification',
      message: 'Payment receipt uploaded for {query_code}. Amount: {currency}{amount}'
    }
  },

  PAYMENT_VERIFIED: {
    client: {
      type: 'success',
      title: 'Payment Verified',
      message: 'Your payment has been verified! Your work code is: {work_code}'
    },
    admin: {
      type: 'success',
      title: 'Payment Verified',
      message: 'Payment verified for {work_code}. Ready for writer assignment.'
    }
  },

  PAYMENT_REJECTED: {
    client: {
      type: 'critical',
      title: 'Payment Verification Failed',
      message: 'Your payment could not be verified. Reason: {reason}. Please upload a valid receipt.'
    }
  },

  // Writer assignment events
  WRITER_ASSIGNED: {
    writer: {
      type: 'success',
      title: 'New Task Assigned',
      message: 'You have been assigned to work on: {paper_topic}. Deadline: {deadline}'
    },
    admin: {
      type: 'info',
      title: 'Writer Assigned',
      message: 'Writer {writer_name} assigned to {work_code}'
    }
  },

  TASK_ACCEPTED: {
    admin: {
      type: 'success',
      title: 'Task Accepted',
      message: 'Writer {writer_name} accepted task for {work_code}'
    }
  },

  TASK_REJECTED: {
    admin: {
      type: 'warning',
      title: 'Task Rejected',
      message: 'Writer {writer_name} rejected task for {work_code}. Reason: {reason}'
    }
  },

  // Progress events
  STATUS_UPDATED: {
    client: {
      type: 'info',
      title: 'Order Status Updated',
      message: 'Your order ({work_code}) status: {status}'
    },
    admin: {
      type: 'info',
      title: 'Status Update',
      message: '{work_code} status changed to: {status}'
    }
  },

  DRAFT_SUBMITTED: {
    admin: {
      type: 'warning',
      title: 'Draft Pending QC',
      message: 'New submission for {work_code} requires QC review'
    },
    writer: {
      type: 'success',
      title: 'Draft Submitted',
      message: 'Your draft for {work_code} has been submitted for QC'
    }
  },

  // QC events
  QC_APPROVED: {
    writer: {
      type: 'success',
      title: 'QC Approved',
      message: 'Your submission for {work_code} has been approved!'
    },
    client: {
      type: 'success',
      title: 'Work Ready',
      message: 'Your order ({work_code}) is ready for delivery'
    },
    admin: {
      type: 'success',
      title: 'QC Approved',
      message: 'Submission approved for {work_code}'
    }
  },

  QC_REJECTED: {
    writer: {
      type: 'critical',
      title: 'Revision Required',
      message: 'Your submission for {work_code} needs revision. Feedback: {feedback}'
    }
  },

  // Delivery events
  ORDER_DELIVERED: {
    client: {
      type: 'success',
      title: 'Order Delivered!',
      message: 'Your order ({work_code}) has been delivered. Please check your downloads.'
    }
  },

  ORDER_COMPLETED: {
    client: {
      type: 'success',
      title: 'Order Completed',
      message: 'Your order ({work_code}) is now complete. Thank you for using our service!'
    },
    writer: {
      type: 'success',
      title: 'Order Completed',
      message: 'Order {work_code} has been marked complete. Great work!'
    }
  },

  // Revision events
  REVISION_REQUESTED: {
    writer: {
      type: 'critical',
      title: 'Revision Requested',
      message: 'Client requested revision for {work_code}. Details: {details}'
    },
    admin: {
      type: 'warning',
      title: 'Revision Request',
      message: 'Revision requested for {work_code}'
    }
  },

  // Deadline reminders
  DEADLINE_REMINDER_24H: {
    writer: {
      type: 'warning',
      title: 'Deadline in 24 Hours',
      message: 'Order {work_code} is due in 24 hours. Please ensure timely submission.'
    }
  },

  DEADLINE_REMINDER_12H: {
    writer: {
      type: 'critical',
      title: 'Deadline in 12 Hours',
      message: 'URGENT: Order {work_code} is due in 12 hours!'
    },
    admin: {
      type: 'warning',
      title: 'Deadline Warning',
      message: 'Order {work_code} deadline approaching (12h)'
    }
  },

  DEADLINE_REMINDER_6H: {
    writer: {
      type: 'critical',
      title: 'Deadline in 6 Hours',
      message: 'CRITICAL: Order {work_code} is due in 6 hours!'
    },
    admin: {
      type: 'critical',
      title: 'Critical Deadline',
      message: 'Order {work_code} deadline in 6 hours!'
    }
  },

  DEADLINE_REMINDER_1H: {
    writer: {
      type: 'critical',
      title: 'FINAL: Deadline in 1 Hour',
      message: 'FINAL WARNING: Order {work_code} is due in 1 HOUR!'
    },
    admin: {
      type: 'critical',
      title: 'URGENT: Deadline Imminent',
      message: 'Order {work_code} deadline in 1 hour!'
    }
  }
};

/**
 * Parse template with variables
 */
function parseTemplate(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{${key}}`, 'g'), value || '');
  }
  return result;
}

/**
 * Create and send notification with multi-channel support
 * 
 * @param {object} params
 * @param {number} params.user_id - Target user ID
 * @param {string} params.type - Notification type (success, info, warning, critical)
 * @param {string} params.title - Notification title
 * @param {string} params.message - Notification message
 * @param {string} params.link_url - Optional link URL
 * @param {object} params.metadata - Optional metadata
 * @param {string} params.severity - Severity level for prioritization
 * @param {array} params.channels - Channels to send to ['push', 'in_app', 'whatsapp']
 * @param {object} io - Socket.IO instance for real-time delivery
 * @param {string} context_code - Optional context for channel emission
 * @returns {Promise<number>} notification_id
 */
async function createNotification({
  user_id,
  type = 'info',
  title,
  message,
  link_url = null,
  metadata = null,
  severity = null,
  channels = ['in_app']
}, io = null, context_code = null) {
  try {
    // Determine severity from type if not explicitly set
    const effectiveSeverity = severity || type;
    
    // Insert notification
    const [result] = await db.query(
      `INSERT INTO notifications 
       (user_id, type, title, message, link_url, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, 0, NOW())`,
      [user_id, type, title, message, link_url]
    );

    const notification_id = result.insertId;

    const notification = {
      notification_id,
      user_id,
      type,
      title,
      message,
      link_url,
      severity: effectiveSeverity,
      is_read: false,
      created_at: new Date().toISOString()
    };

    // Real-time delivery if Socket.IO available
    if (io && channels.includes('in_app')) {
      // Emit to user's personal channel
      io.to(`user:${user_id}`).emit('notification:new', notification);

      // Emit to context channel if provided
      if (context_code) {
        io.to(`context:${context_code}`).emit('notification:new', notification);
      }
    }

    // Schedule reminders for critical/warning notifications
    if (effectiveSeverity === SEVERITY.CRITICAL || effectiveSeverity === SEVERITY.WARNING) {
      await scheduleNotificationReminders(notification_id, user_id, effectiveSeverity);
    }

    // Queue WhatsApp notification if channel enabled
    if (channels.includes('whatsapp')) {
      await queueWhatsAppNotification(user_id, title, message, effectiveSeverity);
    }

    return notification_id;

  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
}

/**
 * Schedule reminder notifications for critical actions
 * @param {number} notification_id - Original notification ID
 * @param {number} user_id - User ID
 * @param {string} severity - Notification severity
 */
async function scheduleNotificationReminders(notification_id, user_id, severity) {
  try {
    const intervals = REMINDER_INTERVALS[severity.toUpperCase()] || [];
    
    for (const minutes of intervals) {
      await db.query(
        `INSERT INTO deadline_reminders 
         (order_id, user_id, reminder_type, is_sent, created_at)
         VALUES (?, ?, ?, 0, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
        [String(notification_id), user_id, `reminder_${minutes}m`, minutes]
      );
    }
  } catch (error) {
    console.error('Error scheduling reminders:', error);
    // Don't throw - reminders are non-critical
  }
}

/**
 * Queue WhatsApp notification for async sending
 * @param {number} user_id - User ID
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} severity - Notification severity
 */
async function queueWhatsAppNotification(user_id, title, message, severity) {
  try {
    // Get user's WhatsApp number
    const [[user]] = await db.query(
      `SELECT whatsapp FROM users WHERE user_id = ? AND whatsapp IS NOT NULL`,
      [user_id]
    );

    if (!user || !user.whatsapp) {
      return; // No WhatsApp number, skip
    }

    // Log WhatsApp queue entry (actual sending handled by separate service)
    await db.query(
      `INSERT INTO audit_logs 
       (user_id, event_type, action, details, created_at)
       VALUES (?, 'WHATSAPP_QUEUED', 'queue_message', ?, NOW())`,
      [user_id, JSON.stringify({ whatsapp: user.whatsapp, title, message, severity })]
    );
    
    console.log(`[WhatsApp Queue] Notification for user ${user_id}: ${title}`);
  } catch (error) {
    console.error('Error queueing WhatsApp notification:', error);
  }
}

/**
 * Send notification based on event template
 * 
 * @param {string} event - Event name from NOTIFICATION_TEMPLATES
 * @param {object} targets - { client: user_id, admin: user_id, bde: user_id, writer: user_id }
 * @param {object} variables - Template variables
 * @param {object} io - Socket.IO instance
 * @param {string} context_code - Optional context code
 */
async function sendEventNotification(event, targets, variables, io = null, context_code = null) {
  const templates = NOTIFICATION_TEMPLATES[event];

  if (!templates) {
    console.error(`Unknown notification event: ${event}`);
    return;
  }

  const notifications = [];

  for (const [role, userId] of Object.entries(targets)) {
    if (!userId || !templates[role]) continue;

    const template = templates[role];

    try {
      const notification_id = await createNotification({
        user_id: userId,
        type: template.type,
        title: parseTemplate(template.title, variables),
        message: parseTemplate(template.message, variables),
        link_url: variables.link_url || null
      }, io, context_code);

      notifications.push({ role, userId, notification_id });

    } catch (error) {
      console.error(`Failed to send ${event} notification to ${role}:`, error);
    }
  }

  return notifications;
}

/**
 * Send notification to all admins
 */
async function notifyAdmins({ type, title, message, link_url }, io = null) {
  try {
    const [admins] = await db.query(
      `SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1`
    );

    const notifications = [];

    for (const admin of admins) {
      const notification_id = await createNotification({
        user_id: admin.user_id,
        type,
        title,
        message,
        link_url
      }, io);

      notifications.push(notification_id);
    }

    return notifications;

  } catch (error) {
    console.error('Error notifying admins:', error);
    throw error;
  }
}

/**
 * Send notification to specific role
 */
async function notifyByRole(role, { type, title, message, link_url }, io = null) {
  try {
    const [users] = await db.query(
      `SELECT user_id FROM users WHERE role = ? AND is_active = 1`,
      [role]
    );

    const notifications = [];

    for (const user of users) {
      const notification_id = await createNotification({
        user_id: user.user_id,
        type,
        title,
        message,
        link_url
      }, io);

      notifications.push(notification_id);
    }

    // Also emit to role channel
    if (io) {
      io.to(`role:${role}`).emit('notification:broadcast', {
        type,
        title,
        message,
        link_url,
        created_at: new Date().toISOString()
      });
    }

    return notifications;

  } catch (error) {
    console.error(`Error notifying ${role}s:`, error);
    throw error;
  }
}

/**
 * Get unread notifications for user
 */
async function getUnreadNotifications(user_id, limit = 20) {
  try {
    const [notifications] = await db.query(
      `SELECT * FROM notifications 
       WHERE user_id = ? AND is_read = 0
       ORDER BY created_at DESC
       LIMIT ?`,
      [user_id, limit]
    );

    return notifications;

  } catch (error) {
    console.error('Error fetching notifications:', error);
    throw error;
  }
}

/**
 * Get all notifications for user (paginated)
 */
async function getAllNotifications(user_id, { page = 0, limit = 20, type = null }) {
  try {
    const offset = page * limit;

    let whereClause = 'user_id = ?';
    let params = [user_id];

    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }

    const [notifications] = await db.query(
      `SELECT * FROM notifications 
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM notifications WHERE ${whereClause}`,
      params
    );

    return {
      notifications,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };

  } catch (error) {
    console.error('Error fetching notifications:', error);
    throw error;
  }
}

/**
 * Get critical alerts for user
 */
async function getCriticalAlerts(user_id) {
  try {
    const [alerts] = await db.query(
      `SELECT * FROM notifications 
       WHERE user_id = ? AND type = 'critical' AND is_read = 0
       ORDER BY created_at DESC`,
      [user_id]
    );

    return alerts;

  } catch (error) {
    console.error('Error fetching critical alerts:', error);
    throw error;
  }
}

/**
 * Mark notification as read
 */
async function markAsRead(notification_id, user_id) {
  try {
    const [result] = await db.query(
      `UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?`,
      [notification_id, user_id]
    );

    return result.affectedRows > 0;

  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
}

/**
 * Mark all notifications as read for user
 */
async function markAllAsRead(user_id) {
  try {
    const [result] = await db.query(
      `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`,
      [user_id]
    );

    return result.affectedRows;

  } catch (error) {
    console.error('Error marking all as read:', error);
    throw error;
  }
}

/**
 * Delete notification (user can only delete their own)
 */
async function deleteNotification(notification_id, user_id) {
  try {
    const [result] = await db.query(
      `DELETE FROM notifications WHERE notification_id = ? AND user_id = ?`,
      [notification_id, user_id]
    );

    return result.affectedRows > 0;

  } catch (error) {
    console.error('Error deleting notification:', error);
    throw error;
  }
}

/**
 * Get unread count for user
 */
async function getUnreadCount(user_id) {
  try {
    const [[{ count }]] = await db.query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`,
      [user_id]
    );

    return count;

  } catch (error) {
    console.error('Error getting unread count:', error);
    throw error;
  }
}

module.exports = {
  NOTIFICATION_TYPES,
  NOTIFICATION_TEMPLATES,
  SEVERITY,
  CHANNELS,
  REMINDER_INTERVALS,
  createNotification,
  sendEventNotification,
  notifyAdmins,
  notifyByRole,
  getUnreadNotifications,
  getAllNotifications,
  getCriticalAlerts,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  scheduleNotificationReminders,
  queueWhatsAppNotification
};
