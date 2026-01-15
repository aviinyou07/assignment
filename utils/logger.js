const db = require('../config/db');

const redacted = (text) => {
  if (!text && text !== 0) return text;
  return String(text).replace(/\+?\d{6,}/g, (m) => {
    if (m.length <= 6) return '****';
    const prefix = m.slice(0, 3);
    const suffix = m.slice(-3);
    return `${prefix}****${suffix}`;
  });
};

function format(level, msg) {
  const t = new Date().toISOString();
  const text = typeof msg === 'string' ? msg : JSON.stringify(msg, (k, v) => (typeof v === 'string' ? redacted(v) : v));
  return `[${t}] [${level}] ${redacted(text)}`;
}

function info(msg) {
  console.log(format('INFO', msg));
}

function warn(msg) {
  console.warn(format('WARN', msg));
}

function error(msg) {
  console.error(format('ERROR', msg));
}

function debug(msg) {
  if ((process.env.NODE_ENV || 'development') === 'development') {
    console.debug(format('DEBUG', msg));
  }
}

/**
 * Persist an audit log to the database
 */
async function logAction({ userId, action, details, resource_type, resource_id, ip, userAgent, eventType }) {
  try {
    const event_type = eventType || action || 'system';
    await db.query(
      `INSERT INTO audit_logs (user_id, action, details, resource_type, resource_id, ip_address, user_agent, event_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [userId || null, action || null, details || null, resource_type || null, resource_id || null, ip || null, userAgent || null, event_type]
    );
  } catch (err) {
    console.error('[logger] Failed to write audit log:', err);
  }
}

module.exports = { info, warn, error, debug, logAction };
