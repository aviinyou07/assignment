/**
 * ENTERPRISE ORDER STATE MACHINE
 * Strict status transitions with role validation
 * All status changes must go through this validator
 */

const db = require('../config/db');
const { createAuditLog, createOrderHistory } = require('./audit');

// Status constants (from master_status table)
const STATUS = {
  PENDING_QUERY: 26,
  QUOTATION_SENT: 27,
  ACCEPTED: 28,
  AWAITING_VERIFICATION: 29,
  PAYMENT_VERIFIED: 30,
  WRITER_ASSIGNED: 31,
  IN_PROGRESS: 32,
  PENDING_QC: 33,
  APPROVED: 34,
  COMPLETED: 35,
  REVISION_REQUIRED: 36,
  DELIVERED: 37
};

// Status name mapping
const STATUS_NAMES = {
  26: 'Pending Query',
  27: 'Quotation Sent',
  28: 'Accepted',
  29: 'Awaiting Verification',
  30: 'Payment Verified',
  31: 'Writer Assigned',
  32: 'In Progress',
  33: 'Pending QC',
  34: 'Approved',
  35: 'Completed',
  36: 'Revision Required',
  37: 'Delivered'
};

// Reverse mapping for name to ID
const STATUS_IDS = Object.fromEntries(
  Object.entries(STATUS_NAMES).map(([id, name]) => [name.toUpperCase().replace(/ /g, '_'), parseInt(id)])
);

// Valid transitions per role (role -> currentStatus -> [allowedNextStatuses])
const VALID_TRANSITIONS = {
  client: {
    [STATUS.QUOTATION_SENT]: [STATUS.ACCEPTED],
    [STATUS.ACCEPTED]: [STATUS.AWAITING_VERIFICATION]
  },
  
  bde: {
    [STATUS.PENDING_QUERY]: [STATUS.QUOTATION_SENT]
  },
  
  writer: {
    [STATUS.WRITER_ASSIGNED]: [STATUS.IN_PROGRESS],
    [STATUS.IN_PROGRESS]: [STATUS.PENDING_QC],
    [STATUS.REVISION_REQUIRED]: [STATUS.PENDING_QC]
  },
  
  admin: {
    [STATUS.PENDING_QUERY]: [STATUS.QUOTATION_SENT],
    [STATUS.QUOTATION_SENT]: [STATUS.PENDING_QUERY, STATUS.ACCEPTED],
    [STATUS.ACCEPTED]: [STATUS.AWAITING_VERIFICATION, STATUS.QUOTATION_SENT],
    [STATUS.AWAITING_VERIFICATION]: [STATUS.PAYMENT_VERIFIED, STATUS.ACCEPTED],
    [STATUS.PAYMENT_VERIFIED]: [STATUS.WRITER_ASSIGNED],
    [STATUS.WRITER_ASSIGNED]: [STATUS.IN_PROGRESS, STATUS.PAYMENT_VERIFIED],
    [STATUS.IN_PROGRESS]: [STATUS.PENDING_QC, STATUS.WRITER_ASSIGNED],
    [STATUS.PENDING_QC]: [STATUS.APPROVED, STATUS.REVISION_REQUIRED],
    [STATUS.APPROVED]: [STATUS.DELIVERED, STATUS.REVISION_REQUIRED],
    [STATUS.REVISION_REQUIRED]: [STATUS.PENDING_QC, STATUS.WRITER_ASSIGNED],
    [STATUS.DELIVERED]: [STATUS.COMPLETED],
    [STATUS.COMPLETED]: [] // Terminal state - no transitions allowed
  }
};

// Actions that trigger specific status changes
const STATUS_ACTIONS = {
  // Client actions
  ACCEPT_QUOTATION: { role: 'client', from: STATUS.QUOTATION_SENT, to: STATUS.ACCEPTED },
  UPLOAD_PAYMENT: { role: 'client', from: STATUS.ACCEPTED, to: STATUS.AWAITING_VERIFICATION },
  
  // BDE actions
  GENERATE_QUOTATION: { role: 'bde', from: STATUS.PENDING_QUERY, to: STATUS.QUOTATION_SENT },
  
  // Writer actions
  START_WORK: { role: 'writer', from: STATUS.WRITER_ASSIGNED, to: STATUS.IN_PROGRESS },
  SUBMIT_FOR_QC: { role: 'writer', from: STATUS.IN_PROGRESS, to: STATUS.PENDING_QC },
  RESUBMIT_REVISION: { role: 'writer', from: STATUS.REVISION_REQUIRED, to: STATUS.PENDING_QC },
  
  // Admin actions
  VERIFY_PAYMENT: { role: 'admin', from: STATUS.AWAITING_VERIFICATION, to: STATUS.PAYMENT_VERIFIED },
  REJECT_PAYMENT: { role: 'admin', from: STATUS.AWAITING_VERIFICATION, to: STATUS.ACCEPTED },
  ASSIGN_WRITER: { role: 'admin', from: STATUS.PAYMENT_VERIFIED, to: STATUS.WRITER_ASSIGNED },
  APPROVE_QC: { role: 'admin', from: STATUS.PENDING_QC, to: STATUS.APPROVED },
  REJECT_QC: { role: 'admin', from: STATUS.PENDING_QC, to: STATUS.REVISION_REQUIRED },
  DELIVER: { role: 'admin', from: STATUS.APPROVED, to: STATUS.DELIVERED },
  COMPLETE: { role: 'admin', from: STATUS.DELIVERED, to: STATUS.COMPLETED }
};

/**
 * Validate status transition
 * 
 * @param {string} role - User role (client, bde, writer, admin)
 * @param {number} currentStatus - Current status ID
 * @param {number} newStatus - Desired new status ID
 * @returns {object} { valid: boolean, message: string }
 */
function validateTransition(role, currentStatus, newStatus) {
  const normalizedRole = role.toLowerCase();
  
  // Terminal state check
  if (currentStatus === STATUS.COMPLETED) {
    return {
      valid: false,
      code: 'TERMINAL_STATE',
      message: 'Order is completed and cannot be modified'
    };
  }
  
  const roleTransitions = VALID_TRANSITIONS[normalizedRole];
  
  if (!roleTransitions) {
    return {
      valid: false,
      code: 'INVALID_ROLE',
      message: `Unknown role: ${role}`
    };
  }
  
  const allowedNextStates = roleTransitions[currentStatus];
  
  if (!allowedNextStates) {
    return {
      valid: false,
      code: 'NO_TRANSITIONS',
      message: `${role} cannot modify orders in status: ${STATUS_NAMES[currentStatus] || currentStatus}`
    };
  }
  
  if (!allowedNextStates.includes(newStatus)) {
    const allowedNames = allowedNextStates.map(s => STATUS_NAMES[s]).join(', ');
    return {
      valid: false,
      code: 'INVALID_TRANSITION',
      message: `Invalid transition from "${STATUS_NAMES[currentStatus]}" to "${STATUS_NAMES[newStatus]}". Allowed transitions: ${allowedNames || 'none'}`
    };
  }
  
  return {
    valid: true,
    code: 'VALID',
    message: 'Transition allowed'
  };
}

/**
 * Get allowed next states for a role and current status
 * 
 * @param {string} role - User role
 * @param {number} currentStatus - Current status ID
 * @returns {array} Array of { id, name } objects
 */
function getAllowedNextStates(role, currentStatus) {
  const normalizedRole = role.toLowerCase();
  const roleTransitions = VALID_TRANSITIONS[normalizedRole];
  
  if (!roleTransitions || !roleTransitions[currentStatus]) {
    return [];
  }
  
  return roleTransitions[currentStatus].map(statusId => ({
    id: statusId,
    name: STATUS_NAMES[statusId]
  }));
}

/**
 * Execute action-based status transition
 * 
 * @param {string} action - Action name from STATUS_ACTIONS
 * @param {number} order_id - Order ID
 * @param {object} user - User object { user_id, role }
 * @param {object} metadata - Additional metadata
 * @returns {Promise<object>} Result with new status
 */
async function executeAction(action, order_id, user, metadata = {}) {
  const actionConfig = STATUS_ACTIONS[action];
  
  if (!actionConfig) {
    throw new Error(`Unknown action: ${action}`);
  }
  
  // Verify role is allowed for this action (admin can do anything)
  if (user.role !== 'admin' && user.role !== actionConfig.role) {
    throw new Error(`${user.role} cannot execute action: ${action}`);
  }
  
  // Get current order status
  const [[order]] = await db.query(
    `SELECT order_id, query_code, work_code, status, paper_topic, user_id, writer_id
     FROM orders WHERE order_id = ? LIMIT 1`,
    [order_id]
  );
  
  if (!order) {
    throw new Error('Order not found');
  }
  
  // Validate transition (admin override allowed for non-completed orders)
  if (user.role === 'admin') {
    if (order.status === STATUS.COMPLETED) {
      throw new Error('Cannot modify completed orders');
    }
  } else {
    // For non-admin, current status must match expected
    if (order.status !== actionConfig.from) {
      throw new Error(`Order is not in expected status. Expected: ${STATUS_NAMES[actionConfig.from]}, Current: ${STATUS_NAMES[order.status]}`);
    }
  }
  
  // Execute the transition
  const newStatus = actionConfig.to;
  
  await db.query(
    `UPDATE orders SET status = ? WHERE order_id = ?`,
    [newStatus, order_id]
  );
  
  // Create audit log
  await createAuditLog({
    user_id: user.user_id,
    role: user.role,
    event_type: `STATUS_CHANGE_${action}`,
    resource_type: 'order',
    resource_id: order_id,
    details: `Status changed from ${STATUS_NAMES[order.status]} to ${STATUS_NAMES[newStatus]} via ${action}`,
    ip_address: metadata.ip_address,
    user_agent: metadata.user_agent,
    event_data: {
      action,
      old_status: order.status,
      new_status: newStatus,
      query_code: order.query_code,
      work_code: order.work_code
    }
  });
  
  // Create order history entry
  await createOrderHistory({
    order_id,
    modified_by: user.user_id,
    modified_by_name: user.full_name || 'System',
    modified_by_role: user.role,
    action_type: action,
    description: `Status: ${STATUS_NAMES[order.status]} → ${STATUS_NAMES[newStatus]}`
  });
  
  return {
    success: true,
    order_id,
    old_status: {
      id: order.status,
      name: STATUS_NAMES[order.status]
    },
    new_status: {
      id: newStatus,
      name: STATUS_NAMES[newStatus]
    },
    action
  };
}

/**
 * Update order status with validation
 * 
 * @param {number} order_id - Order ID
 * @param {number} newStatus - New status ID
 * @param {object} user - User object
 * @param {object} metadata - Additional metadata
 * @returns {Promise<object>} Result
 */
async function updateOrderStatus(order_id, newStatus, user, metadata = {}) {
  // Get current order status
  const [[order]] = await db.query(
    `SELECT order_id, query_code, work_code, status, paper_topic
     FROM orders WHERE order_id = ? LIMIT 1`,
    [order_id]
  );
  
  if (!order) {
    throw new Error('Order not found');
  }
  
  // Validate transition
  const validation = validateTransition(user.role, order.status, newStatus);
  
  if (!validation.valid) {
    throw new Error(validation.message);
  }
  
  // Execute update
  await db.query(
    `UPDATE orders SET status = ? WHERE order_id = ?`,
    [newStatus, order_id]
  );
  
  // Create audit log
  await createAuditLog({
    user_id: user.user_id,
    role: user.role,
    event_type: 'STATUS_UPDATE',
    resource_type: 'order',
    resource_id: order_id,
    details: `Status changed from ${STATUS_NAMES[order.status]} to ${STATUS_NAMES[newStatus]}`,
    ip_address: metadata.ip_address,
    user_agent: metadata.user_agent,
    event_data: {
      old_status: order.status,
      new_status: newStatus,
      query_code: order.query_code,
      work_code: order.work_code
    }
  });
  
  return {
    success: true,
    order_id,
    old_status: {
      id: order.status,
      name: STATUS_NAMES[order.status]
    },
    new_status: {
      id: newStatus,
      name: STATUS_NAMES[newStatus]
    }
  };
}

/**
 * Check if order is in terminal state
 * 
 * @param {number} status - Status ID
 * @returns {boolean}
 */
function isTerminalState(status) {
  return status === STATUS.COMPLETED;
}

/**
 * Check if status is pre-payment (query phase)
 * 
 * @param {number} status - Status ID
 * @returns {boolean}
 */
function isPrePayment(status) {
  return [STATUS.PENDING_QUERY, STATUS.QUOTATION_SENT, STATUS.ACCEPTED, STATUS.AWAITING_VERIFICATION].includes(status);
}

/**
 * Check if status is post-payment (order phase)
 * 
 * @param {number} status - Status ID
 * @returns {boolean}
 */
function isPostPayment(status) {
  return status >= STATUS.PAYMENT_VERIFIED;
}

/**
 * Get order phase
 * 
 * @param {number} status - Status ID
 * @returns {string} 'query' | 'payment' | 'work' | 'qc' | 'delivery' | 'complete'
 */
function getOrderPhase(status) {
  if (status <= STATUS.QUOTATION_SENT) return 'query';
  if (status <= STATUS.AWAITING_VERIFICATION) return 'payment';
  if (status <= STATUS.IN_PROGRESS) return 'work';
  if (status <= STATUS.REVISION_REQUIRED) return 'qc';
  if (status === STATUS.DELIVERED) return 'delivery';
  return 'complete';
}

/**
 * Can user modify order
 * 
 * @param {string} role - User role
 * @param {number} status - Current status
 * @returns {boolean}
 */
function canModify(role, status) {
  if (isTerminalState(status)) return false;
  
  const roleTransitions = VALID_TRANSITIONS[role.toLowerCase()];
  return roleTransitions && roleTransitions[status] && roleTransitions[status].length > 0;
}

/**
 * Get status by name
 * 
 * @param {string} name - Status name
 * @returns {number|null} Status ID or null
 */
function getStatusByName(name) {
  const normalized = name.toUpperCase().replace(/ /g, '_');
  return STATUS_IDS[normalized] || STATUS[normalized] || null;
}

/**
 * Get status name by ID
 * 
 * @param {number} id - Status ID
 * @returns {string|null} Status name or null
 */
function getStatusName(id) {
  return STATUS_NAMES[id] || null;
}

/**
 * Middleware for status transition validation
 */
function validateStatusMiddleware(req, res, next) {
  return async (req, res, next) => {
    try {
      const { order_id, newStatus } = req.body;
      const role = req.user.role;
      
      if (!order_id || newStatus === undefined) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_PARAMS',
          message: 'order_id and newStatus are required'
        });
      }
      
      const [[order]] = await db.query(
        'SELECT status FROM orders WHERE order_id = ?',
        [order_id]
      );
      
      if (!order) {
        return res.status(404).json({
          success: false,
          code: 'ORDER_NOT_FOUND',
          message: 'Order not found'
        });
      }
      
      const validation = validateTransition(role, order.status, newStatus);
      
      if (!validation.valid) {
        return res.status(403).json({
          success: false,
          code: validation.code,
          message: validation.message
        });
      }
      
      req.orderStatus = order.status;
      next();
      
    } catch (error) {
      console.error('Status validation error:', error);
      return res.status(500).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Status validation failed'
      });
    }
  };
}

module.exports = {
  STATUS,
  STATUS_NAMES,
  STATUS_ACTIONS,
  VALID_TRANSITIONS,
  validateTransition,
  getAllowedNextStates,
  executeAction,
  updateOrderStatus,
  isTerminalState,
  isPrePayment,
  isPostPayment,
  getOrderPhase,
  canModify,
  getStatusByName,
  getStatusName,
  validateStatusMiddleware
};
