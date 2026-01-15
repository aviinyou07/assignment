const express = require("express");
const router = express.Router();

const { authGuard } = require("../middleware/auth.admin.middleware");
const adminController = require("../controllers/admin.controller");
const dashboardController = require("../controllers/admin.dashboard.controller");
const queryController = require("../controllers/queries.controller");
const paymentController = require("../controllers/payment.controller");
const assignmentController = require("../controllers/assignment.controller");
const assignmentsController = require("../controllers/assignments.controller");
const taskController = require("../controllers/task.controller");
const qcController = require("../controllers/qc.controller");
const deliveryController = require("../controllers/delivery.controller");
const notificationsController = require("../controllers/notifications.controller");
const auditController = require("../controllers/audit.controller");
const db = require("../config/db");

// Middleware to fetch Admin profile
const fetchAdminProfile = async (req, res, next) => {
  try {
    const userId = req.user.user_id;
    const [rows] = await db.query(
      `SELECT 
        user_id, full_name, email, mobile_number, whatsapp, 
        university, country, currency_code, role, is_verified, created_at
      FROM users
      WHERE user_id = ? AND role = 'admin' AND is_active = 1`,
      [userId]
    );
    
    if (rows.length) {
      const profile = rows[0];
      const initials = profile.full_name
        ? profile.full_name.split(" ").map(n => n[0]).join("").toUpperCase()
        : "AD";
      
      res.locals.profile = profile;
      res.locals.initials = initials;
    }
    next();
  } catch (err) {
    console.error("Error fetching Admin profile:", err);
    next();
  }
};

// Dashboard
router.get(
  "/",
  authGuard(["admin"]),
  fetchAdminProfile,
  dashboardController.getDashboard
);

// Notifications Page
router.get(
  "/notifications",
  authGuard(["admin"]),
  fetchAdminProfile,
  (req, res) => {
    res.render("admin/notifications", {
      title: "Notifications",
      layout: "layouts/admin",
      currentPage: "notifications"
    });
  }
);

// Chat Hub
router.get(
  "/chat",
  authGuard(["admin"]),
  fetchAdminProfile,
  (req, res) => {
    res.render("admin/chat", {
      title: "Chat",
      layout: "layouts/admin",
      currentPage: "chat"
    });
  }
);

// Users Management
router.get(
  "/users",
  authGuard(["admin"]),
  fetchAdminProfile,
  adminController.listUsers
);

router.get(
  "/users/create",
  authGuard(["admin"]),
  fetchAdminProfile,
  adminController.getCreateForm
);

router.post(
  "/users/create",
  authGuard(["admin"]),
  adminController.createUser
);

router.get(
  "/users/:userId/view",
  authGuard(["admin"]),
  fetchAdminProfile,
  adminController.viewUser
);

router.get(
  "/users/:userId/edit",
  authGuard(["admin"]),
  fetchAdminProfile,
  adminController.editUser
);

router.post(
  "/users/:userId/update",
  authGuard(["admin"]),
  adminController.updateUser
);

router.delete(
  "/users/:userId/delete",
  authGuard(["admin"]),
  adminController.deleteUser
);

// Query Management
router.post(
  "/queries/:queryId/invite-writers",
  authGuard(["admin"]),
  queryController.inviteWriters
);
router.get(
  "/queries",
  authGuard(["admin"]),
  fetchAdminProfile,
  queryController.listQueries
);

router.get(
  "/queries/:queryId/view",
  authGuard(["admin"]),
  fetchAdminProfile,
  queryController.viewQuery
);


router.get(
  "/queries/available-writers",
  authGuard(["admin"]),
  assignmentController.getAvailableWriters
);


router.post(
  "/queries/:queryId/assign",
  authGuard(["admin"]),
  assignmentController.assignWriters
);


// router.post(
//   "/queries/:queryId/quotation",
//   authGuard(["admin"]),
//   queryController.generateQuotation
// );

router.post(
  "/queries/:queryId/status",
  authGuard(["admin"]),
  queryController.updateQueryStatus
);

router.post(
  "/queries/:queryId/message",
  authGuard(["admin"]),
  queryController.sendMessageToClient
);

router.post(
  "/queries/reassign-writer",
  authGuard(["admin"]),
  queryController.reassignWriter
);

// Payment Verification
router.get(
  "/payments",
  authGuard(["admin"]),
  fetchAdminProfile,
  paymentController.listPayments
);

router.get(
  "/payments/:paymentId/view",
  authGuard(["admin"]),
  paymentController.viewPayment
);

router.get(
  "/payments/:paymentId/download",
  authGuard(["admin"]),
  paymentController.downloadReceipt
);

router.post(
  "/payments/:paymentId/verify",
  authGuard(["admin"]),
  paymentController.verifyPayment
);

router.post(
  "/payments/:paymentId/stage",
  authGuard(["admin"]),
  paymentController.updatePaymentStage
);

// Task Monitoring
router.get(
  "/tasks",
  authGuard(["admin"]),
  fetchAdminProfile,
  taskController.listActiveTasks
);

router.get(
  "/tasks/:submissionId/progress",
  authGuard(["admin"]),
  taskController.getTaskProgress
);

// Routes removed - functions reference non-existent database tables
// router.get("/tasks/workcode/:workCode", authGuard(["admin"]), taskController.getWorkCodeSubmissions);
// router.get("/tasks/:submissionId/notes", authGuard(["admin"]), taskController.getWriterProgressNotes);
// router.post("/tasks/:submissionId/note", authGuard(["admin"]), taskController.addAdminNote);

router.get(
  "/tasks/overdue/list",
  authGuard(["admin"]),
  taskController.getOverdueTasks
);

router.get(
  "/tasks/stats/summary",
  authGuard(["admin"]),
  taskController.getTaskStatistics
);

// Quality Control
router.get(
  "/qc/pending",
  authGuard(["admin"]),
  fetchAdminProfile,
  qcController.listPendingQC
);

router.get(
  "/qc/:submissionId/detail",
  authGuard(["admin"]),
  qcController.getQCDetail
);

router.post(
  "/qc/:submissionId/approve",
  authGuard(["admin"]),
  qcController.approveSubmission
);

router.post(
  "/qc/:submissionId/reject",
  authGuard(["admin"]),
  qcController.rejectSubmission
);

// Route removed - function references non-existent qc_history table
// router.get("/qc/:submissionId/history", authGuard(["admin"]), qcController.getQCHistory);

router.get(
  "/qc/stats/summary",
  authGuard(["admin"]),
  qcController.getQCStatistics
);

// ===== WRITER ASSIGNMENT SYSTEM =====
router.get(
  "/assignments",
  authGuard(["admin"]),
  fetchAdminProfile,
  assignmentsController.listAssignments
);

router.get(
  "/assignments/available-writers",
  authGuard(["admin"]),
  assignmentController.getAvailableWriters
);

router.post(
  "/assignments/assign",
  authGuard(["admin"]),
  assignmentController.assignWriters
);

router.get(
  "/assignments/:orderId",
  authGuard(["admin"]),
  fetchAdminProfile,
  assignmentController.listAssignments
);

router.get(
  "/assignments/detail/:taskEvalId",
  authGuard(["writer", "admin"]),
  assignmentController.getAssignmentDetail
);

router.post(
  "/assignments/:taskEvalId/accept",
  authGuard(["writer"]),
  assignmentController.acceptAssignment
);

router.post(
  "/assignments/:taskEvalId/reject",
  authGuard(["writer"]),
  assignmentController.rejectAssignment
);

router.post(
  "/assignments/:taskEvalId/reassign",
  authGuard(["admin"]),
  assignmentController.reassignWriter
);

router.post(
  "/assignments/:taskEvalId/finalize",
  authGuard(["admin"]),
  assignmentController.finalizeAssignment
);


// ===== DELIVERY SYSTEM =====
router.get(
  "/delivery/ready",
  authGuard(["admin"]),
  fetchAdminProfile,
  deliveryController.listReadyForDelivery
);

router.post(
  "/delivery/:submissionId/deliver",
  authGuard(["admin"]),
  deliveryController.deliverFile
);

router.post(
  "/delivery/:orderId/complete",
  authGuard(["admin"]),
  deliveryController.completeOrder
);

router.post(
  "/delivery/:orderId/revision",
  authGuard(["admin"]),
  deliveryController.requestRevision
);

router.get(
  "/delivery/:orderId/history",
  authGuard(["admin", "client"]),
  deliveryController.getDeliveryHistory
);

// ===== NOTIFICATIONS SYSTEM =====
router.get(
  "/notifications",
  authGuard(["admin", "writer", "bde", "client"]),
  notificationsController.getNotifications
);

router.get(
  "/notifications/unread-count",
  authGuard(["admin", "writer", "bde", "client"]),
  notificationsController.getUnreadCount
);

router.get(
  "/notifications/critical-alerts",
  authGuard(["admin", "writer", "bde", "client"]),
  notificationsController.getCriticalAlerts
);

router.post(
  "/notifications/:notificationId/read",
  authGuard(["admin", "writer", "bde", "client"]),
  notificationsController.markAsRead
);

router.post(
  "/notifications/mark-all-read",
  authGuard(["admin", "writer", "bde", "client"]),
  notificationsController.markAllAsRead
);

router.delete(
  "/notifications/:notificationId",
  authGuard(["admin", "writer", "bde", "client"]),
  notificationsController.deleteNotification
);

router.post(
  "/notifications/send",
  authGuard(["admin"]),
  notificationsController.sendNotification
);

// ===== AUDIT LOGS SYSTEM =====
router.get(
  "/audit/logs",
  authGuard(["admin"]),
  fetchAdminProfile,
  auditController.getAuditLogs
);

router.get(
  "/audit/logs/:logId",
  authGuard(["admin"]),
  auditController.getLogDetail
);

router.get(
  "/audit/actions",
  authGuard(["admin"]),
  auditController.getAvailableActions
);

router.get(
  "/audit/stats",
  authGuard(["admin"]),
  auditController.getAuditStats
);

router.get(
  "/audit/export",
  authGuard(["admin"]),
  auditController.exportAuditLogs
);

router.post(
  "/audit/override",
  authGuard(["admin"]),
  auditController.recordAdminOverride
);

router.get(
  "/audit/user/:userId",
  authGuard(["admin"]),
  auditController.getUserActivityLog
);

router.get(
  "/audit/order/:orderId",
  authGuard(["admin"]),
  auditController.getOrderAuditTrail
);

module.exports = router;
