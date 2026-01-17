const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

const { authGuard, validateResourceOwnership, idempotent } = require('../middleware/auth.middleware');
const clientController = require('../controllers/client.api.controller');

// =======================
// FILE UPLOAD CONFIG
// =======================
const queryStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads/query-documents'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `query-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const paymentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads/payment-receipts'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `receipt-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const queryUpload = multer({
  storage: queryStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/png',
      'image/gif',
      'text/plain'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, GIF, TXT'));
    }
  }
});

const paymentUpload = multer({
  storage: paymentStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, JPG, PNG'));
    }
  }
});

// =======================
// AUTH ROUTES
// =======================

// Request OTP for login (WhatsApp-based)
router.post(
  '/auth/request-otp',
  clientController.requestOtp
);

// Verify OTP and get token
router.post(
  '/auth/verify-otp',
  clientController.verifyOtp
);

// =======================
// PROFILE ROUTES
// =======================

// Get client profile
router.get(
  '/profile',
  authGuard(['client']),
  clientController.getProfile
);

// Update profile (limited fields)
router.patch(
  '/profile',
  authGuard(['client']),
  clientController.updateProfile
);

// =======================
// QUERY ROUTES
// =======================

// Create new query
router.post(
  '/query',
  authGuard(['client']),
  idempotent('query'),
  queryUpload.array('documents', 10),
  clientController.createQuery
);

// List client's queries
router.get(
  '/query',
  authGuard(['client']),
  clientController.listQueries
);

// Get query details
router.get(
  '/query/:query_code',
  authGuard(['client']),
  validateResourceOwnership('query', 'query_code'),
  clientController.getQueryDetails
);

// =======================
// QUOTATION ROUTES
// =======================

// View quotation for query
router.get(
  '/quotation/:query_code',
  authGuard(['client']),
  validateResourceOwnership('query', 'query_code'),
  clientController.viewQuotation
);

// Accept quotation
router.post(
  '/quotation/:query_code/accept',
  authGuard(['client']),
  idempotent('quotation'),
  validateResourceOwnership('query', 'query_code'),
  clientController.acceptQuotation
);

// Request quotation revision
router.post(
  '/quotation/:query_code/revision',
  authGuard(['client']),
  validateResourceOwnership('query', 'query_code'),
  clientController.requestQuotationRevision
);

// =======================
// PAYMENT ROUTES
// =======================

// Upload payment receipt
router.post(
  '/payment/upload',
  authGuard(['client']),
  idempotent('payment'),
  paymentUpload.single('receipt'),
  clientController.uploadPaymentReceipt
);

// Get payment status
router.get(
  '/payment/:query_code/status',
  authGuard(['client']),
  validateResourceOwnership('query', 'query_code'),
  clientController.getPaymentStatus
);

// =======================
// ORDER ROUTES (POST-PAYMENT)
// =======================

// List client's orders
router.get(
  '/order',
  authGuard(['client']),
  clientController.listOrders
);

// Track order by work_code
router.get(
  '/order/:work_code',
  authGuard(['client']),
  clientController.trackOrder
);

// Get delivery files
router.get(
  '/order/:work_code/delivery',
  authGuard(['client']),
  clientController.getDeliveryFiles
);

// =======================
// FEEDBACK & REVISION ROUTES
// =======================

// Submit feedback
router.post(
  '/order/:work_code/feedback',
  authGuard(['client']),
  idempotent('feedback'),
  clientController.submitFeedback
);

// Request revision
router.post(
  '/order/:work_code/revision',
  authGuard(['client']),
  idempotent('revision'),
  clientController.requestRevision
);

// =======================
// NOTIFICATION ROUTES
// =======================

// Get notifications
router.get(
  '/notifications',
  authGuard(['client']),
  clientController.getNotifications
);

// Mark notification as read
router.patch(
  '/notifications/:notification_id/read',
  authGuard(['client']),
  clientController.markNotificationRead
);

// =======================
// CHAT ROUTES
// =======================

// Get chat history
router.get(
  '/chat/:context_code',
  authGuard(['client']),
  clientController.getChatHistory
);

// Send message
router.post(
  '/chat/:context_code/message',
  authGuard(['client']),
  clientController.sendChatMessage
);

// =======================
// ERROR HANDLER
// =======================
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      code: 'FILE_UPLOAD_ERROR',
      message: err.message
    });
  }
  
  console.error('Client API Error:', err);
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'An error occurred'
  });
});

module.exports = router;
