const db = require("../config/db");

exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [rows] = await db.query(
      `
      SELECT 
        user_id,
        full_name,
        email,
        mobile_number,
        whatsapp,
        university,
        country,
        currency_code,
        role,
        is_verified,
        created_at
      FROM users
      WHERE user_id = ?
        AND role = 'writer'
        AND is_active = 1
      `,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).render("errors/404", {
        title: "Profile Not Found",
        layout: false
      });
    }

    const profile = rows[0];

    // Generate initials for avatar (JD from John Doe)
    const initials = profile.full_name
      ? profile.full_name
          .split(" ")
          .map(n => n[0])
          .join("")
          .toUpperCase()
      : "WR";

    res.render("writer/index", {
      title: "My Profile",
      layout: "layouts/writer",
      profile: rows[0],
      initials,
      currentPage: 'profile'
    });

  } catch (err) {
    console.error("Writer profile error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};
