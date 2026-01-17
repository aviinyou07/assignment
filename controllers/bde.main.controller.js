const db = require("../config/db");
const ChatModel = require('../models/chat.model');
const { createNotificationWithRealtime } = require('./notifications.controller');
const logger = require("../utils/logger");
const { validateTransition, STATUS, STATUS_NAMES } = require('../utils/state-machine');
const { processWorkflowEvent } = require('../utils/workflow.service');

/* =====================================================
   BDE DASHBOARD - KPI METRICS & OVERVIEW
   
   KPI Cards:
   - New Queries (Today)
   - Pending Quotations
   - Confirmed Orders (Month)
   - Revenue (Month)
   - Pending Payments
   - Draft Approval Pending
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
      `SELECT COALESCE(SUM(o.total_price), 0) as total
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

    // Get recent chat messages (Unified)
    const [chats] = await db.query(
      `SELECT gc.chat_id, o.query_code FROM general_chats gc
       JOIN orders o ON gc.order_id = o.order_id
       WHERE o.user_id = ?
       ORDER BY gc.updated_at DESC
       LIMIT 5`,
      [clientId]
    );

    // Extract recent messages
    let messages = [];
    if (chats.length > 0) {
      const chatIds = chats.map(c => c.chat_id);
      const [recentMsgs] = await db.query(
        `SELECT m.content as message, m.created_at 
         FROM general_chat_messages m
         WHERE m.chat_id IN (?)
         ORDER BY m.created_at DESC LIMIT 5`,
        [chatIds]
      );
      messages = recentMsgs;
    }
    // chats loop below logic is no longer needed since messages are flat
    // but the original code had:
    /*
    chats.forEach(chat => { ... messages = messages.concat(...) })
    */
    // Since I replaced the definition of `chats` and `messages`, I should also remove the old loop which parsed JSON.
    // I need to replace the loop too.


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
      `SELECT q.*, o.basic_price, o.discount, o.total_price
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
        base_price: parseFloat(quotations[0].basic_price) || parseFloat(quotations[0].quoted_price) || 0,
        final_price: parseFloat(quotations[0].total_price) || parseFloat(quotations[0].quoted_price) || 0,
        discount: parseFloat(quotations[0].discount) || 0
      };
    }

    // Get chat messages (Unified)
    let messages = [];
    const [chat] = await db.query('SELECT chat_id FROM general_chats WHERE order_id = ?', [query.order_id]);
    if(chat.length > 0) {
        const rawMsgs = await ChatModel.getChatMessages(chat[0].chat_id, req.user.user_id);
        messages = rawMsgs.map(m => ({
            ...m,
            message: m.content
        }));
    }

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
    // Note: quotations table has: order_id, user_id, tax, discount, quoted_price, notes, created_at
    const [result] = await db.query(
      `INSERT INTO quotations (order_id, user_id, quoted_price, discount, notes, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [query.order_id, bdeId, finalPrice, discount, notes]
    );

    // Also update orders table with pricing
    await db.query(
      `UPDATE orders SET basic_price = ?, discount = ?, total_price = ? WHERE order_id = ?`,
      [basePrice, discount, finalPrice, query.order_id]
    );

    // Update order status to "Quotation Sent" (27)
    await db.query(
      `UPDATE orders SET status = 27 WHERE order_id = ?`,
      [query.order_id]
    );

    // Send notification to client
    await createNotificationWithRealtime(req.io, {
      user_id: query.user_id,
      type: 'quotation-generated',
      title: 'Quotation Ready',
      message: `Quotation for your query "${query.paper_topic}" is ready!`,
      link_url: `/client/orders/${queryCode}`,
      context_code: queryCode,
      triggered_by: { user_id: bdeId, role: 'bde' }
    });

    // Notify all admins
    const [admins] = await db.query(`SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1`);
    for (const admin of admins) {
      await createNotificationWithRealtime(req.io, {
        user_id: admin.user_id,
        type: 'quotation-generated',
        title: 'New Quotation Generated',
        message: `BDE generated quotation for query ${queryCode}`,
        link_url: `/admin/queries`,
        context_code: queryCode,
        triggered_by: { user_id: bdeId, role: 'bde' }
      });
    }

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
        o.total_price,
        o.deadline_at,
        u.full_name,
        u.email,
        u.currency_code,
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
    const chatTitle = `Order Chat - ${queryCode || workCode}`;
    const chatId = await ChatModel.createOrderChat(orderId, bdeId, chatTitle);
    
    // Ensure participants
    const [[orderMeta]] = await db.query(`SELECT user_id FROM orders WHERE order_id = ?`, [orderId]);
    if (orderMeta && orderMeta.user_id) await ChatModel.addParticipant(chatId, orderMeta.user_id, 'client');
    await ChatModel.addParticipant(chatId, bdeId, 'bde');

    // Fetch messages from normalized table
    const messagesRows = await ChatModel.getChatMessages(chatId, bdeId);
    
    // Mark as read
    await ChatModel.markAsRead(chatId, bdeId);

    res.json({
      success: true,
      messages: messagesRows,
      chat_id: chatId
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
    const chatTitle = `Order Chat - ${queryCode}`;
    const chatId = await ChatModel.createOrderChat(order.order_id, bdeId, chatTitle);

    // Ensure participants (client + bde)
    if (order.user_id) await ChatModel.addParticipant(chatId, order.user_id, 'client');
    await ChatModel.addParticipant(chatId, bdeId, 'bde');

    // Insert message in normalized table
    const messageId = await ChatModel.sendMessage(chatId, bdeId, message.trim(), 'text', null);

    const [[savedMsg]] = await db.query(
      `SELECT m.*, u.full_name as sender_name, p.role as sender_role 
       FROM general_chat_messages m
       LEFT JOIN users u ON u.user_id = m.sender_id
       LEFT JOIN general_chat_participants p ON p.chat_id = m.chat_id AND p.user_id = m.sender_id
       WHERE m.message_id = ?`, 
       [messageId]
    );

    const newMessage = {
      ...savedMsg,
      message: savedMsg.content,
      is_mine: true,
      is_read: true
    };

    const emittedMessage = { ...newMessage, is_mine: false, is_read: false };

    // Emit real-time chat message via Socket.IO
    if (req.io) {
      req.io.to(`context:${queryCode}`).emit('chat:new_message', {
        chat_id: chatId,
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
        o.total_price,
        COALESCE(SUM(p.amount), 0) as paid_amount,
        u.full_name,
        u.email,
        u.whatsapp,
        u.currency_code,
        o.created_at
      FROM orders o
      JOIN users u ON o.user_id = u.user_id
      LEFT JOIN payments p ON o.order_id = p.order_id
      WHERE u.bde = ? AND o.status >= 3
      GROUP BY o.order_id
      HAVING COALESCE(SUM(p.amount), 0) < o.total_price
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?`,
      [bdeId, limit, offset]
    );

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM (
        SELECT o.order_id, o.total_price, COALESCE(SUM(p.amount), 0) as paid_amount
        FROM orders o
        JOIN users u ON o.user_id = u.user_id
        LEFT JOIN payments p ON o.order_id = p.order_id
        WHERE u.bde = ? AND o.status >= 3
        GROUP BY o.order_id
        HAVING paid_amount < o.total_price
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
    await createNotificationWithRealtime(req.io, {
      user_id: order.user_id,
      type: 'payment-reminder',
      title: 'Payment Reminder',
      message: `Payment reminder for query ${queryCode}. Please complete your payment of ${order.currency_code} ${order.total_price}`,
      link_url: `/client/orders/${queryCode}`,
      context_code: queryCode,
      triggered_by: { user_id: bdeId, role: 'bde' }
    });

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

/* =====================================================
   BDE CUSTOM NOTIFICATION - SEND TO CLIENT/ADMIN
   Per spec: "Send Notification" opens modal with severity/message/context
===================================================== */

/**
 * Send custom notification to user (client or admin)
 * BDE can select severity, write message, and attach context
 */
exports.sendCustomNotification = async (req, res) => {
  try {
    const bdeId = req.user.user_id;
    const { target_user_id, target_role, severity, title, message, context_code, context_type } = req.body;

    // Validation
    if (!message || message.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: "Message must be at least 5 characters"
      });
    }

    if (!severity || !['info', 'success', 'warning', 'critical'].includes(severity)) {
      return res.status(400).json({
        success: false,
        message: "Invalid severity. Must be: info, success, warning, critical"
      });
    }

    // BDE can only notify clients they own, or admins
    let targetUserId = target_user_id;
    let linkUrl = null;

    if (target_role === 'client' && target_user_id) {
      // Verify BDE owns this client
      const [[client]] = await db.query(
        `SELECT user_id FROM users WHERE user_id = ? AND bde = ?`,
        [target_user_id, bdeId]
      );
      
      if (!client) {
        return res.status(403).json({
          success: false,
          message: "You can only send notifications to your assigned clients"
        });
      }
      linkUrl = context_code ? `/client/orders/${context_code}` : '/client/orders';
    } else if (target_role === 'admin') {
      // Send to all admins
      const [admins] = await db.query(
        `SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1`
      );
      
      for (const admin of admins) {
        await createNotificationWithRealtime(req.io, {
          user_id: admin.user_id,
          type: severity,
          title: title || `Message from BDE`,
          message: message.trim(),
          link_url: context_code ? `/admin/queries?search=${context_code}` : '/admin/queries',
          context_code,
          triggered_by: { user_id: bdeId, role: 'bde' }
        });
      }
      
      // Log action
      await db.query(
        `INSERT INTO audit_logs (user_id, event_type, action, details, created_at)
         VALUES (?, 'BDE_NOTIFICATION_SENT', 'send_notification', ?, NOW())`,
        [bdeId, `BDE sent ${severity} notification to admins: ${message.substring(0, 100)}`]
      );
      
      return res.json({
        success: true,
        message: "Notification sent to all admins"
      });
    } else if (!targetUserId) {
      return res.status(400).json({
        success: false,
        message: "Target user or role is required"
      });
    }

    // Send notification to specific client
    await createNotificationWithRealtime(req.io, {
      user_id: targetUserId,
      type: severity,
      title: title || `Message from your representative`,
      message: message.trim(),
      link_url: linkUrl,
      context_code,
      triggered_by: { user_id: bdeId, role: 'bde' }
    });

    // Log action
    await db.query(
      `INSERT INTO audit_logs (user_id, event_type, action, resource_type, resource_id, details, created_at)
       VALUES (?, 'BDE_NOTIFICATION_SENT', 'send_notification', 'user', ?, ?, NOW())`,
      [bdeId, targetUserId, `BDE sent ${severity} notification: ${message.substring(0, 100)}`]
    );

    res.json({
      success: true,
      message: "Notification sent successfully"
    });
  } catch (err) {
    logger.error("Send custom notification error:", err);
    res.status(500).json({
      success: false,
      message: "Error sending notification"
    });
  }
};

module.exports = exports;
