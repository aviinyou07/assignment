const cron = require('node-cron');
const db = require('../config/db');
const { createAuditLog } = require('./audit');
const logger = require('./logger');
const { sendMail } = require('./mailer');
const { STATUS, STATUS_NAMES, NOTIFICATION_TRIGGERS } = require('./order-state-machine');

/**
 * DEADLINE REMINDER SYSTEM - ENHANCED
 * 
 * Scheduled cron jobs:
 * 1. Hourly: Check upcoming deadlines
 * 2. Every 30 minutes: Critical notification reminders
 * 
 * Escalation flow for Deadlines:
 * - 24h before deadline: Send "warning" notification
 * - 12h before deadline: Escalate to "critical"
 * - 6h before deadline: Send final reminder + email
 * - 1h before deadline: Urgent escalation + admin notification
 * 
 * Critical Notification Reminders:
 * - 30 min: First reminder for unread CRITICAL
 * - 60 min: Second reminder
 * - 90 min: Third reminder + admin escalation
 * - 120 min: Final reminder + mark as escalated
 */

// Reminder intervals for critical notifications (in minutes)
const CRITICAL_REMINDER_INTERVALS = [30, 60, 90, 120];
const WARNING_REMINDER_INTERVALS = [60, 120];

let scheduledJob = null;
let criticalReminderJob = null;

const initializeDeadlineReminders = async (io) => {
  // =============================================
  // CRON JOB 1: DEADLINE REMINDERS (Every hour)
  // =============================================
  scheduledJob = cron.schedule('0 * * * *', async () => {
    logger.info('[DEADLINE REMINDER] Checking for upcoming deadlines...');
    
    try {
      // Get all active orders with approaching deadlines
      const query = `
        SELECT 
          o.order_id,
          o.query_code,
          o.work_code,
          o.paper_topic,
          o.writer_id,
          o.user_id,
          o.deadline_at,
          o.status,
          TIMESTAMPDIFF(HOUR, NOW(), o.deadline_at) as hours_remaining,
          dr.id as reminder_id,
          dr.reminder_type,
          dr.is_sent,
          w.full_name as writer_name,
          w.email as writer_email,
          c.full_name as client_name
        FROM orders o
        LEFT JOIN deadline_reminders dr ON o.order_id = dr.order_id AND dr.user_id = o.writer_id
        LEFT JOIN users w ON o.writer_id = w.user_id
        LEFT JOIN users c ON o.user_id = c.user_id
        WHERE o.status IN (?, ?, ?, ?)
        AND o.deadline_at > NOW()
        AND TIMESTAMPDIFF(HOUR, NOW(), o.deadline_at) <= 24
        AND o.writer_id IS NOT NULL
        ORDER BY o.deadline_at ASC
      `;
      
      const [orders] = await db.query(query, [
        STATUS.WRITER_ASSIGNED,
        STATUS.WRITER_ACCEPTED,
        STATUS.UNDER_REVISION,
        STATUS.DRAFT_SUBMITTED
      ]);
      
      for (const order of orders) {
        const hoursRemaining = order.hours_remaining;
        const context_code = order.work_code || order.query_code;
        
        // Determine reminder type based on hours remaining
        let reminderType = null;
        let notificationType = 'warning';
        let escalate = false;
        let notifyAdmin = false;
        let sendEmail = false;
        
        if (hoursRemaining <= 1 && (!order.reminder_id || order.reminder_type !== '1h')) {
          reminderType = '1h';
          notificationType = 'critical';
          escalate = true;
          notifyAdmin = true;
          sendEmail = true;
        } else if (hoursRemaining <= 6 && (!order.reminder_id || order.reminder_type !== '6h')) {
          reminderType = '6h';
          notificationType = 'critical';
          escalate = true;
          sendEmail = true;
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
            await db.query(
              'UPDATE deadline_reminders SET reminder_type = ?, is_sent = 0 WHERE id = ?',
              [reminderType, order.reminder_id]
            );
          } else if (!order.reminder_id) {
            await db.query(
              'INSERT INTO deadline_reminders (order_id, user_id, reminder_type, is_sent) VALUES (?, ?, ?, 0)',
              [order.order_id, order.writer_id, reminderType]
            );
          }
          
          // Create notification for writer
          const notificationTitle = notificationType === 'critical' 
            ? `🚨 URGENT: Deadline in ${reminderType}` 
            : `⏰ Deadline Reminder (${reminderType})`;
          const notificationMessage = `Your assignment "${order.paper_topic}" is due in ${hoursRemaining} hours. Deadline: ${new Date(order.deadline_at).toLocaleString()}`;
          
          const [result] = await db.query(
            `INSERT INTO notifications 
             (user_id, type, title, message, link_url, is_read, created_at, severity, context_code)
             VALUES (?, ?, ?, ?, ?, 0, NOW(), ?, ?)`,
            [
              order.writer_id,
              notificationType,
              notificationTitle,
              notificationMessage,
              `/writer/tasks/${order.order_id}`,
              notificationType.toUpperCase(),
              context_code
            ]
          );
          
          const notificationId = result.insertId;
          
          // Mark reminder as sent
          await db.query(
            'UPDATE deadline_reminders SET is_sent = 1, sent_at = NOW() WHERE order_id = ? AND user_id = ? AND reminder_type = ?',
            [order.order_id, order.writer_id, reminderType]
          );
          
          // Emit real-time notification
          if (io) {
            const notificationEvent = {
              notification_id: notificationId,
              user_id: order.writer_id,
              type: notificationType,
              title: notificationTitle,
              message: notificationMessage,
              link_url: `/writer/tasks/${order.order_id}`,
              is_read: false,
              created_at: new Date().toISOString(),
              severity: notificationType.toUpperCase()
            };
            
            io.to(`user:${order.writer_id}`).emit('notification:new', notificationEvent);
            if (context_code) {
              io.to(`context:${context_code}`).emit('notification:deadline', notificationEvent);
            }
          }
          
          // Send email for 6h and 1h reminders
          if (sendEmail && order.writer_email) {
            sendMail({
              to: order.writer_email,
              subject: `${notificationTitle} - ${order.paper_topic}`,
              html: `
                <h2 style="color: ${notificationType === 'critical' ? 'red' : 'orange'};">${notificationTitle}</h2>
                <p>Hello ${order.writer_name},</p>
                <p><strong>Your deadline is approaching!</strong></p>
                <p><strong>Topic:</strong> ${order.paper_topic}</p>
                <p><strong>Time remaining:</strong> ${hoursRemaining} hours</p>
                <p><strong>Deadline:</strong> ${new Date(order.deadline_at).toLocaleString()}</p>
                ${notificationType === 'critical' ? '<p style="color: red;"><strong>Please submit your work immediately to avoid penalties.</strong></p>' : ''}
              `
            }).catch(err => logger.error(`[DEADLINE REMINDER] Email error: ${err.message}`));
          }
          
          // Notify admin for critical 1h reminders
          if (notifyAdmin) {
            // Get all admins
            const [admins] = await db.query('SELECT user_id FROM users WHERE role = ? AND is_active = 1', ['admin']);
            
            for (const admin of admins) {
              await db.query(
                `INSERT INTO notifications 
                 (user_id, type, title, message, link_url, is_read, created_at, severity)
                 VALUES (?, 'critical', ?, ?, ?, 0, NOW(), 'CRITICAL')`,
                [
                  admin.user_id,
                  `🚨 ORDER AT RISK: ${context_code}`,
                  `Order "${order.paper_topic}" has only ${hoursRemaining} hour(s) remaining. Writer: ${order.writer_name}`,
                  `/admin/orders/${order.order_id}`
                ]
              );
              
              if (io) {
                io.to(`user:${admin.user_id}`).emit('notification:critical', {
                  title: `🚨 ORDER AT RISK: ${context_code}`,
                  message: `Order has only ${hoursRemaining} hour(s) remaining`,
                  order_id: order.order_id
                });
              }
            }
          }
          
          // Audit log
          await createAuditLog({
            event_type: 'DEADLINE_REMINDER_SENT',
            user_id: order.writer_id,
            resource_type: 'Order',
            resource_id: order.order_id,
            old_value: `reminder_type: ${order.reminder_type || 'none'}`,
            new_value: `reminder_type: ${reminderType}`,
            status: 'success',
            ip_address: '127.0.0.1',
            user_agent: 'SYSTEM'
          });
        }
      }
      
      logger.info(`[DEADLINE REMINDER] Processed ${orders.length} orders with approaching deadlines`);
    } catch (error) {
      logger.error(`[DEADLINE REMINDER] Error: ${error && error.message ? error.message : error}`);
      
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
        logger.error(`[DEADLINE REMINDER] Could not log error: ${auditError && auditError.message ? auditError.message : auditError}`);
      }
    }
  });
  
  // =============================================
  // CRON JOB 2: CRITICAL NOTIFICATION REMINDERS
  // Runs every 30 minutes for escalating reminders
  // =============================================
  criticalReminderJob = cron.schedule('*/30 * * * *', async () => {
    logger.info('[CRITICAL REMINDERS] Checking for unread critical notifications...');
    
    try {
      // Get unread CRITICAL notifications older than 30 minutes
      const [unreadCritical] = await db.query(`
        SELECT 
          n.notification_id,
          n.user_id,
          n.title,
          n.message,
          n.link_url,
          n.created_at,
          n.reminder_count,
          TIMESTAMPDIFF(MINUTE, n.created_at, NOW()) as minutes_since_created,
          u.full_name,
          u.email,
          u.role
        FROM notifications n
        JOIN users u ON n.user_id = u.user_id
        WHERE n.is_read = 0
          AND (n.severity = 'CRITICAL' OR n.type = 'critical')
          AND TIMESTAMPDIFF(MINUTE, n.created_at, NOW()) >= 30
          AND (n.reminder_count IS NULL OR n.reminder_count < 4)
        ORDER BY n.created_at ASC
      `);
      
      for (const notification of unreadCritical) {
        const minutesSince = notification.minutes_since_created;
        const currentReminderCount = notification.reminder_count || 0;
        
        // Determine which reminder interval we're at
        let shouldRemind = false;
        let reminderNumber = 0;
        
        for (let i = 0; i < CRITICAL_REMINDER_INTERVALS.length; i++) {
          if (minutesSince >= CRITICAL_REMINDER_INTERVALS[i] && currentReminderCount <= i) {
            shouldRemind = true;
            reminderNumber = i + 1;
            break;
          }
        }
        
        if (shouldRemind) {
          // Update reminder count
          await db.query(
            'UPDATE notifications SET reminder_count = ? WHERE notification_id = ?',
            [reminderNumber, notification.notification_id]
          );
          
          // Create follow-up notification
          const reminderTitle = reminderNumber >= 3 
            ? `🔴 ESCALATED: ${notification.title}`
            : `🔔 Reminder ${reminderNumber}: ${notification.title}`;
          
          const [reminderResult] = await db.query(
            `INSERT INTO notifications 
             (user_id, type, title, message, link_url, is_read, created_at, severity, parent_notification_id)
             VALUES (?, 'critical', ?, ?, ?, 0, NOW(), 'CRITICAL', ?)`,
            [
              notification.user_id,
              reminderTitle,
              `REMINDER: ${notification.message}`,
              notification.link_url,
              notification.notification_id
            ]
          );
          
          // Emit reminder notification
          if (io) {
            io.to(`user:${notification.user_id}`).emit('notification:reminder', {
              notification_id: reminderResult.insertId,
              original_notification_id: notification.notification_id,
              title: reminderTitle,
              message: `REMINDER: ${notification.message}`,
              reminder_number: reminderNumber,
              user_id: notification.user_id
            });
          }
          
          // At 90+ minutes, also notify admin about escalation
          if (reminderNumber >= 3 && notification.role !== 'admin') {
            const [admins] = await db.query('SELECT user_id FROM users WHERE role = ? AND is_active = 1', ['admin']);
            
            for (const admin of admins) {
              await db.query(
                `INSERT INTO notifications 
                 (user_id, type, title, message, link_url, is_read, created_at, severity)
                 VALUES (?, 'critical', ?, ?, ?, 0, NOW(), 'CRITICAL')`,
                [
                  admin.user_id,
                  `⚠️ ESCALATION: Unread Critical Notification`,
                  `User ${notification.full_name} has not read: "${notification.title}" (${minutesSince} mins)`,
                  notification.link_url
                ]
              );
              
              if (io) {
                io.to(`user:${admin.user_id}`).emit('notification:escalation', {
                  user_name: notification.full_name,
                  user_id: notification.user_id,
                  original_title: notification.title,
                  minutes_unread: minutesSince
                });
              }
            }
          }
          
          // At 90+ minutes, send email reminder
          if (reminderNumber >= 3 && notification.email) {
            sendMail({
              to: notification.email,
              subject: `URGENT: Action Required - ${notification.title}`,
              html: `
                <h2 style="color: red;">🔴 URGENT: Action Required</h2>
                <p>Hello ${notification.full_name},</p>
                <p>You have an unread critical notification that requires immediate attention:</p>
                <p><strong>${notification.title}</strong></p>
                <p>${notification.message}</p>
                <p>This notification was sent ${minutesSince} minutes ago and remains unread.</p>
                <p style="color: red;"><strong>Please log in and take action immediately.</strong></p>
              `
            }).catch(err => logger.error(`[CRITICAL REMINDERS] Email error: ${err.message}`));
          }
          
          logger.info(`[CRITICAL REMINDERS] Sent reminder ${reminderNumber} for notification ${notification.notification_id}`);
        }
      }
      
      // Process WARNING notifications with different intervals
      const [unreadWarnings] = await db.query(`
        SELECT 
          n.notification_id,
          n.user_id,
          n.title,
          n.message,
          n.link_url,
          n.created_at,
          n.reminder_count,
          TIMESTAMPDIFF(MINUTE, n.created_at, NOW()) as minutes_since_created,
          u.full_name
        FROM notifications n
        JOIN users u ON n.user_id = u.user_id
        WHERE n.is_read = 0
          AND (n.severity = 'WARNING' OR n.type = 'warning')
          AND TIMESTAMPDIFF(MINUTE, n.created_at, NOW()) >= 60
          AND (n.reminder_count IS NULL OR n.reminder_count < 2)
        ORDER BY n.created_at ASC
      `);
      
      for (const notification of unreadWarnings) {
        const minutesSince = notification.minutes_since_created;
        const currentReminderCount = notification.reminder_count || 0;
        
        let shouldRemind = false;
        let reminderNumber = 0;
        
        for (let i = 0; i < WARNING_REMINDER_INTERVALS.length; i++) {
          if (minutesSince >= WARNING_REMINDER_INTERVALS[i] && currentReminderCount <= i) {
            shouldRemind = true;
            reminderNumber = i + 1;
            break;
          }
        }
        
        if (shouldRemind) {
          await db.query(
            'UPDATE notifications SET reminder_count = ? WHERE notification_id = ?',
            [reminderNumber, notification.notification_id]
          );
          
          if (io) {
            io.to(`user:${notification.user_id}`).emit('notification:reminder', {
              notification_id: notification.notification_id,
              title: `🔔 Reminder: ${notification.title}`,
              reminder_number: reminderNumber
            });
          }
        }
      }
      
      logger.info(`[CRITICAL REMINDERS] Processed ${unreadCritical.length} critical and ${unreadWarnings.length} warning notifications`);
    } catch (error) {
      logger.error(`[CRITICAL REMINDERS] Error: ${error && error.message ? error.message : error}`);
    }
  });
  
  logger.info('[DEADLINE REMINDER] System initialized - deadline check hourly, critical reminders every 30 min');
};

const stopDeadlineReminders = () => {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob.destroy();
    logger.info('[DEADLINE REMINDER] Hourly job stopped');
  }
  if (criticalReminderJob) {
    criticalReminderJob.stop();
    criticalReminderJob.destroy();
    logger.info('[CRITICAL REMINDERS] 30-min job stopped');
  }
};

// Export reminder intervals for use in other modules
module.exports = {
  initializeDeadlineReminders,
  stopDeadlineReminders,
  CRITICAL_REMINDER_INTERVALS,
  WARNING_REMINDER_INTERVALS
};
