const express = require("express");
const router = express.Router();
const multer = require('multer');
const path = require('path');

const { authGuard } = require("../middleware/auth.admin.middleware");
const writerProfileController = require("../controllers/writer.profile.controller");
const writerEditController = require("../controllers/writer.edit.controller");
const writerTaskController = require("../controllers/writer.task.controller");
const db = require("../config/db");

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
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
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

// Middleware to fetch writer profile and attach to res.locals
const fetchWriterProfile = async (req, res, next) => {
  try {
    const userId = req.user.user_id;
    const [rows] = await db.query(
      `SELECT 
        user_id, full_name, email, mobile_number, whatsapp, 
        university, country, currency_code, role, is_verified, created_at
      FROM users
      WHERE user_id = ? AND role = 'writer' AND is_active = 1`,
      [userId]
    );
    
    if (rows.length) {
      const profile = rows[0];
      const initials = profile.full_name
        ? profile.full_name.split(" ").map(n => n[0]).join("").toUpperCase()
        : "WR";
      
      res.locals.profile = profile;
      res.locals.initials = initials;
    }
    next();
  } catch (err) {
    console.error("Error fetching writer profile:", err);
    next();
  }
};

// Dashboard Overview
router.get(
  "/",
  authGuard(["writer"]),
  fetchWriterProfile,
  (req, res) => {
    res.render("writer/dashboard", {
      title: "Writer Dashboard",
      layout: "layouts/writer"
    });
  }
);

// Dashboard Pages - New Enquiries
router.get(
  "/queries",
  authGuard(["writer"]),
  fetchWriterProfile,
  (req, res) => {
    res.render("writer/queries", {
      title: "New Enquiries",
      layout: "layouts/writer"
    });
  }
);

// Dashboard Pages - Active Tasks
router.get(
  "/active-tasks",
  authGuard(["writer"]),
  fetchWriterProfile,
  (req, res) => {
    res.render("writer/active-tasks", {
      title: "Active Projects",
      layout: "layouts/writer"
    });
  }
);

// Dashboard Pages - Updates
router.get(
  "/updates",
  authGuard(["writer"]),
  fetchWriterProfile,
  (req, res) => {
    res.render("writer/updates", {
      title: "Project Updates",
      layout: "layouts/writer"
    });
  }
);

// Dashboard Pages - Delivery
router.get(
  "/delivery",
  authGuard(["writer"]),
  fetchWriterProfile,
  (req, res) => {
    res.render("writer/delivery", {
      title: "Submissions",
      layout: "layouts/writer"
    });
  }
);

// View Profile
router.get(
  "/profile",
  authGuard(["writer"]),
  fetchWriterProfile,
  (req, res) => {
    res.render("writer/profile", {
      title: "My Profile",
      layout: "layouts/writer"
    });
  }
);

// Edit Profile Page
router.get(
  "/edit-profile",
  authGuard(["writer"]),
  fetchWriterProfile,
  writerEditController.getEditProfile
);

// Change Password Page
router.get(
  "/change-password",
  authGuard(["writer"]),
  fetchWriterProfile,
  (req, res) => {
    res.render("writer/change-password", {
      title: "Change Password",
      layout: "layouts/writer",
      isEditPage: true
    });
  }
);

// Update Profile
router.post(
  "/update-profile",
  authGuard(["writer"]),
  writerEditController.updateProfile
);

// Request Password Change OTP
router.post(
  "/request-password-otp",
  authGuard(["writer"]),
  writerEditController.requestPasswordOtp
);

// Verify OTP and Change Password
router.post(
  "/verify-password-otp",
  authGuard(["writer"]),
  writerEditController.verifyPasswordOtp
);

// ============================================================================
// TASK MANAGEMENT API ROUTES
// ============================================================================

// Get dashboard KPI metrics
router.get(
  "/api/dashboard/kpis",
  authGuard(["writer"]),
  writerTaskController.getDashboardKPIs
);

// ============================================================================
// TASK ASSIGNMENT & ACCEPTANCE
// ============================================================================

// Get pending task assignments for writer (with sorting by deadline)
router.get(
  "/api/tasks/pending",
  authGuard(["writer"]),
  writerTaskController.getPendingTaskAssignments
);

// Get detailed task assignment information
router.get(
  "/api/tasks/:taskId/details",
  authGuard(["writer"]),
  writerTaskController.getTaskAssignmentDetail
);

// Accept task assignment (Doable)
router.post(
  "/api/tasks/:taskId/accept",
  authGuard(["writer"]),
  writerTaskController.acceptTaskAssignment
);

// Reject task assignment (Not Doable)
router.post(
  "/api/tasks/:taskId/reject",
  authGuard(["writer"]),
  writerTaskController.rejectTaskAssignment
);

// ============================================================================
// TASK EXECUTION & STATUS UPDATES
// ============================================================================

// Get active tasks for writer
router.get(
  "/api/tasks/active/list",
  authGuard(["writer"]),
  writerTaskController.getActiveTasks
);

// Update task status
router.post(
  "/api/tasks/:taskId/status",
  authGuard(["writer"]),
  writerTaskController.updateTaskStatus
);

// ============================================================================
// FILE UPLOAD & DOCUMENT HISTORY
// ============================================================================

// Upload draft or revision file
router.post(
  "/api/tasks/:taskId/upload",
  authGuard(["writer"]),
  uploadMiddleware.single('file'),
  writerTaskController.uploadFile
);

// Get file upload history for task
router.get(
  "/api/tasks/:taskId/files",
  authGuard(["writer"]),
  writerTaskController.getFileHistory
);

// ============================================================================
// QC SUBMISSION FLOW
// ============================================================================

// Submit draft for QC review
router.post(
  "/api/tasks/:taskId/submit-qc",
  authGuard(["writer"]),
  writerTaskController.submitDraftForQC
);

// ============================================================================
// QC FEEDBACK & REVISION LOOP
// ============================================================================

// Get QC feedback for task
router.get(
  "/api/tasks/:taskId/feedback",
  authGuard(["writer"]),
  writerTaskController.getQCFeedback
);


// Submit revision for rejected QC
router.post(
  "/api/tasks/:taskId/revision",
  authGuard(["writer"]),
  writerTaskController.submitRevision
);

// ============================================================================
// DEADLINES & ALERTS
// ============================================================================

// Check upcoming deadlines
router.get(
  "/api/deadlines/upcoming",
  authGuard(["writer"]),
  writerTaskController.checkUpcomingDeadlines
);

// ============================================================================
// COMMUNICATION & SECURITY
// ============================================================================

// Validate chat access (writers can only chat with admin)
router.post(
  "/api/chat/validate/:recipientId",
  authGuard(["writer"]),
  writerTaskController.validateChatAccess
);

// Check task permissions for actions
router.get(
  "/api/tasks/:taskId/permissions",
  authGuard(["writer"]),
  writerTaskController.checkTaskPermission
);

module.exports = router;
