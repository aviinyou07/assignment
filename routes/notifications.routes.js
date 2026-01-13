const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/rbac.middleware');
const notificationsController = require('../controllers/notifications.controller');

/**
 * NOTIFICATION ROUTES
 * All routes require authentication
 */

// Get unread count (for UI badge)
router.get(
  '/unread-count',
  requireRole(['client', 'bde', 'writer', 'admin']),
  notificationsController.getUnreadCount
);

// Get notifications (paginated)
router.get(
  '/',
  requireRole(['client', 'bde', 'writer', 'admin']),
  notificationsController.getNotifications
);

// Mark single notification as read
router.patch(
  '/:notificationId/read',
  requireRole(['client', 'bde', 'writer', 'admin']),
  notificationsController.markAsRead
);

// Mark all as read
router.patch(
  '/all/read',
  requireRole(['client', 'bde', 'writer', 'admin']),
  notificationsController.markAllAsRead
);

// Get critical alerts
router.get(
  '/critical',
  requireRole(['client', 'bde', 'writer', 'admin']),
  notificationsController.getCriticalAlerts
);

// Delete notification
router.delete(
  '/:notificationId',
  requireRole(['client', 'bde', 'writer', 'admin']),
  notificationsController.deleteNotification
);

module.exports = router;
