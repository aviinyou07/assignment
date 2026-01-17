const db = require('../config/db');
const fs = require('fs').promises;
const path = require('path');
const { validateTransition, STATUS, STATUS_NAMES } = require('../utils/state-machine');
const { processWorkflowEvent } = require('../utils/workflow.service');


exports.getDashboardKPIs = async (req, res) => {
  try {
    const writerId = req.user.user_id;

    // New Tasks (assigned via task_evaluations with pending status)
    const [[newTasks]] = await db.query(
      `SELECT COUNT(*) as count FROM task_evaluations 
       WHERE writer_id = ? AND status = 'pending'`,
      [writerId]
    );

      // Active Tasks (accepted or assigned and order not completed)
    const [[activeTasks]] = await db.query(
      `SELECT COUNT(*) as count FROM task_evaluations te
       JOIN orders o ON te.order_id = o.order_id
       WHERE te.writer_id = ? AND te.status IN ('accepted', 'assigned') AND o.status NOT IN (35, 37)`,
      [writerId]
    );

    // Tasks Due Today (active tasks due today)
    const [[dueTasks]] = await db.query(
      `SELECT COUNT(*) as count FROM task_evaluations te
       JOIN orders o ON te.order_id = o.order_id
       WHERE te.writer_id = ? AND te.status IN ('accepted', 'assigned') 
       AND DATE(o.deadline_at) = CURDATE()`,
      [writerId]
    );

    // Completed Tasks (This Month) - tasks where order is completed
    const [[completedTasks]] = await db.query(
      `SELECT COUNT(*) as count FROM task_evaluations te
       JOIN orders o ON te.order_id = o.order_id
       WHERE te.writer_id = ? AND te.status = 'assigned' AND o.status = 35
       AND MONTH(o.created_at) = MONTH(CURDATE())
       AND YEAR(o.created_at) = YEAR(CURDATE())`,
      [writerId]
    );

    res.json({
      success: true,
      kpis: {
        newTasks: newTasks.count || 0,
        activeTasks: activeTasks.count || 0,
        dueTodayTasks: dueTasks.count || 0,
        completedTasks: completedTasks.count || 0
      }
    });
  } catch (error) {
    console.error('Error fetching KPIs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 2. TASK ASSIGNMENT & ACCEPTANCE
// ============================================================================

/**
 * Get all pending task assignments (orders assigned to writer without response)
 */
exports.getPendingTaskAssignments = async (req, res) => {
  try {
    const writerId = req.user.user_id;
    const { sortBy = 'deadline_at', order = 'ASC' } = req.query;

    const allowedSortFields = ['deadline_at', 'created_at', 'urgency'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'deadline_at';

    // Get tasks assigned to this writer via task_evaluations with pending status
    const [tasks] = await db.query(
      `SELECT 
        o.order_id, o.work_code, o.query_code, o.paper_topic as topic,
        o.service, o.subject, o.urgency, o.deadline_at,
        o.description, te.created_at as assigned_at,
        te.comment as admin_notes, te.status as evaluation_status,
        DATE_ADD(te.created_at, INTERVAL 24 HOUR) as response_deadline,
        COUNT(fv.id) as uploaded_documents_count
       FROM task_evaluations te
       JOIN orders o ON te.order_id = o.order_id
       LEFT JOIN file_versions fv ON o.order_id = fv.order_id
       WHERE te.writer_id = ? AND te.status = 'pending'
       GROUP BY o.order_id, te.id
       ORDER BY ${sortField} ${order}`,
      [writerId]
    );

    res.json({ success: true, tasks });
  } catch (error) {
    console.error('Error fetching pending assignments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get detailed task information
 */
exports.getTaskAssignmentDetail = async (req, res) => {
  try {
    const { taskId } = req.params;
    const writerId = req.user.user_id;

    // Verify writer is assigned to this task via task_evaluations
    const [[evaluation]] = await db.query(
      `SELECT te.*, o.* 
       FROM task_evaluations te
       JOIN orders o ON te.order_id = o.order_id
       WHERE te.order_id = ? AND te.writer_id = ?`,
      [taskId, writerId]
    );

    if (!evaluation) {
      return res.status(403).json({ success: false, error: 'You are not assigned to this task' });
    }

    // Get files
    const [files] = await db.query(
      'SELECT id, file_url, file_name, file_size, created_at FROM file_versions WHERE order_id = ? ORDER BY created_at DESC',
      [taskId]
    );

    res.json({
      success: true,
      task: {
        ...evaluation,
        admin_notes: evaluation.comment,
        evaluation_status: evaluation.status,
        documents: files
      }
    });
  } catch (error) {
    console.error('Error fetching task detail:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Accept task as DOABLE
 */
exports.acceptTaskAssignment = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { taskId } = req.params;
    const writerId = req.user.user_id;
    const { comment = '' } = req.body;

    // Verify writer is assigned to this task via task_evaluations
    const [[evaluation]] = await connection.query(
      `SELECT te.*, o.paper_topic, o.query_code 
       FROM task_evaluations te
       JOIN orders o ON te.order_id = o.order_id
       WHERE te.order_id = ? AND te.writer_id = ? AND te.status = 'pending'`,
      [taskId, writerId]
    );

    if (!evaluation) {
      await connection.rollback();
      return res.status(403).json({ success: false, error: 'You are not assigned to this task or already responded' });
    }

    // Update task evaluation to accepted
    await connection.query(
      `UPDATE task_evaluations SET status = 'accepted', comment = CONCAT(IFNULL(comment, ''), '\nWriter accepted: ', ?), updated_at = NOW()
       WHERE order_id = ? AND writer_id = ?`,
      [comment, taskId, writerId]
    );

    // Create audit log
    await connection.query(
      `INSERT INTO audit_logs (user_id, event_type, action, resource_type, resource_id, details, created_at)
       VALUES (?, 'TASK_ACCEPTED', 'accept_task', 'order', ?, ?, NOW())`,
      [writerId, taskId, `Writer ${writerId} accepted order ${taskId}`]
    );

    // Notify admin
    const [adminUsers] = await connection.query(
      `SELECT user_id FROM users WHERE role = 'admin' LIMIT 1`
    );
    
    if (adminUsers.length > 0) {
      const adminId = adminUsers[0].user_id;
      const [notifResult] = await connection.query(
        `INSERT INTO notifications (user_id, title, message, type, link_url, is_read, created_at)
         VALUES (?, 'Writer Accepted Task', ?, 'task', ?, 0, NOW())`,
        [
          adminId,
          `Writer has accepted task: ${evaluation.paper_topic}`,
          `/admin/queries/${taskId}/view`
        ]
      );
      
      // Emit real-time notification via Socket.IO
      if (req.io) {
        req.io.to(`user:${adminId}`).emit('notification:new', {
          notification_id: notifResult.insertId,
          user_id: adminId,
          title: 'Writer Accepted Task',
          message: `Writer has accepted task: ${evaluation.paper_topic}`,
          type: 'task',
          link_url: `/admin/queries/${taskId}/view`,
          is_read: 0,
          created_at: new Date().toISOString()
        });
        req.io.to('role:admin').emit('notification:new', {
          notification_id: notifResult.insertId,
          user_id: adminId,
          title: 'Writer Accepted Task',
          message: `Writer has accepted task: ${evaluation.paper_topic}`,
          type: 'task',
          link_url: `/admin/queries/${taskId}/view`,
          is_read: 0,
          created_at: new Date().toISOString()
        });
      }
    }

    await connection.commit();

    res.json({ success: true, message: 'Task accepted successfully. You can now start working on it.' });
  } catch (error) {
    await connection.rollback();
    console.error('Error accepting task:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

/**
 * Reject task as NOT DOABLE
 */
exports.rejectTaskAssignment = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { taskId } = req.params;
    const writerId = req.user.user_id;
    const { reason = '' } = req.body;

    // Verify writer is assigned to this task via task_evaluations
    const [[evaluation]] = await connection.query(
      `SELECT te.*, o.paper_topic, o.query_code 
       FROM task_evaluations te
       JOIN orders o ON te.order_id = o.order_id
       WHERE te.order_id = ? AND te.writer_id = ? AND te.status = 'pending'`,
      [taskId, writerId]
    );

    if (!evaluation) {
      await connection.rollback();
      return res.status(403).json({ success: false, error: 'You are not assigned to this task or already responded' });
    }

    // Update task evaluation to rejected
    await connection.query(
      `UPDATE task_evaluations SET status = 'rejected', comment = CONCAT(IFNULL(comment, ''), '\nWriter rejected: ', ?), updated_at = NOW()
       WHERE order_id = ? AND writer_id = ?`,
      [reason, taskId, writerId]
    );

    // Create audit log
    await connection.query(
      `INSERT INTO audit_logs (user_id, event_type, action, resource_type, resource_id, details, created_at)
       VALUES (?, 'TASK_REJECTED', 'reject_task', 'order', ?, ?, NOW())`,
      [writerId, taskId, `Writer ${writerId} rejected order ${taskId}: ${reason}`]
    );

    // Notify admin about rejection
    const [adminUsers] = await connection.query(
      `SELECT user_id FROM users WHERE role = 'admin' LIMIT 1`
    );
    
    if (adminUsers.length > 0) {
      const adminId = adminUsers[0].user_id;
      const [notifResult] = await connection.query(
        `INSERT INTO notifications (user_id, title, message, type, link_url, is_read, created_at)
         VALUES (?, 'Writer Rejected Task', ?, 'warning', ?, 0, NOW())`,
        [
          adminId,
          `Writer rejected task: ${evaluation.paper_topic}. Reason: ${reason}`,
          `/admin/queries/${taskId}/view`
        ]
      );
      
      // Emit real-time notification via Socket.IO
      if (req.io) {
        req.io.to(`user:${adminId}`).emit('notification:new', {
          notification_id: notifResult.insertId,
          user_id: adminId,
          title: 'Writer Rejected Task',
          message: `Writer rejected task: ${evaluation.paper_topic}. Reason: ${reason}`,
          type: 'warning',
          link_url: `/admin/queries/${taskId}/view`,
          is_read: 0,
          created_at: new Date().toISOString()
        });
        req.io.to('role:admin').emit('notification:new', {
          notification_id: notifResult.insertId,
          user_id: adminId,
          title: 'Writer Rejected Task',
          message: `Writer rejected task: ${evaluation.paper_topic}. Reason: ${reason}`,
          type: 'warning',
          link_url: `/admin/queries/${taskId}/view`,
          is_read: 0,
          created_at: new Date().toISOString()
        });
      }
    }

    await connection.commit();

    res.json({ success: true, message: 'Task rejected. Admin has been notified.' });
  } catch (error) {
    await connection.rollback();
    console.error('Error rejecting task:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

// ============================================================================
// 3. TASK EXECUTION & STATUS UPDATES
// ============================================================================

/**
 * Get all active/in-progress tasks
 */
exports.getActiveTasks = async (req, res) => {
  try {
    const writerId = req.user.user_id;
    const { status } = req.query;

    let query = `
      SELECT 
        o.order_id, o.work_code, o.paper_topic as topic,
        o.service, o.subject, o.urgency, o.deadline_at,
        o.status as order_status,
        COALESCE(s.status, 'not_submitted') as status,
        TIMEDIFF(o.deadline_at, NOW()) as time_remaining,
        (SELECT COUNT(*) FROM submissions WHERE order_id = o.order_id) as submission_count
      FROM orders o
      JOIN task_evaluations te ON o.order_id = te.order_id
      LEFT JOIN submissions s ON o.order_id = s.order_id AND s.submission_id = (
        SELECT MAX(submission_id) FROM submissions WHERE order_id = o.order_id
      )
      WHERE o.writer_id = ? AND te.writer_id = ? AND te.status = 'assigned'
      AND o.status IN (30, 31, 32, 33, 34)
    `;

    if (status) {
      query += ` AND COALESCE(s.status, 'not_submitted') = ?`;
    }

    query += ` ORDER BY o.deadline_at ASC`;

    const params = [writerId, writerId];
    if (status) params.push(status);

    const [tasks] = await db.query(query, params);

    res.json({ success: true, tasks });
  } catch (error) {
    console.error('Error fetching active tasks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Update task status/progress
 */
exports.updateTaskStatus = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { taskId } = req.params;
    const writerId = req.user.user_id;
    const { newStatus, notes = '' } = req.body;

    const allowedStatuses = [30, 31, 32, 33, 34]; // In progress statuses
    const allowedStatusValues = ['in_progress', 'research_completed', 'writing_started', 'rework_in_progress'];

    if (!allowedStatusValues.includes(newStatus)) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    // Verify ownership
    const [[order]] = await connection.query(
      'SELECT * FROM orders WHERE order_id = ? AND writer_id = ? AND status IN (30, 31, 32, 33, 34)',
      [taskId, writerId]
    );

    if (!order) {
      await connection.rollback();
      return res.status(403).json({ success: false, error: 'Unauthorized or order not in progress' });
    }

    // Create audit log
    await connection.query(
      `INSERT INTO audit_logs (user_id, event_type, resource_type, resource_id, details, created_at)
       VALUES (?, 'STATUS_UPDATE', 'order', ?, ?, NOW())`,
      [writerId, taskId, `Status changed to ${newStatus}: ${notes}`]
    );

    await connection.commit();

    res.json({ success: true, message: 'Status updated successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Error updating status:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

// ============================================================================
// 4. FILE MANAGEMENT
// ============================================================================

/**
 * Upload file (draft/revision)
 */
exports.uploadFile = async (req, res) => {
  try {
    const { taskId } = req.params;
    const writerId = req.user.user_id;

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file provided' });
    }

    // Verify ownership
    const [[order]] = await db.query(
      'SELECT * FROM orders WHERE order_id = ? AND writer_id = ?',
      [taskId, writerId]
    );

    if (!order) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Get next version number
    const [[versionData]] = await db.query(
      'SELECT MAX(version_number) as maxVersion FROM file_versions WHERE order_id = ?',
      [taskId]
    );

    const nextVersion = (versionData.maxVersion || 0) + 1;

    // Insert file record
    await db.query(
      `INSERT INTO file_versions 
       (order_id, file_url, file_name, uploaded_by, file_size, version_number, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        taskId,
        `/uploads/writer-submissions/${req.file.filename}`,
        req.file.originalname,
        writerId,
        req.file.size,
        nextVersion
      ]
    );

    res.json({
      success: true,
      message: 'File uploaded successfully',
      file: {
        id: req.file.filename,
        version: nextVersion,
        size: req.file.size
      }
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get file history
 */
exports.getFileHistory = async (req, res) => {
  try {
    const { taskId } = req.params;
    const writerId = req.user.user_id;

    // Verify ownership
    const [[order]] = await db.query(
      'SELECT * FROM orders WHERE order_id = ? AND writer_id = ?',
      [taskId, writerId]
    );

    if (!order) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    const [files] = await db.query(
      `SELECT id, file_url, file_name, file_size, version_number, created_at
       FROM file_versions WHERE order_id = ? ORDER BY version_number DESC`,
      [taskId]
    );

    res.json({ success: true, files });
  } catch (error) {
    console.error('Error fetching file history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 5. QC SUBMISSION & FEEDBACK
// ============================================================================

/**
 * Submit draft for QC review
 */
exports.submitDraftForQC = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { taskId } = req.params;
    const writerId = req.user.user_id;
    const { fileId } = req.body;

    // Verify ownership
    const [[order]] = await connection.query(
      'SELECT * FROM orders WHERE order_id = ? AND writer_id = ?',
      [taskId, writerId]
    );

    if (!order) {
      await connection.rollback();
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Get file info
    const [[file]] = await connection.query(
      'SELECT * FROM file_versions WHERE order_id = ? AND id = ?',
      [taskId, fileId]
    );

    if (!file) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'File not found' });
    }

    // Create submission
    await connection.query(
      `INSERT INTO submissions (order_id, writer_id, file_url, status, created_at)
       VALUES (?, ?, ?, 'pending_qc', NOW())`,
      [taskId, writerId, file.file_url]
    );

    // Update order status to awaiting QC (33 - Pending QC)
    await connection.query(
      'UPDATE orders SET status = 33 WHERE order_id = ?',
      [taskId]
    );

    // Audit log
    await connection.query(
      `INSERT INTO audit_logs (user_id, event_type, resource_type, resource_id, details, created_at)
       VALUES (?, 'SUBMISSION_FOR_QC', 'order', ?, ?, NOW())`,
      [writerId, taskId, `Draft submitted for QC review`]
    );

    await connection.commit();

    // ============================================================================
    // CRITICAL NOTIFICATION TO ADMIN (Per Spec: Submit for QC triggers CRITICAL)
    // ============================================================================
    const { notifyDraftSubmitted } = require('./notifications.controller');
    await notifyDraftSubmitted(taskId, writerId, req.io);

    res.json({ success: true, message: 'Draft submitted for QC review' });
  } catch (error) {
    await connection.rollback();
    console.error('Error submitting draft:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

/**
 * Get QC feedback for order
 */
exports.getQCFeedback = async (req, res) => {
  try {
    const { taskId } = req.params;
    const writerId = req.user.user_id;

    // Verify ownership
    const [[order]] = await db.query(
      'SELECT * FROM orders WHERE order_id = ? AND writer_id = ?',
      [taskId, writerId]
    );

    if (!order) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Get latest submission with feedback
    const [[submission]] = await db.query(
      `SELECT * FROM submissions WHERE order_id = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [taskId]
    );

    if (!submission) {
      return res.json({ success: true, submission: null, feedback: [] });
    }

    // Get feedback from submission feedback field
    const feedback = submission.feedback ? JSON.parse(submission.feedback) : [];

    res.json({
      success: true,
      submission,
      feedback
    });
  } catch (error) {
    console.error('Error fetching QC feedback:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Submit revision after rejection
 */
exports.submitRevision = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { taskId } = req.params;
    const writerId = req.user.user_id;
    const { fileId } = req.body;

    // Verify ownership
    const [[order]] = await connection.query(
      'SELECT * FROM orders WHERE order_id = ? AND writer_id = ?',
      [taskId, writerId]
    );

    if (!order) {
      await connection.rollback();
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Check if last submission was rejected
    const [[lastSubmission]] = await connection.query(
      `SELECT * FROM submissions WHERE order_id = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [taskId]
    );

    if (!lastSubmission || lastSubmission.status !== 'revision_required') {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'No revision needed' });
    }

    // Get file info
    const [[file]] = await connection.query(
      'SELECT * FROM file_versions WHERE order_id = ? AND id = ?',
      [taskId, fileId]
    );

    if (!file) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'File not found' });
    }

    // Create new submission with revision
    await connection.query(
      `INSERT INTO submissions (order_id, writer_id, file_url, status, created_at)
       VALUES (?, ?, ?, 'pending_qc', NOW())`,
      [taskId, writerId, file.file_url]
    );

    // Audit log
    await connection.query(
      `INSERT INTO audit_logs (user_id, event_type, resource_type, resource_id, details, created_at)
       VALUES (?, 'REVISION_SUBMITTED', 'order', ?, ?, NOW())`,
      [writerId, taskId, `Revision submitted for QC review`]
    );

    await connection.commit();

    res.json({ success: true, message: 'Revision submitted for QC review' });
  } catch (error) {
    await connection.rollback();
    console.error('Error submitting revision:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

// ============================================================================
// 6. DEADLINES & ALERTS
// ============================================================================

/**
 * Get upcoming deadlines
 */
exports.checkUpcomingDeadlines = async (req, res) => {
  try {
    const writerId = req.user.user_id;
    const { hoursAhead = 48 } = req.query;

    const [deadlines] = await db.query(
      `SELECT order_id, work_code, paper_topic as topic, deadline_at, urgency
       FROM orders
       WHERE writer_id = ? AND status IN (3, 4)
       AND deadline_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? HOUR)
       ORDER BY deadline_at ASC`,
      [writerId, hoursAhead]
    );

    res.json({ success: true, deadlines });
  } catch (error) {
    console.error('Error checking deadlines:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 7. SECURITY & PERMISSIONS
// ============================================================================

/**
 * Validate chat access (writers can only chat with admin)
 */
exports.validateChatAccess = async (req, res) => {
  try {
    const writerId = req.user.user_id;
    const { recipientId } = req.params;

    // Check if recipient is admin
    const [[recipient]] = await db.query(
      'SELECT role FROM users WHERE user_id = ?',
      [recipientId]
    );

    if (!recipient || recipient.role !== 'admin') {
      return res.json({ success: false, message: 'Writers can only chat with admin' });
    }

    res.json({ success: true, message: 'Chat access allowed' });
  } catch (error) {
    console.error('Error validating chat access:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Check task permissions
 */
exports.checkTaskPermission = async (req, res) => {
  try {
    const { taskId } = req.params;
    const writerId = req.user.user_id;

    const [[order]] = await db.query(
      'SELECT * FROM orders WHERE order_id = ? AND writer_id = ?',
      [taskId, writerId]
    );

    if (!order) {
      return res.json({ success: false, permitted: false });
    }

    res.json({ success: true, permitted: true, order });
  } catch (error) {
    console.error('Error checking permissions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = exports;
