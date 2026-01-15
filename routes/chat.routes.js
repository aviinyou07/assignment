const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/rbac.middleware');
const chatController = require('../controllers/chat.controller');

/**
 * CHAT ROUTES
 * All routes require authentication
 * 
 * Allowed chat relationships:
 * - Client ↔ BDE
 * - BDE ↔ Admin
 * - Writer ↔ Admin
 */

// Get all conversations for current user (MUST be before :context_id)
router.get(
  '/my-conversations',
  requireRole(['client', 'bde', 'writer', 'admin']),
  chatController.getMyConversations
);

// Get chat history for order context
router.get(
  '/:context_id',
  requireRole(['client', 'bde', 'writer', 'admin']),
  chatController.getChatHistory
);

// Send message in chat
router.post(
  '/:context_id/message',
  requireRole(['client', 'bde', 'writer', 'admin']),
  chatController.sendMessage
);

// Restrict chat (Admin only)
router.post(
  '/:context_id/restrict',
  requireRole(['admin']),
  chatController.restrictChat
);

// Close chat (Admin only)
router.post(
  '/:context_id/close',
  requireRole(['admin']),
  chatController.closeChat
);

module.exports = router;
