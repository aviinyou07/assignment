const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/rbac.middleware');

// Import controllers
const queriesController = require('../controllers/client.queries.controller');
const quotationController = require('../controllers/client.quotation.controller');
const feedbackController = require('../controllers/client.feedback.controller');

/**
 * CLIENT ROUTES
 * Base path: /api/client
 * All routes require client authentication
 */

// =======================
// QUERY MANAGEMENT
// =======================

// Create new query
router.post(
  '/queries',
  requireRole(['client']),
  queriesController.createQuery
);

// List client's queries (paginated)
router.get(
  '/queries',
  requireRole(['client']),
  queriesController.listMyQueries
);

// Get query details
router.get(
  '/queries/:orderId',
  requireRole(['client']),
  queriesController.getQueryDetail
);

// Edit query (denied - returns explicit error)
router.put(
  '/queries/:orderId',
  requireRole(['client']),
  queriesController.editQueryDenied
);

router.patch(
  '/queries/:orderId',
  requireRole(['client']),
  queriesController.editQueryDenied
);

// =======================
// QUOTATION & ACCEPTANCE
// =======================

// View quotation for order
router.get(
  '/quotations/:orderId',
  requireRole(['client']),
  quotationController.viewQuotation
);

// Accept quotation
router.post(
  '/quotations/:orderId/accept',
  requireRole(['client']),
  quotationController.acceptQuotation
);

// =======================
// PAYMENT
// =======================

// Upload payment receipt
router.post(
  '/payments/upload',
  requireRole(['client']),
  quotationController.uploadPaymentReceipt
);

// Get payment status
router.get(
  '/payments/:orderId/status',
  requireRole(['client']),
  quotationController.getPaymentStatus
);

// =======================
// ORDER TRACKING & DELIVERY
// =======================

// List confirmed orders (with work_code)
router.get(
  '/orders',
  requireRole(['client']),
  queriesController.listMyOrders
);

// Track order by work code
router.get(
  '/orders/:workCode',
  requireRole(['client']),
  queriesController.trackOrderByWorkCode
);

// Get delivery files
router.get(
  '/orders/:orderId/delivery',
  requireRole(['client']),
  feedbackController.getDeliveryFiles
);

// =======================
// NOTIFICATIONS
// =======================

// Get notifications
router.get(
  '/notifications',
  requireRole(['client']),
  queriesController.getNotifications
);

// Mark notification as read
router.patch(
  '/notifications/:notificationId/read',
  requireRole(['client']),
  queriesController.markNotificationAsRead
);

// =======================
// FEEDBACK & REVISIONS
// =======================

// Submit feedback on completed work
router.post(
  '/feedback',
  requireRole(['client']),
  feedbackController.submitFeedback
);

// Request revision
router.post(
  '/revisions',
  requireRole(['client']),
  feedbackController.requestRevision
);

// Get revision history for order
router.get(
  '/revisions/:orderId',
  requireRole(['client']),
  feedbackController.getRevisionHistory
);

module.exports = router;
