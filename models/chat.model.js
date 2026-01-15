const db = require('../config/db');

class ChatModel {

  /* ======================================================
     CONTEXT RESOLUTION
     ====================================================== */

  async getChatContext(contextCode) {
    const orderSql = contextCode.startsWith('QUERY_')
      ? 'SELECT order_id FROM orders WHERE query_code = ? LIMIT 1'
      : 'SELECT order_id FROM orders WHERE work_code = ? LIMIT 1';

    const [[order]] = await db.query(orderSql, [contextCode]);
    if (!order) return null;

    const { order_id } = order;

    const [[chat]] = await db.query(
      'SELECT chat_id FROM order_chat_messages WHERE order_id = ? LIMIT 1',
      [order_id]
    );

    return {
      order_id,
      chat_id: chat ? chat.chat_id : null
    };
  }

  /* ======================================================
     CHAT CREATION
     ====================================================== */

  async createChatAndFirstMessage({
    order_id,
    sender_id,
    sender_role,
    content,
    message_type = 'text',
    attachments = null
  }) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [res] = await conn.query(
        `
        INSERT INTO order_chat_messages
          (chat_id, order_id, sender_id, sender_role, message_type, content, attachments, created_at)
        VALUES
          (NULL, ?, ?, ?, ?, ?, ?, NOW())
        `,
        [order_id, sender_id, sender_role, message_type, content, attachments]
      );

      const message_id = res.insertId;

      const [[row]] = await conn.query(
        'SELECT chat_id FROM order_chat_messages WHERE message_id = ?',
        [message_id]
      );

      await conn.commit();
      return { chat_id: row.chat_id, message_id };

    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /* ======================================================
     PARTICIPANTS
     ====================================================== */

  async getChatParticipants(chatId) {
    const [rows] = await db.query(
      `
      SELECT
        p.user_id,
        p.role,
        p.is_muted,
        u.full_name,
        u.is_active
      FROM order_chat_participants p
      JOIN users u ON u.user_id = p.user_id
      WHERE p.chat_id = ?
      `,
      [chatId]
    );
    return rows;
  }

  async getParticipant(chatId, userId) {
    const [[row]] = await db.query(
      `
      SELECT *
      FROM order_chat_participants
      WHERE chat_id = ? AND user_id = ?
      LIMIT 1
      `,
      [chatId, userId]
    );
    return row;
  }

  async addParticipant(chatId, userId, role) {
    await db.query(
      `
      INSERT IGNORE INTO order_chat_participants
        (chat_id, user_id, role, joined_at)
      VALUES (?, ?, ?, NOW())
      `,
      [chatId, userId, role]
    );
  }

  /* ======================================================
     MESSAGES
     ====================================================== */

  async addMessage({
    chatId,
    orderId,
    senderId,
    senderRole,
    content,
    messageType = 'text',
    attachments = null
  }) {
    const [res] = await db.query(
      `
      INSERT INTO order_chat_messages
        (chat_id, order_id, sender_id, sender_role, message_type, content, attachments, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [chatId, orderId, senderId, senderRole, messageType, content, attachments]
    );
    return res.insertId;
  }

  async getMessageById(messageId) {
    const [[row]] = await db.query(
      `
      SELECT
        m.*,
        u.full_name AS sender_name
      FROM order_chat_messages m
      LEFT JOIN users u ON u.user_id = m.sender_id
      WHERE m.message_id = ?
      `,
      [messageId]
    );
    return row;
  }

  async getMessages(chatId, userId, { limit = 50, offset = 0 }) {
    const [messages] = await db.query(
      `
      SELECT
        m.message_id,
        m.chat_id,
        m.order_id,
        m.sender_id,
        m.sender_role,
        m.message_type,
        m.content,
        m.attachments,
        m.is_deleted,
        m.is_edited,
        m.edited_at,
        m.created_at,
        COALESCE(u.full_name, 'System') AS sender_name,
        (r.user_id IS NOT NULL) AS is_read
      FROM order_chat_messages m
      LEFT JOIN users u ON u.user_id = m.sender_id
      LEFT JOIN order_chat_message_reads r
        ON r.message_id = m.message_id
       AND r.user_id = ?
      WHERE m.chat_id = ?
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [userId, chatId, limit, offset]
    );

    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM order_chat_messages WHERE chat_id = ?',
      [chatId]
    );

    return { messages: messages.reverse(), total };
  }

  async markMessagesAsRead(chatId, userId, messageIds) {
    if (!messageIds.length) return;

    const values = messageIds
      .map(id => `(${db.escape(id)}, ${db.escape(userId)}, NOW())`)
      .join(',');

    await db.query(
      `
      INSERT IGNORE INTO order_chat_message_reads
        (message_id, user_id, read_at)
      VALUES ${values}
      `
    );
  }

  /* ======================================================
     MESSAGE MUTATION
     ====================================================== */

  async softDeleteMessage(messageId, userId) {
    const [res] = await db.query(
      `
      UPDATE order_chat_messages
      SET is_deleted = 1,
          content = 'This message was deleted.'
      WHERE message_id = ? AND sender_id = ?
      `,
      [messageId, userId]
    );
    return res.affectedRows > 0;
  }

  async editMessage(messageId, userId, content) {
    const [res] = await db.query(
      `
      UPDATE order_chat_messages
      SET content = ?,
          is_edited = 1,
          edited_at = NOW()
      WHERE message_id = ? AND sender_id = ?
      `,
      [content, messageId, userId]
    );
    return res.affectedRows > 0;
  }

  /* ======================================================
     PARTICIPANT CONTROL
     ====================================================== */

  async muteParticipant(chatId, userId) {
    const [res] = await db.query(
      'UPDATE order_chat_participants SET is_muted = 1 WHERE chat_id = ? AND user_id = ?',
      [chatId, userId]
    );
    return res.affectedRows > 0;
  }

  async unmuteParticipant(chatId, userId) {
    const [res] = await db.query(
      'UPDATE order_chat_participants SET is_muted = 0 WHERE chat_id = ? AND user_id = ?',
      [chatId, userId]
    );
    return res.affectedRows > 0;
  }

  async removeParticipant(chatId, userId) {
    const [res] = await db.query(
      'DELETE FROM order_chat_participants WHERE chat_id = ? AND user_id = ?',
      [chatId, userId]
    );
    return res.affectedRows > 0;
  }

  /* ======================================================
     CONVERSATIONS LIST
     ====================================================== */

  async getConversations(userId, role) {
    const filter = role === 'admin' ? '' : 'WHERE p_self.user_id = ?';

    const sql = `
      SELECT
        chats.chat_id,
        chats.order_id,
        COALESCE(o.work_code, o.query_code) AS context_code,
        o.subject,
        lm.last_message_content AS last_message,
        lm.last_message_at,
        unread.unread_count,
        (
          SELECT GROUP_CONCAT(u.full_name SEPARATOR ', ')
          FROM order_chat_participants p
          JOIN users u ON u.user_id = p.user_id
          WHERE p.chat_id = chats.chat_id
        ) AS participant_names,
        (
          SELECT GROUP_CONCAT(p.role SEPARATOR ',')
          FROM order_chat_participants p
          WHERE p.chat_id = chats.chat_id
        ) AS participant_roles
      FROM (
        SELECT
          p_self.chat_id,
          MAX(m.order_id) AS order_id
        FROM order_chat_participants p_self
        JOIN order_chat_messages m ON m.chat_id = p_self.chat_id
        ${filter}
        GROUP BY p_self.chat_id
      ) chats
      JOIN orders o ON o.order_id = chats.order_id
      LEFT JOIN (
        SELECT
          m.chat_id,
          m.content AS last_message_content,
          m.created_at AS last_message_at
        FROM order_chat_messages m
        INNER JOIN (
          SELECT chat_id, MAX(message_id) max_id
          FROM order_chat_messages
          GROUP BY chat_id
        ) x ON x.max_id = m.message_id
      ) lm ON lm.chat_id = chats.chat_id
      LEFT JOIN (
        SELECT
          m.chat_id,
          COUNT(*) AS unread_count
        FROM order_chat_messages m
        LEFT JOIN order_chat_message_reads r
          ON r.message_id = m.message_id
         AND r.user_id = ?
        WHERE r.read_at IS NULL
          AND m.sender_id != ?
        GROUP BY m.chat_id
      ) unread ON unread.chat_id = chats.chat_id
      ORDER BY lm.last_message_at DESC
    `;

    const params =
      role === 'admin'
        ? [userId, userId]
        : [userId, userId, userId];

    const [rows] = await db.query(sql, params);
    return rows;
  }
}

module.exports = new ChatModel();
