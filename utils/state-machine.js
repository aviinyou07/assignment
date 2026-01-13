/**
 * STATE MACHINE VALIDATOR
 * 
 * Enforces strict status transitions based on role and current state.
 * No status skipping allowed.
 * 
 * Status IDs (from master_status):
 * 26 - Pending Query (NEW)
 * 27 - Quotation Sent
 * 28 - Accepted (quotation accepted by client)
 * 29 - Awaiting Verification (payment uploaded)
 * 30 - Payment Verified
 * 31 - Writer Assigned
 * 32 - In Progress
 * 33 - Pending QC
 * 34 - Approved (QC passed)
 * 35 - Completed
 * 36 - Revision Required
 * 37 - Delivered
 */

const db = require('../config/db');

// Status mapping for reference
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

// Valid transitions per role
const VALID_TRANSITIONS = {
  // Client can only make limited state changes
  client: {
    [STATUS.QUOTATION_SENT]: [STATUS.ACCEPTED],                    // Accept quotation
    [STATUS.ACCEPTED]: [STATUS.AWAITING_VERIFICATION]              // Upload payment
  },
  
  // BDE can manage queries up to quotation
  bde: {
    [STATUS.PENDING_QUERY]: [STATUS.QUOTATION_SENT],               // Generate quotation
    [STATUS.QUOTATION_SENT]: [STATUS.PENDING_QUERY]                // Revoke quotation (if needed)
  },
  
  // Writer can update task progress
  writer: {
    [STATUS.WRITER_ASSIGNED]: [STATUS.IN_PROGRESS],                // Start working
    [STATUS.IN_PROGRESS]: [STATUS.PENDING_QC],                     // Submit for QC
    [STATUS.REVISION_REQUIRED]: [STATUS.PENDING_QC]                // Resubmit after revision
  },
  
  // Admin has full control
  admin: {
    [STATUS.PENDING_QUERY]: [STATUS.QUOTATION_SENT],
    [STATUS.QUOTATION_SENT]: [STATUS.PENDING_QUERY, STATUS.ACCEPTED],
    [STATUS.ACCEPTED]: [STATUS.AWAITING_VERIFICATION],
    [STATUS.AWAITING_VERIFICATION]: [STATUS.PAYMENT_VERIFIED, STATUS.ACCEPTED],
    [STATUS.PAYMENT_VERIFIED]: [STATUS.WRITER_ASSIGNED],
    [STATUS.WRITER_ASSIGNED]: [STATUS.IN_PROGRESS, STATUS.PAYMENT_VERIFIED],
    [STATUS.IN_PROGRESS]: [STATUS.PENDING_QC, STATUS.WRITER_ASSIGNED],
    [STATUS.PENDING_QC]: [STATUS.APPROVED, STATUS.REVISION_REQUIRED],
    [STATUS.APPROVED]: [STATUS.DELIVERED, STATUS.REVISION_REQUIRED],
    [STATUS.REVISION_REQUIRED]: [STATUS.PENDING_QC, STATUS.WRITER_ASSIGNED],
    [STATUS.DELIVERED]: [STATUS.COMPLETED],
    [STATUS.COMPLETED]: []  // Terminal state
  }
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
  
  // Admin can override all (except completed orders)
  if (normalizedRole === 'admin' && currentStatus === STATUS.COMPLETED) {
    return {
      valid: false,
      message: 'Completed orders cannot be modified'
    };
  }
  
  // Get allowed transitions for this role
  const roleTransitions = VALID_TRANSITIONS[normalizedRole];
  
  if (!roleTransitions) {
    return {
      valid: false,
      message: `Unknown role: ${role}`
    };
  }
  
  const allowedNextStates = roleTransitions[currentStatus];
  
  if (!allowedNextStates) {
    return {
      valid: false,
      message: `${role} cannot modify orders in status: ${STATUS_NAMES[currentStatus] || currentStatus}`
    };
  }
  
  if (!allowedNextStates.includes(newStatus)) {
    return {
      valid: false,
      message: `Invalid transition from "${STATUS_NAMES[currentStatus]}" to "${STATUS_NAMES[newStatus]}". Allowed: ${allowedNextStates.map(s => STATUS_NAMES[s]).join(', ') || 'none'}`
    };
  }
  
  return {
    valid: true,
    message: 'Transition allowed'
  };
}

/**
 * Get allowed next states for a role and current status
 * 
 * @param {string} role - User role
 * @param {number} currentStatus - Current status ID
 * @returns {array} Array of allowed next status IDs
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
 * Check if order is in terminal state
 * 
 * @param {number} status - Status ID
 * @returns {boolean}
 */
function isTerminalState(status) {
  return status === STATUS.COMPLETED;
}

/**
 * Check if order can be modified by role
 * 
 * @param {string} role - User role
 * @param {number} status - Current status ID
 * @returns {boolean}
 */
function canModify(role, status) {
  if (isTerminalState(status)) {
    return false;
  }
  
  const roleTransitions = VALID_TRANSITIONS[role.toLowerCase()];
  return roleTransitions && roleTransitions[status] && roleTransitions[status].length > 0;
}

/**
 * Middleware for status transition validation
 */
function validateStatusTransitionMiddleware(req, res, next) {
  return async (req, res, next) => {
    try {
      const { order_id, newStatus } = req.body;
      const role = req.user.role;
      
      if (!order_id || !newStatus) {
        return res.status(400).json({
          success: false,
          message: 'order_id and newStatus are required'
        });
      }
      
      // Get current order status
      const [[order]] = await db.query(
        'SELECT status FROM orders WHERE order_id = ?',
        [order_id]
      );
      
      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }
      
      const validation = validateTransition(role, order.status, newStatus);
      
      if (!validation.valid) {
        return res.status(403).json({
          success: false,
          message: validation.message
        });
      }
      
      req.orderStatus = order.status;
      next();
      
    } catch (error) {
      console.error('Status validation error:', error);
      return res.status(500).json({
        success: false,
        message: 'Status validation failed'
      });
    }
  };
}

module.exports = {
  STATUS,
  STATUS_NAMES,
  validateTransition,
  getAllowedNextStates,
  isTerminalState,
  canModify,
  validateStatusTransitionMiddleware
};
