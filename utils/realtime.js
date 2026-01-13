const { validateChannelAccess } = require('../middleware/socket.auth.middleware');
const db = require('../config/db');
const { createAuditLog } = require('../utils/audit');

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

    console.log(`[Socket] User ${user_id} (${role}) connected - ${socket.id}`);

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

      console.log(`[Socket] User ${user_id} subscribed to context:${context_code}`);
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
        // FETCH ORDER
        // =======================
        let order;
        if (context_code.startsWith('QUERY_')) {
          [[order]] = await db.query(
            `SELECT o.order_id FROM orders o WHERE o.query_code = ?`,
            [context_code]
          );
        } else {
          [[order]] = await db.query(
            `SELECT o.order_id FROM orders o WHERE o.work_code = ?`,
            [context_code]
          );
        }

        if (!order) {
          return socket.emit('error', { message: 'Order not found' });
        }

        // =======================
        // FETCH CHAT
        // =======================
        let [[chat]] = await db.query(
          `SELECT * FROM order_chats WHERE order_id = ?`,
          [order.order_id]
        );

        if (!chat) {
          const [result] = await db.query(
            `INSERT INTO order_chats (order_id, chat_name, participants, messages, status, created_at, updated_at)
             VALUES (?, 'Order Chat', ?, '[]', 'active', NOW(), NOW())`,
            [order.order_id, JSON.stringify([user_id])]
          );
          chat = {
            chat_id: result.insertId,
            order_id: order.order_id,
            messages: '[]',
            status: 'active'
          };
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
        // ADD MESSAGE
        // =======================
        const messages = JSON.parse(chat.messages || '[]');
        const newMessage = {
          id: Date.now(),
          sender_id: user_id,
          sender_role: role,
          message_type: 'text',
          content: message.trim(),
          timestamp: new Date().toISOString()
        };

        messages.push(newMessage);

        await db.query(
          `UPDATE order_chats SET messages = ?, updated_at = NOW() WHERE chat_id = ?`,
          [JSON.stringify(messages), chat.chat_id]
        );

        // =======================
        // EMIT TO CHANNEL
        // =======================
        io.to(`context:${context_code}`).emit('chat:new_message', {
          chat_id: chat.chat_id,
          context_code,
          message: newMessage
        });

        socket.emit('chat:sent', { message: newMessage });

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
        console.error('Chat send error:', err);
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
      console.log(`[Socket] User ${user_id} disconnected - ${socket.id}`);
    });

    // =======================
    // ERROR HANDLER
    // =======================
    socket.on('error', (error) => {
      console.error(`[Socket] Error from ${user_id}:`, error);
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
  io.to(`user:${user_id}`).emit('notification:new', notification);

  // Emit to context channel if provided
  if (context_code) {
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
    const [[chat]] = await db.query(
      `SELECT * FROM order_chats WHERE order_id = ?`,
      [order_id]
    );

    if (!chat) {
      const [result] = await db.query(
        `INSERT INTO order_chats (order_id, chat_name, participants, messages, status, created_at, updated_at)
         VALUES (?, 'Order Chat', '[]', '[]', 'active', NOW(), NOW())`,
        [order_id]
      );
      return;
    }

    const messages = JSON.parse(chat.messages || '[]');
    const systemMessage = {
      id: Date.now(),
      sender_id: 0, // System message
      sender_role: 'system',
      message_type: 'system',
      content: message,
      timestamp: new Date().toISOString()
    };

    messages.push(systemMessage);

    await db.query(
      `UPDATE order_chats SET messages = ?, updated_at = NOW() WHERE chat_id = ?`,
      [JSON.stringify(messages), chat.chat_id]
    );

    io.to(`context:${context_code}`).emit('chat:system_message', {
      chat_id: chat.chat_id,
      context_code,
      message: systemMessage
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
