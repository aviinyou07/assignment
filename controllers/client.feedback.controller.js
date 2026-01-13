const db = require('../config/db');
const {
  createAuditLog,
  createNotification
} = require('../utils/audit');

/**
 * CLIENT FEEDBACK & REVISION CONTROLLER
 * 
 * Client can:
 * - Submit feedback after delivery
 * - Request revisions via revision_requests
 * - Cannot assign or message writer directly
 * - Cannot see internal QC feedback
 */

/**
 * GET DELIVERY FILES
 * Client can download final delivered files
 * Only after order is delivered
 */
exports.getDeliveryFiles = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { orderId } = req.params;

    // =======================
    // VERIFY CLIENT OWNS ORDER
    // =======================
    const [[order]] = await db.query(
      `SELECT order_id, user_id FROM orders WHERE order_id = ? LIMIT 1`,
      [orderId]
    );

    if (!order || order.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // =======================
    // FETCH DELIVERY FILES
    // =======================
    const [files] = await db.query(
      `SELECT 
        id,
        file_name,
        file_url,
        version_number,
        created_at
      FROM file_versions
      WHERE order_id = ?
      ORDER BY version_number DESC`,
      [orderId]
    );

    return res.json({
      success: true,
      data: {
        files: files || []
      }
    });

  } catch (err) {
    console.error('Error fetching delivery files:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery files'
    });
  }
};

/**
 * SUBMIT FEEDBACK
 * Client submits feedback after reviewing delivered work
 * Feedback is recorded but doesn't trigger automatic revision
 */
exports.submitFeedback = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { orderId, feedback, rating } = req.body;

    if (!orderId || !feedback) {
      return res.status(400).json({
        success: false,
        message: 'Order ID and feedback are required'
      });
    }

    // =======================
    // VERIFY CLIENT OWNS ORDER
    // =======================
    const [[order]] = await db.query(
      `SELECT order_id, user_id, writer_id FROM orders WHERE order_id = ? LIMIT 1`,
      [orderId]
    );

    if (!order || order.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (!order.writer_id) {
      return res.status(400).json({
        success: false,
        message: 'Order is not yet assigned to a writer'
      });
    }

    // =======================
    // CREATE FEEDBACK RECORD
    // (Using revision_requests table with status='feedback')
    // =======================
    const [result] = await db.query(
      `INSERT INTO revision_requests 
       (order_id, requested_by, revision_number, reason, status, created_at)
       VALUES (?, ?, 0, ?, 'completed', NOW())`,
      [orderId, userId, feedback]
    );

    // =======================
    // OPTIONAL: RECORD RATING
    // =======================
    if (rating && order.writer_id) {
      await db.query(
        `INSERT INTO writer_ratings 
         (writer_id, order_id, client_id, rating, review, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE 
         rating = VALUES(rating), 
         review = VALUES(review),
         updated_at = NOW()`,
        [order.writer_id, orderId, userId, rating, feedback]
      );
    }

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: userId,
      role: 'client',
      event_type: 'FEEDBACK_SUBMITTED',
      resource_type: 'order',
      resource_id: orderId,
      details: `Client submitted feedback for order ${orderId}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { feedback, rating }
    });

    // =======================
    // NOTIFICATION TO ADMIN
    // =======================
    const [admins] = await db.query(
      `SELECT user_id FROM users WHERE role = 'Admin' AND is_active = 1 LIMIT 1`
    );
    if (admins.length > 0) {
      await createNotification({
        user_id: admins[0].user_id,
        type: 'info',
        title: 'Client Feedback Received',
        message: `Client submitted feedback for order ${orderId}${rating ? ` with rating: ${rating}/5` : ''}`,
        link_url: `/admin/orders/${orderId}`
      });
    }

    return res.json({
      success: true,
      message: 'Feedback submitted successfully'
    });

  } catch (err) {
    console.error('Error submitting feedback:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit feedback'
    });
  }
};

/**
 * REQUEST REVISION
 * Client can request revisions after delivery
 * Revision has a deadline and awaits writer acceptance
 */
exports.requestRevision = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { orderId, reason, deadline_at } = req.body;

    if (!orderId || !reason || !deadline_at) {
      return res.status(400).json({
        success: false,
        message: 'Order ID, reason, and deadline are required'
      });
    }

    // =======================
    // VERIFY CLIENT OWNS ORDER
    // =======================
    const [[order]] = await db.query(
      `SELECT order_id, user_id, writer_id FROM orders WHERE order_id = ? LIMIT 1`,
      [orderId]
    );

    if (!order || order.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (!order.writer_id) {
      return res.status(400).json({
        success: false,
        message: 'Order is not yet assigned to a writer'
      });
    }

    // =======================
    // VALIDATE DEADLINE
    // =======================
    const deadlineDate = new Date(deadline_at);
    if (deadlineDate <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Revision deadline must be in the future'
      });
    }

    // =======================
    // GET NEXT REVISION NUMBER
    // =======================
    const [[lastRevision]] = await db.query(
      `SELECT COALESCE(MAX(revision_number), 0) + 1 as next_num 
       FROM revision_requests 
       WHERE order_id = ?`,
      [orderId]
    );

    const nextRevisionNum = lastRevision?.next_num || 1;

    // =======================
    // CREATE REVISION REQUEST
    // =======================
    const [result] = await db.query(
      `INSERT INTO revision_requests 
       (order_id, requested_by, revision_number, reason, deadline, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
      [orderId, userId, nextRevisionNum, reason, deadline_at]
    );

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: userId,
      role: 'client',
      event_type: 'REVISION_REQUESTED',
      resource_type: 'order',
      resource_id: orderId,
      details: `Client requested revision #${nextRevisionNum} for order ${orderId}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { reason, deadline: deadline_at, revision_number: nextRevisionNum }
    });

    // =======================
    // SEND NOTIFICATION
    // =======================
    await createNotification({
      user_id: userId,
      type: 'info',
      title: 'Revision Request Submitted',
      message: `Your revision request has been submitted. Deadline: ${new Date(deadline_at).toLocaleDateString()}`,
      link_url: `/client/orders/${orderId}`
    });

    // Notify admin
    const [admins] = await db.query(
      `SELECT user_id FROM users WHERE role = 'Admin' AND is_active = 1 LIMIT 1`
    );
    if (admins.length > 0) {
      await createNotification({
        user_id: admins[0].user_id,
        type: 'critical',
        title: 'Revision Request Pending',
        message: `Revision #${nextRevisionNum} requested for order ${orderId}. Deadline: ${new Date(deadline_at).toLocaleDateString()}`,
        link_url: `/admin/orders/${orderId}/revisions`
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Revision request submitted successfully',
      data: {
        revision_id: result.insertId,
        revision_number: nextRevisionNum,
        status: 'pending'
      }
    });

  } catch (err) {
    console.error('Error requesting revision:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to request revision'
    });
  }
};

/**
 * GET REVISION HISTORY
 * Client can see their revision requests
 */
exports.getRevisionHistory = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { orderId } = req.params;

    // =======================
    // VERIFY CLIENT OWNS ORDER
    // =======================
    const [[order]] = await db.query(
      `SELECT order_id, user_id FROM orders WHERE order_id = ? LIMIT 1`,
      [orderId]
    );

    if (!order || order.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // =======================
    // FETCH REVISIONS
    // =======================
    const [revisions] = await db.query(
      `SELECT 
        id,
        order_id,
        revision_number,
        reason,
        status,
        deadline,
        completed_at,
        created_at
      FROM revision_requests
      WHERE order_id = ? AND revision_number > 0
      ORDER BY revision_number DESC`,
      [orderId]
    );

    return res.json({
      success: true,
      data: {
        revisions: revisions || []
      }
    });

  } catch (err) {
    console.error('Error fetching revisions:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch revision history'
    });
  }
};

module.exports = exports;
