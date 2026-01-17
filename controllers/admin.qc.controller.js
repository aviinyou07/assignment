const db = require('../config/db');
const { logAction } = require('../utils/logger');
const { sendMail } = require('../utils/mailer');
const { createAuditLog, createNotification } = require('../utils/audit');
const { STATUS, STATUS_NAMES, validateTransition, NOTIFICATION_TRIGGERS } = require('../utils/order-state-machine');
const notificationsController = require('./notifications.controller');

// =============================================
// QC CONTROLLER - ENHANCED WITH STATE MACHINE
// =============================================

exports.listPendingQC = async (req, res) => {
  try {
    const { page = 0, status, dateFrom, dateTo } = req.query;
    const limit = 20;
    const offset = page * limit;

    let whereClause = '1=1';
    let params = [];

    if (status && status !== 'all') {
      whereClause += ' AND s.status = ?';
      params.push(status);
    } else if (status !== 'all') { // Default to pending_qc if status is undefined or empty
      whereClause += ' AND s.status = ?';
      params.push('pending_qc');
    }

    if (dateFrom) {
      whereClause += ' AND DATE(s.created_at) >= DATE(?)';
      params.push(dateFrom);
    }

    if (dateTo) {
      whereClause += ' AND DATE(s.created_at) <= DATE(?)';
      params.push(dateTo);
    }

    // Fetch submissions with full user details
    const [submissions] = await db.query(
      `SELECT 
        s.submission_id, s.order_id, s.writer_id,
        w.full_name as writer_name, w.email as writer_email,
        o.query_code, o.paper_topic as topic, o.deadline_at,
        u.full_name as client_name, u.email as client_email,
        o.grammarly_score, o.ai_score, o.plagiarism_score,
        s.status, s.feedback, s.created_at
      FROM submissions s
      JOIN users w ON s.writer_id = w.user_id
      LEFT JOIN orders o ON s.order_id = o.order_id
      LEFT JOIN users u ON o.user_id = u.user_id
      WHERE ${whereClause}
      ORDER BY s.created_at ASC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Get total count
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM submissions s WHERE ${whereClause}`,
      params
    );

    const totalPages = Math.ceil(total / limit);

    res.render('admin/qc/index', {
      title: 'QC Review',
      page: parseInt(page) + 1,
      pages: totalPages,
      total: total,
      filters: { status: status || 'pending_qc' },
      records: submissions,
      currentPage: 'qc',
      layout: 'layouts/admin'
    });
  } catch (error) {
    console.error('Error listing pending QC:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

// Get QC details for a submission
exports.getQCDetail = async (req, res) => {
  try {
    const { submissionId } = req.params;

    // Get submission details
    const [[submission]] = await db.query(
      `SELECT 
        s.submission_id, s.order_id, s.writer_id, u.full_name as writer_name, u.email as writer_email,
        o.query_code, o.paper_topic, o.deadline_at, o.user_id, c.full_name as client_name, c.email as client_email,
        s.status, s.created_at, s.file_url, s.feedback, o.grammarly_score, o.ai_score, o.plagiarism_score
      FROM submissions s
      JOIN users u ON s.writer_id = u.user_id
      JOIN orders o ON s.order_id = o.order_id
      JOIN users c ON o.user_id = c.user_id
      WHERE s.submission_id = ?`,
      [submissionId]
    );

    if (!submission) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }

    // Get previous submissions for this order
    const [previousSubmissions] = await db.query(
      `SELECT 
        submission_id, status, created_at, file_url, feedback
      FROM submissions
      WHERE order_id = ? AND submission_id != ?
      ORDER BY created_at DESC`,
      [submission.order_id, submissionId]
    );

    res.json({
      success: true,
      submission,
      previousSubmissions
    });
  } catch (error) {
    console.error('Error getting QC detail:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Approve submission (QC Pass) - ENHANCED with state machine and notifications
exports.approveSubmission = async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    const adminId = req.user.user_id;
    const { submissionId } = req.params;
    const { feedback, deliverImmediately = false } = req.body;

    await connection.beginTransaction();

    // Get submission details
    const [[submission]] = await connection.query(
      `SELECT 
        s.submission_id, s.order_id, s.writer_id, u.full_name as writer_name, u.email as writer_email,
        o.query_code, o.work_code, o.paper_topic, o.user_id, o.status as order_status,
        c.full_name as client_name, c.email as client_email
      FROM submissions s
      JOIN users u ON s.writer_id = u.user_id
      JOIN orders o ON s.order_id = o.order_id
      JOIN users c ON o.user_id = c.user_id
      WHERE s.submission_id = ?`,
      [submissionId]
    );

    if (!submission) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }

    // =======================
    // VALIDATE STATE TRANSITION
    // =======================
    // FIX: Map READY_FOR_DELIVERY to APPROVED logic for validation if needed, or just use APPROVED
    // The state machine expects APPROVED (34) from PENDING_QC (33)
    const newStatus = deliverImmediately ? STATUS.DELIVERED : STATUS.APPROVED;
    
    // We'll use an internal override for "Deliver Immediately" if validation fails but user is Admin
    // For standard approval, we use STATUS.APPROVED which is valid.
    
    // Check if we strictly need to validate
    let transition = validateTransition('admin', submission.order_status, newStatus);
    
    // If deliverImmediately is requested and direct transition isn't allowed, check if we can override
    if (!transition.valid && deliverImmediately) {
         // Allow admin to skip steps for immediate delivery
         transition = { valid: true }; 
    }

    // Allow re-approval (idempotency) if status is already correct
    if (!transition.valid && submission.order_status === newStatus) {
         transition = { valid: true };
    }

    if (!transition.valid) {
      // Admin can override with reason
      if (req.body.adminOverride && req.body.overrideReason) {
        console.log(`[ADMIN OVERRIDE] QC Approval from status ${submission.order_status} to ${newStatus}`);
      } else {
        await connection.rollback();
        return res.status(400).json({ 
          success: false, 
          error: `Invalid state transition: ${transition.message}. Current status: ${STATUS_NAMES[submission.order_status]}`,
          allowOverride: true
        });
      }
    }

    // =======================
    // UPDATE SUBMISSION STATUS
    // =======================
    await connection.query(
      `UPDATE submissions SET status = 'approved', feedback = ?, updated_at = NOW() WHERE submission_id = ?`,
      [feedback || 'Approved - meets quality standards', submissionId]
    );

    // =======================
    // UPDATE ORDER STATUS
    // =======================
    const { updateOrderStatus } = require('../utils/workflow.service');
    // REMOVED: const { STATUS } = require('../utils/order-state-machine'); // Already imported at top level
    
    const targetStatus = deliverImmediately ? STATUS.DELIVERED : STATUS.APPROVED;
    
    // Only attempt to update if status is different (handles idempotency for stuck pending_qc items)
    if (submission.order_status !== targetStatus) {
      const statusResult = await updateOrderStatus(
        submission.order_id,
        targetStatus,
        'admin',
        {
          userId: adminId,
          userName: 'Admin',
          io: req.io,
          reason: `QC approved: ${feedback || 'Meets quality standards'}${deliverImmediately ? ' - Delivered immediately' : ''}`
        }
      );

      if (!statusResult.success) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: statusResult.error });
      }
    }

    // =======================
    // TRIGGER FINAL PAYMENT REQUEST (if not delivering immediately)
    // =======================
    if (!deliverImmediately) {
      const { processWorkflowEvent } = require('../utils/workflow.service');
      const [[orderData]] = await connection.query(
        `SELECT o.*, u.full_name as client_name FROM orders o JOIN users u ON o.user_id = u.user_id WHERE o.order_id = ?`,
        [submission.order_id]
      );
      
      if (orderData) {
        const totalPrice = orderData.total_price || 0;
        await processWorkflowEvent('PAYMENT_FINAL_REQUESTED', orderData, 
          { client_id: orderData.user_id, admin_id: adminId }, {
          currency: '$',
          amount: totalPrice.toFixed(2),
          half_amount: (totalPrice / 2).toFixed(2)
        }, req.io);
      }
    }

    // =======================
    // CREATE ORDER HISTORY
    // =======================
    await connection.query(
      `INSERT INTO orders_history 
       (order_id, modified_by, modified_by_name, modified_by_role, action_type, description, created_at)
       VALUES (?, ?, 'Admin', 'Admin', 'QC_APPROVED', ?, NOW())`,
      [
        submission.order_id,
        adminId,
        `Submission approved. ${deliverImmediately ? 'Delivered immediately.' : 'Ready for delivery.'} Feedback: ${feedback || 'N/A'}`
      ]
    );

    await connection.commit();

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: adminId,
      role: 'admin',
      event_type: 'QC_APPROVED',
      resource_type: 'submission',
      resource_id: submissionId,
      details: `Submission approved for order ${submission.order_id}. Delivered immediately: ${deliverImmediately}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: {
        order_id: submission.order_id,
        work_code: submission.work_code,
        writer_id: submission.writer_id,
        deliver_immediately: deliverImmediately
      }
    });

    // =======================
    // NOTIFY WRITER (SUCCESS)
    // =======================
    if (req.io) {
      await notificationsController.createNotificationWithRealtime(
        req.io,
        {
          user_id: submission.writer_id,
          type: 'success',
          title: '✅ Submission Approved',
          message: `Your submission for "${submission.paper_topic}" has been approved. ${feedback || 'Great work!'}`,
          link_url: `/writer/tasks/${submission.order_id}`,
          context_code: submission.work_code || submission.query_code,
          triggered_by: { user_id: adminId, role: 'admin' }
        }
      );
    }

    // =======================
    // NOTIFY CLIENT IF DELIVERED
    // =======================
    if (deliverImmediately && req.io) {
      await notificationsController.createNotificationWithRealtime(
        req.io,
        {
          user_id: submission.user_id,
          type: 'success',
          title: '📦 Order Delivered',
          message: `Your order "${submission.paper_topic}" has been delivered. Please review and provide feedback.`,
          link_url: `/client/orders/${submission.order_id}`,
          context_code: submission.work_code || submission.query_code,
          triggered_by: { user_id: adminId, role: 'admin' }
        }
      );
    }

    // =======================
    // SEND EMAIL TO WRITER
    // =======================
    sendMail({
      to: submission.writer_email,
      subject: `✅ Submission Approved - ${submission.paper_topic}`,
      html: `
        <h2>Submission Approved</h2>
        <p>Hello ${submission.writer_name},</p>
        <p>Congratulations! Your submission has been approved.</p>
        <p><strong>Feedback:</strong> ${feedback || 'Your work meets our quality standards'}</p>
        <p>Thank you for your excellent work!</p>
      `
    }).catch(err => console.error('Email error:', err));

    res.json({
      success: true,
      message: deliverImmediately ? 'Submission approved and delivered' : 'Submission approved, ready for delivery',
      newStatus: STATUS_NAMES[newStatus]
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error approving submission:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

// Reject submission and send back to writer - ENHANCED with revision tracking
exports.rejectSubmission = async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    const adminId = req.user.user_id;
    const { submissionId } = req.params;
    const { feedback, revisionDeadlineHours = 24 } = req.body;

    if (!feedback) {
      return res.status(400).json({ success: false, error: 'Feedback required for rejection' });
    }

    await connection.beginTransaction();

    // Get submission details
    const [[submission]] = await connection.query(
      `SELECT 
        s.submission_id, s.order_id, s.writer_id, u.full_name as writer_name, u.email as writer_email,
        o.query_code, o.work_code, o.paper_topic, o.user_id, o.deadline_at, o.status as order_status,
        c.full_name as client_name, c.email as client_email
      FROM submissions s
      JOIN users u ON s.writer_id = u.user_id
      JOIN orders o ON s.order_id = o.order_id
      JOIN users c ON o.user_id = c.user_id
      WHERE s.submission_id = ?`,
      [submissionId]
    );

    if (!submission) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }

    // =======================
    // UPDATE SUBMISSION STATUS
    // =======================
    await connection.query(
      `UPDATE submissions SET status = 'revision_required', feedback = ?, updated_at = NOW() WHERE submission_id = ?`,
      [feedback, submissionId]
    );

    // =======================
    // UPDATE ORDER STATUS BACK TO UNDER REVISION
    // =======================
    if (submission.order_status !== STATUS.REVISION_REQUIRED) {
      await connection.query(
        `UPDATE orders SET status = ?, updated_at = NOW() WHERE order_id = ?`,
        [STATUS.REVISION_REQUIRED, submission.order_id]
      );
    }

    // =======================
    // CREATE REVISION REQUEST RECORD
    // =======================
    const revisionDeadline = new Date();
    revisionDeadline.setHours(revisionDeadline.getHours() + revisionDeadlineHours);

    // Count existing revisions for this order
    const [[{ revisionCount }]] = await connection.query(
      `SELECT COUNT(*) as revisionCount FROM revision_requests WHERE order_id = ?`,
      [String(submission.order_id)]
    );

    await connection.query(
      `INSERT INTO revision_requests (order_id, requested_by, revision_number, reason, status, deadline, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, NOW())`,
      [String(submission.order_id), adminId, revisionCount + 1, feedback, revisionDeadline]
    );

    // =======================
    // CREATE ORDER HISTORY
    // =======================
    await connection.query(
      `INSERT INTO orders_history 
       (order_id, modified_by, modified_by_name, modified_by_role, action_type, description, created_at)
       VALUES (?, ?, 'Admin', 'Admin', 'QC_REJECTED', ?, NOW())`,
      [
        submission.order_id,
        adminId,
        `Submission rejected. Revision #${revisionCount + 1} required. Feedback: ${feedback}`
      ]
    );

    await connection.commit();

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: adminId,
      role: 'admin',
      event_type: 'QC_REJECTED',
      resource_type: 'submission',
      resource_id: submissionId,
      details: `Submission rejected. Revision #${revisionCount + 1} required. Deadline: ${revisionDeadline.toISOString()}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: {
        order_id: submission.order_id,
        work_code: submission.work_code,
        writer_id: submission.writer_id,
        revision_number: revisionCount + 1,
        revision_deadline: revisionDeadline.toISOString()
      }
    });

    // =======================
    // NOTIFY WRITER (WARNING)
    // =======================
    const notificationSeverity = revisionCount >= 2 ? 'critical' : 'warning';
    const notificationTitle = revisionCount >= 2 
      ? `⚠️ URGENT: Revision #${revisionCount + 1} Required` 
      : `📝 Revision #${revisionCount + 1} Required`;

    if (req.io) {
      await notificationsController.createNotificationWithRealtime(
        req.io,
        {
          user_id: submission.writer_id,
          type: notificationSeverity,
          title: notificationTitle,
          message: `Your submission for "${submission.paper_topic}" requires revision. Feedback: ${feedback}. New deadline: ${revisionDeadline.toLocaleString()}`,
          link_url: `/writer/tasks/${submission.order_id}/revise`,
          context_code: submission.work_code || submission.query_code,
          triggered_by: { user_id: adminId, role: 'admin' }
        }
      );
    }

    // =======================
    // SEND EMAIL TO WRITER
    // =======================
    sendMail({
      to: submission.writer_email,
      subject: `${notificationTitle} - ${submission.paper_topic}`,
      html: `
        <h2>Revision Required</h2>
        <p>Hello ${submission.writer_name},</p>
        <p>Your submission requires revision (Revision #${revisionCount + 1}).</p>
        <p><strong>Feedback:</strong> ${feedback}</p>
        <p><strong>New Deadline:</strong> ${revisionDeadline.toLocaleString()}</p>
        ${revisionCount >= 2 ? '<p style="color: red;"><strong>WARNING: Multiple revisions. Please carefully address all feedback.</strong></p>' : ''}
        <p>Please revise and resubmit your work.</p>
      `
    }).catch(err => console.error('Email error:', err));

    res.json({
      success: true,
      message: `Submission rejected. Writer has been notified. Revision #${revisionCount + 1}`,
      revisionNumber: revisionCount + 1,
      revisionDeadline: revisionDeadline.toISOString()
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error rejecting submission:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

// =======================
// FORWARD REVISION TO WRITER
// =======================
exports.forwardRevisionRequest = async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    const adminId = req.user.user_id;
    const { orderId } = req.params;
    const { revisionDetails, newDeadlineHours = 24, urgency = 'normal' } = req.body;

    if (!revisionDetails) {
      return res.status(400).json({ success: false, error: 'Revision details required' });
    }

    await connection.beginTransaction();

    // Get order and writer details
    const [[order]] = await connection.query(
      `SELECT o.*, u.full_name as writer_name, u.email as writer_email,
              c.full_name as client_name
       FROM orders o
       LEFT JOIN users u ON o.writer_id = u.user_id
       LEFT JOIN users c ON o.user_id = c.user_id
       WHERE o.order_id = ?`,
      [orderId]
    );

    if (!order) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (!order.writer_id) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'No writer assigned to this order' });
    }

    // Calculate new deadline
    const newDeadline = new Date();
    newDeadline.setHours(newDeadline.getHours() + newDeadlineHours);

    // Count existing revisions
    const [[{ revisionCount }]] = await connection.query(
      `SELECT COUNT(*) as revisionCount FROM revision_requests WHERE order_id = ?`,
      [String(orderId)]
    );

    // Create revision request
    await connection.query(
      `INSERT INTO revision_requests (order_id, revision_number, reason, status, deadline, created_at)
       VALUES (?, ?, ?, 'pending', ?, NOW())`,
      [String(orderId), revisionCount + 1, revisionDetails, newDeadline]
    );

    // Update order status
    await connection.query(
      `UPDATE orders SET status = ?, updated_at = NOW() WHERE order_id = ?`,
      [STATUS.UNDER_REVISION, orderId]
    );

    // Create order history
    await connection.query(
      `INSERT INTO orders_history 
       (order_id, modified_by, modified_by_name, modified_by_role, action_type, description, created_at)
       VALUES (?, ?, 'Admin', 'Admin', 'REVISION_FORWARDED', ?, NOW())`,
      [orderId, adminId, `Revision request forwarded to writer. Details: ${revisionDetails}`]
    );

    await connection.commit();

    // Notify writer
    const notificationType = urgency === 'urgent' ? 'critical' : 'warning';
    if (req.io) {
      await notificationsController.createNotificationWithRealtime(
        req.io,
        {
          user_id: order.writer_id,
          type: notificationType,
          title: urgency === 'urgent' ? '🚨 URGENT Revision Required' : '📝 Revision Request',
          message: `Revision needed for "${order.paper_topic}": ${revisionDetails}. Deadline: ${newDeadline.toLocaleString()}`,
          link_url: `/writer/tasks/${orderId}/revise`,
          context_code: order.work_code || order.query_code,
          triggered_by: { user_id: adminId, role: 'admin' }
        }
      );
    }

    // Send email
    sendMail({
      to: order.writer_email,
      subject: `${urgency === 'urgent' ? '🚨 URGENT: ' : ''}Revision Request - ${order.paper_topic}`,
      html: `
        <h2>${urgency === 'urgent' ? '🚨 URGENT ' : ''}Revision Request</h2>
        <p>Hello ${order.writer_name},</p>
        <p>A revision has been requested for your work:</p>
        <p><strong>Topic:</strong> ${order.paper_topic}</p>
        <p><strong>Revision Details:</strong> ${revisionDetails}</p>
        <p><strong>New Deadline:</strong> ${newDeadline.toLocaleString()}</p>
        <p>Please submit the revised work by the deadline.</p>
      `
    }).catch(err => console.error('Email error:', err));

    res.json({
      success: true,
      message: 'Revision request forwarded to writer',
      revisionNumber: revisionCount + 1,
      newDeadline: newDeadline.toISOString()
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error forwarding revision:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

// =======================
// ADMIN OVERRIDE - FORCE APPROVE
// =======================
exports.adminForceApprove = async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    const adminId = req.user.user_id;
    const { orderId } = req.params;
    const { reason, deliverImmediately = false } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, error: 'Override reason required' });
    }

    await connection.beginTransaction();

    // Get order details
    const [[order]] = await connection.query(
      `SELECT o.*, u.full_name as client_name, u.email as client_email,
              w.full_name as writer_name, w.email as writer_email
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.user_id
       LEFT JOIN users w ON o.writer_id = w.user_id
       WHERE o.order_id = ?`,
      [orderId]
    );

    if (!order) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Admin can force approve from any status
    const newStatus = deliverImmediately ? STATUS.DELIVERED : STATUS.READY_FOR_DELIVERY;

    // Update all pending submissions to approved
    await connection.query(
      `UPDATE submissions SET status = 'approved', feedback = ?, qc_approved_by = ?, qc_approved_at = NOW() 
       WHERE order_id = ? AND status IN ('pending_qc', 'revision_required')`,
      [`Admin Force Approved: ${reason}`, adminId, orderId]
    );

    // Update order status
    await connection.query(
      `UPDATE orders SET status = ?, updated_at = NOW() WHERE order_id = ?`,
      [newStatus, orderId]
    );

    // Create order history
    await connection.query(
      `INSERT INTO orders_history 
       (order_id, modified_by, modified_by_name, modified_by_role, action_type, description, created_at)
       VALUES (?, ?, 'Admin', 'Admin', 'ADMIN_FORCE_APPROVE', ?, NOW())`,
      [orderId, adminId, `Admin force approved. Reason: ${reason}. Previous status: ${STATUS_NAMES[order.status] || order.status}`]
    );

    await connection.commit();

    // Audit log (critical action)
    await createAuditLog({
      user_id: adminId,
      role: 'admin',
      event_type: 'ADMIN_FORCE_APPROVE',
      resource_type: 'order',
      resource_id: orderId,
      details: `Admin force approved order from status ${order.status}. Reason: ${reason}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: {
        previous_status: order.status,
        new_status: newStatus,
        override_reason: reason
      }
    });

    // Notify writer if assigned
    if (order.writer_id && req.io) {
      await notificationsController.createNotificationWithRealtime(
        req.io,
        {
          user_id: order.writer_id,
          type: 'success',
          title: '✅ Order Force Approved by Admin',
          message: `Order "${order.paper_topic}" has been approved by Admin.`,
          link_url: `/writer/tasks/${orderId}`,
          context_code: order.work_code || order.query_code
        }
      );
    }

    res.json({
      success: true,
      message: 'Order force approved by admin',
      newStatus: STATUS_NAMES[newStatus]
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error in admin force approve:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

// Get QC statistics
exports.getQCStatistics = async (req, res) => {
  try {
    // Overall stats
    const [[stats]] = await db.query(
      `SELECT 
        COUNT(CASE WHEN status = 'pending_qc' THEN 1 END) as pending_qc,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
        COUNT(CASE WHEN status = 'revision_required' THEN 1 END) as revision_required,
        COUNT(CASE WHEN DATE(created_at) = CURDATE() THEN 1 END) as today_submissions
      FROM submissions`,
      []
    );

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error getting QC statistics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
