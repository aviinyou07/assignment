const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");

const { authGuardBDE, fetchBDEProfile, verifyBDEAccess } = require("../middleware/auth.bde.middleware");
const bdeController = require("../controllers/bde.dashboard.controller");

/**
 * Multer configuration for quotation file uploads
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../public/quotations"));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and Word documents allowed"));
    }
  }
});

/**
 * DASHBOARD & HOME
 */

// Dashboard with KPI metrics
router.get(
  "/",
  authGuardBDE(["bde"]),
  fetchBDEProfile,
  bdeController.getDashboard
);

// Notifications page
router.get(
  "/notifications",
  authGuardBDE(["bde"]),
  fetchBDEProfile,
  (req, res) => {
    res.render("bde/notifications", {
      title: "Notifications",
      layout: "layouts/bde",
      currentPage: "notifications"
    });
  }
);

// Chat Hub
router.get(
  "/chat",
  authGuardBDE(["bde"]),
  fetchBDEProfile,
  (req, res) => {
    res.render("bde/chat", {
      title: "Chat",
      layout: "layouts/bde",
      currentPage: "chat"
    });
  }
);

/**
 * CLIENT MANAGEMENT (REFERRAL-BASED)
 */

// List all assigned clients
router.get(
  "/clients",
  authGuardBDE(["bde"]),
  fetchBDEProfile,
  bdeController.listClients
);

// View single client
router.get(
  "/clients/:clientId",
  authGuardBDE(["bde"]),
  fetchBDEProfile,
  bdeController.viewClient
);

/**
 * QUERY MANAGEMENT (PRE-CONFIRMATION)
 */

// List all queries
router.get(
  "/queries",
  authGuardBDE(["bde"]),
  fetchBDEProfile,
  bdeController.listQueries
);

// View single query
router.get(
  "/queries/:queryCode",
  authGuardBDE(["bde"]),
  fetchBDEProfile,
  verifyBDEAccess,
  bdeController.viewQuery
);

// Update query status
router.post(
  "/queries/:queryCode/status",
  authGuardBDE(["bde"]),
  verifyBDEAccess,
  bdeController.updateQueryStatus
);

/**
 * QUOTATION GENERATION & MANAGEMENT
 */

// Generate quotation (POST /queries/:queryCode/quotation)
router.post(
  "/queries/:queryCode/quotation",
  authGuardBDE(["bde"]),
  verifyBDEAccess,
  upload.single("quotationFile"),
  bdeController.generateQuotation
);

/**
 * CONFIRMED ORDERS (READ-ONLY)
 */

// List confirmed orders (payment verified)
router.get(
  "/orders",
  authGuardBDE(["bde"]),
  fetchBDEProfile,
  bdeController.listConfirmedOrders
);

// View confirmed order details
router.get(
  "/orders/:workCode",
  authGuardBDE(["bde"]),
  fetchBDEProfile,
  verifyBDEAccess,
  bdeController.viewConfirmedOrder
);

/**
 * CHAT & COMMUNICATION
 */

// Get chat messages for query
router.get(
  "/chat/query/:queryCode",
  authGuardBDE(["bde"]),
  bdeController.getChat
);

// Get chat messages for work code
router.get(
  "/chat/order/:workCode",
  authGuardBDE(["bde"]),
  bdeController.getChat
);

// Send message to user
router.post(
  "/queries/:queryCode/message",
  authGuardBDE(["bde"]),
  verifyBDEAccess,
  bdeController.sendChatMessage
);

/**
 * PAYMENTS & REMINDERS
 */

// List pending payments
router.get(
  "/payments",
  authGuardBDE(["bde"]),
  fetchBDEProfile,
  bdeController.listPendingPayments
);

// Send payment reminder
router.post(
  "/queries/:queryCode/payment-reminder",
  authGuardBDE(["bde"]),
  verifyBDEAccess,
  bdeController.sendPaymentReminder
);

module.exports = router;
