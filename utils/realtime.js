const { validateChannelAccess } = require('../middleware/socket.auth.middleware');
const db = require('../config/db');
const ChatModel = require('../models/chat.model');
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
        // FETCH/CREATE CHAT (Using Unified ChatModel)
        // =======================
        const chatTitle = `Order Chat ${context_code}`;
        const chatId = await ChatModel.createOrderChat(order.order_id, user_id, chatTitle);
        // Ensure role access for others
        if (order.user_id && order.user_id !== user_id) await ChatModel.addParticipant(chatId, order.user_id, 'client');
        if (order.writer_id && order.writer_id !== user_id) await ChatModel.addParticipant(chatId, order.writer_id, 'writer');
        if (order.bde_id && order.bde_id !== user_id) await ChatModel.addParticipant(chatId, order.bde_id, 'bde');
        
        const chat = await ChatModel.getChatById(chatId);

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
        // ADD MESSAGE (normalized table)
        // =======================
        const messageId = await ChatModel.sendMessage(chatId, user_id, message.trim(), 'text', null);

        // Fetch complete message object for emission
        const [[savedMsg]] = await db.query(
          `SELECT m.*, u.full_name as sender_name, p.role as sender_role 
           FROM general_chat_messages m
           LEFT JOIN users u ON u.user_id = m.sender_id
           LEFT JOIN general_chat_participants p ON p.chat_id = m.chat_id AND p.user_id = m.sender_id
           WHERE m.message_id = ?`, 
           [messageId]
        );

        const senderName = savedMsg.sender_name || 'System';

        // Prepare participants list for notification logic
        const participants = await ChatModel.getChatParticipants(chat.chat_id);
        
        // ... Logic for notifications below is kept ...

        const emittedMessage = {
          ...savedMsg,
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
    const chatTitle = `Order Chat ${context_code}`;
    // Assuming creator is admin (1) if called from system logic, or just 1 as placeholder. 
    // Ideally we should know who triggered it, but for system messages, maybe just attach to chat?
    // Using 0 or 1 as creator if creating new chat.
    const chatId = await ChatModel.createOrderChat(order_id, 1, chatTitle);
    
    // Add system message
    const messageId = await ChatModel.sendMessage(chatId, 1, message, 'system', null);
    
    const [[savedMsg]] = await db.query(
          `SELECT m.*, u.full_name as sender_name, p.role as sender_role 
           FROM general_chat_messages m
           LEFT JOIN users u ON u.user_id = m.sender_id
           LEFT JOIN general_chat_participants p ON p.chat_id = m.chat_id AND p.user_id = m.sender_id
           WHERE m.message_id = ?`, 
           [messageId]
    );

    io.to(`context:${context_code}`).emit('chat:system_message', {
      chat_id: chatId,
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
