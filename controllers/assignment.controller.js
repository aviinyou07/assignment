const db = require('../config/db');
const { sendMail } = require('../utils/mailer');
const { logAction } = require('../utils/logger');
const { createAuditLog, createNotification } = require('../utils/audit');
const notificationsController = require('./notifications.controller');

/**
 * WRITER ASSIGNMENT CONTROLLER
 * Handles assigning writers to work codes, managing acceptance/rejection
 */

// Get available writers
exports.getAvailableWriters = async (req, res) => {
  try {
    const [writers] = await db.query(
      `SELECT 
        user_id, full_name, email, 
        role, is_active
      FROM users
      WHERE role = 'writer' AND is_active = 1
      ORDER BY full_name ASC`,
      []
    );

    res.json({ success: true, writers });
  } catch (error) {
    console.error('Error fetching writers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Assign writers to work_code
exports.assignWriters = async (req, res) => {
  try {
    const { orderId, writerIds, deadline, notes } = req.body;

    if (!orderId || !writerIds || writerIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Order ID and writer IDs required' });
    }

    // Check if order exists
    const [[order]] = await db.query(
      `SELECT order_id, user_id, work_code, paper_topic FROM orders WHERE order_id = ?`,
      [orderId]
    );

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Create work_code if not exists
    let workCode = order.work_code;
    if (!workCode) {
      workCode = `WC${Date.now()}${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
      await db.query(
        `UPDATE orders SET work_code = ? WHERE order_id = ?`,
        [workCode, orderId]
      );
    }

    // Assign writers via task_evaluations
    for (const writerId of writerIds) {
      await db.query(
        `INSERT INTO task_evaluations (order_id, writer_id, status, comment, created_at)
         VALUES (?, ?, 'pending', ?, NOW())
         ON DUPLICATE KEY UPDATE status = 'pending'`,
        [orderId, writerId, notes || '']
      );
    }

    // Update order status to "Writer Assigned" (31)
    await db.query(
      `UPDATE orders SET status = 31 WHERE order_id = ?`,
      [orderId]
    );

    // Log action
    await logAction({
      userId: req.user.user_id,
      action: 'assign_writers',
      details: `Assigned ${writerIds.length} writer(s))`,
      resource_type: 'order',
      resource_id: orderId,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Get writer details for emails
    const [writers] = await db.query(
      `SELECT user_id, full_name, email FROM users WHERE user_id IN (?)`,
      [writerIds]
    );

    writers.forEach(writer => {
      sendMail({
        to: writer.email,
        subject: `New Task Assignment: ${order.paper_topic}`,
        html: `
          <h2>New Assignment</h2>
          <p>Hello ${writer.full_name},</p>
          <p>You have been assigned to work on: <strong>${order.paper_topic}</strong></p>
          <p>Notes: ${notes || 'Please proceed with the assignment'}</p>
          <p>Thank you!</p>
        `
      }).catch(err => console.error('Email error:', err));
    });

    res.json({
      success: true,
      message: `${writerIds.length} writer(s) assigned successfully`,
      workCode
    });
  } catch (error) {
    console.error('Error assigning writers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// List assignments for an order
exports.listAssignments = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { page = 0 } = req.query;
    const limit = 20;
    const offset = page * limit;

    // Get order details
    const [[order]] = await db.query(
      `SELECT order_id, query_code, paper_topic, work_code, status FROM orders WHERE order_id = ?`,
      [orderId]
    );

    if (!order) {
      return res.status(404).render('errors/404', { title: 'Order Not Found', layout: false });
    }

    // Get assignments
    const [assignments] = await db.query(
      `SELECT 
        te.id, te.order_id, te.writer_id, u.full_name, u.email,
        te.status, te.comment, te.created_at, te.updated_at
      FROM task_evaluations te
      JOIN users u ON te.writer_id = u.user_id
      WHERE te.order_id = ?
      ORDER BY te.created_at DESC
      LIMIT ? OFFSET ?`,
      [orderId, limit, offset]
    );

    // Get total
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM task_evaluations WHERE order_id = ?`,
      [orderId]
    );

    const totalPages = Math.ceil(total / limit);

    res.render('admin/assignments/index', {
      title: `Assignments for Order ${order.query_code}`,
      order,
      assignments,
      page: parseInt(page) + 1,
      pages: totalPages,
      total,
      filters: {},
      layout: 'layouts/admin'
    });
  } catch (error) {
    console.error('Error listing assignments:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

// Get assignment detail
exports.getAssignmentDetail = async (req, res) => {
  try {
    const { taskEvalId } = req.params;

    const [[assignment]] = await db.query(
      `SELECT 
        te.id, te.order_id, te.writer_id, u.full_name, u.email,
        te.status, te.comment, te.created_at, te.updated_at,
        o.order_id as order_full, o.query_code, o.paper_topic
      FROM task_evaluations te
      JOIN users u ON te.writer_id = u.user_id
      LEFT JOIN orders o ON te.order_id = o.order_id
      WHERE te.id = ?`,
      [taskEvalId]
    );

    if (!assignment) {
      return res.status(404).json({ success: false, error: 'Assignment not found' });
    }

    // Get submissions for this order
    const [submissions] = await db.query(
      `SELECT submission_id, order_id, writer_id, file_url, status, created_at, updated_at
       FROM submissions
       WHERE order_id = ? AND writer_id = ?
       ORDER BY created_at DESC`,
      [assignment.order_id, assignment.writer_id]
    );

    // Get all evaluations for this order (writers invited/accepted/rejected)
    const [evaluations] = await db.query(
      `SELECT te.id, te.order_id, te.writer_id, te.status, te.comment, u.full_name, u.email
       FROM task_evaluations te
       JOIN users u ON te.writer_id = u.user_id
       WHERE te.order_id = ?
       ORDER BY te.created_at ASC`,
      [assignment.order_id]
    );

    res.json({
      success: true,
      assignment,
      submissions,
      evaluations
    });
  } catch (error) {
    console.error('Error getting assignment detail:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Accept assignment (Writer action)
exports.acceptAssignment = async (req, res) => {
  try {
    const { taskEvalId } = req.params;
    const { notes } = req.body;

    const [[assignment]] = await db.query(
      `SELECT te.*, u.email, u.full_name FROM task_evaluations te
       JOIN users u ON te.writer_id = u.user_id
       WHERE te.id = ?`,
      [taskEvalId]
    );

    if (!assignment) {
      return res.status(404).json({ success: false, error: 'Assignment not found' });
    }

    // Update assignment status
    await db.query(
      `UPDATE task_evaluations SET status = 'doable', comment = ?, updated_at = NOW()
       WHERE id = ?`,
      [notes || '', taskEvalId]
    );

    // Log action
    await logAction({
      userId: req.user.user_id,
      action: 'assignment_accepted',
      details: `Writer ${assignment.full_name} accepted assignment`,
      resource_type: 'order',
      resource_id: assignment.order_id,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Audit log
    await createAuditLog({
      user_id: req.user.user_id,
      role: req.user.role,
      event_type: 'ASSIGNMENT_ACCEPTED',
      resource_type: 'task_evaluation',
      resource_id: taskEvalId,
      details: `Writer ${assignment.full_name} accepted assignment ${taskEvalId}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    // Notify Admin and BDE
    try {
      // Notify admin(s)
      await createNotification({
        user_id: 1, // system/admin id - replace with actual admin routing if available
        type: 'success',
        title: 'Writer Accepted Assignment',
        message: `Writer ${assignment.full_name} accepted assignment for order ${assignment.order_id}`,
        link_url: `/admin/assignments/${assignment.order_id}`
      });
      // Notify BDE if assigned
      const [[userRow]] = await db.query('SELECT bde FROM users WHERE user_id = ? LIMIT 1', [assignment.user_id]);
      if (userRow && userRow.bde) {
        await createNotification({
          user_id: userRow.bde,
          type: 'success',
          title: 'Writer Accepted Assignment',
          message: `Writer ${assignment.full_name} accepted assignment for order ${assignment.order_id}`,
          link_url: `/bde/assignments/${assignment.order_id}`
        });
      }
    } catch (notifErr) {
      console.error('Failed to send accept notifications:', notifErr);
    }

    res.json({ success: true, message: 'Assignment accepted successfully' });
  } catch (error) {
    console.error('Error accepting assignment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Reject assignment (Writer action)
exports.rejectAssignment = async (req, res) => {
  try {
    const { taskEvalId } = req.params;
    const { reason } = req.body;

    if (!reason || String(reason).trim().length < 5) {
      return res.status(400).json({ success: false, error: 'Rejection reason is required and should be descriptive (min 5 chars)' });
    }

    const [[assignment]] = await db.query(
      `SELECT te.*, u.full_name FROM task_evaluations te
       JOIN users u ON te.writer_id = u.user_id
       WHERE te.id = ?`,
      [taskEvalId]
    );

    if (!assignment) {
      return res.status(404).json({ success: false, error: 'Assignment not found' });
    }

    // Update assignment status
    await db.query(
      `UPDATE task_evaluations SET status = 'not_doable', comment = ?, updated_at = NOW()
       WHERE id = ?`,
      [reason || 'Writer rejected the assignment', taskEvalId]
    );

    // Log action
    await logAction({
      userId: req.user.user_id,
      action: 'assignment_rejected',
      details: `Writer ${assignment.full_name} rejected assignment. Reason: ${reason || 'Not specified'}`,
      resource_type: 'order',
      resource_id: assignment.order_id,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Audit log
    await createAuditLog({
      user_id: req.user.user_id,
      role: req.user.role,
      event_type: 'ASSIGNMENT_REJECTED',
      resource_type: 'task_evaluation',
      resource_id: taskEvalId,
      details: `Writer ${assignment.full_name} rejected assignment ${taskEvalId}. Reason: ${reason}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    // Notify Admin and BDE
    try {
      await createNotification({
        user_id: 1,
        type: 'warning',
        title: 'Writer Rejected Assignment',
        message: `Writer ${assignment.full_name} rejected assignment for order ${assignment.order_id}. Reason: ${reason}`,
        link_url: `/admin/assignments/${assignment.order_id}`
      });

      const [[userRow]] = await db.query('SELECT bde FROM users WHERE user_id = ? LIMIT 1', [assignment.user_id]);
      if (userRow && userRow.bde) {
        await createNotification({
          user_id: userRow.bde,
          type: 'warning',
          title: 'Writer Rejected Assignment',
          message: `Writer ${assignment.full_name} rejected assignment for order ${assignment.order_id}. Reason: ${reason}`,
          link_url: `/bde/assignments/${assignment.order_id}`
        });
      }
    } catch (notifErr) {
      console.error('Failed to send rejection notifications:', notifErr);
    }

    res.json({ success: true, message: 'Assignment rejected. Admin will reassign' });
  } catch (error) {
    console.error('Error rejecting assignment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * FINALIZE ASSIGNMENT - Admin selects final writer from accepted list
 */
exports.finalizeAssignment = async (req, res) => {
  try {
    const adminId = req.user.user_id;
    const { taskEvalId } = req.params; // the task evaluation record to finalize (could be one of several)
    const { chosenWriterId } = req.body;

    if (!chosenWriterId) {
      return res.status(400).json({ success: false, error: 'chosenWriterId is required' });
    }

    // Get task evaluation to determine order
    const [[chosenEval]] = await db.query('SELECT id, order_id, writer_id, status FROM task_evaluations WHERE id = ? LIMIT 1', [taskEvalId]);
    if (!chosenEval) return res.status(404).json({ success: false, error: 'Task evaluation not found' });

    const orderId = chosenEval.order_id;

    // Ensure chosenWriterId has previously accepted
    const [[accepted]] = await db.query('SELECT id FROM task_evaluations WHERE order_id = ? AND writer_id = ? AND status = "accepted" LIMIT 1', [orderId, chosenWriterId]);
    if (!accepted) return res.status(400).json({ success: false, error: 'Chosen writer has not accepted or is not available' });

    // Mark chosen writer as final assigned
    await db.query('UPDATE task_evaluations SET status = "assigned", updated_at = NOW() WHERE order_id = ? AND writer_id = ?', [orderId, chosenWriterId]);

    // Release other writers
    await db.query('UPDATE task_evaluations SET status = "released", updated_at = NOW() WHERE order_id = ? AND writer_id != ?', [orderId, chosenWriterId]);

    // Update orders table to set writer_id (final)
    await db.query('UPDATE orders SET writer_id = ? WHERE order_id = ?', [chosenWriterId, orderId]);

    // Audit log
    await createAuditLog({
      user_id: adminId,
      role: 'admin',
      event_type: 'ASSIGNMENT_FINALIZED',
      resource_type: 'order',
      resource_id: orderId,
      details: `Admin finalized writer ${chosenWriterId} for order ${orderId}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    // Notify chosen writer
    await createNotification({
      user_id: chosenWriterId,
      type: 'success',
      title: 'Final Assignment Selected',
      message: `You have been selected as the final writer for order ${orderId}. Please accept and start work.`,
      link_url: `/writer/tasks/${orderId}`
    });

    // Notify BDE and Admin
    const [[orderRow]] = await db.query('SELECT user_id FROM orders WHERE order_id = ? LIMIT 1', [orderId]);
    const clientUserId = orderRow?.user_id;
    const [[clientUser]] = await db.query('SELECT bde FROM users WHERE user_id = ? LIMIT 1', [clientUserId]);
    if (clientUser && clientUser.bde) {
      await createNotification({
        user_id: clientUser.bde,
        type: 'success',
        title: 'Writer Finalized',
        message: `Writer assigned for order ${orderId}`,
        link_url: `/bde/assignments/${orderId}`
      });
    }

    return res.json({ success: true, message: 'Writer finalized and others released' });
  } catch (error) {
    console.error('Error finalizing assignment:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Reassign writer (Admin action)
exports.reassignWriter = async (req, res) => {
  try {
    const { taskEvalId } = req.params;
    const { newWriterId, reason } = req.body;

    if (!newWriterId) {
      return res.status(400).json({ success: false, error: 'New writer ID required' });
    }

    const [[assignment]] = await db.query(
      `SELECT te.*, u.full_name as old_writer_name FROM task_evaluations te
       JOIN users u ON te.writer_id = u.user_id
       WHERE te.id = ?`,
      [taskEvalId]
    );

    if (!assignment) {
      return res.status(404).json({ success: false, error: 'Assignment not found' });
    }

    // Delete old assignment
    await db.query(
      `DELETE FROM task_evaluations WHERE id = ?`,
      [taskEvalId]
    );

    // Create new assignment
    await db.query(
      `INSERT INTO task_evaluations (order_id, writer_id, status, comment, created_at)
       VALUES (?, ?, 'pending', ?, NOW())`,
      [assignment.order_id, newWriterId, `Reassigned: ${reason || 'Previous writer was unavailable'}`]
    );

    // Log action
    await logAction({
        userId: req.user.user_id,
        action: 'writer_reassigned',
        details: `Reassigned from ${assignment.old_writer_name} to new writer. Reason: ${reason || 'Not specified'}`,
        resource_type: 'order',
        resource_id: assignment.order_id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });


    res.json({
      success: true,
      message: 'Writer reassigned successfully'
    });
  } catch (error) {
    console.error('Error reassigning writer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
