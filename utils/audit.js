const db = require('../config/db');

/**
 * Create audit log entry for all critical actions
 * 
 * @param {object} data
 * @param {number} data.user_id
 * @param {string} data.role
 * @param {string} data.event_type
 * @param {string} data.resource_type
 * @param {number|string} data.resource_id
 * @param {string} data.details
 * @param {string} data.ip_address
 * @param {string} data.user_agent
 * @returns {Promise<void>}
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
  event_data
}) {
  try {
    await db.query(
      `INSERT INTO audit_logs 
       (user_id, event_type, event_data, resource_type, resource_id, ip_address, user_agent, action, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        user_id,
        event_type,
        event_data ? JSON.stringify(event_data) : null,
        resource_type,
        resource_id,
        ip_address,
        user_agent,
        event_type,
        details
      ]
    );
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw - audit failure shouldn't block operation
  }
}

/**
 * Create notification for user
 * Server-triggered only (never from frontend)
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
    throw error;
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
 * Get valid status transitions from master_status
 * 
 * @param {string} role - 'client', 'bde', 'writer', 'admin'
 * @returns {Promise<array>}
 */
async function getValidStatusesForRole(role) {
  try {
    const [statuses] = await db.query(
      `SELECT id, status_name FROM master_status 
       WHERE role = ? AND is_active = 1
       ORDER BY id ASC`,
      [role.charAt(0).toUpperCase() + role.slice(1)]
    );
    
    return statuses || [];
  } catch (error) {
    console.error('Error fetching valid statuses:', error);
    throw error;
  }
}

/**
 * Create order history entry for tracking admin actions
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
      [order_id, modified_by, modified_by_name, modified_by_role, action_type, description]
    );
    
    return result.insertId;
  } catch (error) {
    console.error('Error creating order history:', error);
    throw error;
  }
}

module.exports = {
  createAuditLog,
  createNotification,
  generateUniqueCode,
  getUserIfVerified,
  getWalletBalance,
  recordWalletTransaction,
  getValidStatusesForRole,
  createOrderHistory
};
