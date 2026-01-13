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
