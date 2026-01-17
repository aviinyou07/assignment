/**
 * ENTERPRISE ORDER STATE MACHINE
 * Strict status transitions with role validation
 * All status changes must go through this validator
 */

const db = require('../config/db');
const { createAuditLog, createOrderHistory } = require('./audit');

// Status constants (from master_status table)
const STATUS = {
  // Query Phase
  PENDING_QUERY: 26,
  QUOTATION_SENT: 27,
  ACCEPTED: 28,
  
  // Payment Phase
  AWAITING_50_PERCENT: 46,
  PARTIAL_PAYMENT_VERIFIED: 47,
  AWAITING_FINAL_PAYMENT: 48,
  PAYMENT_VERIFIED: 30,
  
  // Execution Phase
  WRITER_ASSIGNED: 31,
  IN_PROGRESS: 32,
  PENDING_QC: 33,
  
  // Delivery Phase
  APPROVED: 34,
  READY_FOR_DELIVERY: 49,
  COMPLETED: 35,
  REVISION_REQUIRED: 36,
  DELIVERED: 37,
  
  // Terminal/Error States (Admin Only)
  QUERY_REJECTED: 38,
  PAYMENT_REJECTED: 39,
  WRITER_REJECTED_TASK: 40,
  CANCELLED: 45
};

// Terminal states that cannot be modified (except by admin override)
const TERMINAL_STATES = [
  STATUS.COMPLETED,
  STATUS.QUERY_REJECTED,
  STATUS.CANCELLED
];

// Status name mapping
const STATUS_NAMES = {
  26: 'Pending Query',
  27: 'Quotation Sent',
  28: 'Accepted',
  29: 'Awaiting 50% Payment',
  30: '50% Payment Verified',
  31: 'Writer Assigned',
  32: 'In Progress',
  33: 'Pending QC',
  34: 'Approved',
  35: 'Completed',
  36: 'Revision Required',
  37: 'Delivered',
  38: 'Query Rejected',
  39: 'Payment Rejected',
  40: 'Writer Rejected Task',
  41: 'Cancelled',
  42: 'Awaiting Final Payment',
  43: 'Payment Verified',
  44: 'Research Completed',
  45: 'Writing Started',
  46: 'Awaiting 50% Payment',
  47: '50% Payment Verified',
  48: 'Awaiting Final Payment',
  49: 'Ready for Delivery'
};

// Notification triggers for status changes
const NOTIFICATION_TRIGGERS = {
  [STATUS.QUOTATION_SENT]: { targets: ['client'], type: 'info', severity: 'success', title: 'Quotation Ready' },
  [STATUS.ACCEPTED]: { targets: ['admin', 'bde'], type: 'info', severity: 'success', title: 'Quotation Accepted' },
  [STATUS.AWAITING_50_PERCENT]: { targets: ['client'], type: 'warning', severity: 'warning', title: '💰 50% Payment Required' },
  [STATUS.PARTIAL_PAYMENT_VERIFIED]: { targets: ['client', 'admin'], type: 'success', severity: 'success', title: '50% Payment Verified' },
  [STATUS.AWAITING_FINAL_PAYMENT]: { targets: ['client'], type: 'warning', severity: 'warning', title: '💰 Final Payment Required' },
  [STATUS.PAYMENT_VERIFIED]: { targets: ['client', 'admin'], type: 'success', severity: 'success', title: 'Payment Verified' },
  [STATUS.PAYMENT_REJECTED]: { targets: ['client'], type: 'critical', severity: 'critical', title: '⚠️ Payment Verification Failed' },
  [STATUS.WRITER_ASSIGNED]: { targets: ['writer', 'admin'], type: 'info', severity: 'warning', title: 'Task Assigned' },
  [STATUS.PENDING_QC]: { targets: ['admin'], type: 'warning', severity: 'warning', title: '📋 Submission Pending QC Review' },
  [STATUS.APPROVED]: { targets: ['writer', 'client'], type: 'success', severity: 'success', title: 'QC Approved' },
  [STATUS.REVISION_REQUIRED]: { targets: ['writer'], type: 'critical', severity: 'critical', title: '🔴 Revision Required' },
  [STATUS.DELIVERED]: { targets: ['client'], type: 'success', severity: 'success', title: '📦 Order Delivered' },
  [STATUS.COMPLETED]: { targets: ['client', 'writer'], type: 'success', severity: 'success', title: '✅ Order Completed' }
};

// Reverse mapping for name to ID
const STATUS_IDS = Object.fromEntries(
  Object.entries(STATUS_NAMES).map(([id, name]) => [name.toUpperCase().replace(/ /g, '_'), parseInt(id)])
);

// Valid transitions per role (role -> currentStatus -> [allowedNextStatuses])
const VALID_TRANSITIONS = {
  client: {
    [STATUS.QUOTATION_SENT]: [STATUS.ACCEPTED],
    [STATUS.ACCEPTED]: [STATUS.AWAITING_50_PERCENT],
    [STATUS.AWAITING_50_PERCENT]: [STATUS.PARTIAL_PAYMENT_VERIFIED],
    [STATUS.APPROVED]: [STATUS.AWAITING_FINAL_PAYMENT],
    [STATUS.AWAITING_FINAL_PAYMENT]: [STATUS.PAYMENT_VERIFIED]
  },
  
  bde: {
    [STATUS.PENDING_QUERY]: [STATUS.QUOTATION_SENT]
  },
  
  writer: {
    [STATUS.WRITER_ASSIGNED]: [STATUS.IN_PROGRESS],
    [STATUS.IN_PROGRESS]: [STATUS.PENDING_QC],
    [STATUS.REVISION_REQUIRED]: [STATUS.PENDING_QC]
  },
  
  // ADMIN has ABSOLUTE CONTROL - can override all transitions
  admin: {
    [STATUS.PENDING_QUERY]: [STATUS.QUOTATION_SENT, STATUS.QUERY_REJECTED],
    [STATUS.QUOTATION_SENT]: [STATUS.PENDING_QUERY, STATUS.ACCEPTED, STATUS.QUERY_REJECTED],
    [STATUS.ACCEPTED]: [STATUS.AWAITING_50_PERCENT, STATUS.QUOTATION_SENT, STATUS.QUERY_REJECTED],
    [STATUS.AWAITING_50_PERCENT]: [STATUS.PARTIAL_PAYMENT_VERIFIED, STATUS.PAYMENT_REJECTED, STATUS.ACCEPTED],
    [STATUS.PARTIAL_PAYMENT_VERIFIED]: [STATUS.WRITER_ASSIGNED],
    [STATUS.WRITER_ASSIGNED]: [STATUS.IN_PROGRESS, STATUS.PARTIAL_PAYMENT_VERIFIED, STATUS.WRITER_REJECTED_TASK],
    [STATUS.IN_PROGRESS]: [STATUS.PENDING_QC, STATUS.WRITER_ASSIGNED],
    [STATUS.PENDING_QC]: [STATUS.APPROVED, STATUS.REVISION_REQUIRED],
    [STATUS.APPROVED]: [STATUS.AWAITING_FINAL_PAYMENT, STATUS.REVISION_REQUIRED],
    [STATUS.AWAITING_FINAL_PAYMENT]: [STATUS.PAYMENT_VERIFIED, STATUS.PAYMENT_REJECTED, STATUS.APPROVED],
    [STATUS.PAYMENT_VERIFIED]: [STATUS.DELIVERED],
    [STATUS.REVISION_REQUIRED]: [STATUS.PENDING_QC, STATUS.WRITER_ASSIGNED],
    [STATUS.DELIVERED]: [STATUS.COMPLETED, STATUS.REVISION_REQUIRED],
    // Recovery paths from error states (Admin only)
    [STATUS.PAYMENT_REJECTED]: [STATUS.AWAITING_50_PERCENT, STATUS.AWAITING_FINAL_PAYMENT, STATUS.CANCELLED],
    [STATUS.WRITER_REJECTED_TASK]: [STATUS.WRITER_ASSIGNED, STATUS.CANCELLED],
    [STATUS.COMPLETED]: [] // Terminal state - requires admin override
  }
};

// Actions that trigger specific status changes
const STATUS_ACTIONS = {
  // Client actions
  ACCEPT_QUOTATION: { role: 'client', from: STATUS.QUOTATION_SENT, to: STATUS.ACCEPTED },
  REQUEST_50_PAYMENT: { role: 'client', from: STATUS.ACCEPTED, to: STATUS.AWAITING_50_PERCENT },
  UPLOAD_50_PAYMENT: { role: 'client', from: STATUS.AWAITING_50_PERCENT, to: STATUS.PARTIAL_PAYMENT_VERIFIED },
  REQUEST_FINAL_PAYMENT: { role: 'client', from: STATUS.APPROVED, to: STATUS.AWAITING_FINAL_PAYMENT },
  UPLOAD_FINAL_PAYMENT: { role: 'client', from: STATUS.AWAITING_FINAL_PAYMENT, to: STATUS.PAYMENT_VERIFIED },
  
  // BDE actions
  GENERATE_QUOTATION: { role: 'bde', from: STATUS.PENDING_QUERY, to: STATUS.QUOTATION_SENT },
  
  // Writer actions
  START_WORK: { role: 'writer', from: STATUS.WRITER_ASSIGNED, to: STATUS.IN_PROGRESS },
  SUBMIT_FOR_QC: { role: 'writer', from: STATUS.IN_PROGRESS, to: STATUS.PENDING_QC },
  RESUBMIT_REVISION: { role: 'writer', from: STATUS.REVISION_REQUIRED, to: STATUS.PENDING_QC },
  
  // Admin actions
  VERIFY_50_PAYMENT: { role: 'admin', from: STATUS.AWAITING_50_PERCENT, to: STATUS.PARTIAL_PAYMENT_VERIFIED },
  VERIFY_FINAL_PAYMENT: { role: 'admin', from: STATUS.AWAITING_FINAL_PAYMENT, to: STATUS.PAYMENT_VERIFIED },
  REJECT_50_PAYMENT: { role: 'admin', from: STATUS.AWAITING_50_PERCENT, to: STATUS.AWAITING_50_PERCENT },
  REJECT_FINAL_PAYMENT: { role: 'admin', from: STATUS.AWAITING_FINAL_PAYMENT, to: STATUS.AWAITING_FINAL_PAYMENT },
  ASSIGN_WRITER: { role: 'admin', from: STATUS.PARTIAL_PAYMENT_VERIFIED, to: STATUS.WRITER_ASSIGNED },
  APPROVE_QC: { role: 'admin', from: STATUS.PENDING_QC, to: STATUS.APPROVED },
  REJECT_QC: { role: 'admin', from: STATUS.PENDING_QC, to: STATUS.REVISION_REQUIRED },
  DELIVER: { role: 'admin', from: STATUS.PAYMENT_VERIFIED, to: STATUS.DELIVERED },
  COMPLETE: { role: 'admin', from: STATUS.DELIVERED, to: STATUS.COMPLETED }
};

/**
 * Validate status transition
 * 
 * @param {string} role - User role (client, bde, writer, admin)
 * @param {number} currentStatus - Current status ID
 * @param {number} newStatus - Desired new status ID
 * @param {boolean} isAdminOverride - Admin special override flag for terminal states
 * @returns {object} { valid: boolean, message: string, isOverride: boolean }
 */
function validateTransition(role, currentStatus, newStatus, isAdminOverride = false) {
  const normalizedRole = role.toLowerCase();
  
  // Terminal state check
  if (TERMINAL_STATES.includes(currentStatus)) {
    // Admin can override terminal states with special flag
    if (normalizedRole === 'admin' && isAdminOverride) {
      return {
        valid: true,
        code: 'ADMIN_OVERRIDE',
        message: 'Admin override: Reopening terminal state order',
        isOverride: true
      };
    }
    
    return {
      valid: false,
      code: 'TERMINAL_STATE',
      message: `Order is in terminal state: ${STATUS_NAMES[currentStatus]}. Cannot be modified.`
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
  return TERMINAL_STATES.includes(status);
}

/**
 * Get lifecycle phase for a status
 * 
 * @param {number} status - Status ID
 * @returns {string} 'QUERY' | 'PAYMENT' | 'EXECUTION' | 'DELIVERY' | 'TERMINAL'
 */
function getLifecyclePhase(status) {
  if ([STATUS.PENDING_QUERY, STATUS.QUOTATION_SENT, STATUS.ACCEPTED, STATUS.QUERY_REJECTED].includes(status)) {
    return 'QUERY';
  }
  if ([STATUS.AWAITING_VERIFICATION, STATUS.PAYMENT_VERIFIED, STATUS.PAYMENT_REJECTED].includes(status)) {
    return 'PAYMENT';
  }
  if ([STATUS.WRITER_ASSIGNED, STATUS.IN_PROGRESS, STATUS.PENDING_QC, STATUS.WRITER_REJECTED_TASK].includes(status)) {
    return 'EXECUTION';
  }
  if ([STATUS.APPROVED, STATUS.REVISION_REQUIRED, STATUS.DELIVERED, STATUS.COMPLETED].includes(status)) {
    return 'DELIVERY';
  }
  if (TERMINAL_STATES.includes(status)) {
    return 'TERMINAL';
  }
  return 'UNKNOWN';
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
  TERMINAL_STATES,
  NOTIFICATION_TRIGGERS,
  validateTransition,
  getAllowedNextStates,
  executeAction,
  updateOrderStatus,
  isTerminalState,
  isPrePayment,
  isPostPayment,
  getOrderPhase,
  getLifecyclePhase,
  canModify,
  getStatusByName,
  getStatusName,
  validateStatusMiddleware
};
