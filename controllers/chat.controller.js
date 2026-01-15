const ChatModel = require('../models/chat.model');
const db = require('../config/db');
const { createAuditLog } = require('../utils/audit');
const { getIO } = require('../utils/socket');

/**
 * Validate context_id (order_code / query_code / work_code)
 * and ensure user has access.
 * Returns: { order_id, chat_id, participant }
 */
async function getValidatedContext(contextId, user) {
  const { user_id, role } = user;

  const context = await ChatModel.getChatContext(contextId);
  if (!context) {
    throw { statusCode: 404, message: 'Context not found' };
  }

  let participant = null;

  if (context.chat_id) {
    participant = await ChatModel.getParticipant(context.chat_id, user_id);
    if (role !== 'admin' && !participant) {
      throw {
        statusCode: 403,
        message: 'Access denied: You are not a participant in this chat.'
      };
    }
  }

  const orderSql = `
    SELECT 
      o.user_id,
      o.writer_id,
      (SELECT bde FROM users WHERE user_id = o.user_id) AS bde_id
    FROM orders o
    WHERE o.order_id = ?
  `;
  const [[order]] = await db.query(orderSql, [context.order_id]);

  if (!order) {
    throw { statusCode: 404, message: 'Order not found' };
  }

  const isInvolved =
    order.user_id === user_id ||
    order.writer_id === user_id ||
    order.bde_id === user_id;

  if (role !== 'admin' && !isInvolved) {
    throw {
      statusCode: 403,
      message: 'Access denied: You are not involved in this order.'
    };
  }

  return {
    order_id: context.order_id,
    chat_id: context.chat_id || null,
    participant
  };
}

/**
 * GET MY CONVERSATIONS
 */
exports.getMyConversations = async (req, res) => {
  try {
    const { user_id, role, full_name } = req.user;

    const rows = await ChatModel.getConversations(user_id, role);

    const conversations = rows.map(chat => {
      const participants = chat.participant_names
        ? chat.participant_names.split(', ')
        : [];

      const display_name =
        role === 'admin'
          ? participants.join(', ')
          : participants.filter(n => n !== full_name).join(', ') || 'Chat';

      return {
        chat_id: chat.chat_id,
        context_code: chat.context_code,
        title: chat.subject || chat.context_code,
        display_name,
        last_message: chat.last_message || 'No messages yet.',
        last_message_at: chat.last_message_at,
        unread_count: Number(chat.unread_count) || 0,
        participants
      };
    });

    res.status(200).json({ success: true, conversations });
  } catch (err) {
    console.error('Error in getMyConversations:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve conversations.'
    });
  }
};

/**
 * GET CHAT HISTORY
 */
exports.getChatHistory = async (req, res) => {
  try {
    const { context_id } = req.params;
    const { user_id } = req.user;
    const limit = Number(req.query.limit || 50);
    const offset = Number(req.query.offset || 0);

    const { chat_id } = await getValidatedContext(context_id, req.user);

    if (!chat_id) {
      return res.status(200).json({
        success: true,
        messages: [],
        participants: [],
        pagination: { total: 0, limit, offset }
      });
    }

    const [{ messages, total }, participants] = await Promise.all([
      ChatModel.getMessages(chat_id, user_id, { limit, offset }),
      ChatModel.getChatParticipants(chat_id)
    ]);

    const unreadIds = messages
      .filter(m => !m.is_read && m.sender_id !== user_id)
      .map(m => m.message_id);

    if (unreadIds.length) {
      await ChatModel.markMessagesAsRead(chat_id, user_id, unreadIds);
    }

    res.status(200).json({
      success: true,
      messages: messages.map(m => ({
        ...m,
        is_mine: m.sender_id === user_id
      })),
      participants,
      pagination: { total, limit, offset }
    });
  } catch (err) {
    console.error('Error in getChatHistory:', err);
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch chat history.'
    });
  }
};

/**
 * SEND MESSAGE
 */
exports.sendMessage = async (req, res) => {
  try {
    const { context_id } = req.params;
    const { user_id, role } = req.user;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message content cannot be empty.'
      });
    }

    let { order_id, chat_id, participant } =
      await getValidatedContext(context_id, req.user);

    if (participant?.is_muted) {
      return res.status(403).json({
        success: false,
        message: 'You are muted and cannot send messages.'
      });
    }

    let message_id;

    if (!chat_id) {
      const result = await ChatModel.createChatAndFirstMessage({
        order_id,
        sender_id: user_id,
        sender_role: role,
        content
      });

      chat_id = result.chat_id;
      message_id = result.message_id;

      const [[order]] = await db.query(
        `
        SELECT 
          o.user_id,
          o.writer_id,
          (SELECT bde FROM users WHERE user_id = o.user_id) AS bde_id
        FROM orders o
        WHERE o.order_id = ?
        `,
        [order_id]
      );

      const additions = [];
      if (order.user_id) additions.push(ChatModel.addParticipant(chat_id, order.user_id, 'client'));
      if (order.writer_id) additions.push(ChatModel.addParticipant(chat_id, order.writer_id, 'writer'));
      if (order.bde_id) additions.push(ChatModel.addParticipant(chat_id, order.bde_id, 'bde'));

      if (!participant) {
        additions.push(ChatModel.addParticipant(chat_id, user_id, role));
      }

      await Promise.all(additions);
    } else {
      message_id = await ChatModel.addMessage({
        chatId: chat_id,
        orderId: order_id,
        senderId: user_id,
        senderRole: role,
        content
      });
    }

    await ChatModel.markMessagesAsRead(chat_id, user_id, [message_id]);
    const message = await ChatModel.getMessageById(message_id);

    const io = getIO();
    if (io) {
      const participants = await ChatModel.getChatParticipants(chat_id);
      for (const p of participants) {
        if (p.user_id !== user_id) {
          io.to(`user:${p.user_id}`).emit('chat:new_message', {
            context_code: context_id,
            chat_id,
            message: { ...message, is_mine: false }
          });
        }
      }
    }

    await createAuditLog({
      user_id,
      role,
      event_type: 'CHAT_MESSAGE_SENT',
      resource_type: 'chat',
      resource_id: chat_id,
      details: `Message sent in ${context_id}`
    });

    res.status(201).json({
      success: true,
      data: { ...message, is_mine: true }
    });
  } catch (err) {
    console.error('Error in sendMessage:', err);
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to send message.'
    });
  }
};

exports.restrictChat = (_, res) =>
  res.status(501).json({ success: false, message: 'Not implemented' });

exports.closeChat = (_, res) =>
  res.status(501).json({ success: false, message: 'Not implemented' });
