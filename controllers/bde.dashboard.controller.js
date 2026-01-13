const db = require("../config/db");
const { sendNotification } = require("../utils/notifications");
const logger = require("../utils/logger");

/* =====================================================
   BDE DASHBOARD - KPI METRICS & OVERVIEW
===================================================== */

/**
 * Get BDE Dashboard with KPI cards and filters
 */
exports.getDashboard = async (req, res) => {
  try {
    const bdeId = req.user.user_id;
    const dateFilter = req.query.dateFilter || "today";
    const monthFilter = req.query.monthFilter || new Date().toISOString().slice(0, 7);

    // Build date range based on filter
    let dateRange = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (dateFilter === "today") {
      dateRange.start = today;
      dateRange.end = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    } else if (dateFilter === "week") {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      dateRange.start = weekStart;
      dateRange.end = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else if (dateFilter === "month") {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      dateRange.start = monthStart;
      dateRange.end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    }

    // KPI 1: New Queries (Today)
    const [newQueries] = await db.query(
      `SELECT COUNT(*) as count
       FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE u.bde = ? AND o.status = 1 AND DATE(o.created_at) = ?`,
      [bdeId, today.toISOString().split("T")[0]]
    );

    // KPI 2: Pending Quotations (orders with quotations but status < 4)
    const [pendingQuotations] = await db.query(
      `SELECT COUNT(DISTINCT o.order_id) as count
       FROM orders o
       JOIN users u ON o.user_id = u.user_id
       JOIN quotations q ON o.order_id = q.order_id
       WHERE u.bde = ? AND o.status = 3`,
      [bdeId]
    );

    // KPI 3: Confirmed Orders (This Month)
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const [confirmedOrders] = await db.query(
      `SELECT COUNT(*) as count
       FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE u.bde = ? AND o.status >= 4 
       AND DATE(o.created_at) BETWEEN ? AND ?`,
      [bdeId, monthStart.toISOString().split("T")[0], monthEnd.toISOString().split("T")[0]]
    );

    // KPI 4: Total Revenue (This Month)
    const [totalRevenue] = await db.query(
      `SELECT COALESCE(SUM(o.total_price_usd), 0) as total
       FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE u.bde = ? AND o.status >= 4
       AND DATE(o.created_at) BETWEEN ? AND ?`,
      [bdeId, monthStart.toISOString().split("T")[0], monthEnd.toISOString().split("T")[0]]
    );

    // KPI 5: Pending Payments (orders with no payments or incomplete payments)
    const [pendingPayments] = await db.query(
      `SELECT COUNT(DISTINCT o.order_id) as count
       FROM orders o
       JOIN users u ON o.user_id = u.user_id
       LEFT JOIN payments p ON o.order_id = p.order_id
       WHERE u.bde = ? AND o.status >= 3 AND (p.payment_id IS NULL OR COALESCE(p.amount, 0) < o.total_price_usd)`,
      [bdeId]
    );

    // KPI 6: Submissions Pending QC
    const [draftsAwaitingApproval] = await db.query(
      `SELECT COUNT(*) as count
       FROM submissions s
       JOIN orders o ON s.order_id = o.order_id
       JOIN users u ON o.user_id = u.user_id
       WHERE u.bde = ? AND s.status = 'pending_qc'`,
      [bdeId]
    );

    res.render("bde/dashboard", {
      title: "BDE Dashboard",
      layout: "layouts/bde",
      currentPage: "dashboard",
      kpis: {
        newQueries: parseInt(newQueries[0].count) || 0,
        pendingQuotations: parseInt(pendingQuotations[0].count) || 0,
        confirmedOrders: parseInt(confirmedOrders[0].count) || 0,
        totalRevenue: parseFloat(totalRevenue[0].total) || 0,
        pendingPayments: parseInt(pendingPayments[0].count) || 0,
        draftsAwaitingApproval: parseInt(draftsAwaitingApproval[0].count) || 0
      },
      dateFilter,
      monthFilter
    });
  } catch (err) {
    logger.error("BDE Dashboard error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};

/* =====================================================
   CLIENT MANAGEMENT - REFERRAL-BASED
===================================================== */

/**
 * List all clients assigned to BDE through referral
 */
exports.listClients = async (req, res) => {
  try {
    const bdeId = req.user.user_id;
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const [clients] = await db.query(
      `SELECT 
        u.user_id,
        u.full_name,
        u.email,
        u.whatsapp,
        u.mobile_number,
        u.country,
        u.university,
        COUNT(DISTINCT o.order_id) as total_orders,
        SUM(CASE WHEN o.status >= 4 THEN 1 ELSE 0 END) as confirmed_orders
      FROM users u
      LEFT JOIN orders o ON u.user_id = o.user_id
      WHERE u.bde = ? AND u.role = 'client' AND u.is_active = 1
      GROUP BY u.user_id
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?`,
      [bdeId, limit, offset]
    );

    const [countResult] = await db.query(
      `SELECT COUNT(DISTINCT user_id) as total
       FROM users
       WHERE bde = ? AND role = 'client' AND is_active = 1`,
      [bdeId]
    );

    const totalClients = countResult[0].total;
    const totalPages = Math.ceil(totalClients / limit);

    res.render("bde/clients/index", {
      title: "Client Management",
      layout: "layouts/bde",
      currentPage: "clients",
      clients,
      pagination: {
        current: page,
        total: totalPages,
        limit
      }
    });
  } catch (err) {
    logger.error("List clients error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};

/**
 * View single client details
 */
exports.viewClient = async (req, res) => {
  try {
    const { clientId } = req.params;
    const bdeId = req.user.user_id;

    // Verify BDE owns this client
    const [clientRows] = await db.query(
      `SELECT * FROM users WHERE user_id = ? AND bde = ?`,
      [clientId, bdeId]
    );

    if (!clientRows.length) {
      return res.status(404).render("errors/404", {
        title: "Client Not Found",
        layout: false
      });
    }

    const client = clientRows[0];

    // Get client's queries
    const [queries] = await db.query(
      `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`,
      [clientId]
    );

    // Get recent messages
    const [messages] = await db.query(
      `SELECT * FROM chats 
       WHERE (user_id = ? OR admin_id = ?) 
       ORDER BY created_at DESC 
       LIMIT 10`,
      [clientId, bdeId]
    );

    res.render("bde/clients/detail", {
      title: "Client Details",
      layout: "layouts/bde",
      currentPage: "clients",
      client,
      queries,
      messages
    });
  } catch (err) {
    logger.error("View client error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};

/* =====================================================
   QUERY MANAGEMENT - PRE-CONFIRMATION
===================================================== */

/**
 * List all queries assigned to BDE
 */
exports.listQueries = async (req, res) => {
  try {
    const bdeId = req.user.user_id;
    const page = parseInt(req.query.page) || 1;
    const status = req.query.status || "all";
    const limit = 20;
    const offset = (page - 1) * limit;

    let statusCondition = "";
    if (status !== "all") {
      const statusMap = {
        new: 1,
        review: 2,
        quotation_sent: 3,
        awaiting_response: 4,
        closed: 5,
        confirmed: 6
      };
      statusCondition = `AND o.status = ${statusMap[status] || 1}`;
    }

    const [queries] = await db.query(
      `SELECT 
        o.order_id,
        o.query_code,
        o.paper_topic,
        o.status,
        o.created_at,
        o.deadline_at,
        u.full_name,
        u.email,
        u.country
      FROM orders o
      JOIN users u ON o.user_id = u.user_id
      WHERE u.bde = ? ${statusCondition}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?`,
      [bdeId, limit, offset]
    );

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE u.bde = ? ${statusCondition}`,
      [bdeId]
    );

    const totalQueries = countResult[0].total;
    const totalPages = Math.ceil(totalQueries / limit);

    res.render("bde/queries/index", {
      title: "Query Management",
      layout: "layouts/bde",
      currentPage: "queries",
      queries,
      currentStatus: status,
      pagination: {
        current: page,
        total: totalPages,
        limit
      }
    });
  } catch (err) {
    logger.error("List queries error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};

/**
 * View query details
 */
exports.viewQuery = async (req, res) => {
  try {
    const { queryCode } = req.params;
    const bdeId = req.user.user_id;

    // Get query details with BDE verification
    const [queries] = await db.query(
      `SELECT o.*, u.full_name, u.email, u.whatsapp
       FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE o.query_code = ? AND u.bde = ?`,
      [queryCode, bdeId]
    );

    if (!queries.length) {
      return res.status(404).render("errors/404", {
        title: "Query Not Found",
        layout: false
      });
    }

    const query = queries[0];

    // Get quotation if exists
    const [quotations] = await db.query(
      `SELECT * FROM quotations WHERE order_id = ?`,
      [query.order_id]
    );

    // Get chat messages
    const [messages] = await db.query(
      `SELECT * FROM chats WHERE order_id = ? ORDER BY created_at DESC`,
      [query.order_id]
    );

    res.render("bde/queries/detail", {
      title: "Query Details",
      layout: "layouts/bde",
      currentPage: "queries",
      query,
      quotation: quotations[0] || null,
      messages
    });
  } catch (err) {
    logger.error("View query error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};

/* =====================================================
   QUOTATION GENERATION & MANAGEMENT
===================================================== */

/**
 * Generate quotation for a query
 */
exports.generateQuotation = async (req, res) => {
  try {
    const { queryCode } = req.params;
    const { basePrice, discount, finalPrice, notes } = req.body;
    const quotationFile = req.file;
    const bdeId = req.user.user_id;

    // Verify BDE owns this query
    const [queries] = await db.query(
      `SELECT o.* FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE o.query_code = ? AND u.bde = ?`,
      [queryCode, bdeId]
    );

    if (!queries.length) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this query"
      });
    }

    const query = queries[0];

    // Save quotation to database
    const quotationFileUrl = quotationFile ? `/quotations/${quotationFile.filename}` : null;

    const [result] = await db.query(
      `INSERT INTO quotations (order_id, base_price, discount, final_price, file_url, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [query.order_id, basePrice, discount, finalPrice, quotationFileUrl, notes, bdeId]
    );

    // Update order status to "Quotation Sent"
    await db.query(
      `UPDATE orders SET status = 3, updated_at = NOW() WHERE order_id = ?`,
      [query.order_id]
    );

    // Send notification to client
    await sendNotification(
      query.user_id,
      `Quotation for your query "${query.paper_topic}" is ready!`,
      `quotation-generated`,
      {
        queryCode,
        basePrice,
        finalPrice
      }
    );

    // Notify admin
    await sendNotification(
      null,
      `BDE generated quotation for query ${queryCode}`,
      `quotation-generated`,
      {
        role: "admin",
        queryCode
      }
    );

    res.json({
      success: true,
      message: "Quotation generated and notifications sent"
    });
  } catch (err) {
    logger.error("Generate quotation error:", err);
    res.status(500).json({
      success: false,
      message: "Error generating quotation"
    });
  }
};

/**
 * Update query status
 */
exports.updateQueryStatus = async (req, res) => {
  try {
    const { queryCode } = req.params;
    const { newStatus } = req.body;
    const bdeId = req.user.user_id;

    // BDE can update: New → Review, Review → Quotation Sent, Quotation Sent → Awaiting Response, Awaiting Response → Closed
    // BDE CANNOT update: To "Confirmed" (admin only)
    const allowedStatuses = [2, 3, 4, 5]; // Exclude 6 (Confirmed)

    if (!allowedStatuses.includes(newStatus)) {
      return res.status(403).json({
        success: false,
        message: "You cannot change status to this value"
      });
    }

    // Verify ownership
    const [queries] = await db.query(
      `SELECT o.* FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE o.query_code = ? AND u.bde = ?`,
      [queryCode, bdeId]
    );

    if (!queries.length) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this query"
      });
    }

    // Update status
    await db.query(
      `UPDATE orders SET status = ?, updated_at = NOW() WHERE query_code = ?`,
      [newStatus, queryCode]
    );

    res.json({
      success: true,
      message: "Query status updated"
    });
  } catch (err) {
    logger.error("Update query status error:", err);
    res.status(500).json({
      success: false,
      message: "Error updating status"
    });
  }
};

/* =====================================================
   CONFIRMED ORDERS - READ-ONLY VIEW
===================================================== */

/**
 * List confirmed orders (payment verified)
 */
exports.listConfirmedOrders = async (req, res) => {
  try {
    const bdeId = req.user.user_id;
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const [orders] = await db.query(
      `SELECT 
        o.order_id,
        o.work_code,
        o.paper_topic,
        o.status,
        o.total_price_usd,
        o.deadline_at,
        u.full_name,
        u.email,
        COUNT(DISTINCT t.id) as task_count,
        SUM(CASE WHEN t.status = 'pending' THEN 0 ELSE 1 END) as completed_tasks
      FROM orders o
      JOIN users u ON o.user_id = u.user_id
      LEFT JOIN task_evaluations t ON o.order_id = t.order_id
      WHERE u.bde = ? AND o.status >= 4
      GROUP BY o.order_id
      ORDER BY o.deadline_at ASC
      LIMIT ? OFFSET ?`,
      [bdeId, limit, offset]
    );

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE u.bde = ? AND o.status >= 4`,
      [bdeId]
    );

    const totalOrders = countResult[0].total;
    const totalPages = Math.ceil(totalOrders / limit);

    res.render("bde/orders/index", {
      title: "Confirmed Orders",
      layout: "layouts/bde",
      currentPage: "orders",
      orders,
      pagination: {
        current: page,
        total: totalPages,
        limit
      }
    });
  } catch (err) {
    logger.error("List confirmed orders error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};

/**
 * View confirmed order details (read-only)
 */
exports.viewConfirmedOrder = async (req, res) => {
  try {
    const { workCode } = req.params;
    const bdeId = req.user.user_id;

    const [orders] = await db.query(
      `SELECT o.*, u.full_name, u.email, u.whatsapp
       FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE o.work_code = ? AND u.bde = ?`,
      [workCode, bdeId]
    );

    if (!orders.length) {
      return res.status(404).render("errors/404", {
        title: "Order Not Found",
        layout: false
      });
    }

    const order = orders[0];

    // Get task progress
    const [tasks] = await db.query(
      `SELECT * FROM task_evaluations WHERE order_id = ? ORDER BY created_at DESC`,
      [order.order_id]
    );

    // Get submissions for QC status
    const [submissions] = await db.query(
      `SELECT * FROM submissions WHERE order_id = ? ORDER BY created_at DESC`,
      [order.order_id]
    );

    // Get delivery status
    const [deliveries] = await db.query(
      `SELECT * FROM deliveries WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`,
      [order.order_id]
    );

    res.render("bde/orders/detail", {
      title: "Order Details",
      layout: "layouts/bde",
      currentPage: "orders",
      order,
      tasks,
      submissions,
      delivery: deliveries[0] || null
    });
  } catch (err) {
    logger.error("View confirmed order error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};

/* =====================================================
   CHAT & COMMUNICATION
===================================================== */

/**
 * Get chat messages for a query/order
 */
exports.getChat = async (req, res) => {
  try {
    const { queryCode, workCode } = req.params;
    const bdeId = req.user.user_id;

    let orderId;
    if (queryCode) {
      const [rows] = await db.query(
        `SELECT o.order_id FROM orders o
         JOIN users u ON o.user_id = u.user_id
         WHERE o.query_code = ? AND u.bde = ?`,
        [queryCode, bdeId]
      );
      if (!rows.length) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      orderId = rows[0].order_id;
    } else if (workCode) {
      const [rows] = await db.query(
        `SELECT o.order_id FROM orders o
         JOIN users u ON o.user_id = u.user_id
         WHERE o.work_code = ? AND u.bde = ?`,
        [workCode, bdeId]
      );
      if (!rows.length) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      orderId = rows[0].order_id;
    }

    const [messages] = await db.query(
      `SELECT * FROM chats WHERE order_id = ? ORDER BY created_at ASC`,
      [orderId]
    );

    res.json({
      success: true,
      messages
    });
  } catch (err) {
    logger.error("Get chat error:", err);
    res.status(500).json({
      success: false,
      message: "Error retrieving messages"
    });
  }
};

/**
 * Send chat message
 */
exports.sendChatMessage = async (req, res) => {
  try {
    const { queryCode } = req.params;
    const { message, recipientType } = req.body;
    const bdeId = req.user.user_id;

    // recipientType: 'user' or 'admin'

    // Verify ownership
    const [orders] = await db.query(
      `SELECT o.* FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE o.query_code = ? AND u.bde = ?`,
      [queryCode, bdeId]
    );

    if (!orders.length) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const order = orders[0];

    // Insert chat message
    const recipientId = recipientType === 'admin' ? null : order.user_id;

    const [result] = await db.query(
      `INSERT INTO chats (order_id, sender_id, recipient_id, message, recipient_type, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [order.order_id, bdeId, recipientId, message, recipientType]
    );

    // Send notification
    if (recipientType === 'admin') {
      await sendNotification(
        null,
        `New message from BDE for query ${queryCode}`,
        `bde-message`,
        {
          role: "admin",
          queryCode,
          bdeId
        }
      );
    } else {
      await sendNotification(
        order.user_id,
        `New message from your BDE`,
        `bde-message`,
        {
          queryCode
        }
      );
    }

    res.json({
      success: true,
      message: "Message sent",
      messageId: result.insertId
    });
  } catch (err) {
    logger.error("Send message error:", err);
    res.status(500).json({
      success: false,
      message: "Error sending message"
    });
  }
};

/* =====================================================
   PAYMENTS & REMINDERS
===================================================== */

/**
 * List pending payments
 */
exports.listPendingPayments = async (req, res) => {
  try {
    const bdeId = req.user.user_id;
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const [payments] = await db.query(
      `SELECT 
        o.order_id,
        o.query_code,
        o.paper_topic,
        o.total_price_usd,
        COALESCE(SUM(p.amount), 0) as paid_amount,
        u.full_name,
        u.email,
        u.whatsapp,
        o.created_at
      FROM orders o
      JOIN users u ON o.user_id = u.user_id
      LEFT JOIN payments p ON o.order_id = p.order_id
      WHERE u.bde = ? AND o.status >= 3
      GROUP BY o.order_id
      HAVING COALESCE(SUM(p.amount), 0) < o.total_price_usd
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?`,
      [bdeId, limit, offset]
    );

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM (
        SELECT o.order_id, o.total_price_usd, COALESCE(SUM(p.amount), 0) as paid_amount
        FROM orders o
        JOIN users u ON o.user_id = u.user_id
        LEFT JOIN payments p ON o.order_id = p.order_id
        WHERE u.bde = ? AND o.status >= 3
        GROUP BY o.order_id
        HAVING paid_amount < o.total_price_usd
      ) as subquery`,
      [bdeId]
    );

    const totalPayments = countResult[0].total;
    const totalPages = Math.ceil(totalPayments / limit);

    res.render("bde/payments/index", {
      title: "Pending Payments",
      layout: "layouts/bde",
      currentPage: "payments",
      payments,
      pagination: {
        current: page,
        total: totalPages,
        limit
      }
    });
  } catch (err) {
    logger.error("List pending payments error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};

/**
 * Send payment reminder to client
 */
exports.sendPaymentReminder = async (req, res) => {
  try {
    const { queryCode } = req.params;
    const bdeId = req.user.user_id;

    // Verify ownership
    const [queries] = await db.query(
      `SELECT o.* FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE o.query_code = ? AND u.bde = ?`,
      [queryCode, bdeId]
    );

    if (!queries.length) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const order = queries[0];

    // Send notification
    await sendNotification(
      order.user_id,
      `Payment reminder for query ${queryCode}. Please complete your payment of $${order.total_price_usd}`,
      `payment-reminder`,
      {
        queryCode,
        amount: order.total_price_usd
      }
    );

    // Log reminder
    await db.query(
      `INSERT INTO audit_logs (action, user_id, target_type, target_id, created_at)
       VALUES ('payment-reminder-sent', ?, 'order', ?, NOW())`,
      [bdeId, order.order_id]
    );

    res.json({
      success: true,
      message: "Payment reminder sent to client"
    });
  } catch (err) {
    logger.error("Send payment reminder error:", err);
    res.status(500).json({
      success: false,
      message: "Error sending reminder"
    });
  }
};

module.exports = exports;
