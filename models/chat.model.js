/**
 * CHAT MODEL - Unified Chat System
 * 
 * Tables used:
 * - general_chats: Chat metadata (status, created_by, title)
 * - general_chat_participants: Who is in each chat (user_id, role)
 * - general_chat_messages: Messages in chats
 * - chat_requests: Pending requests from non-admin users
 * 
 * RULES:
 * - Admin can see ALL chats
 * - Non-admin users only see chats they participate in
 * - Writers only see chats with admin
 * - BDE sees: chats with admin, chats with assigned clients
 * - Clients see: chats with admin, chats with assigned BDE
 */

const db = require('../config/db');

class ChatModel {
  /**
   * Get all chats for admin (full visibility)
   * Returns chats categorized by participants
   */
  static async getAdminChats(adminId) {
    const sql = `
      SELECT 
        gc.chat_id,
        gc.order_id,
        gc.title,
        gc.status,
        gc.is_important,
        gc.created_at,
        gc.updated_at,
        
        -- Participant flags (1 if present, 0 if not)
        MAX(CASE WHEN p.role = 'admin' THEN 1 ELSE 0 END) as has_admin,
        MAX(CASE WHEN p.role = 'bde' THEN 1 ELSE 0 END) as has_bde,
        MAX(CASE WHEN p.role = 'writer' THEN 1 ELSE 0 END) as has_writer,
        MAX(CASE WHEN p.role = 'client' THEN 1 ELSE 0 END) as has_client,
        
        -- Get display name (first non-admin participant)
        (SELECT u.full_name FROM general_chat_participants cp 
         JOIN users u ON u.user_id = cp.user_id 
         WHERE cp.chat_id = gc.chat_id AND cp.role != 'admin' 
         LIMIT 1) as display_name,
         
        -- Get role label
        (SELECT cp.role FROM general_chat_participants cp 
         WHERE cp.chat_id = gc.chat_id AND cp.role != 'admin' 
         LIMIT 1) as role_label,
        
        -- Last message info
        (SELECT content FROM general_chat_messages 
         WHERE chat_id = gc.chat_id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM general_chat_messages 
         WHERE chat_id = gc.chat_id ORDER BY created_at DESC LIMIT 1) as last_message_at,
        
        -- Message count
        (SELECT COUNT(*) FROM general_chat_messages WHERE chat_id = gc.chat_id) as message_count,
        
        -- Unread count
        (SELECT COUNT(*) FROM general_chat_messages m 
         WHERE m.chat_id = gc.chat_id 
         AND m.sender_id != ?
         AND (m.is_read IS NULL OR JSON_SEARCH(m.is_read, 'one', CAST(? as char)) IS NULL)) as unread_count
         
      FROM general_chats gc
      JOIN general_chat_participants p ON p.chat_id = gc.chat_id
      WHERE gc.status != 'deleted'
      GROUP BY gc.chat_id
      ORDER BY gc.updated_at DESC
    `;
    
    const [rows] = await db.query(sql, [adminId, adminId]);
    return rows;
  }

  /**
   * Get chats for non-admin user (filtered by participation)
   */
  static async getUserChats(userId, role) {
    let sql = `
      SELECT 
        gc.chat_id,
        gc.order_id,
        gc.title,
        gc.status,
        gc.is_important,
        gc.created_at,
        gc.updated_at,
        
        -- Participant flags
        MAX(CASE WHEN p.role = 'admin' THEN 1 ELSE 0 END) as has_admin,
        MAX(CASE WHEN p.role = 'bde' THEN 1 ELSE 0 END) as has_bde,
        MAX(CASE WHEN p.role = 'writer' THEN 1 ELSE 0 END) as has_writer,
        MAX(CASE WHEN p.role = 'client' THEN 1 ELSE 0 END) as has_client,
        
        -- Get display name (other participant)
        (SELECT u.full_name FROM general_chat_participants cp 
         JOIN users u ON u.user_id = cp.user_id 
         WHERE cp.chat_id = gc.chat_id AND cp.user_id != ? 
         LIMIT 1) as display_name,
         
        -- Get role label
        (SELECT cp.role FROM general_chat_participants cp 
         WHERE cp.chat_id = gc.chat_id AND cp.user_id != ? 
         LIMIT 1) as role_label,
        
        -- Last message
        (SELECT content FROM general_chat_messages 
         WHERE chat_id = gc.chat_id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM general_chat_messages 
         WHERE chat_id = gc.chat_id ORDER BY created_at DESC LIMIT 1) as last_message_at,
        
        -- Message count
        (SELECT COUNT(*) FROM general_chat_messages WHERE chat_id = gc.chat_id) as message_count,
        
        -- Unread count
        (SELECT COUNT(*) FROM general_chat_messages m 
         WHERE m.chat_id = gc.chat_id 
         AND m.sender_id != ?
         AND (m.is_read IS NULL OR JSON_SEARCH(m.is_read, 'one', CAST(? as char)) IS NULL)) as unread_count
         
      FROM general_chats gc
      JOIN general_chat_participants p ON p.chat_id = gc.chat_id
      WHERE gc.status IN ('active', 'closed')
      AND gc.chat_id IN (
        SELECT chat_id FROM general_chat_participants WHERE user_id = ?
      )
    `;
    
    // Writer: only see chats with admin
    if (role === 'writer') {
      sql += ` AND gc.chat_id IN (
        SELECT chat_id FROM general_chat_participants WHERE role = 'admin'
      )`;
    }
    
    sql += ` GROUP BY gc.chat_id ORDER BY gc.updated_at DESC`;
    
    const [rows] = await db.query(sql, [userId, userId, userId, userId, userId]);
    return rows;
  }

  /**
   * Get messages for a chat with pagination
   */
  static async getChatMessages(chatId, userId, limit = 50, beforeId = null) {
    let sql = `
      SELECT 
        m.message_id,
        m.chat_id,
        m.sender_id,
        m.content,
        m.message_type,
        m.attachments,
        m.is_read,
        m.created_at,
        u.full_name as sender_name,
        p.role as sender_role
      FROM general_chat_messages m
      JOIN users u ON u.user_id = m.sender_id
      JOIN general_chat_participants p ON p.chat_id = m.chat_id AND p.user_id = m.sender_id
      WHERE m.chat_id = ?
    `;

    const params = [chatId];

    if (beforeId) {
        sql += ` AND m.message_id < ?`;
        params.push(beforeId);
    }
    
    // We get LIMIT + 1 to check if there are more
    sql += ` ORDER BY m.message_id DESC LIMIT ?`;
    params.push(limit);
    
    const [rows] = await db.query(sql, params);
    
    // Reverse to show in chronological order
    return rows.reverse();
  }

  /**
   * Send a message in a chat
   */
  static async sendMessage(chatId, senderId, content, messageType = 'text', attachments = null) {
    const sql = `
      INSERT INTO general_chat_messages 
        (chat_id, sender_id, content, message_type, attachments, is_read)
      VALUES (?, ?, ?, ?, ?, '[]')
    `;
    
    const [result] = await db.query(sql, [chatId, senderId, content, messageType, 
      attachments ? JSON.stringify(attachments) : null]);
    
    // Update chat's updated_at
    await db.query('UPDATE general_chats SET updated_at = NOW() WHERE chat_id = ?', [chatId]);
    
    return result.insertId;
  }

  /**
   * Check if user is participant in chat
   */
  static async isParticipant(chatId, userId) {
    const sql = `SELECT 1 FROM general_chat_participants WHERE chat_id = ? AND user_id = ?`;
    const [rows] = await db.query(sql, [chatId, userId]);
    return rows.length > 0;
  }

  /**
   * Get chat by ID
   */
  static async getChatById(chatId) {
    const sql = `SELECT * FROM general_chats WHERE chat_id = ?`;
    const [rows] = await db.query(sql, [chatId]);
    return rows[0];
  }

  /**
   * Create a new chat (admin only)
   */
  static async createChat(createdBy, participantUserId, participantRole, title = null) {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // Get admin role
      const [adminUser] = await connection.query(
        'SELECT role FROM users WHERE user_id = ?', [createdBy]
      );
      const adminRole = adminUser[0]?.role || 'admin';
      
      // Create chat
      const [chatResult] = await connection.query(
        `INSERT INTO general_chats (created_by, title, status) VALUES (?, ?, 'active')`,
        [createdBy, title || `Chat with User #${participantUserId}`]
      );
      const chatId = chatResult.insertId;
      
      // Add admin as participant
      await connection.query(
        `INSERT INTO general_chat_participants (chat_id, user_id, role) VALUES (?, ?, ?)`,
        [chatId, createdBy, adminRole]
      );
      
      // Add other participant
      await connection.query(
        `INSERT INTO general_chat_participants (chat_id, user_id, role) VALUES (?, ?, ?)`,
        [chatId, participantUserId, participantRole]
      );
      
      await connection.commit();
      return chatId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Check if an active chat exists between two users
   */
  static async findActiveChatBetween(userId1, userId2) {
    const sql = `
      SELECT gc.chat_id, gc.title
      FROM general_chats gc
      JOIN general_chat_participants p1 ON p1.chat_id = gc.chat_id
      JOIN general_chat_participants p2 ON p2.chat_id = gc.chat_id
      WHERE gc.status = 'active'
      AND p1.user_id = ?
      AND p2.user_id = ?
      LIMIT 1
    `;
    const [rows] = await db.query(sql, [userId1, userId2]);
    return rows[0] || null;
  }

  /**
   * Create a chat request (for non-admin users)
   */
  static async createChatRequest(fromUserId, fromRole, requestType, message = null) {
    // Get an admin user to be the target
    const [admins] = await db.query(
      `SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1`
    );
    
    if (!admins.length) {
      throw new Error('No admin available');
    }
    
    const toUserId = admins[0].user_id;

    // Check if an active chat already exists
    const activeChat = await ChatModel.findActiveChatBetween(fromUserId, toUserId);
    if (activeChat) {
      throw new Error(`You already have an active chat with admin (#${activeChat.chat_id})`);
    }
    
    // Check if there's already a pending request
    const [existing] = await db.query(
      `SELECT request_id FROM chat_requests 
       WHERE from_user_id = ? AND status = 'pending'`,
      [fromUserId]
    );
    
    if (existing.length > 0) {
      throw new Error('You already have a pending chat request');
    }
    
    const sql = `
      INSERT INTO chat_requests 
        (from_user_id, from_role, to_user_id, request_type, message, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `;
    
    const [result] = await db.query(sql, [fromUserId, fromRole, toUserId, requestType, message]);
    return result.insertId;
  }

  /**
   * Get pending chat requests (admin only)
   */
  static async getChatRequests() {
    const sql = `
      SELECT 
        cr.request_id,
        cr.from_user_id,
        cr.from_role,
        cr.to_user_id,
        cr.request_type,
        cr.message,
        cr.status,
        cr.created_at,
        u.full_name as from_name,
        u.email as from_email
      FROM chat_requests cr
      JOIN users u ON u.user_id = cr.from_user_id
      WHERE cr.status = 'pending'
      ORDER BY cr.created_at DESC
    `;
    
    const [rows] = await db.query(sql);
    return rows;
  }

  /**
   * Approve chat request (creates a new chat)
   */
  static async approveChatRequest(requestId, adminId) {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // Get request details
      const [requests] = await connection.query(
        'SELECT * FROM chat_requests WHERE request_id = ? AND status = ?',
        [requestId, 'pending']
      );
      
      if (!requests.length) {
        throw new Error('Request not found or already processed');
      }
      
      const request = requests[0];
      
      // Create chat
      const [chatResult] = await connection.query(
        `INSERT INTO general_chats (created_by, title, status) VALUES (?, ?, 'active')`,
        [adminId, `Admin Chat - Request #${requestId}`]
      );
      const chatId = chatResult.insertId;
      
      // Add admin as participant
      await connection.query(
        `INSERT INTO general_chat_participants (chat_id, user_id, role) VALUES (?, ?, 'admin')`,
        [chatId, adminId]
      );
      
      // Add requester as participant
      await connection.query(
        `INSERT INTO general_chat_participants (chat_id, user_id, role) VALUES (?, ?, ?)`,
        [chatId, request.from_user_id, request.from_role]
      );
      
      // Update request
      await connection.query(
        `UPDATE chat_requests SET status = 'approved', processed_by = ?, processed_at = NOW(), chat_id = ? WHERE request_id = ?`,
        [adminId, chatId, requestId]
      );
      
      await connection.commit();
      return { chatId, request };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Reject chat request
   */
  static async rejectChatRequest(requestId, adminId, reason = null) {
    const sql = `
      UPDATE chat_requests 
      SET status = 'rejected', processed_by = ?, processed_at = NOW(), rejected_reason = ?
      WHERE request_id = ? AND status = 'pending'
    `;
    
    const [result] = await db.query(sql, [adminId, reason, requestId]);
    return result.affectedRows > 0;
  }

  /**
   * Close a chat (admin only)
   */
  static async closeChat(chatId) {
    const sql = `UPDATE general_chats SET status = 'closed' WHERE chat_id = ?`;
    const [result] = await db.query(sql, [chatId]);
    return result.affectedRows > 0;
  }

  /**
   * Delete a chat (soft delete)
   */
  static async deleteChat(chatId) {
    const sql = `UPDATE general_chats SET status = 'deleted' WHERE chat_id = ?`;
    const [result] = await db.query(sql, [chatId]);
    return result.affectedRows > 0;
  }

  /**
   * Restrict a chat (admin only)
   */
  static async restrictChat(chatId) {
    const sql = `UPDATE general_chats SET status = 'restricted' WHERE chat_id = ?`;
    const [result] = await db.query(sql, [chatId]);
    return result.affectedRows > 0;
  }

  /**
   * Toggle important flag (admin only)
   */
  static async toggleImportant(chatId) {
    const sql = `UPDATE general_chats SET is_important = NOT is_important WHERE chat_id = ?`;
    const [result] = await db.query(sql, [chatId]);
    return result.affectedRows > 0;
  }

  /**
   * Mark messages as read
   */
  static async markAsRead(chatId, userId) {
    // Get all unread messages
    const [messages] = await db.query(
      `SELECT message_id, is_read FROM general_chat_messages 
       WHERE chat_id = ? AND sender_id != ?`,
      [chatId, userId]
    );
    
    for (const msg of messages) {
      let readBy = msg.is_read;
      
      // Handle case where mysql2 already parsed the JSON
      if (typeof readBy === 'string') {
        try {
          readBy = JSON.parse(readBy);
        } catch (e) {
          readBy = [];
        }
      }

      // Ensure it's an array
      if (!Array.isArray(readBy)) {
        readBy = [];
      }
      
      if (!readBy.includes(userId)) {
        readBy.push(userId);
        await db.query(
          'UPDATE general_chat_messages SET is_read = ? WHERE message_id = ?',
          [JSON.stringify(readBy), msg.message_id]
        );
      }
    }
    
    return true;
  }

  /**
   * Get user by ID
   */
  static async getUserById(userId) {
    const [rows] = await db.query(
      'SELECT user_id, full_name, email, role FROM users WHERE user_id = ?',
      [userId]
    );
    return rows[0];
  }

  /**
   * Search users for admin (to create new chats)
   */
  static async searchUsers(query, excludeUserId) {
    const sql = `
      SELECT user_id, full_name, email, role 
      FROM users 
      WHERE (full_name LIKE ? OR email LIKE ?)
      AND user_id != ?
      AND is_active = 1
      LIMIT 10
    `;
    
    const searchTerm = `%${query}%`;
    const [rows] = await db.query(sql, [searchTerm, searchTerm, excludeUserId]);
    return rows;
  }

  /**
   * Get chat participants
   */
  static async getChatParticipants(chatId) {
    const sql = `
      SELECT p.user_id, p.role, u.full_name, u.email
      FROM general_chat_participants p
      JOIN users u ON u.user_id = p.user_id
      WHERE p.chat_id = ?
    `;
    const [rows] = await db.query(sql, [chatId]);
    return rows;
  }

  /**
   * Create chat for an order
   */
  static async createOrderChat(orderId, creatorId, title) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Check if chat already exists
      const [existing] = await connection.query('SELECT chat_id FROM general_chats WHERE order_id = ?', [orderId]);
      if (existing.length > 0) {
        await connection.commit();
        return existing[0].chat_id;
      }

      // Create chat
      const [chatResult] = await connection.query(
        `INSERT INTO general_chats (created_by, order_id, title, status, chat_type) VALUES (?, ?, ?, 'active', 'order')`,
        [creatorId, orderId, title]
      );
      const chatId = chatResult.insertId;

      // Add creator as participant
      const [creator] = await connection.query('SELECT role FROM users WHERE user_id = ?', [creatorId]);
      if (creator.length > 0) {
          await connection.query(
            `INSERT INTO general_chat_participants (chat_id, user_id, role) VALUES (?, ?, ?)`,
            [chatId, creatorId, creator[0].role]
          );
      }

      // Add all admins as participants automatically
      // In a real system you might only add specific admins, but for now we add all to ensure visibility
      
      const [admins] = await connection.query("SELECT user_id FROM users WHERE role = 'admin'");
      for(const admin of admins) {
          await connection.query(
            `INSERT IGNORE INTO general_chat_participants (chat_id, user_id, role) VALUES (?, ?, 'admin')`,
            [chatId, admin.user_id]
          );
      }

      await connection.commit();
      return chatId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  
  /** 
   * Add participant to chat 
   */
  static async addParticipant(chatId, userId, role) {
      await db.query(
          `INSERT IGNORE INTO general_chat_participants (chat_id, user_id, role) VALUES (?, ?, ?)`,
          [chatId, userId, role]
      );
  }

  /**
   * Get chat ID by order ID
   */
  static async getOrderChat(orderId) {
    const [rows] = await db.query('SELECT chat_id FROM general_chats WHERE order_id = ?', [orderId]);
    return rows.length > 0 ? rows[0] : null;
  }
}

module.exports = ChatModel;
