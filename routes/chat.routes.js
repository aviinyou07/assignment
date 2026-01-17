const express = require('express');
const router = express.Router();
const { authGuard } = require('../middleware/auth.middleware');
const chatController = require('../controllers/chat.controller');

/**
 * SHARED CHAT ROUTES
 * Used by all roles for common chat operations
 * Role-specific filtering happens in the controller
 */

// Get all chats for current user (filtered by role)
router.get(
  '/my-conversations',
  authGuard(['client', 'bde', 'writer', 'admin']),
  chatController.getChats
);

// Get messages for a specific chat
router.get(
  '/:chatId/messages',
  authGuard(['client', 'bde', 'writer', 'admin']),
  chatController.getMessages
);

// Send message in a chat
router.post(
  '/:chatId/message',
  authGuard(['client', 'bde', 'writer', 'admin']),
  chatController.sendMessage
);

// ===== ADMIN-ONLY GOVERNANCE =====

// Restrict chat
router.post(
  '/:chatId/restrict',
  authGuard(['admin']),
  chatController.restrictChat
);

// Close chat
router.post(
  '/:chatId/close',
  authGuard(['admin']),
  chatController.closeChat
);

// Delete chat
router.post(
  '/:chatId/delete',
  authGuard(['admin']),
  chatController.deleteChat
);

// Tag as important
router.post(
  '/:chatId/tag-important',
  authGuard(['admin']),
  chatController.toggleImportant
);

// Create new chat (Admin only)
router.post(
  '/',
  authGuard(['admin']), 
  chatController.createChat
);

// Search users (Admin only)
router.get(
  '/users/search',
  authGuard(['admin']),
  chatController.searchUsers
);

// Request chat (Non-admin)
router.post(
  '/request',
  authGuard(['client', 'bde', 'writer']),
  chatController.requestChat
);

// Get chat requests (Admin only)
router.get(
  '/requests',
  authGuard(['admin']),
  chatController.getRequests
);

// Approve chat request (Admin only)
router.post(
  '/requests/:requestId/approve',
  authGuard(['admin']),
  chatController.approveRequest
);

// Reject chat request (Admin only)
router.post(
  '/requests/:requestId/reject',
  authGuard(['admin']),
  chatController.rejectRequest
);

module.exports = router;
