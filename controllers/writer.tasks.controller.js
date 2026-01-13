const db = require('../config/db');
const {
  createAuditLog,
  createNotification,
  createOrderHistory
} = require('../utils/audit');

/**
 * WRITER TASK CONTROLLER
 * 
 * Writer can:
 * - Accept/decline task
 * - Upload drafts and submissions
 * - Update task status (only valid transitions)
 * - Submit work for QC
 * 
 * Writer CANNOT:
 * - See pricing, payments, client details
 * - Approve/reject QC
 * - Assign themselves
 */

/**
 * GET ASSIGNED TASKS
 * Writer views all tasks assigned to them
 */
exports.getAssignedTasks = async (req, res) => {
  try {
    const writerId = req.user.user_id;
    const { page = 0, limit = 20, status } = req.query;
    const offset = parseInt(page) * parseInt(limit);

    let whereClause = 'o.writer_id = ?';
    let params = [writerId];

    if (status && status !== 'all') {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }

    // =======================
    // FETCH TASKS
    // =======================
    const [tasks] = await db.query(
      `SELECT 
        o.order_id,
        o.query_code,
        o.paper_topic,
        o.subject,
        o.urgency,
        o.description,
        o.deadline_at,
        o.status,
        o.created_at,
        ms.status_name,
        CASE WHEN te.id IS NOT NULL THEN te.status ELSE 'pending' END as evaluation_status
      FROM orders o
      LEFT JOIN master_status ms ON ms.id = o.status
      LEFT JOIN task_evaluations te ON te.order_id = o.order_id AND te.writer_id = ?
      WHERE ${whereClause}
      ORDER BY o.deadline_at ASC, o.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, writerId, parseInt(limit), offset]
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
        tasks,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: totalPages
        }
      }
    });

  } catch (err) {
    console.error('Error fetching tasks:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch assigned tasks'
    });
  }
};

/**
 * EVALUATE TASK (Accept/Decline)
 * Writer responds to task assignment
 * Status: doable or not_doable
 */
exports.evaluateTask = async (req, res) => {
  try {
    const writerId = req.user.user_id;
    const { order_id, status, comment } = req.body;

    if (!order_id || !status) {
      return res.status(400).json({
        success: false,
        message: 'Order ID and status (doable/not_doable) are required'
      });
    }

    if (!['doable', 'not_doable'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be "doable" or "not_doable"'
      });
    }

    // =======================
    // VERIFY WRITER ASSIGNED TO TASK
    // =======================
    const [[order]] = await db.query(
      `SELECT order_id, writer_id, user_id FROM orders WHERE order_id = ? LIMIT 1`,
      [order_id]
    );

    if (!order || order.writer_id !== writerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // =======================
    // CHECK IF ALREADY EVALUATED
    // =======================
    const [[existingEval]] = await db.query(
      `SELECT id FROM task_evaluations WHERE order_id = ? AND writer_id = ? LIMIT 1`,
      [order_id, writerId]
    );

    if (existingEval) {
      return res.status(400).json({
        success: false,
        message: 'Task already evaluated'
      });
    }

    // =======================
    // CREATE EVALUATION
    // =======================
    const [result] = await db.query(
      `INSERT INTO task_evaluations 
       (order_id, writer_id, status, comment, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [order_id, writerId, status, comment || null]
    );

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: writerId,
      role: 'writer',
      event_type: 'TASK_EVALUATED',
      resource_type: 'task',
      resource_id: order_id,
      details: `Writer evaluated task as: ${status}${comment ? '. Comment: ' + comment : ''}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { order_id, status, comment }
    });

    // =======================
    // SEND NOTIFICATIONS
    // =======================

    const notificationTitle = status === 'doable' ? 'Task Accepted' : 'Task Declined';
    const notificationType = status === 'doable' ? 'success' : 'warning';

    // Notify admin
    const [admins] = await db.query(
      `SELECT user_id FROM users WHERE role = 'Admin' AND is_active = 1 LIMIT 1`
    );

    if (admins.length > 0) {
      await createNotification({
        user_id: admins[0].user_id,
        type: notificationType,
        title: notificationTitle,
        message: `Writer ${status === 'doable' ? 'accepted' : 'declined'} task for order ${order_id}${comment ? '. Comment: ' + comment : ''}`,
        link_url: `/admin/orders/${order_id}`
      });
    }

    return res.json({
      success: true,
      message: `Task ${status === 'doable' ? 'accepted' : 'declined'}`,
      data: {
        evaluation_id: result.insertId,
        order_id,
        status
      }
    });

  } catch (err) {
    console.error('Error evaluating task:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to evaluate task'
    });
  }
};

/**
 * GET TASK DETAIL
 * Writer views task details (without client contact info)
 */
exports.getTaskDetail = async (req, res) => {
  try {
    const writerId = req.user.user_id;
    const { order_id } = req.params;

    // =======================
    // FETCH TASK (WITHOUT CLIENT DETAILS)
    // =======================
    const [[task]] = await db.query(
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
        o.created_at,
        ms.status_name
      FROM orders o
      LEFT JOIN master_status ms ON ms.id = o.status
      WHERE o.order_id = ? AND o.writer_id = ?
      LIMIT 1`,
      [order_id, writerId]
    );

    if (!task) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // =======================
    // FETCH UPLOADED FILES
    // =======================
    const [files] = await db.query(
      `SELECT id, file_name, file_url, version_number, uploaded_by, created_at
       FROM file_versions
       WHERE order_id = ?
       ORDER BY version_number DESC`,
      [order_id]
    );

    // =======================
    // FETCH TASK EVALUATION
    // =======================
    const [[evaluation]] = await db.query(
      `SELECT id, status, comment FROM task_evaluations WHERE order_id = ? AND writer_id = ? LIMIT 1`,
      [order_id, writerId]
    );

    return res.json({
      success: true,
      data: {
        task,
        files: files || [],
        evaluation: evaluation || null
      }
    });

  } catch (err) {
    console.error('Error fetching task:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch task'
    });
  }
};

/**
 * UPLOAD DRAFT/WORK FILE
 * Writer uploads drafts during task execution
 * Creates new file_version entry
 */
exports.uploadWorkFile = async (req, res) => {
  try {
    const writerId = req.user.user_id;
    const { order_id } = req.body;

    if (!order_id) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    if (!req.files || !req.files.file) {
      return res.status(400).json({
        success: false,
        message: 'Work file is required'
      });
    }

    const file = req.files.file;

    // =======================
    // VERIFY WRITER ASSIGNED
    // =======================
    const [[order]] = await db.query(
      `SELECT order_id, writer_id FROM orders WHERE order_id = ? LIMIT 1`,
      [order_id]
    );

    if (!order || order.writer_id !== writerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // =======================
    // GET NEXT VERSION NUMBER
    // =======================
    const [[lastVersion]] = await db.query(
      `SELECT COALESCE(MAX(version_number), 0) + 1 as next_version
       FROM file_versions
       WHERE order_id = ?`,
      [order_id]
    );

    const nextVersion = lastVersion?.next_version || 1;

    // =======================
    // INSERT FILE VERSION
    // =======================
    const [result] = await db.query(
      `INSERT INTO file_versions 
       (order_id, file_url, file_name, uploaded_by, file_size, version_number, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [order_id, file.path, file.originalname, writerId, file.size, nextVersion]
    );

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: writerId,
      role: 'writer',
      event_type: 'WORK_FILE_UPLOADED',
      resource_type: 'file',
      resource_id: result.insertId,
      details: `Writer uploaded work file v${nextVersion} for order ${order_id}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    return res.status(201).json({
      success: true,
      message: 'Work file uploaded successfully',
      data: {
        file_id: result.insertId,
        order_id,
        version: nextVersion,
        file_name: file.originalname
      }
    });

  } catch (err) {
    console.error('Error uploading work file:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload work file'
    });
  }
};

/**
 * SUBMIT WORK FOR QC
 * Writer submits completed work
 * Creates submission record with pending_qc status
 */
exports.submitWork = async (req, res) => {
  try {
    const writerId = req.user.user_id;
    const { order_id, file_id } = req.body;

    if (!order_id || !file_id) {
      return res.status(400).json({
        success: false,
        message: 'Order ID and file ID are required'
      });
    }

    // =======================
    // VERIFY FILE EXISTS AND BELONGS TO ORDER
    // =======================
    const [[file]] = await db.query(
      `SELECT id, file_url FROM file_versions WHERE id = ? AND order_id = ? LIMIT 1`,
      [file_id, order_id]
    );

    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // =======================
    // VERIFY WRITER ASSIGNED
    // =======================
    const [[order]] = await db.query(
      `SELECT order_id, writer_id FROM orders WHERE order_id = ? LIMIT 1`,
      [order_id]
    );

    if (!order || order.writer_id !== writerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // =======================
    // CHECK IF ALREADY SUBMITTED
    // =======================
    const [[existingSubmission]] = await db.query(
      `SELECT submission_id FROM submissions WHERE order_id = ? AND writer_id = ? AND status != 'revision_required' LIMIT 1`,
      [order_id, writerId]
    );

    if (existingSubmission) {
      return res.status(400).json({
        success: false,
        message: 'Work already submitted for QC'
      });
    }

    // =======================
    // CREATE SUBMISSION
    // =======================
    const [result] = await db.query(
      `INSERT INTO submissions 
       (order_id, writer_id, file_url, status, created_at)
       VALUES (?, ?, ?, 'pending_qc', NOW())`,
      [order_id, writerId, file.file_url]
    );

    // =======================
    // CREATE ORDER HISTORY
    // =======================
    await createOrderHistory({
      order_id: order_id,
      modified_by: writerId,
      modified_by_name: 'Writer',
      modified_by_role: 'Writer',
      action_type: 'WORK_SUBMITTED',
      description: 'Writer submitted work for QC'
    });

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: writerId,
      role: 'writer',
      event_type: 'WORK_SUBMITTED',
      resource_type: 'submission',
      resource_id: result.insertId,
      details: `Writer submitted work for order ${order_id}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { order_id, file_id }
    });

    // =======================
    // SEND NOTIFICATIONS
    // =======================

    // Notify admin
    const [admins] = await db.query(
      `SELECT user_id FROM users WHERE role = 'Admin' AND is_active = 1 LIMIT 1`
    );

    if (admins.length > 0) {
      await createNotification({
        user_id: admins[0].user_id,
        type: 'critical',
        title: 'Submission Received',
        message: `Writer submitted work for order ${order_id}. Awaiting QC.`,
        link_url: `/admin/qc/${result.insertId}`
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Work submitted for QC',
      data: {
        submission_id: result.insertId,
        order_id,
        status: 'pending_qc'
      }
    });

  } catch (err) {
    console.error('Error submitting work:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit work'
    });
  }
};

module.exports = exports;
