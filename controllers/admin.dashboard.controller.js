const db = require('../config/db');
const { sendMail } = require('../utils/mailer');
const { logAction } = require('../utils/logger');
const { STATUS, STATUS_NAMES, getLifecyclePhase } = require('../utils/order-state-machine');
const { processWorkflowEvent, WORKFLOW_EVENTS } = require('../utils/workflow.service');

/* =====================================================
   ADMIN DASHBOARD - COMPREHENSIVE KPIs
   
   KPI Cards (Per Specification):
   - Revenue (Today/Month)
   - New Queries
   - Pending Quotations
   - Confirmed Orders
   - Active Tasks
   - Completed Tasks
   - Pending Approvals (Payments + Drafts Combined) - CRITICAL
===================================================== */

exports.getDashboard = async (req, res) => {
  try {
    console.log('[DEBUG] getDashboard called, user_id:', req.user?.user_id);
    const userId = req.user.user_id;

    // Fetch admin profile
    const [adminRows] = await db.query(
      `SELECT 
        user_id, full_name, email, mobile_number, university, 
        country, currency_code, role, is_verified, created_at
      FROM users
      WHERE user_id = ? AND role = 'admin' AND is_active = 1`,
      [userId]
    );

    console.log('[DEBUG] Admin rows found:', adminRows.length);

    if (!adminRows.length) {
      console.log('[DEBUG] No admin found for user_id:', userId);
      return res.status(404).render("errors/404", { title: "Not Found", layout: false });
    }

    const profile = adminRows[0];

    // TODAY'S DATE RANGE
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);

    // THIS MONTH DATE RANGE
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    // COMPREHENSIVE KPI QUERIES - ALL PARALLEL
    const [
      [todayRevenue],
      [monthRevenue],
      [newQueries],
      [pendingQuotations],
      [confirmedOrders],
      [activeTasks],
      [completedTasks],
      [pendingPayments],
      [pendingDrafts],
      [overdueOrders],
      [writerPendingAcceptance],
      [underRevision],
      [readyForDelivery],
      [deliveredToday],
      [clientResponses]
    ] = await Promise.all([
      // 1. Total Revenue Today (from payments where order is verified/beyond)
      db.query(
        `SELECT COALESCE(SUM(p.amount), 0) as revenue
         FROM payments p
         JOIN orders o ON p.order_id = o.order_id
         WHERE o.status >= ? AND DATE(p.created_at) = DATE(?)`,
        [STATUS.PAYMENT_VERIFIED, today]
      ),
      // 2. Total Revenue This Month
      db.query(
        `SELECT COALESCE(SUM(p.amount), 0) as revenue
         FROM payments p
         JOIN orders o ON p.order_id = o.order_id
         WHERE o.status >= ?
           AND DATE(p.created_at) >= DATE(?) AND DATE(p.created_at) <= DATE(?)`,
        [STATUS.PAYMENT_VERIFIED, monthStart, monthEnd]
      ),
      // 3. New Queries Today (PENDING_QUERY status = 26)
      db.query(
        `SELECT COUNT(*) as count
         FROM orders
         WHERE DATE(created_at) = DATE(?) AND status = ?`,
        [today, STATUS.PENDING_QUERY]
      ),
      // 4. Pending Quotations (QUOTATION_SENT status = 27)
      db.query(
        `SELECT COUNT(*) as count
         FROM orders
         WHERE status = ?`,
        [STATUS.QUOTATION_SENT]
      ),
      // 5. Confirmed Orders Today (PAYMENT_VERIFIED and beyond)
      db.query(
        `SELECT COUNT(*) as count
         FROM orders
         WHERE DATE(updated_at) = DATE(?) AND status >= ?`,
        [today, STATUS.PAYMENT_VERIFIED]
      ),
      // 6. Active Tasks In Progress (submissions pending QC or revision)
      db.query(
        `SELECT COUNT(*) as count
         FROM submissions
         WHERE status IN ('pending_qc', 'revision_required')`,
        []
      ),
      // 7. Completed Tasks This Month
      db.query(
        `SELECT COUNT(*) as count
         FROM submissions
         WHERE status = 'approved' 
           AND DATE(updated_at) >= DATE(?) AND DATE(updated_at) <= DATE(?)`,
        [monthStart, monthEnd]
      ),
      // 8. Pending Payments (AWAITING_VERIFICATION = 29)
      db.query(
        `SELECT COUNT(*) as count
         FROM orders
         WHERE status = ?`,
        [STATUS.AWAITING_VERIFICATION]
      ),
      // 9. Pending Drafts/QC Review
      db.query(
        `SELECT COUNT(*) as count
         FROM submissions
         WHERE status = 'pending_qc'`,
        []
      ),
      // 10. Overdue Orders (deadline passed but not delivered)
      db.query(
        `SELECT COUNT(*) as count
         FROM orders
         WHERE deadline_at < NOW() AND status NOT IN (?, ?, ?, ?)`,
        [STATUS.DELIVERED, STATUS.COMPLETED, STATUS.QUERY_REJECTED, STATUS.CANCELLED]
      ),
      // 11. Writer Pending Acceptance (WRITER_ASSIGNED = 31)
      db.query(
        `SELECT COUNT(*) as count
         FROM orders
         WHERE status = ?`,
        [STATUS.WRITER_ASSIGNED]
      ),
      // 12. Under Revision
      db.query(
        `SELECT COUNT(*) as count
         FROM orders
         WHERE status = ?`,
        [STATUS.REVISION_REQUIRED]
      ),
      // 13. Ready For Delivery (APPROVED)
      db.query(
        `SELECT COUNT(*) as count
         FROM orders
         WHERE status = ?`,
        [STATUS.APPROVED]
      ),
      // 14. Delivered Today
      db.query(
        `SELECT COUNT(*) as count
         FROM orders
         WHERE status = ? AND DATE(updated_at) = DATE(?)`,
        [STATUS.DELIVERED, today]
      ),
      // 15. Awaiting Client Response (QUOTATION_SENT)
      db.query(
        `SELECT COUNT(*) as count
         FROM orders
         WHERE status = ? AND DATEDIFF(NOW(), updated_at) > 2`,
        [STATUS.QUOTATION_SENT]
      )
    ]);

    // COMBINED PENDING APPROVALS (Payments + Drafts)
    const totalPendingApprovals = pendingPayments[0].count + pendingDrafts[0].count;

    // Prepare comprehensive KPI data
    const kpis = {
      // Financial
      todayRevenue: parseFloat(todayRevenue[0].revenue).toFixed(2),
      monthRevenue: parseFloat(monthRevenue[0].revenue).toFixed(2),
      
      // Query Pipeline
      newQueries: newQueries[0].count,
      pendingQuotations: pendingQuotations[0].count,
      clientResponses: clientResponses[0].count, // Stale quotations
      
      // Orders
      confirmedOrders: confirmedOrders[0].count,
      overdueOrders: overdueOrders[0].count,
      
      // Tasks/Work
      activeTasks: activeTasks[0].count,
      completedTasks: completedTasks[0].count,
      writerPendingAcceptance: writerPendingAcceptance[0].count,
      underRevision: underRevision[0].count,
      
      // Approvals - COMBINED METRIC
      pendingApprovals: totalPendingApprovals,
      pendingPayments: pendingPayments[0].count,
      pendingDrafts: pendingDrafts[0].count,
      
      // Delivery
      readyForDelivery: readyForDelivery[0].count,
      deliveredToday: deliveredToday[0].count
    };

    // Get recent activities with status labels
    const [recentActivities] = await db.query(
      `SELECT 
        o.order_id, o.query_code, o.work_code, o.user_id, o.paper_topic, 
        o.service, o.status, o.created_at, o.deadline_at, o.writer_id,
        u.full_name as client_name,
        w.full_name as writer_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.user_id
      LEFT JOIN users w ON o.writer_id = w.user_id
      ORDER BY o.updated_at DESC
      LIMIT 15`
    );

    // Add status label and phase to each activity
    const activitiesWithLabels = recentActivities.map(activity => ({
      ...activity,
      statusLabel: STATUS_NAMES[activity.status] || `Status ${activity.status}`,
      lifecyclePhase: getLifecyclePhase(activity.status),
      isOverdue: activity.deadline_at && new Date(activity.deadline_at) < new Date() && activity.status < STATUS.DELIVERED
    }));

    // Get urgent items requiring attention
    const [urgentItems] = await db.query(
      `SELECT 
        o.order_id, o.query_code, o.work_code, o.paper_topic, o.deadline_at, o.status,
        TIMESTAMPDIFF(HOUR, NOW(), o.deadline_at) as hours_remaining
      FROM orders o
      WHERE o.deadline_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR)
        AND o.status NOT IN (?, ?, ?, ?)
      ORDER BY o.deadline_at ASC
      LIMIT 10`,
      [STATUS.DELIVERED, STATUS.COMPLETED, STATUS.QUERY_REJECTED, STATUS.CANCELLED]
    );

    const urgentItemsWithLabels = urgentItems.map(item => ({
      ...item,
      statusLabel: STATUS_NAMES[item.status] || `Status ${item.status}`,
      urgencyLevel: item.hours_remaining <= 6 ? 'critical' : item.hours_remaining <= 12 ? 'high' : 'medium'
    }));

    // Get admin initials
    const initials = profile.full_name
      ? profile.full_name.split(" ").map(n => n[0]).join("").toUpperCase()
      : "AD";

    res.render("admin/dashboard", {
      title: "Admin Dashboard",
      layout: "layouts/admin",
      currentPage: "dashboard",
      profile,
      initials,
      kpis,
      recentActivities: activitiesWithLabels,
      urgentItems: urgentItemsWithLabels,
      STATUS_NAMES
    });

  } catch (err) {
    console.error("Admin Dashboard error:", err);
    console.error("Error stack:", err.stack);
    res.status(500).render("errors/500", { title: "Server Error", layout: false });
  }
};

/* =====================================================
   QUERY MANAGEMENT - LIST QUERIES
===================================================== */

exports.listQueries = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 10;
    const offset = (page - 1) * limit;

    const filters = {
      search: req.query.search || '',
      status: req.query.status || 'all',
      urgency: req.query.urgency || 'all'
    };

    // Build where clause
    let whereClause = '1=1';
    const params = [];

    if (filters.search) {
      whereClause += ' AND (order_code LIKE ? OR paper_topic LIKE ? OR CONCAT(u.full_name) LIKE ?)';
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (filters.status !== 'all') {
      const statusMap = {
        'new': 1, 'under-review': 2, 'quotation-sent': 3,
        'awaiting-response': 4, 'confirmed': 5, 'closed': 6
      };
      if (statusMap[filters.status]) {
        whereClause += ' AND o.status = ?';
        params.push(statusMap[filters.status]);
      }
    }

    if (filters.urgency !== 'all') {
      whereClause += ' AND o.urgency = ?';
      params.push(filters.urgency);
    }

    // Get total count
    const [countResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders o 
       JOIN users u ON o.user_id = u.user_id 
       WHERE ${whereClause}`,
      params
    );
    const total = countResult[0].count;
    const pages = Math.ceil(total / limit);

    // Get queries
    const [queries] = await db.query(
      `SELECT 
        o.order_id, o.order_code, o.paper_topic, o.service, 
        o.urgency, o.deadline_at, o.status, o.created_at,
        u.full_name, u.email, u.user_id
      FROM orders o
      JOIN users u ON o.user_id = u.user_id
      WHERE ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const profile = res.locals.profile;
    const initials = res.locals.initials;

    res.render("admin/queries/index", {
      title: "Query Management",
      layout: "layouts/admin",
      currentPage: "queries",
      profile,
      initials,
      queries,
      filters,
      page,
      pages,
      total
    });

  } catch (err) {
    console.error("List queries error:", err);
    res.status(500).render("errors/500", { title: "Server Error", layout: false });
  }
};

/* =====================================================
   QUERY MANAGEMENT - VIEW QUERY DETAILS
===================================================== */

exports.viewQuery = async (req, res) => {
  try {
    const { orderId } = req.params;

    // Get query details
    const [queryRows] = await db.query(
      `SELECT 
        o.order_id, o.order_code, o.paper_topic, o.service, 
        o.subject, o.urgency, o.deadline_at, o.status, 
        o.created_at, o.description, o.file_path, o.basic_price,
        o.discount, o.total_price, o.user_id,
        u.full_name, u.email, u.mobile_number, u.university
      FROM orders o
      JOIN users u ON o.user_id = u.user_id
      WHERE o.order_id = ?`,
      [orderId]
    );

    if (!queryRows.length) {
      return res.status(404).render("errors/404", { title: "Query Not Found", layout: false });
    }

    const query = queryRows[0];
    const profile = res.locals.profile;
    const initials = res.locals.initials;

    res.render("admin/queries/view", {
      title: `Query - ${query.order_code}`,
      layout: "layouts/admin",
      currentPage: "queries",
      profile,
      initials,
      query
    });

  } catch (err) {
    console.error("View query error:", err);
    res.status(500).render("errors/500", { title: "Server Error", layout: false });
  }
};

/* =====================================================
   QUERY MANAGEMENT - CHANGE STATUS
===================================================== */

exports.updateQueryStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, notes } = req.body;

    const statusMap = {
      'new': 1, 'under-review': 2, 'quotation-sent': 3,
      'awaiting-response': 4, 'confirmed': 5, 'closed': 6
    };

    if (!statusMap[status]) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    await db.query(
      'UPDATE orders SET status = ? WHERE order_id = ?',
      [statusMap[status], orderId]
    );

    // Log action
    await logAction({
        userId: req.user.user_id,
        action: 'status_change',
        details: notes || `Status changed to ${status}`,
        resource_type: 'order',
        resource_id: orderId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    res.json({ success: true, message: 'Query status updated successfully' });

  } catch (err) {
    console.error("Update query status error:", err);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
};

/* =====================================================
   PAYMENTS - LIST PENDING VERIFICATIONS
===================================================== */

exports.listPayments = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 10;
    const offset = (page - 1) * limit;

    const filters = {
      status: req.query.status || 'pending'
    };

    // Get total count
    const [countResult] = await db.query(
      `SELECT COUNT(*) as count FROM payments WHERE payment_type = ?`,
      [filters.status]
    );
    const total = countResult[0].count;
    const pages = Math.ceil(total / limit);

    // Get payments
    const [payments] = await db.query(
      `SELECT 
        p.payment_id, p.order_id, p.amount, p.payment_method,
        p.payment_doc, p.created_at, p.payment_type,
        o.order_code, o.paper_topic,
        u.full_name, u.email
      FROM payments p
      LEFT JOIN orders o ON p.order_id = o.order_id
      LEFT JOIN users u ON p.user_id = u.user_id
      WHERE p.payment_type = ?
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?`,
      [filters.status, limit, offset]
    );

    const profile = res.locals.profile;
    const initials = res.locals.initials;

    res.render("admin/payments/index", {
      title: "Payment Verification",
      layout: "layouts/admin",
      currentPage: "payments",
      profile,
      initials,
      payments,
      filters,
      page,
      pages,
      total
    });

  } catch (err) {
    console.error("List payments error:", err);
    res.status(500).render("errors/500", { title: "Server Error", layout: false });
  }
};

/* =====================================================
   PAYMENTS - VERIFY PAYMENT
===================================================== */

exports.verifyPayment = async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    const { paymentId } = req.params;
    const { verification_status, percentage } = req.body;

    // Get payment details
    const [paymentRows] = await connection.query(
      'SELECT * FROM payments WHERE payment_id = ?',
      [paymentId]
    );

    if (!paymentRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const payment = paymentRows[0];
    const orderId = payment.order_id;

    if (verification_status === 'verified') {
      // Generate work_code if this is 100% payment
      let workCode = null;
      if (percentage === 100) {
        // Generate unique work code
        workCode = 'WC' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
        
        // Update order with work_code and convert to confirmed
        await connection.query(
          'UPDATE orders SET work_code = ?, status = 30 WHERE order_id = ?',
          [workCode, orderId]
        );
      }

      // Update payment status
      await connection.query(
        'UPDATE payments SET payment_type = ? WHERE payment_id = ?',
        ['verified', paymentId]
      );

      // Log action
      await logAction({
          userId: req.user.user_id,
          action: 'payment_verified',
          details: `Payment verified for ${percentage}% - Work Code: ${workCode || 'Pending'}`,
          resource_type: 'order',
          resource_id: orderId,
          ip: req.ip,
          userAgent: req.get('User-Agent')
      });

    } else if (verification_status === 'rejected') {
      // Update payment status
      await connection.query(
        'UPDATE payments SET payment_type = ? WHERE payment_id = ?',
        ['rejected', paymentId]
      );

      // Notify user with real-time emission
      const [notifResult] = await connection.query(
        `INSERT INTO notifications (user_id, type, title, message, link_url, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, 0, NOW())`,
        [payment.user_id, 'warning', 'Payment Rejected', 'Your payment receipt was rejected. Please reupload.', `/client/orders`]
      );
      
      // Emit real-time notification via Socket.IO
      if (req.io) {
        req.io.to(`user:${payment.user_id}`).emit('notification:new', {
          notification_id: notifResult.insertId,
          user_id: payment.user_id,
          type: 'warning',
          title: 'Payment Rejected',
          message: 'Your payment receipt was rejected. Please reupload.',
          link_url: '/client/orders',
          is_read: 0,
          created_at: new Date().toISOString()
        });
      }
      
      // Log action
      await logAction({
          userId: req.user.user_id,
          action: 'payment_rejected',
          details: `Payment rejected for order ${orderId}`,
          resource_type: 'order',
          resource_id: orderId,
          ip: req.ip,
          userAgent: req.get('User-Agent')
      });
    }

    await connection.commit();
    connection.release();

    res.json({ success: true, message: 'Payment ' + verification_status });

  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error("Verify payment error:", err);
    res.status(500).json({ success: false, message: 'Failed to verify payment' });
  }
};

exports.listTasks = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 10;
    const offset = (page - 1) * limit;

    const filters = {
      status: req.query.status || 'all'
    };

    let whereClause = '1=1';
    if (filters.status !== 'all') {
      whereClause = `s.status = ?`;
    }

    // Get total count
    const [countResult] = await db.query(
      `SELECT COUNT(*) as count FROM submissions s WHERE ${whereClause}`,
      filters.status !== 'all' ? [filters.status] : []
    );
    const total = countResult[0].count;
    const pages = Math.ceil(total / limit);

    // Get tasks
    const [tasks] = await db.query(
      `SELECT 
        s.submission_id, s.order_id, s.writer_id, s.status,
        s.file_url, s.grammarly_score, s.ai_score, 
        s.plagiarism_score, s.created_at, s.updated_at,
        o.order_code, o.paper_topic, o.deadline_at,
        w.full_name as writer_name
      FROM submissions s
      LEFT JOIN orders o ON s.order_id = o.order_id
      LEFT JOIN users w ON s.writer_id = w.user_id
      WHERE ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?`,
      [...(filters.status !== 'all' ? [filters.status] : []), limit, offset]
    );

    const profile = res.locals.profile;
    const initials = res.locals.initials;

    res.render("admin/tasks/index", {
      title: "Task Monitoring",
      layout: "layouts/admin",
      currentPage: "tasks",
      profile,
      initials,
      tasks,
      filters,
      page,
      pages,
      total
    });

  } catch (err) {
    console.error("List tasks error:", err);
    res.status(500).render("errors/500", { title: "Server Error", layout: false });
  }
};

exports.approveQC = async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    const { submissionId } = req.params;
    const { qc_action } = req.body;

    if (!['approve', 'reject'].includes(qc_action)) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }

    // Get submission details
    const [submissionRows] = await connection.query(
      'SELECT * FROM submissions WHERE submission_id = ?',
      [submissionId]
    );

    if (!submissionRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    const submission = submissionRows[0];
    const orderId = submission.order_id;

    if (qc_action === 'approve') {
      // Update submission status to approved
      await connection.query(
        'UPDATE submissions SET status = ? WHERE submission_id = ?',
        ['approved', submissionId]
      );

      // Update order status to 34 (Approved)
      await connection.query(
        'UPDATE orders SET status = 34 WHERE order_id = ?',
        [orderId]
      );
    } else {
      // Mark as revision required
      await connection.query(
        'UPDATE submissions SET status = ? WHERE submission_id = ?',
        ['revision_required', submissionId]
      );
    }

    // Log action
    await logAction({
        userId: req.user.user_id,
        action: 'qc_' + qc_action,
        details: `QC ${qc_action}ed by admin`,
        resource_type: 'order',
        resource_id: orderId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    await connection.commit();
    connection.release();

    res.json({ success: true, message: `QC ${qc_action}ed successfully` });

  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error("Approve QC error:", err);
    res.status(500).json({ success: false, message: 'Failed to process QC' });
  }
};

// ===== REAL-TIME DASHBOARD API =====

/**
 * Get sidebar counts for real-time badge updates
 */
exports.getSidebarCounts = async (req, res) => {
  try {
    // Queries count (status 26-27)
    const [queriesResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders WHERE status IN (26, 27)`
    );

    // Pending Payments count (status 28)
    const [paymentsResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders WHERE status = 28`
    );

    // QC Pending count (status 33)
    const [qcResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders WHERE status = 33`
    );

    // Delivery Pending count (status 37)
    const [deliveryResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders WHERE status = 37`
    );

    // Active Writers count
    const [writersResult] = await db.query(
      `SELECT COUNT(*) as count FROM users WHERE role = 'writer' AND is_active = 1`
    );

    // Active BDEs count
    const [bdesResult] = await db.query(
      `SELECT COUNT(*) as count FROM users WHERE role = 'bde' AND is_active = 1`
    );

    // Unread Notifications
    const [notificationsResult] = await db.query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`,
      [req.user.user_id]
    );

    res.json({
      success: true,
      data: {
        queries: queriesResult[0].count,
        payments: paymentsResult[0].count,
        qc: qcResult[0].count,
        delivery: deliveryResult[0].count,
        writers: writersResult[0].count,
        bdes: bdesResult[0].count,
        notifications: notificationsResult[0].count
      }
    });

  } catch (err) {
    console.error("Get sidebar counts error:", err);
    res.status(500).json({ success: false, message: 'Failed to fetch sidebar counts' });
  }
};

/**
 * Get dashboard KPIs for real-time updates
 */
exports.getDashboardKPIs = async (req, res) => {
  try {
    // Total Active Orders (status 26-39)
    const [activeOrdersResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders WHERE status BETWEEN 26 AND 39`
    );

    // Orders by Phase
    const [phaseCountsResult] = await db.query(`
      SELECT 
        SUM(CASE WHEN status IN (26, 27) THEN 1 ELSE 0 END) as query_phase,
        SUM(CASE WHEN status IN (28, 29, 30) THEN 1 ELSE 0 END) as payment_phase,
        SUM(CASE WHEN status IN (31, 32, 33) THEN 1 ELSE 0 END) as execution_phase,
        SUM(CASE WHEN status IN (34, 35, 36) THEN 1 ELSE 0 END) as qc_phase,
        SUM(CASE WHEN status IN (37, 38, 39) THEN 1 ELSE 0 END) as delivery_phase,
        SUM(CASE WHEN status IN (40, 41, 42, 43, 44, 45) THEN 1 ELSE 0 END) as terminal_phase
      FROM orders WHERE status BETWEEN 26 AND 45
    `);

    // Today's Orders
    const [todayOrdersResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders WHERE DATE(created_at) = CURDATE()`
    );

    // Revenue Today
    const [todayRevenueResult] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM payments 
       WHERE status = 'confirmed' AND DATE(created_at) = CURDATE()`
    );

    // Revenue This Month
    const [monthRevenueResult] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM payments 
       WHERE status = 'confirmed' AND MONTH(created_at) = MONTH(CURDATE()) 
       AND YEAR(created_at) = YEAR(CURDATE())`
    );

    // Pending Actions
    const [pendingQueriesResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders WHERE status = 26`
    );
    const [pendingQuotationsResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders WHERE status = 27`
    );
    const [pendingPaymentsResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders WHERE status = 28`
    );
    const [pendingQCResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders WHERE status = 33`
    );
    const [pendingDeliveryResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders WHERE status = 37`
    );

    // Overdue Orders
    const [overdueResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders 
       WHERE deadline < NOW() AND status BETWEEN 26 AND 39`
    );

    // Due Today
    const [dueTodayResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders 
       WHERE DATE(deadline) = CURDATE() AND status BETWEEN 26 AND 39`
    );

    // Completion Rate (last 30 days)
    const [completedResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders 
       WHERE status = 40 AND updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );
    const [totalCompletableResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );
    const completionRate = totalCompletableResult[0].count > 0 
      ? Math.round((completedResult[0].count / totalCompletableResult[0].count) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        activeOrders: activeOrdersResult[0].count,
        phases: phaseCountsResult[0],
        todayOrders: todayOrdersResult[0].count,
        todayRevenue: todayRevenueResult[0].total,
        monthRevenue: monthRevenueResult[0].total,
        pending: {
          queries: pendingQueriesResult[0].count,
          quotations: pendingQuotationsResult[0].count,
          payments: pendingPaymentsResult[0].count,
          qc: pendingQCResult[0].count,
          delivery: pendingDeliveryResult[0].count
        },
        overdue: overdueResult[0].count,
        dueToday: dueTodayResult[0].count,
        completionRate: completionRate
      }
    });

  } catch (err) {
    console.error("Get dashboard KPIs error:", err);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard KPIs' });
  }
};
