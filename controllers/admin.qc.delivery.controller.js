const db = require('../config/db');
const {
  createAuditLog,
  createNotification,
  createOrderHistory
} = require('../utils/audit');

/**
 * ADMIN QC & DELIVERY CONTROLLER
 * 
 * Admin can:
 * - Approve or reject submissions from writers
 * - Deliver final files
 * - Close orders
 * - Lock completed orders from edits
 * - Reassign writers after QC failure
 */

/**
 * GET SUBMISSIONS FOR QC
 * Admin reviews all pending submissions
 */
exports.listSubmissionsForQC = async (req, res) => {
  try {
    const { page = 0, limit = 20, status = 'pending_qc' } = req.query;
    const offset = parseInt(page) * parseInt(limit);

    let whereClause = '1=1';
    let params = [];

    if (status && status !== 'all') {
      whereClause += ` AND s.status = ?`;
      params.push(status);
    }

    // =======================
    // FETCH SUBMISSIONS
    // =======================
    const [submissions] = await db.query(
      `SELECT 
        s.submission_id,
        s.order_id,
        s.writer_id,
        w.full_name as writer_name,
        s.file_url,
        o.query_code,
        o.paper_topic,
        c.full_name as client_name,
        s.status,
        s.grammarly_score,
        s.ai_score,
        s.plagiarism_score,
        s.created_at
      FROM submissions s
      JOIN orders o ON s.order_id = o.order_id
      JOIN users w ON s.writer_id = w.user_id
      JOIN users c ON o.user_id = c.user_id
      WHERE ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // =======================
    // GET TOTAL COUNT
    // =======================
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM submissions s
       JOIN orders o ON s.order_id = o.order_id
       WHERE ${whereClause}`,
      params
    );

    const totalPages = Math.ceil(total / parseInt(limit));

    return res.json({
      success: true,
      data: {
        submissions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: totalPages
        }
      }
    });

  } catch (err) {
    console.error('Error listing submissions:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch submissions'
    });
  }
};

/**
 * APPROVE SUBMISSION
 * Admin approves the submission and can proceed to delivery
 */
exports.approveSubmission = async (req, res) => {
  try {
    const adminId = req.user.user_id;
    const { submission_id, feedback } = req.body;

    if (!submission_id) {
      return res.status(400).json({
        success: false,
        message: 'Submission ID is required'
      });
    }

    // =======================
    // FETCH SUBMISSION WITH ORDER
    // =======================
    const [[submission]] = await db.query(
      `SELECT s.*, o.order_id, o.user_id, o.writer_id
       FROM submissions s
       JOIN orders o ON s.order_id = o.order_id
       WHERE s.submission_id = ?
       LIMIT 1`,
      [submission_id]
    );

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    // =======================
    // UPDATE SUBMISSION STATUS
    // =======================
    await db.query(
      `UPDATE submissions SET status = 'approved', feedback = ? WHERE submission_id = ?`,
      [feedback || null, submission_id]
    );

    // =======================
    // CREATE ORDER HISTORY
    // =======================
    await createOrderHistory({
      order_id: submission.order_id,
      modified_by: adminId,
      modified_by_name: 'Admin',
      modified_by_role: 'Admin',
      action_type: 'SUBMISSION_APPROVED',
      description: `Submission approved${feedback ? ': ' + feedback : ''}`
    });

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: adminId,
      role: 'admin',
      event_type: 'SUBMISSION_APPROVED',
      resource_type: 'submission',
      resource_id: submission_id,
      details: `Admin approved submission for order ${submission.order_id}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { submission_id, feedback }
    });

    // =======================
    // SEND NOTIFICATIONS
    // =======================

    // Notify writer
    await createNotification({
      user_id: submission.writer_id,
      type: 'success',
      title: 'Submission Approved',
      message: `Your submission for order ${submission.order_id} has been approved!`,
      link_url: `/writer/orders/${submission.order_id}`
    });

    // Notify client
    await createNotification({
      user_id: submission.user_id,
      type: 'success',
      title: 'Work Approved & Ready for Download',
      message: `Your order ${submission.order_id} is approved. Download your final work now.`,
      link_url: `/client/orders/${submission.order_id}/delivery`
    });

    return res.json({
      success: true,
      message: 'Submission approved successfully',
      data: {
        submission_id,
        order_id: submission.order_id,
        status: 'approved'
      }
    });

  } catch (err) {
    console.error('Error approving submission:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to approve submission'
    });
  }
};

/**
 * REJECT SUBMISSION (REVISION REQUIRED)
 * Admin rejects and requires revision
 * Writer must resubmit within deadline
 */
exports.rejectSubmission = async (req, res) => {
  try {
    const adminId = req.user.user_id;
    const { submission_id, feedback, revision_deadline } = req.body;

    if (!submission_id || !feedback) {
      return res.status(400).json({
        success: false,
        message: 'Submission ID and feedback are required'
      });
    }

    // =======================
    // FETCH SUBMISSION WITH ORDER
    // =======================
    const [[submission]] = await db.query(
      `SELECT s.*, o.order_id, o.user_id, o.writer_id, o.deadline_at
       FROM submissions s
       JOIN orders o ON s.order_id = o.order_id
       WHERE s.submission_id = ?
       LIMIT 1`,
      [submission_id]
    );

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    // =======================
    // UPDATE SUBMISSION STATUS
    // =======================
    await db.query(
      `UPDATE submissions SET status = 'revision_required', feedback = ? WHERE submission_id = ?`,
      [feedback, submission_id]
    );

    // =======================
    // CREATE REVISION REQUEST FOR WRITER
    // =======================
    const deadlineDate = revision_deadline || submission.deadline_at;

    await db.query(
      `INSERT INTO revision_requests 
       (order_id, requested_by, revision_number, reason, deadline, status, created_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(revision_number), 0) + 1 FROM revision_requests WHERE order_id = ?), ?, ?, 'pending', NOW())`,
      [submission.order_id, adminId, submission.order_id, feedback, deadlineDate]
    );

    // =======================
    // CREATE ORDER HISTORY
    // =======================
    await createOrderHistory({
      order_id: submission.order_id,
      modified_by: adminId,
      modified_by_name: 'Admin',
      modified_by_role: 'Admin',
      action_type: 'SUBMISSION_REJECTED',
      description: `Submission rejected. Revision required: ${feedback}`
    });

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: adminId,
      role: 'admin',
      event_type: 'SUBMISSION_REJECTED',
      resource_type: 'submission',
      resource_id: submission_id,
      details: `Admin rejected submission for order ${submission.order_id}. Feedback: ${feedback}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { submission_id, feedback }
    });

    // =======================
    // SEND NOTIFICATIONS
    // =======================

    // Notify writer
    await createNotification({
      user_id: submission.writer_id,
      type: 'critical',
      title: 'Revision Required',
      message: `Your submission was rejected. Feedback: ${feedback}. Please revise and resubmit.`,
      link_url: `/writer/orders/${submission.order_id}`
    });

    // Notify client
    await createNotification({
      user_id: submission.user_id,
      type: 'warning',
      title: 'Revision in Progress',
      message: `Your order requires revision. The writer will resubmit soon.`,
      link_url: `/client/orders/${submission.order_id}`
    });

    return res.json({
      success: true,
      message: 'Submission rejected. Revision requested.',
      data: {
        submission_id,
        order_id: submission.order_id,
        status: 'revision_required'
      }
    });

  } catch (err) {
    console.error('Error rejecting submission:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to reject submission'
    });
  }
};

/**
 * DELIVER ORDER
 * Admin marks order as delivered and locks it from further edits
 * Moves approved submission files to delivery
 */
exports.deliverOrder = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const adminId = req.user.user_id;
    const { order_id, notes } = req.body;

    if (!order_id) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    await connection.beginTransaction();

    // =======================
    // FETCH ORDER
    // =======================
    const [[order]] = await connection.query(
      `SELECT order_id, user_id, writer_id, status FROM orders WHERE order_id = ? LIMIT 1`,
      [order_id]
    );

    if (!order) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // =======================
    // FETCH APPROVED SUBMISSION
    // =======================
    const [[submission]] = await connection.query(
      `SELECT submission_id FROM submissions WHERE order_id = ? AND status = 'approved' LIMIT 1`,
      [order_id]
    );

    if (!submission) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'No approved submission to deliver'
      });
    }

    // =======================
    // UPDATE SUBMISSION STATUS
    // =======================
    await connection.query(
      `UPDATE submissions SET status = 'completed' WHERE submission_id = ?`,
      [submission.submission_id]
    );

    // =======================
    // MARK ORDER AS DELIVERED (Set status to completed)
    // =======================
    const [[completedStatus]] = await connection.query(
      `SELECT id FROM master_status WHERE status_name = 'Completed' OR status_name = 'completed' LIMIT 1`
    );

    const statusId = completedStatus?.id || 10;

    await connection.query(
      `UPDATE orders SET status = ? WHERE order_id = ?`,
      [statusId, order_id]
    );

    // =======================
    // CREATE ORDER HISTORY
    // =======================
    await createOrderHistory({
      order_id: order_id,
      modified_by: adminId,
      modified_by_name: 'Admin',
      modified_by_role: 'Admin',
      action_type: 'ORDER_DELIVERED',
      description: `Order delivered to client. ${notes || ''}`
    });

    await connection.commit();

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: adminId,
      role: 'admin',
      event_type: 'ORDER_DELIVERED',
      resource_type: 'order',
      resource_id: order_id,
      details: `Admin delivered order ${order_id} to client`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    // =======================
    // SEND NOTIFICATIONS
    // =======================

    // Notify client
    await createNotification({
      user_id: order.user_id,
      type: 'success',
      title: 'Order Delivered',
      message: `Your order has been completed and is ready for download.`,
      link_url: `/client/orders/${order_id}/delivery`
    });

    // Notify writer
    await createNotification({
      user_id: order.writer_id,
      type: 'success',
      title: 'Order Completed',
      message: `Your work for order ${order_id} has been delivered to the client.`,
      link_url: `/writer/orders/${order_id}`
    });

    return res.json({
      success: true,
      message: 'Order delivered successfully',
      data: {
        order_id,
        status: 'delivered'
      }
    });

  } catch (err) {
    await connection.rollback();
    console.error('Error delivering order:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to deliver order'
    });
  } finally {
    connection.release();
  }
};

/**
 * CLOSE ORDER
 * Admin marks order as closed/completed
 * Order is locked from further edits
 */
exports.closeOrder = async (req, res) => {
  try {
    const adminId = req.user.user_id;
    const { order_id, closure_reason } = req.body;

    if (!order_id) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    // =======================
    // FETCH ORDER
    // =======================
    const [[order]] = await db.query(
      `SELECT order_id, user_id FROM orders WHERE order_id = ? LIMIT 1`,
      [order_id]
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // =======================
    // GET COMPLETED STATUS
    // =======================
    const [[completedStatus]] = await db.query(
      `SELECT id FROM master_status WHERE status_name = 'Completed' OR status_name = 'completed' LIMIT 1`
    );

    const statusId = completedStatus?.id || 10;

    // =======================
    // UPDATE ORDER STATUS
    // =======================
    await db.query(
      `UPDATE orders SET status = ? WHERE order_id = ?`,
      [statusId, order_id]
    );

    // =======================
    // CREATE ORDER HISTORY
    // =======================
    await createOrderHistory({
      order_id: order_id,
      modified_by: adminId,
      modified_by_name: 'Admin',
      modified_by_role: 'Admin',
      action_type: 'ORDER_CLOSED',
      description: `Order closed${closure_reason ? ': ' + closure_reason : ''}`
    });

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: adminId,
      role: 'admin',
      event_type: 'ORDER_CLOSED',
      resource_type: 'order',
      resource_id: order_id,
      details: `Admin closed order ${order_id}. Reason: ${closure_reason || 'No reason provided'}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { closure_reason }
    });

    // =======================
    // SEND NOTIFICATION
    // =======================
    await createNotification({
      user_id: order.user_id,
      type: 'info',
      title: 'Order Closed',
      message: `Your order has been closed.${closure_reason ? ' Reason: ' + closure_reason : ''}`,
      link_url: `/client/orders/${order_id}`
    });

    return res.json({
      success: true,
      message: 'Order closed successfully',
      data: {
        order_id,
        status: 'closed'
      }
    });

  } catch (err) {
    console.error('Error closing order:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to close order'
    });
  }
};

module.exports = exports;
