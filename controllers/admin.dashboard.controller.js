const db = require('../config/db');
const { sendMail } = require('../utils/mailer');
const { logAction } = require('../utils/logger');

/* =====================================================
   ADMIN DASHBOARD - MAIN METRICS & KPIs
===================================================== */

exports.getDashboard = async (req, res) => {
  try {
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

    if (!adminRows.length) {
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

    // KPI QUERIES - ALL PARALLEL
    const [
      [todayRevenue],
      [monthRevenue],
      [newQueries],
      [pendingQuotations],
      [confirmedOrders],
      [activeTasks],
      [completedTasks],
      [pendingApprovals]
    ] = await Promise.all([
      // 1. Total Revenue Today
      db.query(
        `SELECT COALESCE(SUM(total_price_usd), 0) as revenue
         FROM orders
         WHERE DATE(created_at) = DATE(?)`,
        [today]
      ),
      // 2. Total Revenue This Month
      db.query(
        `SELECT COALESCE(SUM(total_price_usd), 0) as revenue
         FROM orders
         WHERE DATE(created_at) >= DATE(?) AND DATE(created_at) <= DATE(?)`,
        [monthStart, monthEnd]
      ),
      // 3. New Queries Today (status: New/Under Review)
      db.query(
        `SELECT COUNT(*) as count
         FROM orders
         WHERE DATE(created_at) = DATE(?) AND status IN (1, 2)`,
        [today]
      ),
      // 4. Pending Quotations (Quotation Sent status)
      db.query(
        `SELECT COUNT(*) as count
         FROM orders
         WHERE status = 3`,
        []
      ),
      // 5. Confirmed Orders Today
      db.query(
        `SELECT COUNT(*) as count
         FROM orders
         WHERE DATE(created_at) = DATE(?) AND status >= 4`,
        [today]
      ),
      // 6. Active Tasks In Progress
      db.query(
        `SELECT COUNT(*) as count
         FROM submissions
         WHERE status = 'pending_qc' OR status = 'revision_required'`,
        []
      ),
      // 7. Completed Tasks This Month
      db.query(
        `SELECT COUNT(*) as count
         FROM submissions
         WHERE status = 'completed' AND DATE(created_at) >= DATE(?) AND DATE(created_at) <= DATE(?)`,
        [monthStart, monthEnd]
      ),
      // 8. Pending Approvals (Payment verification + QC pending)
      db.query(
        `SELECT COUNT(DISTINCT po.order_id) as count
         FROM orders po
         WHERE po.status = 3 OR po.status = 4`,
        []
      )
    ]);

    // Prepare KPI data
    const kpis = {
      todayRevenue: parseFloat(todayRevenue[0].revenue).toFixed(2),
      monthRevenue: parseFloat(monthRevenue[0].revenue).toFixed(2),
      newQueries: newQueries[0].count,
      pendingQuotations: pendingQuotations[0].count,
      confirmedOrders: confirmedOrders[0].count,
      activeTasks: activeTasks[0].count,
      completedTasks: completedTasks[0].count,
      pendingApprovals: pendingApprovals[0].count
    };

    // Get recent activities (last 10)
    const [recentActivities] = await db.query(
      `SELECT 
        order_id, order_code, user_id, paper_topic, 
        service, status, created_at, writer_id
      FROM orders
      ORDER BY created_at DESC
      LIMIT 10`
    );

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
      recentActivities
    });

  } catch (err) {
    console.error("Admin Dashboard error:", err);
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
        o.created_at, o.description, o.file_path, o.basic_price_usd,
        o.discount_usd, o.total_price_usd, o.user_id,
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
          'UPDATE orders SET work_code = ?, status = 5 WHERE order_id = ?',
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

      // Notify user
      await connection.query(
        `INSERT INTO notifications (user_id, type, title, message)
         VALUES (?, ?, ?, ?)`,
        [payment.user_id, 'warning', 'Payment Rejected', 'Your payment receipt was rejected. Please reupload.']
      );
      
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

      // Update order status to Ready for Delivery
      await connection.query(
        'UPDATE orders SET status = 7 WHERE order_id = ?',
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
