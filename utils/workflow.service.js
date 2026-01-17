/**
 * ENTERPRISE WORKFLOW SERVICE
 * 
 * Orchestrates the complete order lifecycle:
 * Query → Quotation → Payment → Work Code → Execution → QC → Delivery → Closure
 * 
 * Every step:
 * - Updates status
 * - Fires notifications
 * - Unlocks/locks permissions
 * - Logs chat + history
 * - Triggers deadlines & reminders
 */

const db = require('../config/db');
const { STATUS, STATUS_NAMES, CLIENT_VISIBLE_STATUSES, validateTransition } = require('./state-machine');
const { createAuditLog, createNotification, createOrderHistory, generateWorkCode } = require('./audit');
const notificationService = require('./notification.service');
const logger = require('./logger');

// Notification severity levels
const SEVERITY = {
  SUCCESS: 'success',
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical'
};

/**
 * WORKFLOW EVENTS - What triggers notifications
 */
const WORKFLOW_EVENTS = {
  // Query Phase
  QUERY_CREATED: {
    status: STATUS.PENDING_QUERY,
    notifications: {
      client: { type: SEVERITY.SUCCESS, title: 'Query Received Successfully', priority: 'normal' },
      admin: { type: SEVERITY.INFO, title: 'New Query Generated', priority: 'high' },
      bde: { type: SEVERITY.INFO, title: 'New Query Requires Quotation', priority: 'high' }
    }
  },
  
  QUOTATION_GENERATED: {
    status: STATUS.QUOTATION_SENT,
    notifications: {
      client: { type: SEVERITY.SUCCESS, title: 'Quotation Ready', priority: 'high' },
      admin: { type: SEVERITY.INFO, title: 'Quotation Generated', priority: 'normal' }
    }
  },
  
  QUOTATION_ACCEPTED: {
    status: STATUS.ACCEPTED,
    notifications: {
      client: { type: SEVERITY.SUCCESS, title: 'Quotation Accepted', priority: 'normal' },
      admin: { type: SEVERITY.INFO, title: 'Quotation Accepted by Client', priority: 'high' },
      bde: { type: SEVERITY.SUCCESS, title: 'Your Quotation Accepted!', priority: 'high' }
    }
  },
  
  // Payment Phase
  PAYMENT_50_REQUESTED: {
    status: STATUS.AWAITING_50_PERCENT,
    notifications: {
      client: { type: SEVERITY.WARNING, title: '💰 50% Payment Required', priority: 'high' },
      admin: { type: SEVERITY.INFO, title: 'Client Ready for 50% Payment', priority: 'normal' },
      bde: { type: SEVERITY.INFO, title: 'Client Ready for 50% Payment', priority: 'normal' }
    },
    reminder: { interval: 60, max: 3 } // Remind every hour for 3 hours
  },
  
  PAYMENT_50_UPLOADED: {
    status: STATUS.AWAITING_50_PERCENT,
    notifications: {
      client: { type: SEVERITY.SUCCESS, title: '50% Payment Receipt Received', priority: 'normal' },
      admin: { type: SEVERITY.CRITICAL, title: '🔔 50% PAYMENT VERIFICATION REQUIRED', priority: 'critical' },
      bde: { type: SEVERITY.CRITICAL, title: '🔔 50% Payment Verification Required', priority: 'critical' }
    },
    reminder: { interval: 30, max: 4 } // Repeat every 30 mins until action
  },
  
  PAYMENT_50_VERIFIED: {
    status: STATUS.PARTIAL_PAYMENT_VERIFIED,
    notifications: {
      client: { type: SEVERITY.SUCCESS, title: '50% Payment Verified! Work Starting Soon', priority: 'high' },
      admin: { type: SEVERITY.SUCCESS, title: '50% Payment Verified', priority: 'normal' },
      bde: { type: SEVERITY.SUCCESS, title: '50% Payment Verified', priority: 'normal' }
    }
  },
  
  PAYMENT_FINAL_REQUESTED: {
    status: STATUS.AWAITING_FINAL_PAYMENT,
    notifications: {
      client: { type: SEVERITY.WARNING, title: '💰 Final 50% Payment Required', priority: 'high' },
      admin: { type: SEVERITY.INFO, title: 'Client Ready for Final Payment', priority: 'normal' }
    },
    reminder: { interval: 60, max: 3 } // Remind every hour for 3 hours
  },
  
  PAYMENT_FINAL_UPLOADED: {
    status: STATUS.AWAITING_FINAL_PAYMENT,
    notifications: {
      client: { type: SEVERITY.SUCCESS, title: 'Final Payment Receipt Received', priority: 'normal' },
      admin: { type: SEVERITY.CRITICAL, title: '🔔 FINAL PAYMENT VERIFICATION REQUIRED', priority: 'critical' }
    },
    reminder: { interval: 30, max: 4 } // Repeat every 30 mins until action
  },
  
  PAYMENT_VERIFIED: {
    status: STATUS.PAYMENT_VERIFIED,
    notifications: {
      client: { type: SEVERITY.SUCCESS, title: 'Payment Verified! Content Ready', priority: 'high' },
      admin: { type: SEVERITY.SUCCESS, title: 'Final Payment Verified', priority: 'normal' }
    }
  },
  
  PAYMENT_REJECTED: {
    status: STATUS.PAYMENT_REJECTED,
    notifications: {
      client: { type: SEVERITY.CRITICAL, title: '⚠️ Payment Verification Failed', priority: 'critical' }
    }
  },
  
  // Writer Assignment Phase
  WRITER_ASSIGNED: {
    status: STATUS.WRITER_ASSIGNED,
    notifications: {
      writer: { type: SEVERITY.INFO, title: 'New Task Assigned', priority: 'high' },
      admin: { type: SEVERITY.INFO, title: 'Writer Assigned', priority: 'normal' }
    }
  },
  
  TASK_ACCEPTED: {
    status: STATUS.IN_PROGRESS,
    notifications: {
      admin: { type: SEVERITY.SUCCESS, title: 'Task Accepted by Writer', priority: 'normal' }
    }
  },
  
  TASK_REJECTED: {
    status: STATUS.WRITER_ASSIGNED, // Stays at same status, needs reassignment
    notifications: {
      admin: { type: SEVERITY.WARNING, title: '⚠️ Task Rejected by Writer', priority: 'high' }
    },
    reminder: { interval: 60, max: 2 } // Remind admin to reassign
  },
  
  // Progress Updates
  WORK_STARTED: {
    status: STATUS.IN_PROGRESS,
    notifications: {
      client: { type: SEVERITY.INFO, title: 'Work Started', priority: 'normal' }
    }
  },
  
  RESEARCH_COMPLETED: {
    status: STATUS.RESEARCH_COMPLETED,
    notifications: {
      admin: { type: SEVERITY.INFO, title: 'Research Phase Completed', priority: 'normal' }
    }
  },
  
  WRITING_STARTED: {
    status: STATUS.WRITING_STARTED,
    notifications: {
      admin: { type: SEVERITY.INFO, title: 'Writing Phase Started', priority: 'normal' }
    }
  },
  
  DRAFT_SUBMITTED: {
    status: STATUS.DRAFT_SUBMITTED,
    notifications: {
      client: { type: SEVERITY.INFO, title: 'Draft Submitted', priority: 'normal' },
      admin: { type: SEVERITY.WARNING, title: '📋 Draft Pending QC Review', priority: 'high' }
    }
  },
  
  // QC Phase
  QC_SUBMITTED: {
    status: STATUS.PENDING_QC,
    notifications: {
      admin: { type: SEVERITY.WARNING, title: '📋 Submission Pending QC', priority: 'high' },
      writer: { type: SEVERITY.SUCCESS, title: 'Draft Submitted for QC', priority: 'normal' }
    }
  },
  
  QC_APPROVED: {
    status: STATUS.APPROVED,
    notifications: {
      client: { type: SEVERITY.SUCCESS, title: 'Work Ready', priority: 'high' },
      writer: { type: SEVERITY.SUCCESS, title: 'QC Approved!', priority: 'normal' },
      admin: { type: SEVERITY.SUCCESS, title: 'QC Approved', priority: 'normal' }
    }
  },
  
  QC_REJECTED: {
    status: STATUS.REVISION_REQUIRED,
    notifications: {
      writer: { type: SEVERITY.CRITICAL, title: '🔴 Revision Required', priority: 'critical' },
      admin: { type: SEVERITY.WARNING, title: 'Revision Required', priority: 'normal' }
    }
  },
  
  // Delivery Phase
  ORDER_DELIVERED: {
    status: STATUS.DELIVERED,
    notifications: {
      client: { type: SEVERITY.SUCCESS, title: '📦 Order Delivered!', priority: 'high' }
    }
  },
  
  // Revision
  REVISION_REQUESTED: {
    status: STATUS.REVISION_REQUIRED,
    notifications: {
      client: { type: SEVERITY.INFO, title: 'Revision Requested', priority: 'normal' },
      writer: { type: SEVERITY.CRITICAL, title: '🔴 Client Requested Revision', priority: 'critical' },
      admin: { type: SEVERITY.WARNING, title: 'Revision Request', priority: 'high' }
    }
  },
  
  // Completion
  ORDER_COMPLETED: {
    status: STATUS.COMPLETED,
    notifications: {
      client: { type: SEVERITY.SUCCESS, title: '✅ Order Completed', priority: 'high' },
      writer: { type: SEVERITY.SUCCESS, title: '✅ Order Completed - Great Work!', priority: 'normal' }
    }
  }
};

/**
 * Process a workflow event
 * 
 * @param {string} eventName - Event from WORKFLOW_EVENTS
 * @param {object} orderData - Order information
 * @param {object} actors - { client_id, admin_id, bde_id, writer_id }
 * @param {object} variables - Template variables for messages
 * @param {object} io - Socket.IO instance
 * @returns {Promise<object>} Result of workflow processing
 */
async function processWorkflowEvent(eventName, orderData, actors, variables, io = null) {
  const event = WORKFLOW_EVENTS[eventName];
  
  if (!event) {
    logger.warn(`Unknown workflow event: ${eventName}`);
    return { success: false, error: 'Unknown event' };
  }
  
  const results = {
    event: eventName,
    notifications: [],
    reminders: []
  };
  
  try {
    // Send notifications to each target role
    for (const [role, config] of Object.entries(event.notifications)) {
      const userId = actors[`${role}_id`] || actors[role];
      
      if (!userId) {
        logger.debug(`No ${role} ID provided for event ${eventName}`);
        continue;
      }
      
      // Build notification message
      const message = buildNotificationMessage(eventName, role, orderData, variables);
      
      // Create notification
      const notificationId = await createNotification({
        user_id: userId,
        type: config.type,
        title: config.title,
        message: message,
        link_url: buildLinkUrl(role, orderData)
      });
      
      // Real-time emit if IO available
      if (io) {
        io.to(`user:${userId}`).emit('notification:new', {
          notification_id: notificationId,
          type: config.type,
          title: config.title,
          message: message,
          priority: config.priority,
          created_at: new Date().toISOString()
        });
      }
      
      results.notifications.push({
        role,
        userId,
        notificationId,
        type: config.type
      });
    }
    
    // Schedule reminders if configured
    if (event.reminder && actors.admin_id) {
      const reminderId = await scheduleReminder(
        orderData.order_id,
        actors.admin_id,
        eventName,
        event.reminder.interval,
        event.reminder.max
      );
      results.reminders.push(reminderId);
    }
    
    // Log to order history
    await createOrderHistory({
      order_id: orderData.order_id,
      modified_by: actors.triggered_by || actors.admin_id,
      modified_by_name: variables.modifier_name || 'System',
      modified_by_role: variables.modifier_role || 'system',
      action_type: eventName,
      description: `Workflow event: ${eventName}`
    });
    
    results.success = true;
    return results;
    
  } catch (error) {
    logger.error(`Error processing workflow event ${eventName}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Build notification message based on event and role
 */
function buildNotificationMessage(event, role, orderData, variables) {
  const templates = {
    QUERY_CREATED: {
      client: `Your query (${orderData.query_code}) has been created. A BDE will send you a quotation soon.`,
      admin: `New query (${orderData.query_code}) from ${variables.client_name}: ${orderData.paper_topic}`,
      bde: `New query (${orderData.query_code}) requires quotation: ${orderData.paper_topic}`
    },
    QUOTATION_GENERATED: {
      client: `A quotation has been generated for your query (${orderData.query_code}). Amount: ${variables.currency}${variables.amount}`,
      admin: `Quotation generated for ${orderData.query_code} by ${variables.bde_name}`
    },
    PAYMENT_50_REQUESTED: {
      client: `Your quotation has been accepted! Please pay 50% of the total amount (${variables.currency}${variables.half_amount}) to start work.`,
      admin: `Client ready for 50% payment on ${orderData.query_code}`,
      bde: `Client ready for 50% payment on ${orderData.query_code}`
    },
    PAYMENT_50_UPLOADED: {
      client: `Your 50% payment receipt has been uploaded. We will verify it shortly.`,
      admin: `🔔 50% Payment receipt uploaded for ${orderData.query_code}. Amount: ${variables.currency}${variables.half_amount}. VERIFY NOW!`,
      bde: `🔔 50% Payment uploaded for ${orderData.query_code}. Awaiting admin verification.`
    },
    PAYMENT_50_VERIFIED: {
      client: `Your 50% payment has been verified! Work will begin shortly.`,
      admin: `50% Payment verified for ${orderData.query_code}. Ready for writer assignment.`,
      bde: `50% Payment verified for ${orderData.query_code}.`
    },
    PAYMENT_FINAL_REQUESTED: {
      client: `Your work is complete! Please pay the remaining 50% (${variables.currency}${variables.half_amount}) to receive your content.`
    },
    PAYMENT_FINAL_UPLOADED: {
      client: `Your final payment receipt has been uploaded. We will verify it shortly.`,
      admin: `🔔 Final payment receipt uploaded for ${orderData.work_code}. Amount: ${variables.currency}${variables.half_amount}. VERIFY NOW!`
    },
    PAYMENT_VERIFIED: {
      client: `Your final payment has been verified! Your content is ready for download.`,
      admin: `Final payment verified for ${orderData.work_code}. Ready for delivery.`
    },
    WRITER_ASSIGNED: {
      writer: `You have been assigned to work on: ${orderData.paper_topic}. Deadline: ${variables.deadline}`,
      admin: `Writer ${variables.writer_name} assigned to ${orderData.work_code}`
    },
    TASK_ACCEPTED: {
      admin: `Writer ${variables.writer_name} accepted task for ${orderData.work_code}`
    },
    TASK_REJECTED: {
      admin: `⚠️ Writer ${variables.writer_name} rejected task for ${orderData.work_code}. Reason: ${variables.reason}. Please reassign.`
    },
    QC_APPROVED: {
      client: `Your order (${orderData.work_code}) is approved and ready for delivery!`,
      writer: `Great work! Your submission for ${orderData.work_code} has been approved.`,
      admin: `QC approved for ${orderData.work_code}. Ready for delivery.`
    },
    QC_REJECTED: {
      writer: `Your submission for ${orderData.work_code} needs revision. Feedback: ${variables.feedback}`,
      admin: `Revision required for ${orderData.work_code}`
    },
    ORDER_DELIVERED: {
      client: `📦 Your order (${orderData.work_code}) has been delivered! Check your downloads.`
    },
    ORDER_COMPLETED: {
      client: `✅ Your order (${orderData.work_code}) is complete. Thank you for using our service!`,
      writer: `✅ Order ${orderData.work_code} completed. Great job!`
    },
    REVISION_REQUESTED: {
      client: `Revision requested for ${orderData.work_code}. We will update you once ready.`,
      writer: `🔴 Client requested revision for ${orderData.work_code}: ${variables.details}`,
      admin: `Revision requested for ${orderData.work_code}`
    }
  };
  
  return templates[event]?.[role] || `${event} notification for order ${orderData.query_code || orderData.work_code}`;
}

/**
 * Build appropriate link URL based on role
 */
function buildLinkUrl(role, orderData) {
  const paths = {
    client: `/client/orders/${orderData.order_id}`,
    admin: `/admin/queries/${orderData.order_id}/view`,
    bde: `/bde/queries/${orderData.query_code}`,
    writer: `/writer/tasks/${orderData.order_id}`
  };
  
  return paths[role] || `/orders/${orderData.order_id}`;
}

/**
 * Schedule reminder notification
 */
async function scheduleReminder(orderId, userId, eventType, intervalMinutes, maxReminders) {
  try {
    const [result] = await db.query(
      `INSERT INTO deadline_reminders 
       (order_id, user_id, reminder_type, is_sent, created_at)
       VALUES (?, ?, ?, 0, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
      [String(orderId), userId, `${eventType}_reminder`, intervalMinutes]
    );
    
    return result.insertId;
  } catch (error) {
    logger.error('Error scheduling reminder:', error);
    return null;
  }
}

/**
 * Get status display name for client (simplified view)
 */
function getClientStatusName(statusId) {
  return CLIENT_VISIBLE_STATUSES[statusId] || STATUS_NAMES[statusId] || 'Processing';
}

/**
 * Update order status with complete workflow processing
 * 
 * @param {number} orderId - Order ID
 * @param {number} newStatus - New status ID
 * @param {string} role - Role performing the update
 * @param {object} context - { userId, userName, io, reason }
 * @returns {Promise<object>} Update result
 */
async function updateOrderStatus(orderId, newStatus, role, context = {}) {
  const connection = await db.getConnection();
  
  try {
    // Get current order
    const [[order]] = await connection.query(
      `SELECT o.*, u.full_name as client_name, u.bde 
       FROM orders o 
       JOIN users u ON o.user_id = u.user_id 
       WHERE o.order_id = ?`,
      [orderId]
    );
    
    if (!order) {
      return { success: false, error: 'Order not found' };
    }
    
    // Validate transition
    const validation = validateTransition(role, order.status, newStatus);
    if (!validation.valid) {
      return { success: false, error: validation.message };
    }
    
    await connection.beginTransaction();
    
    // Update order status
    await connection.query(
      `UPDATE orders SET status = ?, updated_at = NOW() WHERE order_id = ?`,
      [newStatus, orderId]
    );
    
    // Log the change
    await connection.query(
      `INSERT INTO orders_history 
       (order_id, modified_by, modified_by_name, modified_by_role, action_type, description, created_at, modified_date)
       VALUES (?, ?, ?, ?, 'STATUS_CHANGE', ?, NOW(), NOW())`,
      [
        orderId,
        context.userId,
        context.userName || 'System',
        role,
        `Status changed from ${STATUS_NAMES[order.status]} to ${STATUS_NAMES[newStatus]}${context.reason ? ': ' + context.reason : ''}`
      ]
    );
    
    await connection.commit();
    
    // Trigger workflow event based on new status
    const eventMap = {
      [STATUS.QUOTATION_SENT]: 'QUOTATION_GENERATED',
      [STATUS.ACCEPTED]: 'QUOTATION_ACCEPTED',
      [STATUS.AWAITING_VERIFICATION]: 'PAYMENT_UPLOADED',
      [STATUS.PAYMENT_VERIFIED]: 'PAYMENT_VERIFIED',
      [STATUS.WRITER_ASSIGNED]: 'WRITER_ASSIGNED',
      [STATUS.IN_PROGRESS]: 'WORK_STARTED',
      [STATUS.PENDING_QC]: 'QC_SUBMITTED',
      [STATUS.APPROVED]: 'QC_APPROVED',
      [STATUS.REVISION_REQUIRED]: 'QC_REJECTED',
      [STATUS.DELIVERED]: 'ORDER_DELIVERED',
      [STATUS.COMPLETED]: 'ORDER_COMPLETED'
    };
    
    const workflowEvent = eventMap[newStatus];
    if (workflowEvent) {
      await processWorkflowEvent(
        workflowEvent,
        order,
        {
          client_id: order.user_id,
          admin_id: context.userId,
          bde_id: order.bde,
          writer_id: order.writer_id,
          triggered_by: context.userId
        },
        {
          client_name: order.client_name,
          modifier_name: context.userName,
          modifier_role: role
        },
        context.io
      );
    }
    
    return {
      success: true,
      previousStatus: order.status,
      newStatus: newStatus,
      statusName: STATUS_NAMES[newStatus]
    };
    
  } catch (error) {
    await connection.rollback();
    logger.error('Error updating order status:', error);
    return { success: false, error: error.message };
  } finally {
    connection.release();
  }
}

/**
 * Get order lifecycle phase
 */
function getLifecyclePhase(status) {
  if (status <= STATUS.ACCEPTED) return 'QUERY';
  if (status <= STATUS.PAYMENT_VERIFIED) return 'PAYMENT';
  if (status <= STATUS.IN_PROGRESS) return 'ASSIGNMENT';
  if (status <= STATUS.APPROVED) return 'EXECUTION';
  if (status === STATUS.DELIVERED) return 'DELIVERY';
  if (status === STATUS.COMPLETED) return 'CLOSED';
  return 'UNKNOWN';
}

module.exports = {
  WORKFLOW_EVENTS,
  SEVERITY,
  processWorkflowEvent,
  updateOrderStatus,
  getClientStatusName,
  getLifecyclePhase,
  STATUS,
  STATUS_NAMES,
  CLIENT_VISIBLE_STATUSES
};
