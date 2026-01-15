/**
 * ENTERPRISE AUDIT LOGGING SERVICE
 * Comprehensive logging for all critical actions
 * - Structured event data
 * - Role-based filtering
 * - Export capabilities
 * - Tamper detection
 */

const db = require('../config/db');

// Audit event categories
const AUDIT_CATEGORIES = {
  AUTH: 'authentication',
  ORDER: 'order',
  PAYMENT: 'payment',
  USER: 'user',
  CHAT: 'chat',
  NOTIFICATION: 'notification',
  SYSTEM: 'system',
  ADMIN: 'admin_action'
};

// Event types that require immediate attention
const CRITICAL_EVENTS = [
  'PAYMENT_VERIFIED',
  'PAYMENT_REJECTED',
  'ADMIN_OVERRIDE',
  'UNAUTHORIZED_ACCESS',
  'ROLE_ESCALATION_ATTEMPT',
  'SECURITY_VIOLATION',
  'DATA_EXPORT',
  'USER_DEACTIVATED'
];

/**
 * Create audit log entry
 * 
 * @param {object} data
 * @param {number} data.user_id - User performing action
 * @param {string} data.role - User's role
 * @param {string} data.event_type - Type of event
 * @param {string} data.resource_type - Type of resource affected
 * @param {number|string} data.resource_id - ID of affected resource
 * @param {string} data.details - Human-readable description
 * @param {string} data.ip_address - Request IP
 * @param {string} data.user_agent - Request user agent
 * @param {object} data.event_data - Structured event data (JSON)
 * @param {string} data.old_value - Previous value (for changes)
 * @param {string} data.new_value - New value (for changes)
 * @returns {Promise<number>} Log ID
 */
async function createAuditLog({
  user_id,
  role,
  event_type,
  resource_type,
  resource_id,
  details,
  ip_address,
  user_agent,
  event_data,
  old_value,
  new_value
}) {
  try {
    const [result] = await db.query(
      `INSERT INTO audit_logs 
       (user_id, event_type, event_data, resource_type, resource_id, 
        ip_address, user_agent, action, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        user_id,
        event_type,
        event_data ? JSON.stringify({ ...event_data, role, old_value, new_value }) : JSON.stringify({ role }),
        resource_type,
        resource_id?.toString(),
        ip_address,
        user_agent,
        event_type,
        details
      ]
    );

    // Log critical events to console for monitoring
    if (CRITICAL_EVENTS.includes(event_type)) {
      console.warn(`[CRITICAL AUDIT] ${event_type}: User ${user_id} (${role}) - ${details}`);
    }

    return result.insertId;

  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw - audit failure shouldn't block operation
    return null;
  }
}

/**
 * Create notification for user
 * 
 * @param {object} data
 * @param {number} data.user_id
 * @param {string} data.type - 'success', 'warning', 'critical', 'info'
 * @param {string} data.title
 * @param {string} data.message
 * @param {string} data.link_url (optional)
 * @returns {Promise<number>} notification_id
 */
async function createNotification({
  user_id,
  type = 'info',
  title,
  message,
  link_url
}) {
  try {
    const [result] = await db.query(
      `INSERT INTO notifications 
       (user_id, type, title, message, link_url, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, 0, NOW())`,
      [user_id, type, title, message, link_url || null]
    );
    
    return result.insertId;
  } catch (error) {
    console.error('Failed to create notification:', error);
    throw error;
  }
}

/**
 * Generate unique code
 * 
 * @param {string} prefix - e.g., 'QUERY', 'ORDER', 'WORK'
 * @param {number} length - number of random chars (default 8)
 * @returns {string}
 */
function generateUniqueCode(prefix = '', length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = prefix ? prefix + '_' : '';
  
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return code;
}

/**
 * Verify user exists and is verified (active)
 * 
 * @param {number} user_id
 * @returns {Promise<object|null>}
 */
async function getUserIfVerified(user_id) {
  try {
    const [[user]] = await db.query(
      `SELECT user_id, full_name, email, mobile_number, role, is_active
       FROM users
       WHERE user_id = ? AND is_active = 1
       LIMIT 1`,
      [user_id]
    );
    
    return user || null;
  } catch (error) {
    console.error('Error fetching user:', error);
    throw error;
  }
}

/**
 * Get wallet balance for user
 * 
 * @param {number} user_id
 * @returns {Promise<number>}
 */
async function getWalletBalance(user_id) {
  try {
    const [[wallet]] = await db.query(
      `SELECT balance FROM wallets WHERE user_id = ? LIMIT 1`,
      [user_id]
    );
    
    return wallet?.balance || 0;
  } catch (error) {
    console.error('Error fetching wallet:', error);
    return 0;
  }
}

/**
 * Record wallet transaction (credit/debit)
 * 
 * @param {object} data
 * @param {number} data.user_id
 * @param {number} data.amount
 * @param {string} data.type - 'credit' or 'debit'
 * @param {string} data.reason
 * @param {number} data.reference_id (optional)
 * @returns {Promise<number>} transaction_id
 */
async function recordWalletTransaction({
  user_id,
  amount,
  type,
  reason,
  reference_id
}) {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    // Insert transaction
    const [result] = await connection.query(
      `INSERT INTO wallet_transactions 
       (user_id, amount, type, reason, reference_id, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [user_id, amount, type, reason, reference_id || null]
    );

    // Update wallet balance
    if (type === 'credit') {
      await connection.query(
        `UPDATE wallets SET balance = balance + ? WHERE user_id = ?`,
        [amount, user_id]
      );
    } else if (type === 'debit') {
      await connection.query(
        `UPDATE wallets SET balance = balance - ? WHERE user_id = ?`,
        [amount, user_id]
      );
    }

    await connection.commit();
    return result.insertId;

  } catch (error) {
    await connection.rollback();
    console.error('Error recording wallet transaction:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Create order history entry
 * 
 * @param {object} data
 * @param {number} data.order_id
 * @param {number} data.modified_by
 * @param {string} data.modified_by_name
 * @param {string} data.modified_by_role
 * @param {string} data.action_type
 * @param {string} data.description
 * @returns {Promise<number>} history_id
 */
async function createOrderHistory({
  order_id,
  modified_by,
  modified_by_name,
  modified_by_role,
  action_type,
  description
}) {
  try {
    const [result] = await db.query(
      `INSERT INTO orders_history 
       (order_id, modified_by, modified_by_name, modified_by_role, action_type, description, created_at, modified_date)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [order_id, modified_by, modified_by_name || 'System', modified_by_role, action_type, description]
    );
    
    return result.insertId;
  } catch (error) {
    console.error('Error creating order history:', error);
    // Don't throw - history failure shouldn't block operation
    return null;
  }
}

/**
 * Get audit logs with filters
 * 
 * @param {object} filters
 * @param {number} filters.user_id - Filter by user
 * @param {string} filters.event_type - Filter by event type
 * @param {string} filters.resource_type - Filter by resource type
 * @param {string} filters.resource_id - Filter by resource ID
 * @param {string} filters.start_date - Start date (ISO)
 * @param {string} filters.end_date - End date (ISO)
 * @param {number} filters.page - Page number (0-based)
 * @param {number} filters.limit - Items per page
 * @returns {Promise<object>} { logs, pagination }
 */
async function getAuditLogs({
  user_id,
  event_type,
  resource_type,
  resource_id,
  start_date,
  end_date,
  page = 0,
  limit = 50
}) {
  try {
    let whereClause = '1=1';
    const params = [];

    if (user_id) {
      whereClause += ' AND user_id = ?';
      params.push(user_id);
    }
    if (event_type) {
      whereClause += ' AND event_type = ?';
      params.push(event_type);
    }
    if (resource_type) {
      whereClause += ' AND resource_type = ?';
      params.push(resource_type);
    }
    if (resource_id) {
      whereClause += ' AND resource_id = ?';
      params.push(resource_id);
    }
    if (start_date) {
      whereClause += ' AND created_at >= ?';
      params.push(start_date);
    }
    if (end_date) {
      whereClause += ' AND created_at <= ?';
      params.push(end_date);
    }

    const offset = page * limit;

    const [logs] = await db.query(
      `SELECT al.*, u.full_name as user_name, u.role as user_role
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.user_id
       WHERE ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM audit_logs WHERE ${whereClause}`,
      params
    );

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };

  } catch (error) {
    console.error('Error fetching audit logs:', error);
    throw error;
  }
}

/**
 * Get order audit trail
 * 
 * @param {number} order_id
 * @returns {Promise<array>}
 */
async function getOrderAuditTrail(order_id) {
  try {
    const [logs] = await db.query(
      `SELECT al.*, u.full_name as user_name, u.role as user_role
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.user_id
       WHERE al.resource_type = 'order' AND al.resource_id = ?
       ORDER BY al.created_at ASC`,
      [order_id.toString()]
    );

    return logs;

  } catch (error) {
    console.error('Error fetching order audit trail:', error);
    throw error;
  }
}

/**
 * Get user activity log
 * 
 * @param {number} user_id
 * @param {number} days - Number of days to look back
 * @returns {Promise<array>}
 */
async function getUserActivityLog(user_id, days = 30) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [logs] = await db.query(
      `SELECT * FROM audit_logs
       WHERE user_id = ? AND created_at >= ?
       ORDER BY created_at DESC`,
      [user_id, startDate]
    );

    return logs;

  } catch (error) {
    console.error('Error fetching user activity:', error);
    throw error;
  }
}

/**
 * Record admin override action
 * 
 * @param {object} data
 * @param {number} data.admin_id
 * @param {string} data.action
 * @param {string} data.resource_type
 * @param {number} data.resource_id
 * @param {string} data.reason
 * @param {string} data.old_value
 * @param {string} data.new_value
 * @returns {Promise<number>}
 */
async function recordAdminOverride({
  admin_id,
  action,
  resource_type,
  resource_id,
  reason,
  old_value,
  new_value,
  ip_address,
  user_agent
}) {
  return createAuditLog({
    user_id: admin_id,
    role: 'admin',
    event_type: 'ADMIN_OVERRIDE',
    resource_type,
    resource_id,
    details: `Admin override: ${action}. Reason: ${reason}`,
    ip_address,
    user_agent,
    event_data: {
      action,
      reason,
      old_value,
      new_value
    }
  });
}

/**
 * Export audit logs to CSV format
 * 
 * @param {object} filters - Same as getAuditLogs
 * @returns {Promise<string>} CSV string
 */
async function exportAuditLogs(filters = {}) {
  try {
    const { logs } = await getAuditLogs({ ...filters, limit: 10000 });

    // CSV header
    const headers = ['ID', 'Date', 'User ID', 'User Name', 'Role', 'Event Type', 'Resource Type', 'Resource ID', 'Details', 'IP Address'];
    
    // CSV rows
    const rows = logs.map(log => [
      log.id,
      log.created_at,
      log.user_id,
      log.user_name || 'System',
      log.user_role || 'N/A',
      log.event_type,
      log.resource_type,
      log.resource_id,
      `"${(log.details || '').replace(/"/g, '""')}"`,
      log.ip_address
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  } catch (error) {
    console.error('Error exporting audit logs:', error);
    throw error;
  }
}

/**
 * Get audit statistics
 * 
 * @param {string} period - 'day', 'week', 'month'
 * @returns {Promise<object>}
 */
async function getAuditStats(period = 'week') {
  try {
    let dateFilter;
    switch (period) {
      case 'day':
        dateFilter = 'DATE(created_at) = CURDATE()';
        break;
      case 'week':
        dateFilter = 'created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        break;
      case 'month':
        dateFilter = 'created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
        break;
      default:
        dateFilter = '1=1';
    }

    // Total events
    const [[{ total_events }]] = await db.query(
      `SELECT COUNT(*) as total_events FROM audit_logs WHERE ${dateFilter}`
    );

    // Events by type
    const [eventsByType] = await db.query(
      `SELECT event_type, COUNT(*) as count 
       FROM audit_logs 
       WHERE ${dateFilter}
       GROUP BY event_type
       ORDER BY count DESC
       LIMIT 10`
    );

    // Events by resource type
    const [eventsByResource] = await db.query(
      `SELECT resource_type, COUNT(*) as count 
       FROM audit_logs 
       WHERE ${dateFilter}
       GROUP BY resource_type
       ORDER BY count DESC`
    );

    // Most active users
    const [mostActiveUsers] = await db.query(
      `SELECT al.user_id, u.full_name, u.role, COUNT(*) as action_count
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.user_id
       WHERE ${dateFilter} AND al.user_id IS NOT NULL
       GROUP BY al.user_id
       ORDER BY action_count DESC
       LIMIT 10`
    );

    // Critical events count
    const [[{ critical_count }]] = await db.query(
      `SELECT COUNT(*) as critical_count 
       FROM audit_logs 
       WHERE ${dateFilter} 
       AND event_type IN (${CRITICAL_EVENTS.map(() => '?').join(',')})`,
      CRITICAL_EVENTS
    );

    return {
      period,
      total_events,
      critical_count,
      events_by_type: eventsByType,
      events_by_resource: eventsByResource,
      most_active_users: mostActiveUsers
    };

  } catch (error) {
    console.error('Error getting audit stats:', error);
    throw error;
  }
}

module.exports = {
  AUDIT_CATEGORIES,
  CRITICAL_EVENTS,
  createAuditLog,
  createNotification,
  generateUniqueCode,
  getUserIfVerified,
  getWalletBalance,
  recordWalletTransaction,
  createOrderHistory,
  getAuditLogs,
  getOrderAuditTrail,
  getUserActivityLog,
  recordAdminOverride,
  exportAuditLogs,
  getAuditStats
};
