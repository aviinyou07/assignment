const db = require('../config/db');

/* =====================================================
   BDE DASHBOARD - GET PROFILE
===================================================== */

exports.getDashboard = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [rows] = await db.query(
      `SELECT 
        user_id, full_name, email, mobile_number, whatsapp, 
        university, country, currency_code, role, is_verified, created_at
      FROM users
      WHERE user_id = ? AND role = 'bde' AND is_active = 1`,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).render("errors/404", {
        title: "Profile Not Found",
        layout: false
      });
    }

    const profile = rows[0];
    const initials = profile.full_name
      ? profile.full_name.split(" ").map(n => n[0]).join("").toUpperCase()
      : "BD";

    res.render("bde/index", {
      title: "BDE Dashboard",
      layout: "layouts/bde",
      currentPage: "dashboard",
      profile,
      initials
    });

  } catch (err) {
    console.error("Get BDE dashboard error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};

exports.getDashboardKPIs = async (req, res) => {
  try {
    const bdeId = req.user.user_id;
    const [newQueriesResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders o 
       JOIN users u ON o.user_id = u.user_id 
       WHERE u.bde = ? AND o.status = 26`,
      [bdeId]
    );

    // Pending Quotations (status 27)
    const [pendingQuotationsResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders o 
       JOIN users u ON o.user_id = u.user_id 
       WHERE u.bde = ? AND o.status = 27`,
      [bdeId]
    );

    // Confirmed Orders (status >= 29)
    const [confirmedOrdersResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders o 
       JOIN users u ON o.user_id = u.user_id 
       WHERE u.bde = ? AND o.status >= 29 AND o.status <= 40`,
      [bdeId]
    );

    // Revenue This Month
    const [revenueResult] = await db.query(
      `SELECT COALESCE(SUM(p.amount), 0) as total 
       FROM payments p 
       JOIN orders o ON p.order_id = o.order_id 
       JOIN users u ON o.user_id = u.user_id
       WHERE u.bde = ? AND p.status = 'confirmed'
       AND MONTH(p.created_at) = MONTH(CURDATE()) 
       AND YEAR(p.created_at) = YEAR(CURDATE())`,
      [bdeId]
    );

    // Pending Payments (status 28)
    const [pendingPaymentsResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders o 
       JOIN users u ON o.user_id = u.user_id 
       WHERE u.bde = ? AND o.status = 28`,
      [bdeId]
    );

    // Draft Quotations
    const [draftsResult] = await db.query(
      `SELECT COUNT(*) as count FROM quotations q
       JOIN orders o ON q.order_id = o.order_id
       JOIN users u ON o.user_id = u.user_id
       WHERE u.bde = ? AND q.status = 'draft'`,
      [bdeId]
    );

    // Sales Funnel
    const [funnelResult] = await db.query(
      `SELECT 
        SUM(CASE WHEN o.status = 26 THEN 1 ELSE 0 END) as queries,
        SUM(CASE WHEN o.status = 27 THEN 1 ELSE 0 END) as quotations,
        SUM(CASE WHEN o.status = 28 THEN 1 ELSE 0 END) as pending_payment,
        SUM(CASE WHEN o.status >= 29 AND o.status <= 40 THEN 1 ELSE 0 END) as confirmed
       FROM orders o 
       JOIN users u ON o.user_id = u.user_id 
       WHERE u.bde = ?`,
      [bdeId]
    );

    // Today's Orders
    const [todayOrdersResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders o 
       JOIN users u ON o.user_id = u.user_id 
       WHERE u.bde = ? AND DATE(o.created_at) = CURDATE()`,
      [bdeId]
    );

    // Conversion Rate
    const [totalQueriesResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders o 
       JOIN users u ON o.user_id = u.user_id 
       WHERE u.bde = ? AND o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [bdeId]
    );
    const [convertedResult] = await db.query(
      `SELECT COUNT(*) as count FROM orders o 
       JOIN users u ON o.user_id = u.user_id 
       WHERE u.bde = ? AND o.status >= 29 
       AND o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [bdeId]
    );
    const conversionRate = totalQueriesResult[0].count > 0
      ? Math.round((convertedResult[0].count / totalQueriesResult[0].count) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        newQueries: newQueriesResult[0].count,
        pendingQuotations: pendingQuotationsResult[0].count,
        confirmedOrders: confirmedOrdersResult[0].count,
        revenue: revenueResult[0].total,
        pendingPayments: pendingPaymentsResult[0].count,
        drafts: draftsResult[0].count,
        funnel: funnelResult[0],
        todayOrders: todayOrdersResult[0].count,
        conversionRate: conversionRate
      }
    });

  } catch (err) {
    console.error("Get BDE dashboard KPIs error:", err);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard KPIs' });
  }
};

/**
 * Get BDE Sidebar Counts
 */
exports.getSidebarCounts = async (req, res) => {
  try {
    const bdeId = req.user.user_id;

    // BDE sees orders from clients assigned to them (users.bde = bdeId)
    const [countsResult] = await db.query(
      `SELECT 
        SUM(CASE WHEN o.status = 26 THEN 1 ELSE 0 END) as queries,
        SUM(CASE WHEN o.status = 27 THEN 1 ELSE 0 END) as quotations,
        SUM(CASE WHEN o.status = 28 THEN 1 ELSE 0 END) as payments,
        SUM(CASE WHEN o.status >= 29 AND o.status <= 39 THEN 1 ELSE 0 END) as active
       FROM orders o 
       JOIN users u ON o.user_id = u.user_id 
       WHERE u.bde = ?`,
      [bdeId]
    );

    // Unread Notifications
    const [notificationsResult] = await db.query(
      `SELECT COUNT(*) as count FROM notifications 
       WHERE user_id = ? AND is_read = 0`,
      [bdeId]
    );

    res.json({
      success: true,
      data: {
        queries: countsResult[0].queries || 0,
        quotations: countsResult[0].quotations || 0,
        payments: countsResult[0].payments || 0,
        active: countsResult[0].active || 0,
        notifications: notificationsResult[0].count
      }
    });

  } catch (err) {
    console.error("Get BDE sidebar counts error:", err);
    res.status(500).json({ success: false, message: 'Failed to fetch sidebar counts' });
  }
};
