/**
 * CHAT CONTROLLER - Unified Chat System
 * 
 * Handles all chat API endpoints for admin, bde, writer, and client
 * 
 * ROLE PERMISSIONS:
 * - Admin: Create chat, approve/reject requests, close/restrict chats, see all chats
 * - BDE: Request admin chat, see own chats (admin + clients)
 * - Writer: Request admin chat, see only admin chats
 * - Client: Request admin chat, see own chats (admin + bde)
 */

const ChatModel = require('../models/chat.model');
const { getIO } = require('../utils/socket');

/**
 * GET /api/chat
 * Get all chats for the current user
 * Admin sees all, others see only their chats
 */
exports.getChats = async (req, res) => {
  console.log('[CHAT API] getChats called by user:', req.user?.user_id, 'role:', req.user?.role);
  try {
    const userId = req.user.user_id;
    const role = req.user.role.toLowerCase();
    
    let chats;
    if (role === 'admin') {
      chats = await ChatModel.getAdminChats(userId);
    } else {
      chats = await ChatModel.getUserChats(userId, role);
    }
    
    // Format for frontend
    const formatted = chats.map(chat => ({
      ...chat,
      context_code: `general-${chat.chat_id}`,
      display_name: chat.display_name || chat.title || `Chat #${chat.chat_id}`,
      is_restricted: chat.status === 'restricted',
      is_closed: chat.status === 'closed'
    }));
    
    res.json({ success: true, data: formatted });
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ success: false, message: 'Failed to load chats' });
  }
};

/**
 * GET /api/chat/:chatId/messages
 * Get messages for a specific chat
 */
exports.getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.user_id;
    const role = req.user.role.toLowerCase();
    
    // Parse chat ID from context_code format if needed
    const actualChatId = chatId.startsWith('general-') 
      ? parseInt(chatId.replace('general-', ''), 10) 
      : parseInt(chatId, 10);
    
    if (isNaN(actualChatId)) {
      return res.status(400).json({ success: false, message: 'Invalid chat ID' });
    }
    
    // Check access (admin can access all, others must be participants)
    if (role !== 'admin') {
      const isParticipant = await ChatModel.isParticipant(actualChatId, userId);
      if (!isParticipant) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }
    
    // Get chat info
    const chat = await ChatModel.getChatById(actualChatId);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }
    
    // Get messages with pagination
    const limit = parseInt(req.query.limit) || 50;
    const beforeId = req.query.before ? parseInt(req.query.before) : null;
    
    const messages = await ChatModel.getChatMessages(actualChatId, userId, limit, beforeId);
    
    // Mark as read only if loading latest
    if (!beforeId) {
      await ChatModel.markAsRead(actualChatId, userId);
    }
    
    // Get participants
    const participants = await ChatModel.getChatParticipants(actualChatId);
    
    res.json({ 
      success: true, 
      data: {
        chat: {
          chat_id: actualChatId,
          title: chat.title,
          status: chat.status,
          is_important: chat.is_important,
          is_restricted: chat.status === 'restricted',
          is_closed: chat.status === 'closed'
        },
        messages,
        participants
      }
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ success: false, message: 'Failed to load messages' });
  }
};

/**
 * POST /api/chat/:chatId/messages
 * Send a message in a chat
 */
exports.sendMessage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { content, message_type = 'text', attachments } = req.body;
    const userId = req.user.user_id;
    const role = req.user.role.toLowerCase();
    
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'Message content required' });
    }
    
    // Parse chat ID
    const actualChatId = chatId.startsWith('general-') 
      ? parseInt(chatId.replace('general-', ''), 10) 
      : parseInt(chatId, 10);
    
    if (isNaN(actualChatId)) {
      return res.status(400).json({ success: false, message: 'Invalid chat ID' });
    }
    
    // Check access
    if (role !== 'admin') {
      const isParticipant = await ChatModel.isParticipant(actualChatId, userId);
      if (!isParticipant) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }
    
    // Check if chat is restricted (admin can still send)
    const chat = await ChatModel.getChatById(actualChatId);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }
    
    if (chat.status === 'restricted' && role !== 'admin') {
      return res.status(403).json({ success: false, message: 'This chat has been restricted by admin' });
    }
    
    if (chat.status === 'closed') {
      return res.status(403).json({ success: false, message: 'This chat has been closed' });
    }
    
    // Send message
    const messageId = await ChatModel.sendMessage(actualChatId, userId, content.trim(), message_type, attachments);
    
    // Get sender info
    const sender = await ChatModel.getUserById(userId);
    
    // Emit socket event
    const io = getIO();
    if (io) {
      const participants = await ChatModel.getChatParticipants(actualChatId);
      
      const messageData = {
        message_id: messageId,
        chat_id: actualChatId,
        sender_id: userId,
        sender_name: sender?.full_name || 'Unknown',
        sender_role: role,
        content: content.trim(),
        message_type,
        attachments,
        created_at: new Date().toISOString()
      };
      
      // Emit to all participants
      participants.forEach(p => {
        io.to(`user:${p.user_id}`).emit('chat:message', messageData);
      });
    }
    
    res.json({ 
      success: true, 
      message_id: messageId,
      data: {
        message_id: messageId,
        content: content.trim(),
        created_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
};

/**
 * POST /api/chat
 * Create a new chat (admin only)
 */
exports.createChat = async (req, res) => {
  try {
    const { user_id, title } = req.body;
    const adminId = req.user.user_id;
    
    if (!user_id) {
      return res.status(400).json({ success: false, message: 'Target user ID required' });
    }
    
    // Get target user
    const targetUser = await ChatModel.getUserById(user_id);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check existing chat
    const existing = await ChatModel.findActiveChatBetween(adminId, user_id);
    if (existing) {
      return res.status(400).json({ 
        success: false, 
        message: 'An active chat already exists with this user',
        data: { chat_id: existing.chat_id } 
      });
    }
    
    // Create chat
    const chatId = await ChatModel.createChat(
      adminId,
      user_id,
      targetUser.role.toLowerCase(),
      title || `Chat with ${targetUser.full_name}`
    );
    
    // Emit socket event
    const io = getIO();
    if (io) {
      io.to(`user:${user_id}`).emit('chat:new', {
        chat_id: chatId,
        title: title || `Chat with Admin`,
        created_at: new Date().toISOString()
      });
    }
    
    res.json({ 
      success: true, 
      chat_id: chatId,
      data: { chat_id: chatId }
    });
  } catch (error) {
    console.error('Error creating chat:', error);
    res.status(500).json({ success: false, message: 'Failed to create chat' });
  }
};

/**
 * POST /api/chat/request
 * Request a chat with admin (for non-admin users)
 */
exports.requestChat = async (req, res) => {
  try {
    const { requestType = 'admin', message } = req.body;
    const userId = req.user.user_id;
    const role = req.user.role.toLowerCase();
    
    if (role === 'admin') {
      return res.status(400).json({ success: false, message: 'Admin cannot request chat' });
    }
    
    // Create request
    const requestId = await ChatModel.createChatRequest(userId, role, requestType, message);
    
    // Emit socket event to admins
    const io = getIO();
    if (io) {
      io.to('role:admin').emit('chat:request:new', {
        request_id: requestId,
        from_user_id: userId,
        from_role: role,
        from_name: req.user.full_name,
        request_type: requestType,
        message,
        created_at: new Date().toISOString()
      });
    }
    
    res.json({ 
      success: true, 
      request_id: requestId,
      message: 'Chat request sent successfully'
    });
  } catch (error) {
    console.error('Error requesting chat:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to request chat' });
  }
};

/**
 * GET /api/chat/requests
 * Get pending chat requests (admin only)
 */
exports.getRequests = async (req, res) => {
  console.log('[CHAT API] getRequests called by user:', req.user?.user_id, 'role:', req.user?.role);
  try {
    const requests = await ChatModel.getChatRequests();
    console.log('[CHAT API] getRequests found:', requests.length, 'requests');
    res.json({ success: true, data: requests });
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).json({ success: false, message: 'Failed to load requests' });
  }
};

/**
 * POST /api/chat/requests/:requestId/approve
 * Approve a chat request (admin only)
 */
exports.approveRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const adminId = req.user.user_id;
    
    const result = await ChatModel.approveChatRequest(requestId, adminId);
    
    // Emit socket events
    const io = getIO();
    if (io) {
      // Notify the requester
      io.to(`user:${result.request.from_user_id}`).emit('chat:approved', {
        request_id: requestId,
        chat_id: result.chatId,
        message: 'Your chat request has been approved'
      });
    }
    
    res.json({ 
      success: true, 
      chat_id: result.chatId,
      message: 'Chat request approved'
    });
  } catch (error) {
    console.error('Error approving request:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to approve request' });
  }
};

/**
 * POST /api/chat/requests/:requestId/reject
 * Reject a chat request (admin only)
 */
exports.rejectRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { reason } = req.body;
    const adminId = req.user.user_id;
    
    // Get request details first
    const [requests] = await require('../config/db').query(
      'SELECT from_user_id FROM chat_requests WHERE request_id = ?',
      [requestId]
    );
    
    const success = await ChatModel.rejectChatRequest(requestId, adminId, reason);
    
    if (!success) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    
    // Emit socket event
    const io = getIO();
    if (io && requests.length > 0) {
      io.to(`user:${requests[0].from_user_id}`).emit('chat:rejected', {
        request_id: requestId,
        reason,
        message: 'Your chat request has been rejected'
      });
    }
    
    res.json({ success: true, message: 'Chat request rejected' });
  } catch (error) {
    console.error('Error rejecting request:', error);
    res.status(500).json({ success: false, message: 'Failed to reject request' });
  }
};

/**
 * POST /api/chat/:chatId/close
 * Close a chat (admin only)
 */
exports.closeChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    
    const actualChatId = chatId.startsWith('general-') 
      ? parseInt(chatId.replace('general-', ''), 10) 
      : parseInt(chatId, 10);
    
    const success = await ChatModel.closeChat(actualChatId);
    
    if (!success) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }
    
    // Emit socket event
    const io = getIO();
    if (io) {
      const participants = await ChatModel.getChatParticipants(actualChatId);
      participants.forEach(p => {
        io.to(`user:${p.user_id}`).emit('chat:closed', { chat_id: actualChatId });
      });
    }
    
    res.json({ success: true, message: 'Chat closed' });
  } catch (error) {
    console.error('Error closing chat:', error);
    res.status(500).json({ success: false, message: 'Failed to close chat' });
  }
};

/**
 * POST /api/chat/:chatId/delete
 * Delete a chat (soft delete) (admin only)
 */
exports.deleteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    
    const actualChatId = chatId.startsWith('general-') 
      ? parseInt(chatId.replace('general-', ''), 10) 
      : parseInt(chatId, 10);
      
    const success = await ChatModel.deleteChat(actualChatId);
    
    if (!success) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }
    
    // Emit socket event
    const io = getIO();
    if (io) {
      const participants = await ChatModel.getChatParticipants(actualChatId);
      participants.forEach(p => {
        io.to(`user:${p.user_id}`).emit('chat:deleted', { chat_id: actualChatId });
      });
    }
    
    res.json({ success: true, message: 'Chat deleted' });
  } catch (error) {
    console.error('Error deleting chat:', error);
    res.status(500).json({ success: false, message: 'Failed to delete chat' });
  }
};

/**
 * POST /api/chat/:chatId/restrict
 * Restrict a chat (admin only)
 */
exports.restrictChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    
    const actualChatId = chatId.startsWith('general-') 
      ? parseInt(chatId.replace('general-', ''), 10) 
      : parseInt(chatId, 10);
    
    const success = await ChatModel.restrictChat(actualChatId);
    
    if (!success) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }
    
    // Emit socket event
    const io = getIO();
    if (io) {
      const participants = await ChatModel.getChatParticipants(actualChatId);
      participants.forEach(p => {
        io.to(`user:${p.user_id}`).emit('chat:restricted', { chat_id: actualChatId });
      });
    }
    
    res.json({ success: true, message: 'Chat restricted' });
  } catch (error) {
    console.error('Error restricting chat:', error);
    res.status(500).json({ success: false, message: 'Failed to restrict chat' });
  }
};

/**
 * POST /api/chat/:chatId/important
 * Toggle important flag (admin only)
 */
exports.toggleImportant = async (req, res) => {
  try {
    const { chatId } = req.params;
    
    const actualChatId = chatId.startsWith('general-') 
      ? parseInt(chatId.replace('general-', ''), 10) 
      : parseInt(chatId, 10);
    
    const success = await ChatModel.toggleImportant(actualChatId);
    
    if (!success) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }
    
    res.json({ success: true, message: 'Chat importance toggled' });
  } catch (error) {
    console.error('Error toggling importance:', error);
    res.status(500).json({ success: false, message: 'Failed to toggle importance' });
  }
};

/**
 * GET /api/users/search
 * Search users for creating new chats (admin only)
 */
exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    const adminId = req.user.user_id;
    
    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] });
    }
    
    const users = await ChatModel.searchUsers(q, adminId);
    res.json({ success: true, data: users });
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ success: false, message: 'Failed to search users' });
  }
};
