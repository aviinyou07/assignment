const db = require('../config/db');

/**
 * TASKS CONTROLLER
 * Monitor active tasks with proper user JOINs
 */

// List active tasks with pagination
exports.listActiveTasks = async (req, res) => {
  try {
    const { page = 0, status, dateFrom, dateTo } = req.query;
    const limit = 20;
    const offset = page * limit;

    let whereClause = '1=1';
    let params = [];

    if (status && status !== 'all') {
      whereClause += ' AND s.status = ?';
      params.push(status);
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
        s.status, s.feedback, s.created_at, s.updated_at
      FROM submissions s
      JOIN users w ON s.writer_id = w.user_id
      LEFT JOIN orders o ON s.order_id = o.order_id
      LEFT JOIN users u ON o.user_id = u.user_id
      WHERE ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM submissions s WHERE ${whereClause}`,
      params
    );

    const pages = Math.ceil(total / limit);

    res.render('admin/tasks/index', {
      title: 'Active Tasks',
      page: parseInt(page) + 1,
      pages: pages,
      total: total,
      filters: { status: status || 'all' },
      records: submissions,
      layout: 'layouts/admin'
    });
  } catch (error) {
    console.error('Error in listActiveTasks:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

// Get task progress details
exports.getTaskProgress = async (req, res) => {
  try {
    const { submissionId } = req.params;

    const [result] = await db.query(
      `SELECT 
        s.submission_id, s.order_id, s.writer_id,
        w.full_name as writer_name, w.email as writer_email,
        o.query_code, o.paper_topic as topic, o.deadline_at,
        u.full_name as client_name,
        s.status, s.grammarly_score, s.ai_score, s.plagiarism_score,
        s.feedback, s.created_at, s.updated_at
      FROM submissions s
      JOIN users w ON s.writer_id = w.user_id
      LEFT JOIN orders o ON s.order_id = o.order_id
      LEFT JOIN users u ON o.user_id = u.user_id
      WHERE s.submission_id = ?`,
      [submissionId]
    );

    if (!result[0]) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const submission = result[0];

    // Get file versions for this submission
    const [files] = await db.query(
      `SELECT id, file_name, file_url, version_number, created_at 
       FROM file_versions 
       WHERE order_id = ? 
       ORDER BY version_number DESC`,
      [String(submission.order_id)]
    );

    res.json({
      success: true,
      submission: submission,
      files: files || []
    });

  } catch (error) {
    console.error('Error in getTaskProgress:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get overdue tasks
exports.getOverdueTasks = async (req, res) => {
  try {
    const [overdue] = await db.query(
      `SELECT 
        s.submission_id, s.order_id, s.writer_id,
        w.full_name as writer_name, w.email as writer_email,
        o.query_code, o.paper_topic as topic, o.deadline_at,
        u.full_name as client_name,
        DATEDIFF(NOW(), o.deadline_at) as days_overdue,
        s.status, s.created_at
      FROM submissions s
      JOIN users w ON s.writer_id = w.user_id
      LEFT JOIN orders o ON s.order_id = o.order_id
      LEFT JOIN users u ON o.user_id = u.user_id
      WHERE o.deadline_at < NOW() AND s.status IN ('pending_qc', 'revision_required')
      ORDER BY o.deadline_at ASC`
    );

    res.json({ success: true, overdue: overdue });
  } catch (error) {
    console.error('Error in getOverdueTasks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get task statistics
exports.getTaskStatistics = async (req, res) => {
  try {
    const [[stats]] = await db.query(
      `SELECT 
        COUNT(*) as total_tasks,
        SUM(CASE WHEN s.status = 'pending_qc' THEN 1 ELSE 0 END) as pending_qc,
        SUM(CASE WHEN s.status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN s.status = 'revision_required' THEN 1 ELSE 0 END) as revision_required,
        AVG(DATEDIFF(s.updated_at, s.created_at)) as avg_completion_days
      FROM submissions s`
    );

    res.json({ success: true, statistics: stats });
  } catch (error) {
    console.error('Error in getTaskStatistics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
