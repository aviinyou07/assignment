const db = require('../config/db');

/**
 * AUDIT LOGS CONTROLLER
 * Track all admin actions and generate audit trails
 */

exports.getAuditLogs = async (req, res) => {
  try {
    const { page = 0, action, userId, dateFrom, dateTo } = req.query;
    const limit = 50;
    const offset = page * limit;

    let whereClause = '1=1';
    let params = [];

    if (action && action !== 'all') {
      whereClause += ' AND action = ?';
      params.push(action);
    }

    if (userId) {
      whereClause += ' AND al.user_id = ?';
      params.push(userId);
    }

    if (dateFrom) {
      whereClause += ' AND DATE(al.created_at) >= DATE(?)';
      params.push(dateFrom);
    }

    if (dateTo) {
      whereClause += ' AND DATE(al.created_at) <= DATE(?)';
      params.push(dateTo);
    }

    const [logs] = await db.query(
      `SELECT 
        al.id, al.resource_id as order_id, al.action, al.details as description, al.user_id as created_by, 
        u.full_name, al.created_at
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.user_id
      WHERE ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM audit_logs al WHERE ${whereClause}`,
      params
    );

    res.render('admin/audit/index', {
      title: 'Audit Logs',
      logs,
      page: parseInt(page) + 1,
      pages: Math.ceil(total / limit),
      total,
      filters: { action: action || 'all' },
      currentPage: 'audit'
    });
  } catch (error) {
    console.error('Error listing audit logs:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

exports.getLogDetail = async (req, res) => {
  try {
    const { logId } = req.params;

    const [[log]] = await db.query(
      `SELECT 
        al.id, al.resource_id as order_id, al.action, al.details as description, al.user_id as created_by, u.full_name,
        al.created_at, al.ip_address, al.user_agent, al.event_data
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.user_id
      WHERE al.id = ?`,
      [logId]
    );

    if (!log) {
      return res.status(404).json({ success: false, error: 'Log not found' });
    }

    res.json({ success: true, log });
  } catch (error) {
    console.error('Error getting log detail:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getAvailableActions = async (req, res) => {
  try {
    const [actions] = await db.query(
      `SELECT DISTINCT action FROM audit_logs ORDER BY action ASC`,
      []
    );

    res.json({ success: true, actions });
  } catch (error) {
    console.error('Error getting actions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getAuditStats = async (req, res) => {
  try {
    const [[stats]] = await db.query(
      `SELECT 
        COUNT(*) as total_actions,
        COUNT(DISTINCT user_id) as unique_admins,
        COUNT(DISTINCT resource_id) as unique_orders,
        COUNT(CASE WHEN DATE(created_at) = CURDATE() THEN 1 END) as today_actions
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      []
    );

    const [actionBreakdown] = await db.query(
      `SELECT action, COUNT(*) as count
       FROM audit_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY action
       ORDER BY count DESC`,
      []
    );

    const [recentActions] = await db.query(
      `SELECT 
        action, COUNT(*) as count
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
      GROUP BY action
      ORDER BY count DESC`,
      []
    );

    res.json({
      success: true,
      stats,
      actionBreakdown,
      recentActions
    });
  } catch (error) {
    console.error('Error getting audit stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.exportAuditLogs = async (req, res) => {
  try {
    const { dateFrom, dateTo, action } = req.query;

    let whereClause = '1=1';
    let params = [];

    if (dateFrom) {
      whereClause += ' AND DATE(al.created_at) >= DATE(?)';
      params.push(dateFrom);
    }

    if (dateTo) {
      whereClause += ' AND DATE(al.created_at) <= DATE(?)';
      params.push(dateTo);
    }

    if (action && action !== 'all') {
      whereClause += ' AND al.action = ?';
      params.push(action);
    }

    const [logs] = await db.query(
      `SELECT 
        al.id, al.resource_id as order_id, al.action, al.details, al.user_id, u.full_name,
        al.created_at
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.user_id
      WHERE ${whereClause}
      ORDER BY al.created_at DESC`,
      params
    );

    // Generate CSV
    const headers = ['ID', 'Order ID', 'Action', 'Description', 'Admin', 'Timestamp'];
    const rows = logs.map(log => [
      log.id,
      log.order_id,
      log.action,
      log.details,
      log.full_name,
      log.created_at
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${Date.now()}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting audit logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// This function seems to be a way for an admin to manually log an action.
// It will now insert into the audit_logs table.
exports.recordAdminOverride = async (req, res) => {
  try {
    const { orderId, action, reason } = req.body;
    const userId = req.user.user_id;

    if (!orderId || !action) {
      return res.status(400).json({ success: false, error: 'Order ID and action required' });
    }

    await db.query(
      `INSERT INTO audit_logs (user_id, action, details, resource_type, resource_id, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, 'order', ?, ?, ?, NOW())`,
      [userId, `admin_override_${action}`, `Override reason: ${reason || 'N/A'}`, orderId, req.ip, req.get('User-Agent')]
    );

    res.json({ success: true, message: 'Admin override logged' });
  } catch (error) {
    console.error('Error recording override:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getUserActivityLog = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 0 } = req.query;
    const limit = 50;
    const offset = page * limit;

    const [logs] = await db.query(
      `SELECT 
        id, resource_id as order_id, action, details, created_at
      FROM audit_logs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM audit_logs WHERE user_id = ?`,
      [userId]
    );

    res.json({
      success: true,
      logs,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error getting user activity log:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getOrderAuditTrail = async (req, res) => {
  try {
    const { orderId } = req.params;

    const [trail] = await db.query(
      `SELECT 
        al.id, al.action, al.details, al.user_id, u.full_name, al.created_at
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.user_id
      WHERE al.resource_type = 'order' AND al.resource_id = ?
      ORDER BY al.created_at DESC`,
      [orderId]
    );

    res.json({ success: true, trail });
  } catch (error) {
    console.error('Error getting order audit trail:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};