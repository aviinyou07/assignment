const { validateChannelAccess } = require('../middleware/socket.auth.middleware');
const db = require('../config/db');
const { createAuditLog } = require('../utils/audit');
const { createNotificationWithRealtime } = require('../controllers/notifications.controller');
const logger = require('../utils/logger');

/**
 * SOCKET.IO REAL-TIME HANDLERS
 * Manages WebSocket connections, channels, and event emission
 */

const initializeRealtime = (io) => {
  // =======================
  // CONNECTION HANDLER
  // =======================
  io.on('connection', async (socket) => {
    const { user_id, role } = socket.user;

    logger.info(`Socket connected: User ${user_id} (${role}) - ${socket.id}`);

    // =======================
    // JOIN USER CHANNEL
    // =======================
    socket.join(`user:${user_id}`);
    socket.join(`role:${role}`);

    // =======================
    // SUBSCRIBE TO CONTEXT CHANNELS
    // =======================
    socket.on('subscribe:context', async (data) => {
      const { context_code } = data;

      if (!context_code) {
        return socket.emit('error', { message: 'context_code required' });
      }

      // Validate access
      const hasAccess = await validateChannelAccess(socket, `context:${context_code}`);

      if (!hasAccess) {
        await createAuditLog({
          user_id,
          role,
          event_type: 'SOCKET_UNAUTHORIZED_SUBSCRIBE',
          resource_type: 'channel',
          resource_id: context_code,
          details: `Unauthorized subscribe attempt to ${context_code}`,
          ip_address: socket.handshake.address,
          user_agent: socket.handshake.headers['user-agent']
        });

        return socket.emit('error', {
          message: 'Access denied to this context'
        });
      }

      socket.join(`context:${context_code}`);
      socket.emit('subscribed', {
        context_code,
        message: 'Subscribed to context channel'
      });

      logger.debug(`User ${user_id} subscribed to context:${context_code}`);
    });

    // =======================
    // UNSUBSCRIBE FROM CONTEXT CHANNEL
    // =======================
    socket.on('unsubscribe:context', (data) => {
      const { context_code } = data;
      socket.leave(`context:${context_code}`);
      socket.emit('unsubscribed', { context_code });
    });

    // =======================
    // SEND CHAT MESSAGE (Real-time)
    // =======================
    socket.on('chat:send', async (data) => {
      try {
        const { context_code, message } = data;

        if (!context_code || !message) {
          return socket.emit('error', {
            message: 'context_code and message required'
          });
        }

        // Validate access
        const hasAccess = await validateChannelAccess(socket, `context:${context_code}`);
        if (!hasAccess) {
          return socket.emit('error', { message: 'Access denied' });
        }

        // =======================
        // FETCH ORDER (with participants)
        // =======================
        let order;
        if (context_code.startsWith('QUERY_')) {
          [[order]] = await db.query(
            `SELECT o.order_id, o.user_id, o.writer_id, u.bde as bde_id FROM orders o
             JOIN users u ON o.user_id = u.user_id
             WHERE o.query_code = ?`,
            [context_code]
          );
        } else {
          [[order]] = await db.query(
            `SELECT o.order_id, o.user_id, o.writer_id, u.bde as bde_id FROM orders o
             JOIN users u ON o.user_id = u.user_id
             WHERE o.work_code = ?`,
            [context_code]
          );
        }

        if (!order) {
          return socket.emit('error', { message: 'Order not found' });
        }

        // =======================
        // FETCH/CREATE CHAT
        // =======================
        let [[chat]] = await db.query(
          `SELECT * FROM order_chats WHERE order_id = ?`,
          [order.order_id]
        );

        if (!chat) {
          const [result] = await db.query(
            `INSERT INTO order_chats (order_id, context_code, chat_name, status, created_at, updated_at)
             VALUES (?, ?, 'Order Chat', 'active', NOW(), NOW())`,
            [order.order_id, context_code]
          );
          [[chat]] = await db.query(`SELECT * FROM order_chats WHERE chat_id = ?`, [result.insertId]);
        }

        // =======================
        // ENSURE PARTICIPANTS
        // =======================
        const participants = [];
        if (order.user_id) participants.push({ user_id: order.user_id, role: 'client' });
        if (order.writer_id) participants.push({ user_id: order.writer_id, role: 'writer' });
        if (order.bde_id) participants.push({ user_id: order.bde_id, role: 'bde' });
        if (role === 'admin') participants.push({ user_id, role: 'admin' });

        if (participants.length) {
          const values = participants.map(p => `(${chat.chat_id}, ${p.user_id}, '${p.role}', 0, NOW())`).join(',');
          await db.query(
            `INSERT IGNORE INTO order_chat_participants (chat_id, user_id, role, is_muted, joined_at) VALUES ${values}`
          );
        }

        // =======================
        // CHECK STATUS
        // =======================
        if (chat.status === 'closed') {
          return socket.emit('error', { message: 'Chat is closed' });
        }

        if (chat.status === 'restricted' && role !== 'admin') {
          return socket.emit('error', { message: 'Chat is restricted' });
        }

        // =======================
        // ROLE TARGET VALIDATION (non-admin)
        // =======================
        if (role !== 'admin') {
          const allowedTargetsByRole = {
            client: ['bde', 'admin'],
            bde: ['client', 'admin'],
            writer: ['admin']
          };
          const allowedTargets = allowedTargetsByRole[role] || [];
          const participantRoles = participants.map(p => p.role);
          const canChat = allowedTargets.some(target => target === 'admin' || participantRoles.includes(target)) || participants.length === 0;
          if (!canChat) {
            return socket.emit('error', { message: `Chat not allowed for role ${role}` });
          }
        }

        // =======================
        // ADD MESSAGE (normalized table)
        // =======================
        const [insertRes] = await db.query(
          `INSERT INTO order_chat_messages (chat_id, order_id, sender_id, sender_role, message_type, content, attachments, is_edited, is_deleted, created_at)
           VALUES (?, ?, ?, ?, 'text', ?, NULL, 0, 0, NOW())`,
          [chat.chat_id, order.order_id, user_id, role, message.trim()]
        );

        const messageId = insertRes.insertId;
        const [[savedMsg]] = await db.query(`SELECT * FROM order_chat_messages WHERE message_id = ? LIMIT 1`, [messageId]);

        // Mark sender read
        await db.query(
          `INSERT IGNORE INTO order_chat_message_reads (message_id, user_id, read_at) VALUES (?, ?, NOW())`,
          [messageId, user_id]
        );

        // Resolve sender name and build payloads
        let senderName = 'System';
        const [[senderUser]] = await db.query(`SELECT full_name FROM users WHERE user_id = ?`, [user_id]);
        if (senderUser && senderUser.full_name) {
          senderName = senderUser.full_name;
        }

        const emittedMessage = {
          ...savedMsg,
          sender_name: senderName,
          message: savedMsg.content,
          is_mine: false,
          is_read: false
        };

        const senderMessage = {
          ...emittedMessage,
          is_mine: true,
          is_read: true
        };

        // Determine recipients
        const recipients = new Set();
        let notifyAdmins = false;

        if (role === 'admin') {
          if (order.user_id) recipients.add(order.user_id);
          if (order.writer_id) recipients.add(order.writer_id);
          if (order.bde_id) recipients.add(order.bde_id);
        } else if (role === 'client') {
          if (order.bde_id) recipients.add(order.bde_id);
          notifyAdmins = true;
        } else if (role === 'bde') {
          if (order.user_id) recipients.add(order.user_id);
          notifyAdmins = true;
        } else if (role === 'writer') {
          notifyAdmins = true;
        }

        recipients.delete(user_id);

        const emitPayload = {
          chat_id: chat.chat_id,
          context_code,
          message: emittedMessage
        };

        for (const rid of recipients) {
          io.to(`user:${rid}`).emit('chat:new_message', emitPayload);
        }

        if (notifyAdmins || role === 'admin') {
          io.to('role:admin').emit('chat:new_message', emitPayload);
        }

        io.to(`context:${context_code}`).emit('chat:new_message', emitPayload);

        socket.emit('chat:sent', { message: senderMessage, context_code });

        // =======================
        // CREATE NOTIFICATIONS FOR RECIPIENTS
        // =======================
        const participantRoleMap = new Map(participants.map(p => [p.user_id, p.role]));
        const buildLink = (targetRole) => {
          if (targetRole === 'admin') return `/admin/queries/${order.order_id}/view`;
          if (targetRole === 'bde') return `/bde/queries/${context_code}`;
          if (targetRole === 'writer') return `/writer/orders/${context_code}`;
          return `/client/orders/${context_code}`;
        };

        for (const rid of recipients) {
          const targetRole = participantRoleMap.get(rid) || 'client';
          await createNotificationWithRealtime(io, {
            user_id: rid,
            type: 'chat',
            title: `New chat reply from ${senderName}`,
            message: savedMsg.content || 'New message',
            link_url: buildLink(targetRole),
            context_code,
            triggered_by: { user_id, role }
          });
        }

        if (notifyAdmins || role === 'admin') {
          const [admins] = await db.query(`SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1`);
          for (const admin of admins) {
            if (admin.user_id === user_id) continue;
            await createNotificationWithRealtime(io, {
              user_id: admin.user_id,
              type: 'chat',
              title: `New chat message in ${context_code}`,
              message: savedMsg.content || 'New message',
              link_url: buildLink('admin'),
              context_code,
              triggered_by: { user_id, role }
            });
          }
        }

        // =======================
        // AUDIT LOG
        // =======================
        await createAuditLog({
          user_id,
          role,
          event_type: 'CHAT_MESSAGE_SENT',
          resource_type: 'chat',
          resource_id: chat.chat_id,
          details: `Real-time message sent in ${context_code}`,
          ip_address: socket.handshake.address,
          user_agent: socket.handshake.headers['user-agent']
        });

      } catch (err) {
        logger.error(`Chat send error: ${err && err.message ? err.message : err}`);
        socket.emit('error', { message: err.message });
      }
    });

    // =======================
    // TYPING INDICATOR
    // =======================
    socket.on('chat:typing', async (data) => {
      const { context_code } = data;

      const hasAccess = await validateChannelAccess(socket, `context:${context_code}`);
      if (!hasAccess) return;

      io.to(`context:${context_code}`).emit('chat:user_typing', {
        user_id,
        context_code
      });
    });

    // =======================
    // STOP TYPING
    // =======================
    socket.on('chat:stop_typing', async (data) => {
      const { context_code } = data;

      const hasAccess = await validateChannelAccess(socket, `context:${context_code}`);
      if (!hasAccess) return;

      io.to(`context:${context_code}`).emit('chat:user_stop_typing', {
        user_id,
        context_code
      });
    });

    // =======================
    // DISCONNECT HANDLER
    // =======================
    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: User ${user_id} - ${socket.id}`);
    });

    // =======================
    // ERROR HANDLER
    // =======================
    socket.on('error', (error) => {
      logger.error(`Socket error from ${user_id}: ${error && error.message ? error.message : error}`);
      socket.emit('error', { message: 'Connection error' });
    });
  });
};

/**
 * EMIT NOTIFICATION EVENT TO SOCKET.IO
 * Called by notification creation logic
 * 
 * @param {object} io Socket.IO instance
 * @param {number} user_id Target user
 * @param {object} notification Notification object
 * @param {string} context_code Optional context for channel emission
 */
const emitNotificationRealtime = (io, user_id, notification, context_code) => {
  // Emit to user's personal channel
  logger.debug(`[Realtime] Emitting notification to user:${user_id} - ${JSON.stringify(notification)}`);
  io.to(`user:${user_id}`).emit('notification:new', notification);

  // Emit to context channel if provided
  if (context_code) {
    logger.debug(`Emitting notification to context:${context_code}`);
    io.to(`context:${context_code}`).emit('notification:new', notification);
  }

  // Emit to role channel (for admin/BDE/Writer broadcasts)
  // This allows role-based dashboards to update
  io.to(`role:admin`).emit('notification:broadcast', {
    type: 'new_user_notification',
    user_id,
    notification
  });
};

/**
 * EMIT CHAT SYSTEM MESSAGE
 * Called when system events occur (assignment, QC, etc.)
 * 
 * @param {object} io Socket.IO instance
 * @param {number} order_id Order ID
 * @param {string} context_code Query or work code
 * @param {string} message System message
 */
const emitChatSystemMessage = async (io, order_id, context_code, message) => {
  try {
    let [[chat]] = await db.query(
      `SELECT * FROM order_chats WHERE order_id = ?`,
      [order_id]
    );

    if (!chat) {
      const [result] = await db.query(
        `INSERT INTO order_chats (order_id, context_code, chat_name, status, created_at, updated_at)
         VALUES (?, ?, 'Order Chat', 'active', NOW(), NOW())`,
        [order_id, context_code]
      );
      [[chat]] = await db.query(`SELECT * FROM order_chats WHERE chat_id = ?`, [result.insertId]);
    }

    const [insertRes] = await db.query(
      `INSERT INTO order_chat_messages (chat_id, order_id, sender_id, sender_role, message_type, content, attachments, is_edited, is_deleted, created_at)
       VALUES (?, ?, 0, 'system', 'system', ?, NULL, 0, 0, NOW())`,
      [chat.chat_id, order_id, message]
    );

    const messageId = insertRes.insertId;
    const [[savedMsg]] = await db.query(`SELECT * FROM order_chat_messages WHERE message_id = ? LIMIT 1`, [messageId]);

    io.to(`context:${context_code}`).emit('chat:system_message', {
      chat_id: chat.chat_id,
      context_code,
      message: savedMsg
    });

  } catch (err) {
    console.error('Error emitting system message:', err);
  }
};

module.exports = {
  initializeRealtime,
  emitNotificationRealtime,
  emitChatSystemMessage
};
