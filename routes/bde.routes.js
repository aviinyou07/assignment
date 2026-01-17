const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");

const { authGuard, fetchProfile, verifyBDEAccess } = require("../middleware/auth.middleware");
const bdeController = require("../controllers/bde.main.controller");

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
  authGuard(["bde"]),
  fetchProfile,
  bdeController.getDashboard
);

// Notifications page
router.get(
  "/notifications",
  authGuard(["bde"]),
  fetchProfile,
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
  authGuard(["bde"]),
  fetchProfile,
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
  authGuard(["bde"]),
  fetchProfile,
  bdeController.listClients
);

// View single client
router.get(
  "/clients/:clientId",
  authGuard(["bde"]),
  fetchProfile,
  bdeController.viewClient
);

/**
 * QUERY MANAGEMENT (PRE-CONFIRMATION)
 */

// List all queries
router.get(
  "/queries",
  authGuard(["bde"]),
  fetchProfile,
  bdeController.listQueries
);

// View single query
router.get(
  "/queries/:queryCode",
  authGuard(["bde"]),
  fetchProfile,
  verifyBDEAccess,
  bdeController.viewQuery
);

// Update query status
router.post(
  "/queries/:queryCode/status",
  authGuard(["bde"]),
  verifyBDEAccess,
  bdeController.updateQueryStatus
);

/**
 * QUOTATION GENERATION & MANAGEMENT
 */

// Generate quotation (POST /queries/:queryCode/quotation)
router.post(
  "/queries/:queryCode/quotation",
  authGuard(["bde"]),
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
  authGuard(["bde"]),
  fetchProfile,
  bdeController.listConfirmedOrders
);

// View confirmed order details
router.get(
  "/orders/:workCode",
  authGuard(["bde"]),
  fetchProfile,
  verifyBDEAccess,
  bdeController.viewConfirmedOrder
);

/**
 * CHAT & COMMUNICATION
 */

// Get chat messages for query
router.get(
  "/chat/query/:queryCode",
  authGuard(["bde"]),
  bdeController.getChat
);

// Get chat messages for work code
router.get(
  "/chat/order/:workCode",
  authGuard(["bde"]),
  bdeController.getChat
);

// Send message to user
router.post(
  "/queries/:queryCode/message",
  authGuard(["bde"]),
  verifyBDEAccess,
  bdeController.sendChatMessage
);

/**
 * PAYMENTS & REMINDERS
 */

// List pending payments
router.get(
  "/payments",
  authGuard(["bde"]),
  fetchProfile,
  bdeController.listPendingPayments
);

// Send payment reminder
router.post(
  "/queries/:queryCode/payment-reminder",
  authGuard(["bde"]),
  verifyBDEAccess,
  bdeController.sendPaymentReminder
);

/**
 * REAL-TIME API ENDPOINTS
 */
const bdeSimpleController = require("../controllers/bde.api.controller");

// Get dashboard KPIs for real-time updates
router.get(
  "/api/dashboard/kpis",
  authGuard(["bde"]),
  bdeSimpleController.getDashboardKPIs
);

// Get sidebar counts for badge updates
router.get(
  "/api/sidebar-counts",
  authGuard(["bde"]),
  bdeSimpleController.getSidebarCounts
);

module.exports = router;
