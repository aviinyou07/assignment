const db = require('../config/db');
const { createAuditLog } = require('../utils/audit');

/**
 * CHAT CONTROLLER
 * Role-based chat system for orders
 * 
 * Allowed relationships:
 * - Client ↔ BDE
 * - BDE ↔ Admin
 * - Writer ↔ Admin
 * 
 * Disallowed:
 * - Client ↔ Writer (direct communication blocked)
 * - BDE ↔ Writer
 */

/**
 * VALIDATE CHAT ACCESS
 * Checks if two users can chat in a given context
 */
const validateChatAccess = async (userId1, role1, userId2, role2, contextCode) => {
  // Check allowed role pairs
  const allowedPairs = [
    ['client', 'bde'],
    ['bde', 'admin'],
    ['writer', 'admin']
  ];

  const pair = [role1, role2].sort();
  const allowed = allowedPairs.some(p => 
    (p[0] === pair[0] && p[1] === pair[1]) || 
    (p[1] === pair[0] && p[0] === pair[1])
  );

  if (!allowed) {
    throw new Error(`Chat not allowed between ${role1} and ${role2}`);
  }

  // Verify context existence and participant relationship
  if (contextCode.startsWith('QUERY_')) {
    // Query context: Client, BDE, Admin
    const [[context]] = await db.query(
      `SELECT o.order_id, o.user_id, u.bde FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE o.query_code = ?
       LIMIT 1`,
      [contextCode]
    );

    if (!context) throw new Error('Query not found');

    // Both users must be valid participants
    const isUser1Valid = 
      context.user_id === userId1 || 
      context.bde === userId1 ||
      role1 === 'admin';
    
    const isUser2Valid = 
      context.user_id === userId2 || 
      context.bde === userId2 ||
      role2 === 'admin';

    if (!isUser1Valid || !isUser2Valid) {
      throw new Error('One or both users not involved in this query');
    }

    return context.order_id;
  }

  if (contextCode.startsWith('WORK_')) {
    // Work context: Client, Writer, Admin, BDE
    const [[context]] = await db.query(
      `SELECT o.order_id, o.user_id, o.writer_id, u.bde FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE o.work_code = ?
       LIMIT 1`,
      [contextCode]
    );

    if (!context) throw new Error('Order not found');

    const isUser1Valid = 
      context.user_id === userId1 || 
      context.writer_id === userId1 || 
      context.bde === userId1 ||
      role1 === 'admin';
    
    const isUser2Valid = 
      context.user_id === userId2 || 
      context.writer_id === userId2 || 
      context.bde === userId2 ||
      role2 === 'admin';

    if (!isUser1Valid || !isUser2Valid) {
      throw new Error('One or both users not involved in this order');
    }

    return context.order_id;
  }

  throw new Error('Invalid context code');
};

/**
 * GET CHAT HISTORY
 * Fetch all messages for an order context
 */
exports.getChatHistory = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const role = req.user.role;
    const { context_id } = req.params;
    const { page = 0, limit = 50 } = req.query;
    const offset = parseInt(page) * parseInt(limit);

    // =======================
    // FETCH ORDER & VALIDATE ACCESS
    // =======================
    let query;
    if (context_id.startsWith('QUERY_')) {
      query = `SELECT o.order_id, o.query_code, o.user_id, u.bde as bde_id, u.full_name as client_name
               FROM orders o
               JOIN users u ON o.user_id = u.user_id
               WHERE o.query_code = ?`;
    } else if (context_id.startsWith('WORK_')) {
      query = `SELECT o.order_id, o.work_code, o.user_id, o.writer_id, u.bde as bde_id, u.full_name as client_name
               FROM orders o
               JOIN users u ON o.user_id = u.user_id
               WHERE o.work_code = ?`;
    } else {
      return res.status(400).json({ success: false, message: 'Invalid context' });
    }

    const [[order]] = await db.query(query, [context_id]);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // =======================
    // VALIDATE USER ACCESS TO CHAT
    // =======================
    const hasAccess = 
      order.user_id === userId ||
      order.writer_id === userId ||
      order.bde_id === userId ||
      role === 'admin';

    if (!hasAccess) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // =======================
    // FETCH CHAT RECORD
    // =======================
    let [[chat]] = await db.query(
      `SELECT * FROM order_chats WHERE order_id = ? LIMIT 1`,
      [order.order_id]
    );

    if (!chat) {
      // Create chat if doesn't exist
      const [result] = await db.query(
        `INSERT INTO order_chats (order_id, chat_name, participants, messages, status, created_at, updated_at)
         VALUES (?, 'Order Chat', ?, '[]', 'active', NOW(), NOW())`,
        [order.order_id, JSON.stringify([order.user_id, order.writer_id || null, order.bde_id])]
      );
      chat = {
        chat_id: result.insertId,
        order_id: order.order_id,
        messages: '[]',
        status: 'active'
      };
    }

    // =======================
    // PARSE MESSAGES
    // =======================
    const allMessages = JSON.parse(chat.messages || '[]');
    const messages = allMessages.slice(offset, offset + parseInt(limit));
    const total = allMessages.length;

    return res.json({
      success: true,
      data: {
        chat_id: chat.chat_id,
        context: context_id,
        order_id: order.order_id,
        status: chat.status,
        messages,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total
        }
      }
    });

  } catch (err) {
    console.error('Error fetching chat history:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch chat history'
    });
  }
};

/**
 * SEND MESSAGE
 */
exports.sendMessage = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const role = req.user.role;
    const { context_id } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message cannot be empty'
      });
    }

    // =======================
    // FETCH ORDER & GET OTHER USER INFO
    // =======================
    let order;
    if (context_id.startsWith('QUERY_')) {
      [[order]] = await db.query(
        `SELECT o.order_id, o.query_code, o.user_id, u.bde, u.full_name as client_name
         FROM orders o
         JOIN users u ON o.user_id = u.user_id
         WHERE o.query_code = ?`,
        [context_id]
      );
    } else if (context_id.startsWith('WORK_')) {
      [[order]] = await db.query(
        `SELECT o.order_id, o.work_code, o.user_id, o.writer_id, u.bde, u.full_name as client_name
         FROM orders o
         JOIN users u ON o.user_id = u.user_id
         WHERE o.work_code = ?`,
        [context_id]
      );
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // =======================
    // VALIDATE ACCESS
    // =======================
    const hasAccess = 
      order.user_id === userId ||
      order.writer_id === userId ||
      order.bde === userId ||
      role === 'admin';

    if (!hasAccess) {
      await createAuditLog({
        user_id: userId,
        role,
        event_type: 'CHAT_PERMISSION_DENIED',
        resource_type: 'chat',
        resource_id: order.order_id,
        details: `User attempted unauthorized chat access in ${context_id}`,
        ip_address: req.ip,
        user_agent: req.get('User-Agent')
      });

      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // =======================
    // VALIDATE ROLE PAIR (if not admin)
    // =======================
    if (role !== 'admin') {
      // Get other participants' roles to validate pair
      const participants = [];
      if (order.user_id) {
        const [[clientUser]] = await db.query(
          `SELECT role FROM users WHERE user_id = ?`,
          [order.user_id]
        );
        if (clientUser) participants.push({ user_id: order.user_id, role: clientUser.role });
      }
      if (order.writer_id) {
        const [[writerUser]] = await db.query(
          `SELECT role FROM users WHERE user_id = ?`,
          [order.writer_id]
        );
        if (writerUser) participants.push({ user_id: order.writer_id, role: writerUser.role });
      }
      if (order.bde) {
        const [[bdeUser]] = await db.query(
          `SELECT role FROM users WHERE user_id = ?`,
          [order.bde]
        );
        if (bdeUser) participants.push({ user_id: order.bde, role: bdeUser.role });
      }

      // Check if sender can chat with any of the other participants
      const allowedPairs = [
        ['client', 'bde'],
        ['bde', 'admin'],
        ['writer', 'admin']
      ];

      const canChat = participants.some(p => {
        if (p.user_id === userId) return true; // Can chat with self
        const pair = [role, p.role].sort();
        return allowedPairs.some(ap => 
          (ap[0] === pair[0] && ap[1] === pair[1])
        );
      }) || participants.length === 0; // Allow if no other participants yet

      if (!canChat) {
        await createAuditLog({
          user_id: userId,
          role,
          event_type: 'CHAT_ROLE_PAIR_DENIED',
          resource_type: 'chat',
          resource_id: order.order_id,
          details: `Role pair validation failed: ${role} cannot chat with participants in ${context_id}`,
          ip_address: req.ip,
          user_agent: req.get('User-Agent')
        });

        return res.status(403).json({
          success: false,
          message: `Chat not allowed between ${role} and other participants`
        });
      }
    }

    // =======================
    // FETCH/CREATE CHAT
    // =======================
    let [[chat]] = await db.query(
      `SELECT * FROM order_chats WHERE order_id = ? LIMIT 1`,
      [order.order_id]
    );

    if (!chat) {
      const context_code = context_id;
      const [result] = await db.query(
        `INSERT INTO order_chats (order_id, context_code, chat_name, participants, messages, status, created_at, updated_at)
         VALUES (?, ?, 'Order Chat', ?, '[]', 'active', NOW(), NOW())`,
        [order.order_id, context_code, JSON.stringify([order.user_id, order.writer_id || null, order.bde].filter(Boolean))]
      );
      chat = {
        chat_id: result.insertId,
        order_id: order.order_id,
        context_code: context_code,
        messages: '[]',
        status: 'active'
      };
    }

    // =======================
    // CHECK CHAT STATUS
    // =======================
    if (chat.status === 'closed') {
      return res.status(400).json({
        success: false,
        message: 'This chat is closed'
      });
    }

    if (chat.status === 'restricted') {
      if (role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Chat is restricted by admin'
        });
      }
    }

    // =======================
    // APPEND MESSAGE
    // =======================
    const messages = JSON.parse(chat.messages || '[]');
    const newMessage = {
      id: Date.now(),
      sender_id: userId,
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
    // EMIT REALTIME EVENT
    // =======================
    if (req.io) {
      req.io.to(`context:${context_id}`).emit('chat:new_message', {
        chat_id: chat.chat_id,
        context_code: context_id,
        message: newMessage
      });
    }

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: userId,
      role,
      event_type: 'CHAT_MESSAGE_SENT',
      resource_type: 'chat',
      resource_id: chat.chat_id,
      details: `Message sent in ${context_id}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { context_id, message_length: message.length }
    });

    return res.status(201).json({
      success: true,
      message: 'Message sent',
      data: newMessage
    });

  } catch (err) {
    console.error('Error sending message:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to send message'
    });
  }
};

/**
 * RESTRICT CHAT (Admin only)
 * Make chat read-only
 */
exports.restrictChat = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const role = req.user.role;
    const { context_id } = req.params;
    const { reason } = req.body;

    if (role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can restrict chats'
      });
    }

    // =======================
    // FETCH ORDER
    // =======================
    let order;
    if (context_id.startsWith('QUERY_')) {
      [[order]] = await db.query(
        `SELECT o.order_id FROM orders o WHERE o.query_code = ?`,
        [context_id]
      );
    } else {
      [[order]] = await db.query(
        `SELECT o.order_id FROM orders o WHERE o.work_code = ?`,
        [context_id]
      );
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // =======================
    // UPDATE CHAT STATUS
    // =======================
    await db.query(
      `UPDATE order_chats SET status = 'restricted' WHERE order_id = ?`,
      [order.order_id]
    );

    // =======================
    // ADD SYSTEM MESSAGE
    // =======================
    const [[chat]] = await db.query(
      `SELECT * FROM order_chats WHERE order_id = ?`,
      [order.order_id]
    );

    const messages = JSON.parse(chat.messages || '[]');
    const systemMessage = {
      id: Date.now(),
      sender_id: userId,
      sender_role: 'admin',
      message_type: 'system',
      content: `Admin restricted chat: ${reason || 'No reason provided'}`,
      timestamp: new Date().toISOString()
    };
    messages.push(systemMessage);

    await db.query(
      `UPDATE order_chats SET messages = ? WHERE chat_id = ?`,
      [JSON.stringify(messages), chat.chat_id]
    );

    // =======================
    // EMIT REALTIME EVENT
    // =======================
    if (req.io) {
      req.io.to(`context:${context_id}`).emit('chat:system_message', {
        chat_id: chat.chat_id,
        context_code: context_id,
        message: systemMessage
      });
      
      req.io.to(`context:${context_id}`).emit('chat:restricted', {
        chat_id: chat.chat_id,
        context_code: context_id,
        reason: reason || 'Admin action',
        restricted_by: userId
      });
    }

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: userId,
      role: 'admin',
      event_type: 'CHAT_RESTRICTED',
      resource_type: 'chat',
      resource_id: chat.chat_id,
      details: `Chat restricted in ${context_id}. Reason: ${reason || 'Admin action'}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    return res.json({
      success: true,
      message: 'Chat restricted'
    });

  } catch (err) {
    console.error('Error restricting chat:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to restrict chat'
    });
  }
};

/**
 * CLOSE CHAT (Admin only)
 * Make chat permanently closed
 */
exports.closeChat = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const role = req.user.role;
    const { context_id } = req.params;
    const { reason } = req.body;

    if (role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can close chats'
      });
    }

    // =======================
    // FETCH ORDER
    // =======================
    let order;
    if (context_id.startsWith('QUERY_')) {
      [[order]] = await db.query(
        `SELECT o.order_id FROM orders o WHERE o.query_code = ?`,
        [context_id]
      );
    } else {
      [[order]] = await db.query(
        `SELECT o.order_id FROM orders o WHERE o.work_code = ?`,
        [context_id]
      );
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // =======================
    // UPDATE CHAT STATUS
    // =======================
    await db.query(
      `UPDATE order_chats SET status = 'closed' WHERE order_id = ?`,
      [order.order_id]
    );

    // =======================
    // ADD SYSTEM MESSAGE
    // =======================
    const [[chat]] = await db.query(
      `SELECT * FROM order_chats WHERE order_id = ?`,
      [order.order_id]
    );

    const messages = JSON.parse(chat.messages || '[]');
    const systemMessage = {
      id: Date.now(),
      sender_id: userId,
      sender_role: 'admin',
      message_type: 'system',
      content: `Admin closed chat: ${reason || 'No reason provided'}`,
      timestamp: new Date().toISOString()
    };
    messages.push(systemMessage);

    await db.query(
      `UPDATE order_chats SET messages = ? WHERE chat_id = ?`,
      [JSON.stringify(messages), chat.chat_id]
    );

    // =======================
    // EMIT REALTIME EVENT
    // =======================
    if (req.io) {
      req.io.to(`context:${context_id}`).emit('chat:system_message', {
        chat_id: chat.chat_id,
        context_code: context_id,
        message: systemMessage
      });
      
      req.io.to(`context:${context_id}`).emit('chat:closed', {
        chat_id: chat.chat_id,
        context_code: context_id,
        reason: reason || 'Admin action',
        closed_by: userId
      });
    }

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: userId,
      role: 'admin',
      event_type: 'CHAT_CLOSED',
      resource_type: 'chat',
      resource_id: chat.chat_id,
      details: `Chat closed in ${context_id}. Reason: ${reason || 'Admin action'}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    return res.json({
      success: true,
      message: 'Chat closed'
    });

  } catch (err) {
    console.error('Error closing chat:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to close chat'
    });
  }
};

module.exports = exports;
