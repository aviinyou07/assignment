const express = require('express');
const router = express.Router();
const { authGuard } = require('../middleware/auth.middleware');

// Import controllers
const queriesController = require('../controllers/client.queries.controller');
const quotationController = require('../controllers/client.quotation.controller');
const feedbackController = require('../controllers/client.feedback.controller');

/**
 * CLIENT ROUTES
 * Base path: /client
 * All routes require client authentication
 */

// =======================
// QUERY MANAGEMENT
// =======================

// Create new query
const upload = require('../middleware/multer');

router.post(
  '/queries',
  authGuard(['client']),
  upload.any(), 
  queriesController.createQuery
);


// List client's queries (paginated)
router.get(
  '/queries',
  authGuard(['client']),
  queriesController.listMyQueries
);

// Get query details
router.get(
  '/queries/:orderId',
  authGuard(['client']),
  queriesController.getQueryDetail
);

// Edit query (denied - returns explicit error)
router.put(
  '/queries/:orderId',
  authGuard(['client']),
  queriesController.editQueryDenied
);

router.patch(
  '/queries/:orderId',
  authGuard(['client']),
  queriesController.editQueryDenied
);

// =======================
// QUOTATION & ACCEPTANCE
// =======================

// View quotation for order
router.get(
  '/quotations/:orderId',
  authGuard(['client']),
  quotationController.viewQuotation
);

// Accept quotation
router.post(
  '/quotations/:orderId/accept',
  authGuard(['client']),
  quotationController.acceptQuotation
);

// =======================
// PAYMENT
// =======================

// Upload payment receipt
router.post(
  '/payments/upload',
  authGuard(['client']),
  quotationController.uploadPaymentReceipt
);

// Get payment status
router.get(
  '/payments/:orderId/status',
  authGuard(['client']),
  quotationController.getPaymentStatus
);

// =======================
// ORDER TRACKING & DELIVERY
// =======================

// List confirmed orders (with work_code)
router.get(
  '/orders',
  authGuard(['client']),
  queriesController.listMyOrders
);

// Track order by work code
router.get(
  '/orders/:workCode',
  authGuard(['client']),
  queriesController.trackOrderByWorkCode
);

// Get delivery files
router.get(
  '/orders/:orderId/delivery',
  authGuard(['client']),
  feedbackController.getDeliveryFiles
);

// =======================
// NOTIFICATIONS
// =======================

// Get notifications
router.get(
  '/notifications',
  authGuard(['client']),
  queriesController.getNotifications
);

// Mark notification as read
router.patch(
  '/notifications/:notificationId/read',
  authGuard(['client']),
  queriesController.markNotificationAsRead
);

// =======================
// FEEDBACK & REVISIONS
// =======================

// Submit feedback on completed work
router.post(
  '/feedback',
  authGuard(['client']),
  feedbackController.submitFeedback
);

// Request revision
router.post(
  '/revisions',
  authGuard(['client']),
  feedbackController.requestRevision
);

// Get revision history for order
router.get(
  '/revisions/:orderId',
  authGuard(['client']),
  feedbackController.getRevisionHistory
);

module.exports = router;
