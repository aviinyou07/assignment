const db = require('../config/db');

exports.listActiveTasks = async (req, res) => {
  try {
    const { page = 0, status } = req.query;
    const limit = 20;
    const offset = page * limit;

    let whereClause = "1=1";
    let params = [];

    if (status && status !== 'all') {
      whereClause += " AND s.status = ?";
      params.push(status);
    } else {
      whereClause += " AND (s.status = 'pending_qc' OR s.status = 'revision_required')";
    }

    // Fetch active tasks
    const [tasks] = await db.query(
      `SELECT 
        s.submission_id as id, s.order_id, s.writer_id, u.full_name as writer_name,
        o.paper_topic as topic, o.deadline_at as deadline, s.status,
        s.created_at as submission_date, s.feedback as notes
      FROM submissions s
      JOIN users u ON s.writer_id = u.user_id
      JOIN orders o ON s.order_id = o.order_id
      WHERE ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Get total count
    const [[{ total }]] = await db.query(
      `SELECT COUNT(DISTINCT s.submission_id) as total FROM submissions s
       WHERE ${whereClause}`,
      params
    );

    const totalPages = Math.ceil(total / limit);

    res.render('admin/tasks/index', {
      title: 'Active Tasks Monitoring',
      tasks,
      page: parseInt(page) + 1,
      pages: totalPages,
      total,
      filters: { status: status || 'all' },
      layout: 'layouts/admin'
    });
  } catch (error) {
    console.error('Error listing tasks:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

// Get task progress details
exports.getTaskProgress = async (req, res) => {
  try {
    const { submissionId } = req.params;

    // Get submission details
    const [[submission]] = await db.query(
      `SELECT 
        s.submission_id, s.order_id, s.writer_id, u.full_name as writer_name, u.email as writer_email,
        o.query_code, o.paper_topic, o.deadline_at, o.user_id, c.full_name as client_name,
        s.status, s.created_at, s.file_url, s.feedback
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

    res.json({
      success: true,
      submission,
      deadline: submission.deadline_at
    });
  } catch (error) {
    console.error('Error getting task progress:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get all submissions for an order
exports.getOrderSubmissions = async (req, res) => {
  try {
    const { orderId } = req.params;

    // Get order details
    const [[order]] = await db.query(
      `SELECT order_id, query_code, paper_topic, deadline_at, status FROM orders WHERE order_id = ?`,
      [orderId]
    );

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Get all submissions for this order
    const [submissions] = await db.query(
      `SELECT 
        s.submission_id, s.order_id, s.writer_id, u.full_name as writer_name,
        s.status, s.created_at, s.file_url,
        s.grammarly_score, s.ai_score, s.plagiarism_score
      FROM submissions s
      JOIN users u ON s.writer_id = u.user_id
      WHERE s.order_id = ?
      ORDER BY s.created_at DESC`,
      [orderId]
    );

    res.json({
      success: true,
      order,
      submissions
    });
  } catch (error) {
    console.error('Error getting submissions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get overdue tasks
exports.getOverdueTasks = async (req, res) => {
  try {
    const [overdueTasks] = await db.query(
      `SELECT 
        s.submission_id, s.order_id, s.writer_id, u.full_name as writer_name,
        o.paper_topic, o.deadline_at, s.status,
        DATEDIFF(CURDATE(), o.deadline_at) as days_overdue
      FROM submissions s
      JOIN users u ON s.writer_id = u.user_id
      JOIN orders o ON s.order_id = o.order_id
      WHERE o.deadline_at < CURDATE() AND (s.status = 'pending_qc' OR s.status = 'revision_required')
      ORDER BY o.deadline_at ASC`,
      []
    );

    res.json({
      success: true,
      overdueTasks,
      count: overdueTasks.length
    });
  } catch (error) {
    console.error('Error getting overdue tasks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get task statistics
exports.getTaskStatistics = async (req, res) => {
  try {
    // Get overall stats
    const [[stats]] = await db.query(
      `SELECT 
        COUNT(CASE WHEN status = 'pending_qc' THEN 1 END) as pending_qc,
        COUNT(CASE WHEN status = 'revision_required' THEN 1 END) as revision_required,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed
      FROM submissions`,
      []
    );

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error getting task statistics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
