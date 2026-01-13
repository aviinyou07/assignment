const db = require('../config/db');
const { logAction } = require('../utils/logger');

/**
 * ASSIGNMENTS CONTROLLER
 * Handle writer assignments with proper user JOINs
 */

// List all assignments with pagination
exports.listAssignments = async (req, res) => {
  try {
    const { page = 0, status, dateFrom, dateTo } = req.query;
    const limit = 20;
    const offset = page * limit;

    let whereClause = '1=1';
    let params = [];

    if (status && status !== 'all') {
      whereClause += ' AND te.status = ?';
      params.push(status);
    }

    if (dateFrom) {
      whereClause += ' AND DATE(te.created_at) >= DATE(?)';
      params.push(dateFrom);
    }

    if (dateTo) {
      whereClause += ' AND DATE(te.created_at) <= DATE(?)';
      params.push(dateTo);
    }

    // Fetch assignments with user details JOINed
    const [assignments] = await db.query(
      `SELECT 
        te.id, te.order_id, te.writer_id,
        w.full_name as writer_name, w.email as writer_email,
        o.query_code, o.paper_topic as topic, u.full_name as client_name, u.email as client_email,
        te.status, te.comment, te.created_at
      FROM task_evaluations te
      JOIN users w ON te.writer_id = w.user_id
      LEFT JOIN orders o ON te.order_id = o.order_id
      LEFT JOIN users u ON o.user_id = u.user_id
      WHERE ${whereClause}
      ORDER BY te.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM task_evaluations te WHERE ${whereClause}`,
      params
    );

    const pages = Math.ceil(total / limit);

    res.render('admin/assignments/index', {
      title: 'Writer Assignments',
      page: parseInt(page) + 1,
      pages: pages,
      total: total,
      filters: { status: status || 'all' },
      records: assignments,
      currentPage: 'assignments'
    });
  } catch (error) {
    console.error('Error in listAssignments:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

// View assignment details
exports.viewAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const [[assignment]] = await db.query(
      `SELECT 
        te.id, te.order_id, te.writer_id,
        w.full_name as writer_name, w.email as writer_email, w.mobile_number as writer_phone,
        o.query_code, o.paper_topic as topic, o.deadline_at,
        u.full_name as client_name, u.email as client_email,
        te.status, te.comment, te.created_at, te.updated_at
      FROM task_evaluations te
      JOIN users w ON te.writer_id = w.user_id
      LEFT JOIN orders o ON te.order_id = o.order_id
      LEFT JOIN users u ON o.user_id = u.user_id
      WHERE te.id = ?`,
      [assignmentId]
    );

    if (!assignment) {
      return res.status(404).render('errors/404', { title: 'Assignment Not Found', layout: false });
    }

    res.render('admin/assignments/view', {
      title: 'Assignment Details',
      assignment: assignment,
      currentPage: 'assignments'
    });
  } catch (error) {
    console.error('Error in viewAssignment:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

// Update assignment status
exports.updateAssignmentStatus = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { status, comment } = req.body;
    const adminId = req.user.user_id;

    const [[task]] = await db.query('SELECT order_id FROM task_evaluations WHERE id = ?', [assignmentId]);

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task evaluation not found' });
    }

    await db.query(
      `UPDATE task_evaluations SET status = ?, comment = ?, updated_at = NOW() WHERE id = ?`,
      [status, comment, assignmentId]
    );

    // Log to audit
    await logAction({
        userId: adminId,
        action: 'assignment_updated',
        details: `Status changed to ${status}`,
        resource_type: 'order',
        resource_id: task.order_id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    
    res.json({ success: true, message: 'Assignment updated' });
  } catch (error) {
    console.error('Error in updateAssignmentStatus:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
