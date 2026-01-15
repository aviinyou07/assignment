const db = require('../config/db');
const {
  createAuditLog,
  createNotification,
  generateUniqueCode,
  getUserIfVerified,
  createOrderHistory
} = require('../utils/audit');

const notificationsController = require('../controllers/notifications.controller');
const socketUtils = require('../utils/socket');
const logger = require('../utils/logger');

/**
 * CLIENT QUERIES CONTROLLER
 * 
 * Client can:
 * - Create queries with file upload
 * - View their quotations
 * - Accept quotations (no work_code generation)
 * - Upload payment receipts
 * - Track order status (read-only)
 * - Submit feedback and revisions
 * 
 * Client CANNOT:
 * - Edit query after creation
 * - Assign writers
 * - Set pricing
 * - Change status
 * - See writer identity
 * - See internal QC feedback
 */

/**
 * CREATE QUERY
 * Initial status set using master_status
 * Uploaded files go to file_versions
 * work_code = NULL at this stage
 */
exports.createQuery = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const userId = req.user.user_id;
    const {
      paper_topic,
      service,
      subject,
      urgency,
      description,
      deadline_at,
      currency_code
    } = req.body;

    // =======================
    // VALIDATION
    // =======================
    if (!paper_topic || !service || !subject || !urgency || !deadline_at) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: paper_topic, service, subject, urgency, deadline_at'
      });
    }

    // Verify user exists and is verified
    const user = await getUserIfVerified(userId);
    if (!user) {
      return res.status(403).json({
        success: false,
        message: 'User account is not verified or inactive'
      });
    }

    // Validate deadline is in future
    const deadlineDate = new Date(deadline_at);
    if (deadlineDate <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Deadline must be in the future'
        
      });
    }

    await connection.beginTransaction();

    // =======================
    // ENTERPRISE STATUS (26 - Pending Query)
    // =======================
    const statusId = 26;

    // =======================
    // GENERATE QUERY CODE
    // =======================
    const query_code = generateUniqueCode('QUERY', 8);

    // =======================
    // CREATE ORDER/QUERY
    // =======================
    const [queryResult] = await connection.query(
      `INSERT INTO orders 
       (query_code, user_id, paper_topic, service, subject, urgency, description, 
        deadline_at, status, acceptance, work_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NOW())`,
      [query_code, userId, paper_topic, service, subject, urgency, description || null, deadline_at, statusId]
    );

    const orderId = queryResult.insertId;

    // ============================================================================
    // AUTO-GENERATE QUOTATION (ENTERPRISE FLOW)
    // Create auto-quotation record (Status 27)
    // ============================================================================
    await connection.query(
      `INSERT INTO quotations (order_id, user_id, quoted_price_usd, notes, created_at)
       VALUES (?, ?, 0.00, 'Auto-generated quotation. Pending final review by admin.', NOW())`,
      [orderId, userId]
    );
    
    // Update order status to 27 (Quotation Sent)
    await connection.query(`UPDATE orders SET status = 27 WHERE order_id = ?`, [orderId]);

    // =======================
    // HANDLE FILE UPLOAD (if provided)
    // =======================
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        
        await connection.query(
          `INSERT INTO file_versions 
           (order_id, file_url, file_name, uploaded_by, file_size, version_number, created_at)
           VALUES (?, ?, ?, ?, ?, 1, NOW())`,
          [orderId, file.path, file.originalname, userId, file.size]
        );
      }
    }

    await connection.commit();

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: userId,
      role: 'client',
      event_type: 'QUERY_CREATED',
      resource_type: 'order',
      resource_id: orderId,
      details: `Client created query with code: ${query_code}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { query_code, paper_topic, service, subject, urgency }
    });

    // =======================
    // SEND NOTIFICATION TO CLIENT (DB + realtime when possible)
    // =======================
    try {
      const io = req.io || socketUtils.getIO();
      if (io && notificationsController && notificationsController.createNotificationWithRealtime) {
        logger.debug(`[Query Notification] Using IO from ${req.io ? 'req.io' : 'socket singleton'} to notify client ${userId}`);
        await notificationsController.createNotificationWithRealtime(io, {
          user_id: userId,
          type: 'success',
          title: 'Query Created Successfully',
          message: `Your query (${query_code}) has been created. A BDE will send you a quotation soon.`,
          link_url: `/client/queries/${orderId}`
        });
      } else {
        logger.debug(`[Query Notification] No IO available, falling back to DB-only for client ${userId}`);
        await createNotification({
          user_id: userId,
          type: 'success',
          title: 'Query Created Successfully',
          message: `Your query (${query_code}) has been created. A BDE will send you a quotation soon.`,
          link_url: `/client/queries/${orderId}`
        });
      }
      } catch (err) {
      logger.error(`Failed to send client realtime notification: ${err && err.message ? err.message : err}`);
      await createNotification({
        user_id: userId,
        type: 'success',
        title: 'Query Created Successfully',
        message: `Your query (${query_code}) has been created. A BDE will send you a quotation soon.`,
        link_url: `/client/queries/${orderId}`
      });
    }

    // =======================
    // SEND NOTIFICATION TO ADMIN/BDE (DB + realtime when possible)
    // =======================
    const [admins] = await connection.query(
      `SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1`
    );
    
    if (admins.length > 0) {
      const adminId = admins[0].user_id;
      try {
        const io = req.io || socketUtils.getIO();
        const adminNotification = {
          type: 'critical',
          title: 'New Query Received',
          message: `New query created by ${user.full_name}: ${paper_topic}`,
          link_url: `/admin/queries/${orderId}/view`
        };

        // Prefer broadcasting to all connected admins so any admin receives it
        if (io && notificationsController && notificationsController.broadcastNotificationToRole) {
          logger.debug('[Query Notification] Broadcasting to admin role via IO');
          await notificationsController.broadcastNotificationToRole(io, 'admin', adminNotification);
        } else {
          logger.debug(`[Query Notification] No IO available, falling back to DB-only for admin ${adminId}`);
          await createNotification({
            user_id: adminId,
            type: adminNotification.type,
            title: adminNotification.title,
            message: adminNotification.message,
            link_url: adminNotification.link_url
          });
        }
      } catch (err) {
        logger.error(`Failed to send admin realtime notification: ${err && err.message ? err.message : err}`);
        await createNotification({
          user_id: adminId,
          type: 'critical',
          title: 'New Query Received',
          message: `New query created by ${user.full_name}: ${paper_topic}`,
          link_url: `/admin/queries/${orderId}`
        });
      }
    }

    // Notify the client's assigned BDE (preferred) so only the owning BDE sees the detail
    try {
      const assignedBdeId = user.bde || null;
      const ioForBde = req.io || socketUtils.getIO();
      const bdeNotification = {
        type: 'info',
        title: 'New Query Requires Quotation',
        message: `New query from ${user.full_name}: ${paper_topic}`,
        link_url: `/bde/queries/${query_code}`
      };

      if (assignedBdeId) {
        // Notify the specific BDE
        if (ioForBde && notificationsController && notificationsController.createNotificationWithRealtime) {
          logger.debug(`[Query Notification] Notifying assigned BDE via IO ${assignedBdeId}`);
          await notificationsController.createNotificationWithRealtime(ioForBde, {
            ...bdeNotification,
            user_id: assignedBdeId
          });
        } else {
          logger.debug(`[Query Notification] No IO available, inserting DB notification for assigned BDE ${assignedBdeId}`);
          await createNotification({
            user_id: assignedBdeId,
            type: bdeNotification.type,
            title: bdeNotification.title,
            message: bdeNotification.message,
            link_url: bdeNotification.link_url
          });
        }
      } else {
        // Fallback: broadcast to all BDEs (legacy behavior)
        if (ioForBde && notificationsController && notificationsController.broadcastNotificationToRole) {
          logger.debug('[Query Notification] No assigned BDE, broadcasting to bde role via IO');
          await notificationsController.broadcastNotificationToRole(ioForBde, 'bde', bdeNotification);
        } else {
          logger.debug('[Query Notification] No IO for BDE broadcast, inserting DB notifications for BDEs');
          const [bdes] = await connection.query(
            `SELECT user_id FROM users WHERE role = 'bde' AND is_active = 1`
          );
          for (const bde of bdes) {
            await createNotification({
              user_id: bde.user_id,
              type: bdeNotification.type,
              title: bdeNotification.title,
              message: bdeNotification.message,
              link_url: bdeNotification.link_url
            });
          }
        }
      }
    } catch (err) {
      logger.error(`Failed to notify BDEs about new query: ${err && err.message ? err.message : err}`);
    }

    return res.status(201).json({
      success: true,
      message: 'Query created successfully',
      data: {
        order_id: orderId,
        query_code: query_code,
        status: 'pending',
        created_at: new Date()
      }
    });

  } catch (err) {
    await connection.rollback();
    logger.error(`Error creating query: ${err && err.message ? err.message : err}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to create query',
      error: err.message
    });
  } finally {
    connection.release();
  }
};

/**
 * LIST CLIENT'S QUERIES
 * Paginated, with filtering
 */
exports.listMyQueries = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { page = 0, status, limit = 20 } = req.query;
    const offset = parseInt(page) * parseInt(limit);

    let whereClause = 'o.user_id = ?';
    let params = [userId];

    if (status && status !== 'all') {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }

    // =======================
    // FETCH QUERIES
    // =======================
    const [queries] = await db.query(
      `SELECT 
        o.order_id,
        o.query_code,
        o.paper_topic,
        o.service,
        o.subject,
        o.urgency,
        o.deadline_at,
        o.status,
        o.acceptance,
        o.work_code,
        o.created_at,
        ms.status_name
      FROM orders o
      LEFT JOIN master_status ms ON ms.id = o.status
      WHERE ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // =======================
    // GET TOTAL COUNT
    // =======================
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM orders WHERE ${whereClause}`,
      params
    );

    const totalPages = Math.ceil(total / parseInt(limit));

    return res.json({
      success: true,
      data: {
        queries,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: totalPages
        }
      }
    });

  } catch (err) {
    console.error('Error listing queries:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch queries'
    });
  }
};

/**
 * VIEW QUERY DETAILS
 * Client can only view their own queries
 */
exports.getQueryDetail = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { orderId } = req.params;

    // =======================
    // FETCH QUERY
    // =======================
    const [[query]] = await db.query(
      `SELECT 
        o.order_id,
        o.query_code,
        o.paper_topic,
        o.service,
        o.subject,
        o.urgency,
        o.description,
        o.deadline_at,
        o.status,
        o.acceptance,
        o.work_code,
        o.basic_price_usd,
        o.total_price_usd,
        o.created_at,
        ms.status_name
      FROM orders o
      LEFT JOIN master_status ms ON ms.id = o.status
      WHERE o.order_id = ? AND o.user_id = ?
      LIMIT 1`,
      [orderId, userId]
    );

    if (!query) {
      return res.status(404).json({
        success: false,
        message: 'Query not found or access denied'
      });
    }

    // =======================
    // FETCH FILES
    // =======================
    const [files] = await db.query(
      `SELECT id, file_name, file_url, version_number, created_at
       FROM file_versions
       WHERE order_id = ?
       ORDER BY version_number DESC`,
      [orderId]
    );

    // =======================
    // FETCH QUOTATION (if exists)
    // =======================
    const [[quotation]] = await db.query(
      `SELECT quotation_id, quoted_price_usd, tax, discount, notes, created_at
       FROM quotations
       WHERE order_id = ?
       LIMIT 1`,
      [orderId]
    );

    return res.json({
      success: true,
      data: {
        query,
        files: files || [],
        quotation: quotation || null
      }
    });

  } catch (err) {
    console.error('Error fetching query:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch query details'
    });
  }
};

/**
 * CLIENT CANNOT EDIT QUERY AFTER CREATION
 * This endpoint returns explicit error
 */
exports.editQueryDenied = async (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Client cannot edit query after creation. Contact support if changes needed.'
  });
};

/**
 * LIST CONFIRMED ORDERS (with work_code)
 * Client can only view their own confirmed orders
 * These are orders where payment has been verified by Admin
 */
exports.listMyOrders = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { page = 0, status, limit = 20 } = req.query;
    const offset = parseInt(page) * parseInt(limit);

    let whereClause = 'o.user_id = ? AND o.work_code IS NOT NULL';
    let params = [userId];

    if (status && status !== 'all') {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }

    // =======================
    // FETCH CONFIRMED ORDERS
    // =======================
    const [orders] = await db.query(
      `SELECT 
        o.order_id,
        o.query_code,
        o.work_code,
        o.paper_topic,
        o.service,
        o.subject,
        o.urgency,
        o.deadline_at,
        o.status,
        o.writer_id,
        o.created_at,
        o.basic_price_usd,
        o.total_price_usd,
        ms.status_name,
        COALESCE(s.submission_id, 0) as has_submission,
        COALESCE(fv.id, 0) as has_delivery
      FROM orders o
      LEFT JOIN master_status ms ON ms.id = o.status
      LEFT JOIN submissions s ON s.order_id = o.order_id
      LEFT JOIN file_versions fv ON fv.order_id = o.order_id AND fv.id > (
        SELECT COALESCE(MAX(id), 0) FROM file_versions WHERE order_id = o.order_id AND uploaded_by IS NULL
      )
      WHERE ${whereClause}
      GROUP BY o.order_id
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // =======================
    // GET TOTAL COUNT
    // =======================
    const [[{ total }]] = await db.query(
      `SELECT COUNT(DISTINCT o.order_id) as total FROM orders o
       WHERE ${whereClause}`,
      params
    );

    const totalPages = Math.ceil(total / parseInt(limit));

    return res.json({
      success: true,
      data: {
        orders,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: totalPages
        }
      }
    });

  } catch (err) {
    console.error('Error listing orders:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch orders'
    });
  }
};

/**
 * TRACK ORDER STATUS BY WORK_CODE
 * Client can track real-time progress of confirmed order
 * Includes: status, deadline, submission info, delivery files
 */
exports.trackOrderByWorkCode = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { workCode } = req.params;

    // =======================
    // FETCH ORDER BY WORK_CODE
    // =======================
    const [[order]] = await db.query(
      `SELECT 
        o.order_id,
        o.query_code,
        o.work_code,
        o.paper_topic,
        o.service,
        o.subject,
        o.urgency,
        o.deadline_at,
        o.status,
        o.writer_id,
        o.created_at,
        o.basic_price_usd,
        o.total_price_usd,
        o.words_used,
        o.pages_used,
        o.user_id,
        ms.status_name
      FROM orders o
      LEFT JOIN master_status ms ON ms.id = o.status
      WHERE o.work_code = ? AND o.user_id = ?
      LIMIT 1`,
      [workCode, userId]
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // =======================
    // FETCH SUBMISSION INFO (if any)
    // =======================
    const [[submission]] = await db.query(
      `SELECT 
        submission_id,
        status,
        created_at,
        updated_at
      FROM submissions
      WHERE order_id = ?
      LIMIT 1`,
      [order.order_id]
    );

    // =======================
    // FETCH DELIVERED FILES
    // =======================
    const [deliveryFiles] = await db.query(
      `SELECT 
        id,
        file_name,
        file_url,
        version_number,
        created_at
      FROM file_versions
      WHERE order_id = ? AND uploaded_by IS NULL
      ORDER BY version_number DESC`,
      [order.order_id]
    );

    // =======================
    // FETCH REVISION REQUESTS
    // =======================
    const [revisions] = await db.query(
      `SELECT 
        id,
        revision_number,
        status,
        deadline,
        created_at
      FROM revision_requests
      WHERE order_id = ? AND revision_number > 0
      ORDER BY revision_number DESC`,
      [order.order_id]
    );

    // =======================
    // CALCULATE TIME REMAINING
    // =======================
    const now = new Date();
    const deadline = new Date(order.deadline_at);
    const timeRemaining = Math.max(0, Math.floor((deadline - now) / (1000 * 60 * 60)));

    return res.json({
      success: true,
      data: {
        order: {
          ...order,
          timeRemaining: `${timeRemaining} hours`
        },
        submission: submission || null,
        deliveryFiles: deliveryFiles || [],
        revisions: revisions || []
      }
    });

  } catch (err) {
    console.error('Error tracking order:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to track order'
    });
  }
};

/**
 * GET NOTIFICATIONS
 * Client can view their notifications (read-only)
 * Can mark as read
 */
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { page = 0, limit = 50, unreadOnly = false } = req.query;
    const offset = parseInt(page) * parseInt(limit);

    let whereClause = 'user_id = ?';
    let params = [userId];

    if (unreadOnly === 'true') {
      whereClause += ' AND is_read = 0';
    }

    // =======================
    // FETCH NOTIFICATIONS
    // =======================
    const [notifications] = await db.query(
      `SELECT 
        notification_id,
        type,
        title,
        message,
        link_url,
        is_read,
        created_at
      FROM notifications
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // =======================
    // GET TOTAL COUNT
    // =======================
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM notifications WHERE ${whereClause}`,
      params
    );

    return res.json({
      success: true,
      data: {
        notifications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          unread: unreadOnly === 'true'
        }
      }
    });

  } catch (err) {
    console.error('Error fetching notifications:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
};

/**
 * MARK NOTIFICATION AS READ
 */
exports.markNotificationAsRead = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { notificationId } = req.params;

    // =======================
    // VERIFY OWNERSHIP
    // =======================
    const [[notification]] = await db.query(
      `SELECT notification_id, user_id FROM notifications WHERE notification_id = ? LIMIT 1`,
      [notificationId]
    );

    if (!notification || notification.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // =======================
    // MARK AS READ
    // =======================
    await db.query(
      `UPDATE notifications SET is_read = 1 WHERE notification_id = ?`,
      [notificationId]
    );

    return res.json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (err) {
    console.error('Error marking notification:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update notification'
    });
  }
};

module.exports = exports;
