const db = require("../config/db");
const { createNotificationWithRealtime } = require('./notifications.controller');
const logger = require("../utils/logger");
const { validateTransition, STATUS } = require('../utils/state-machine');

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
       WHERE u.bde = ? AND o.status = 26 AND DATE(o.created_at) = ?`,
      [bdeId, today.toISOString().split("T")[0]]
    );

    // KPI 2: Pending Quotations
    const [pendingQuotations] = await db.query(
      `SELECT COUNT(DISTINCT o.order_id) as count
       FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE u.bde = ? AND o.status = 27`,
      [bdeId]
    );

    // KPI 3: Confirmed Orders (This Month)
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const [confirmedOrders] = await db.query(
      `SELECT COUNT(*) as count
       FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE u.bde = ? AND o.status >= 30 
       AND DATE(o.created_at) BETWEEN ? AND ?`,
      [bdeId, monthStart.toISOString().split("T")[0], monthEnd.toISOString().split("T")[0]]
    );

    // KPI 4: Total Revenue (This Month)
    const [totalRevenue] = await db.query(
      `SELECT COALESCE(SUM(o.total_price_usd), 0) as total
       FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE u.bde = ? AND o.status >= 30
       AND DATE(o.created_at) BETWEEN ? AND ?`,
      [bdeId, monthStart.toISOString().split("T")[0], monthEnd.toISOString().split("T")[0]]
    );

    // KPI 5: Pending Payments
    const [pendingPayments] = await db.query(
      `SELECT COUNT(DISTINCT o.order_id) as count
       FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE u.bde = ? AND o.status IN (28, 29)`,
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
        SUM(CASE WHEN o.status >= 30 THEN 1 ELSE 0 END) as confirmed_orders
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

    // Get recent chat messages from order_chats (messages are stored as JSON)
    const [chats] = await db.query(
      `SELECT oc.*, o.query_code FROM order_chats oc
       JOIN orders o ON oc.order_id = o.order_id
       WHERE o.user_id = ?
       ORDER BY oc.updated_at DESC
       LIMIT 5`,
      [clientId]
    );

    // Extract recent messages from JSON
    let messages = [];
    chats.forEach(chat => {
      try {
        const chatMsgs = typeof chat.messages === 'string' ? JSON.parse(chat.messages) : chat.messages;
        if (Array.isArray(chatMsgs)) {
          messages = messages.concat(chatMsgs.slice(-5));
        }
      } catch (e) {}
    });

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

    // Get quotation if exists and compute display values
    const [quotations] = await db.query(
      `SELECT q.*, o.basic_price_usd, o.discount_usd, o.total_price_usd
       FROM quotations q
       JOIN orders o ON q.order_id = o.order_id
       WHERE q.order_id = ?`,
      [query.order_id]
    );

    // Transform quotation for view compatibility
    let quotation = null;
    if (quotations[0]) {
      quotation = {
        ...quotations[0],
        base_price: parseFloat(quotations[0].basic_price_usd) || parseFloat(quotations[0].quoted_price_usd) || 0,
        final_price: parseFloat(quotations[0].total_price_usd) || parseFloat(quotations[0].quoted_price_usd) || 0,
        discount: parseFloat(quotations[0].discount) || parseFloat(quotations[0].discount_usd) || 0
      };
    }

    // Get chat messages
    const [messages] = await db.query(
      `SELECT * FROM order_chats WHERE order_id = ? ORDER BY created_at DESC`,
      [query.order_id]
    );

    res.render("bde/queries/detail", {
      title: "Query Details",
      layout: "layouts/bde",
      currentPage: "queries",
      query,
      quotation,
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
    // Note: quotations table has: order_id, user_id, tax, discount, quoted_price_usd, notes, created_at
    const [result] = await db.query(
      `INSERT INTO quotations (order_id, user_id, quoted_price_usd, discount, notes, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [query.order_id, bdeId, finalPrice, discount, notes]
    );

    // Also update orders table with pricing
    await db.query(
      `UPDATE orders SET basic_price_usd = ?, discount_usd = ?, total_price_usd = ? WHERE order_id = ?`,
      [basePrice, discount, finalPrice, query.order_id]
    );

    // Update order status to "Quotation Sent" (27)
    await db.query(
      `UPDATE orders SET status = 27 WHERE order_id = ?`,
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
        finalPrice,
        link_url: `/client/orders/${queryCode}`
      },
      req.io
    );

    // Notify admin
    await sendNotification(
      null,
      `BDE generated quotation for query ${queryCode}`,
      `quotation-generated`,
      {
        role: "admin",
        queryCode,
        link_url: `/admin/queries`
      },
      req.io
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
      `UPDATE orders SET status = ? WHERE query_code = ?`,
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

    // Fetch/create chat metadata
    let [[chat]] = await db.query(
      `SELECT * FROM order_chats WHERE order_id = ? LIMIT 1`,
      [orderId]
    );

    if (!chat) {
      const [result] = await db.query(
        `INSERT INTO order_chats (order_id, chat_name, status, created_at, updated_at)
         VALUES (?, 'Order Chat', 'active', NOW(), NOW())`,
        [orderId]
      );
      [[chat]] = await db.query(`SELECT * FROM order_chats WHERE chat_id = ? LIMIT 1`, [result.insertId]);
    }

    // Ensure participants (client + bde)
    const [[orderMeta]] = await db.query(`SELECT user_id FROM orders WHERE order_id = ?`, [orderId]);
    const participantValues = [
      orderMeta?.user_id ? `(${chat.chat_id}, ${orderMeta.user_id}, 'client', 0, NOW())` : null,
      `(${chat.chat_id}, ${bdeId}, 'bde', 0, NOW())`
    ].filter(Boolean).join(',');
    if (participantValues) {
      await db.query(
        `INSERT IGNORE INTO order_chat_participants (chat_id, user_id, role, is_muted, joined_at) VALUES ${participantValues}`
      );
    }

    // Fetch messages from normalized table
    const [messagesRows] = await db.query(
      `SELECT m.*, CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END as is_read
       FROM order_chat_messages m
       LEFT JOIN order_chat_message_reads r ON m.message_id = r.message_id AND r.user_id = ?
       WHERE m.chat_id = ?
       ORDER BY m.created_at ASC`,
      [bdeId, chat.chat_id]
    );

    const unread = messagesRows.filter(m => m.is_read === 0 && m.sender_id !== bdeId).map(m => m.message_id);
    if (unread.length) {
      const values = unread.map(id => `(${id}, ${bdeId}, NOW())`).join(',');
      await db.query(`INSERT IGNORE INTO order_chat_message_reads (message_id, user_id, read_at) VALUES ${values}`);
    }

    res.json({
      success: true,
      messages: messagesRows,
      chat_id: chat?.chat_id
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

    // Get or create chat metadata
    let [[chat]] = await db.query(
      `SELECT * FROM order_chats WHERE order_id = ? LIMIT 1`,
      [order.order_id]
    );

    if (!chat) {
      const [result] = await db.query(
        `INSERT INTO order_chats (order_id, context_code, chat_name, status, created_at, updated_at)
         VALUES (?, ?, 'Order Chat', 'active', NOW(), NOW())`,
        [order.order_id, queryCode]
      );
      [[chat]] = await db.query(`SELECT * FROM order_chats WHERE chat_id = ? LIMIT 1`, [result.insertId]);
    }

    // Ensure participants (client + bde)
    const participantValues = [
      `(${chat.chat_id}, ${order.user_id}, 'client', 0, NOW())`,
      `(${chat.chat_id}, ${bdeId}, 'bde', 0, NOW())`
    ].join(',');
    await db.query(
      `INSERT IGNORE INTO order_chat_participants (chat_id, user_id, role, is_muted, joined_at) VALUES ${participantValues}`
    );

    // Insert message in normalized table
    const [insertRes] = await db.query(
      `INSERT INTO order_chat_messages (chat_id, order_id, sender_id, sender_role, message_type, content, attachments, is_edited, is_deleted, created_at)
       VALUES (?, ?, ?, 'bde', 'text', ?, NULL, 0, 0, NOW())`,
      [chat.chat_id, order.order_id, bdeId, message.trim()]
    );

    const messageId = insertRes.insertId;
    const [[savedMsg]] = await db.query(`SELECT * FROM order_chat_messages WHERE message_id = ? LIMIT 1`, [messageId]);

    const [[senderUser]] = await db.query(`SELECT full_name FROM users WHERE user_id = ?`, [bdeId]);
    const senderName = senderUser?.full_name || 'BDE';

    const newMessage = {
      ...savedMsg,
      sender_name: senderName,
      message: savedMsg.content,
      is_mine: true,
      is_read: true
    };

    const emittedMessage = { ...newMessage, is_mine: false, is_read: false };

    // Mark sender read
    await db.query(
      `INSERT IGNORE INTO order_chat_message_reads (message_id, user_id, read_at) VALUES (?, ?, NOW())`,
      [messageId, bdeId]
    );

    // Emit real-time chat message via Socket.IO
    if (req.io) {
      req.io.to(`context:${queryCode}`).emit('chat:new_message', {
        chat_id: chat.chat_id,
        context_code: queryCode,
        message: emittedMessage
      });
    }

    // Notifications (admin + client)
    if (req.io) {
      const buildLink = (targetRole) => {
        if (targetRole === 'admin') return `/admin/queries/${order.order_id}/view`;
        if (targetRole === 'bde') return `/bde/queries/${queryCode}`;
        return `/client/orders/${queryCode}`;
      };

      // Client
      await createNotificationWithRealtime(req.io, {
        user_id: order.user_id,
        type: 'chat',
        title: `New chat from ${senderName}`,
        message: savedMsg.content || 'New message',
        link_url: buildLink('client'),
        context_code: queryCode,
        triggered_by: { user_id: bdeId, role: 'bde' }
      });

      // Admins
      const [admins] = await db.query(`SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1`);
      for (const admin of admins) {
        await createNotificationWithRealtime(req.io, {
          user_id: admin.user_id,
          type: 'chat',
          title: `New chat message in ${queryCode}`,
          message: savedMsg.content || 'New message',
          link_url: buildLink('admin'),
          context_code: queryCode,
          triggered_by: { user_id: bdeId, role: 'bde' }
        });
      }
    }

    res.json({
      success: true,
      message: "Message sent",
      messageId,
      data: newMessage
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
        amount: order.total_price_usd,
        link_url: `/client/orders/${queryCode}`
      },
      req.io
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
