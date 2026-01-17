const express = require("express");
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { authGuard, fetchProfile } = require("../middleware/auth.middleware");
const queriesController = require('../controllers/admin.queries.controller');
const writerEditController = require("../controllers/writer.edit.controller");
const writerTaskController = require("../controllers/writer.task.controller");
const writerQueriesController = require('../controllers/writer.queries.controller');

// ============================================================================
// FILE UPLOAD CONFIGURATION
// ============================================================================
const uploadDir = path.join(__dirname, '../uploads/writer-submissions');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, DOC, DOCX, PPT, TXT'));
    }
  }
});

// ============================================================================
// PAGE ROUTES
// ============================================================================

// Dashboard Overview
router.get("/", authGuard(["writer"]), fetchProfile, (req, res) => {
  res.render("writer/dashboard", { title: "Writer Dashboard", layout: "layouts/writer" });
});

// Notifications Page
router.get("/notifications", authGuard(["writer"]), fetchProfile, (req, res) => {
  res.render("writer/notifications", { title: "Notifications", layout: "layouts/writer" });
});

// New Enquiries
router.get("/queries", authGuard(["writer"]), fetchProfile, (req, res) => {
  res.render("writer/queries", { title: "New Enquiries", layout: "layouts/writer" });
});

// Active Tasks
router.get("/active-tasks", authGuard(["writer"]), fetchProfile, (req, res) => {
  res.render("writer/active-tasks", { title: "Active Projects", layout: "layouts/writer" });
});

// Updates
router.get("/updates", authGuard(["writer"]), fetchProfile, writerTaskController.getProjectUpdates);

// Delivery
router.get("/delivery", authGuard(["writer"]), fetchProfile, (req, res) => {
  res.render("writer/delivery", { title: "Submissions", layout: "layouts/writer" });
});

// View Profile
router.get("/profile", authGuard(["writer"]), fetchProfile, (req, res) => {
  res.render("writer/profile", { title: "My Profile", layout: "layouts/writer" });
});

// Edit Profile Page
router.get("/edit-profile", authGuard(["writer"]), fetchProfile, writerEditController.getEditProfile);

// Change Password Page
router.get("/change-password", authGuard(["writer"]), fetchProfile, (req, res) => {
  res.render("writer/change-password", { title: "Change Password", layout: "layouts/writer", isEditPage: true });
});

// Chat Hub
router.get("/chat", authGuard(["writer"]), fetchProfile, (req, res) => {
  res.render("writer/chat", { title: "Chat", layout: "layouts/writer", currentPage: "chat" });
});

// ============================================================================
// PROFILE API ROUTES
// ============================================================================

router.post("/update-profile", authGuard(["writer"]), writerEditController.updateProfile);
router.post("/request-password-otp", authGuard(["writer"]), writerEditController.requestPasswordOtp);
router.post("/verify-password-otp", authGuard(["writer"]), writerEditController.verifyPasswordOtp);

// ============================================================================
// QUERY/INVITATION API ROUTES
// ============================================================================

router.get('/queries/invited', authGuard(['writer']), writerQueriesController.listInvitedQueries);
router.get('/queries/:queryId', authGuard(['writer']), queriesController.getQueryDetails);
router.post('/queries/:orderId/show-interest', authGuard(['writer']), queriesController.writerShowInterest);
router.post('/queries/:orderId/decline-invitation', authGuard(['writer']), queriesController.writerDeclineInvitation);
router.post('/invitations/:orderId/accept', authGuard(['writer']), queriesController.writerAcceptInvitation);
router.post('/invitations/:orderId/reject', authGuard(['writer']), queriesController.writerRejectInvitation);

// ============================================================================
// DASHBOARD API
// ============================================================================

router.get("/dashboard/kpis", authGuard(["writer"]), writerTaskController.getDashboardKPIs);

// ============================================================================
// TASK ASSIGNMENT & ACCEPTANCE
// ============================================================================

router.get("/tasks/pending", authGuard(["writer"]), writerTaskController.getPendingTaskAssignments);
router.get("/tasks/:taskId/details", authGuard(["writer"]), writerTaskController.getTaskAssignmentDetail);
router.post("/tasks/:taskId/accept", authGuard(["writer"]), writerTaskController.acceptTaskAssignment);
router.post("/tasks/:taskId/reject", authGuard(["writer"]), writerTaskController.rejectTaskAssignment);

// ============================================================================
// TASK EXECUTION & STATUS
// ============================================================================

router.get("/tasks/active/list", authGuard(["writer"]), writerTaskController.getActiveTasks);
router.get("/tasks/:taskId/view", authGuard(["writer"]), fetchProfile, writerTaskController.viewTaskDetails);
router.get("/tasks/:taskId/revise", authGuard(["writer"]), fetchProfile, writerTaskController.viewTaskDetails);
router.post("/tasks/:taskId/status", authGuard(["writer"]), writerTaskController.updateTaskStatus);

// ============================================================================
// FILE UPLOAD & HISTORY
// ============================================================================

router.post("/tasks/:taskId/upload", authGuard(["writer"]), uploadMiddleware.single('file'), writerTaskController.uploadFile);
router.get("/tasks/:taskId/files", authGuard(["writer"]), writerTaskController.getFileHistory);

// ============================================================================
// QC SUBMISSION & FEEDBACK
// ============================================================================

router.post("/tasks/:taskId/submit-qc", authGuard(["writer"]), writerTaskController.submitDraftForQC);
router.get("/tasks/:taskId/feedback", authGuard(["writer"]), writerTaskController.getQCFeedback);
router.post("/tasks/:taskId/revision", authGuard(["writer"]), writerTaskController.submitRevision);

// ============================================================================
// DEADLINES & PERMISSIONS
// ============================================================================

router.get("/deadlines/upcoming", authGuard(["writer"]), writerTaskController.checkUpcomingDeadlines);
router.post("/chat/validate/:recipientId", authGuard(["writer"]), writerTaskController.validateChatAccess);
router.get("/tasks/:taskId/permissions", authGuard(["writer"]), writerTaskController.checkTaskPermission);

module.exports = router;
