const db = require('../config/db');

/**
 *
 * @param {object} logData
 * @param {number} logData.userId
 * @param {string} logData.action
 * @param {string} logData.details
 * @param {string} logData.resource_type
 * @param {number|string} logData.resource_id
 * @param {string} logData.ip
 * @param {string} logData.userAgent
 */
async function logAction({ userId, action, details, resource_type, resource_id, ip, userAgent }) {
    try {
        await db.query(
          `INSERT INTO audit_logs (user_id, action, details, resource_type, resource_id, ip_address, user_agent, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [userId, action, details, resource_type, resource_id, ip, userAgent]
        );
    } catch (error) {
        console.error('Failed to log action:', error);
    }
}

/**
 * Log error message
 * @param {string} message
 * @param {Error} error
 */
function error(message, err) {
    console.error(`[ERROR] ${message}:`, err);
}

/**
 * Log info message
 * @param {string} message
 */
function info(message) {
    console.log(`[INFO] ${message}`);
}

/**
 * Log warning message
 * @param {string} message
 */
function warn(message) {
    console.warn(`[WARN] ${message}`);
}

module.exports = { logAction, error, info, warn };
