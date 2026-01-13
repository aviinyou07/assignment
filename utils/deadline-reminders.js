const cron = require('node-cron');
const db = require('../config/db');
const { createAuditLog } = require('./audit');

/**
 * DEADLINE REMINDER SYSTEM
 * Scheduled to run every hour
 * Checks for upcoming deadlines and escalates reminders
 * 
 * Escalation flow:
 * - 24h before deadline: Send "warning" notification
 * - 12h before deadline: Escalate to "critical"
 * - 6h before deadline: Send final reminder
 * - 1h before deadline: Urgent escalation
 */

let scheduledJob = null;

const initializeDeadlineReminders = async (io) => {
  // Run every hour at :00 minutes
  scheduledJob = cron.schedule('0 * * * *', async () => {
    console.log('[DEADLINE REMINDER] Checking for upcoming deadlines...');
    
    try {
      // Get all active orders with approaching deadlines
      // Note: status = 3 is "In Progress" based on status mapping
      const query = `
        SELECT 
          o.order_id,
          o.query_code,
          o.work_code,
          o.writer_id,
          o.user_id,
          o.deadline_at,
          TIMESTAMPDIFF(HOUR, NOW(), o.deadline_at) as hours_remaining,
          dr.id as reminder_id,
          dr.reminder_type,
          dr.is_sent
        FROM orders o
        LEFT JOIN deadline_reminders dr ON o.order_id = dr.order_id AND dr.user_id = o.writer_id
        WHERE o.status = 3
        AND o.deadline_at > NOW()
        AND TIMESTAMPDIFF(HOUR, NOW(), o.deadline_at) <= 24
        AND o.writer_id IS NOT NULL
        ORDER BY o.deadline_at ASC
      `;
      
      const [orders] = await db.query(query);
      
      for (const order of orders) {
        const hoursRemaining = order.hours_remaining;
        const context_code = order.work_code || order.query_code;
        
        // Determine reminder type based on hours remaining
        let reminderType = null;
        let notificationType = 'warning';
        let escalate = false;
        
        if (hoursRemaining <= 1 && (!order.reminder_id || order.reminder_type !== '1h')) {
          reminderType = '1h';
          notificationType = 'critical';
          escalate = true;
        } else if (hoursRemaining <= 6 && (!order.reminder_id || order.reminder_type !== '6h')) {
          reminderType = '6h';
          notificationType = 'critical';
          escalate = true;
        } else if (hoursRemaining <= 12 && (!order.reminder_id || order.reminder_type !== '12h')) {
          reminderType = '12h';
          notificationType = 'critical';
          escalate = true;
        } else if (hoursRemaining <= 24 && (!order.reminder_id || order.reminder_type !== '24h')) {
          reminderType = '24h';
          notificationType = 'warning';
        }
        
        if (reminderType) {
          // Update or create deadline reminder
          if (order.reminder_id && escalate) {
            // Escalate existing reminder
            await db.query(
              'UPDATE deadline_reminders SET reminder_type = ?, is_sent = 0 WHERE id = ?',
              [reminderType, order.reminder_id]
            );
          } else if (!order.reminder_id) {
            // Create new reminder
            await db.query(
              'INSERT INTO deadline_reminders (order_id, user_id, reminder_type, is_sent) VALUES (?, ?, ?, 0)',
              [order.order_id, order.writer_id, reminderType]
            );
          }
          
          // Create notification for writer
          const notificationTitle = `Deadline Reminder (${reminderType})`;
          const notificationMessage = `Your assignment is due in ${hoursRemaining} hours. Deadline: ${new Date(order.deadline_at).toLocaleString()}`;
          
          const [result] = await db.query(
            `INSERT INTO notifications 
             (user_id, type, title, message, link_url, is_read, created_at)
             VALUES (?, ?, ?, ?, ?, 0, NOW())`,
            [
              order.writer_id,
              notificationType,
              notificationTitle,
              notificationMessage,
              `/writer/tasks?order_id=${order.order_id}`
            ]
          );
          
          const notificationId = result.insertId;
          
          // Mark reminder as sent
          await db.query(
            'UPDATE deadline_reminders SET is_sent = 1, sent_at = NOW() WHERE order_id = ? AND user_id = ? AND reminder_type = ?',
            [order.order_id, order.writer_id, reminderType]
          );
          
          // Emit real-time notification if Socket.IO available
          if (io) {
            const notificationEvent = {
              notification_id: notificationId,
              user_id: order.writer_id,
              type: notificationType,
              title: notificationTitle,
              message: notificationMessage,
              link_url: `/writer/tasks?order_id=${order.order_id}`,
              is_read: false,
              created_at: new Date().toISOString()
            };
            
            io.to(`user:${order.writer_id}`).emit('notification:new', notificationEvent);
            
            // Also emit to context channel
            if (context_code) {
              io.to(`context:${context_code}`).emit('notification:new', notificationEvent);
            }
          }
          
          // Audit log
          await createAuditLog({
            event_type: 'DEADLINE_REMINDER_SENT',
            user_id: order.writer_id,
            resource_type: 'Order',
            resource_id: order.order_id,
            old_value: `reminder_type: ${order.reminder_type}`,
            new_value: `reminder_type: ${reminderType}`,
            status: 'success',
            ip_address: '127.0.0.1',
            user_agent: 'SYSTEM'
          });
        }
      }
      
      console.log(`[DEADLINE REMINDER] Processed ${orders.length} orders with approaching deadlines`);
    } catch (error) {
      console.error('[DEADLINE REMINDER] Error:', error.message);
      
      // Log error
      try {
        await createAuditLog({
          event_type: 'DEADLINE_REMINDER_ERROR',
          user_id: null,
          resource_type: 'System',
          resource_id: 'deadline-reminder-cron',
          new_value: error.message,
          status: 'error',
          ip_address: '127.0.0.1',
          user_agent: 'SYSTEM'
        });
      } catch (auditError) {
        console.error('[DEADLINE REMINDER] Could not log error:', auditError.message);
      }
    }
  });
  
  console.log('[DEADLINE REMINDER] System initialized - runs every hour');
};

const stopDeadlineReminders = () => {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob.destroy();
    console.log('[DEADLINE REMINDER] System stopped');
  }
};

module.exports = {
  initializeDeadlineReminders,
  stopDeadlineReminders
};
