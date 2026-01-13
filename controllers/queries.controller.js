const db = require('../config/db');
const { logAction } = require('../utils/logger');

/**
 * QUERIES CONTROLLER (Orders)
 * Handles query/order management with proper user JOINs
 */

// List all queries with pagination
exports.listQueries = async (req, res) => {
  try {
    const { page = 0, status, dateFrom, dateTo } = req.query;
    const limit = 20;
    const offset = page * limit;

    let whereClause = '1=1';
    let params = [];

    if (status && status !== 'all') {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }

    if (dateFrom) {
      whereClause += ' AND DATE(o.created_at) >= DATE(?)';
      params.push(dateFrom);
    }

    if (dateTo) {
      whereClause += ' AND DATE(o.created_at) <= DATE(?)';
      params.push(dateTo);
    }

    // Fetch queries with user JOIN
    const [queries] = await db.query(
      `SELECT 
        o.order_id, o.query_code, o.user_id, u.full_name, u.email, u.mobile_number,
        o.paper_topic as topic, o.urgency, o.deadline_at as deadline, o.status, o.created_at
      FROM orders o
      JOIN users u ON o.user_id = u.user_id
      WHERE ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Get total count
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM orders o WHERE ${whereClause}`,
      params
    );

    const pages = Math.ceil(total / limit);

    res.render('admin/queries/index', {
      title: 'Query Management',
      page: parseInt(page) + 1,
      pages: pages,
      total: total,
      filters: { status: status || 'all' },
      records: queries,
      layout: 'layouts/admin'
    });
  } catch (error) {
    console.error('Error in listQueries:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

// View single query with details
exports.viewQuery = async (req, res) => {
  try {
    const { orderId } = req.params;

    // Get query details with user info
    const [[query]] = await db.query(
      `SELECT 
        o.order_id, o.query_code, o.user_id, u.full_name, u.email, u.mobile_number, u.university,
        o.paper_topic as topic, o.description, o.urgency, o.deadline_at as deadline, 
        o.status, o.created_at, o.basic_price_usd, o.total_price_usd, o.file_path
      FROM orders o
      JOIN users u ON o.user_id = u.user_id
      WHERE o.order_id = ?`,
      [orderId]
    );

    if (!query) {
      return res.status(404).render('errors/404', { title: 'Query Not Found', layout: false });
    }

    // Get file versions
    const [files] = await db.query(
      `SELECT id, file_name, file_url, version_number, uploaded_by, created_at 
       FROM file_versions 
       WHERE order_id = ?
       ORDER BY version_number DESC`,
      [String(orderId)]
    );

    res.render('admin/queries/view', {
      title: 'Query Details',
      query: query,
      files: files || [],
      layout: 'layouts/admin'
    });
  } catch (error) {
    console.error('Error in viewQuery:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

// Update query status
exports.updateQueryStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, notes } = req.body;
    const adminId = req.user.user_id;

    await db.query(
      `UPDATE orders SET status = ? WHERE order_id = ?`,
      [status, orderId]
    );

    // Log action
    await logAction({
      userId: adminId,
      action: 'status_updated',
      details: notes || `Status changed to ${status}`,
      resource_type: 'order',
      resource_id: orderId,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({ success: true, message: 'Query status updated' });
  } catch (error) {
    console.error('Error in updateQueryStatus:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
