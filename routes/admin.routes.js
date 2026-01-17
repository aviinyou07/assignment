const express = require("express");
const router = express.Router();

const { authGuard, fetchProfile } = require("../middleware/auth.middleware");
const adminController = require("../controllers/admin.controller");
const dashboardController = require("../controllers/admin.dashboard.controller");
const queryController = require("../controllers/admin.queries.controller");
const paymentController = require("../controllers/admin.payment.controller");
const assignmentController = require("../controllers/admin.assignment.controller");
const assignmentsController = require("../controllers/admin.assignments.controller");
const taskController = require("../controllers/admin.task.controller");
const qcController = require("../controllers/admin.qc.controller");
const deliveryController = require("../controllers/admin.delivery.controller");
const notificationsController = require("../controllers/notifications.controller");
const auditController = require("../controllers/admin.audit.controller");

// Dashboard
router.get(
  "/",
  authGuard(["admin"]),
  fetchProfile,
  (req, res, next) => {
    console.log('[DEBUG] Admin dashboard route hit, user:', req.user);
    next();
  },
  dashboardController.getDashboard
);

// Notifications Page
router.get(
  "/notifications",
  authGuard(["admin"]),
  fetchProfile,
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
  fetchProfile,
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
  fetchProfile,
  adminController.listUsers
);

router.get(
  "/users/create",
  authGuard(["admin"]),
  fetchProfile,
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
  fetchProfile,
  adminController.viewUser
);

router.get(
  "/users/:userId/edit",
  authGuard(["admin"]),
  fetchProfile,
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
  fetchProfile,
  queryController.listQueries
);

router.get(
  "/queries/:queryId/view",
  authGuard(["admin"]),
  fetchProfile,
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


router.post(
  "/queries/:queryId/quotation",
  authGuard(["admin"]),
  queryController.generateQuotation
);

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

// Assign writer from interested list
router.post(
  "/query/:orderId/assign-writer",
  authGuard(["admin"]),
  queryController.adminAssignWriter
);

// Revoke writer assignment
router.post(
  "/query/:orderId/revoke-writer",
  authGuard(["admin"]),
  queryController.revokeWriterAssignment
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
  fetchProfile,
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
  fetchProfile,
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
  fetchProfile,
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

// New QC routes - Enhanced admin controls
router.post(
  "/qc/:orderId/forward-revision",
  authGuard(["admin"]),
  qcController.forwardRevisionRequest
);

router.post(
  "/qc/:orderId/force-approve",
  authGuard(["admin"]),
  qcController.adminForceApprove
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
  fetchProfile,
  assignmentsController.listAssignments
);

router.get(
  "/assignments/available-writers",
  authGuard(["admin"]),
  assignmentController.getAvailableWriters
);

router.get(
  "/assignments/:assignmentId/accepted-writers",
  authGuard(["admin"]),
  assignmentsController.getAcceptedWritersForAssignment
);

router.post(
  "/assignments/assign",
  authGuard(["admin"]),
  assignmentController.assignWriters
);

router.get(
  "/assignments/:orderId",
  authGuard(["admin"]),
  fetchProfile,
  assignmentController.listAssignments
);

router.get(
  "/assignments/detail/:taskEvalId",
  authGuard(["admin"]),
  fetchProfile,
  assignmentController.getAssignmentDetail
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
  fetchProfile,
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

// ===== ADMIN-ONLY NOTIFICATION ACTION =====
// Note: Other notification routes are handled by /notifications/* route

router.post(
  "/notifications/send",
  authGuard(["admin"]),
  notificationsController.sendNotification
);

// ===== AUDIT LOGS SYSTEM =====
router.get(
  "/audit/logs",
  authGuard(["admin"]),
  fetchProfile,
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

// ===== REAL-TIME DASHBOARD API =====
router.get(
  "/sidebar-counts",
  authGuard(["admin"]),
  dashboardController.getSidebarCounts
);

router.get(
  "/dashboard/kpis",
  authGuard(["admin"]),
  dashboardController.getDashboardKPIs
);

// Search users for new chats
// router.get("/users/search", authGuard(["admin"]), chatController.searchUsers);

module.exports = router;
