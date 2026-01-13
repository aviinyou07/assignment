const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

exports.login = async (req, res) => {
  const { email, password, role } = req.body;

  try {
    const [users] = await db.query(
      `SELECT user_id, email, role, password_hash 
       FROM users 
       WHERE email = ? AND role = ? AND is_active = 1`,
      [email, role]
    );

    if (!users.length) {
      return res.status(401).render("auth/login", {
        title: "Login | Assignment366",
        layout: false,
        error: "Invalid credentials"
      });
    }

    const user = users[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).render("auth/login", {
        title: "Login | Assignment366",
        layout: false,
        error: "Invalid credentials"
      });
    }

    const token = jwt.sign(
      {
        user_id: user.user_id,
        role: user.role,
        email: user.email
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES || "1h"
      }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 1000 // 1 hour
    });

    // Role-based redirect
    switch (user.role) {
      case "admin":
        return res.redirect("/admin");
      case "bde":
        return res.redirect("/bde");
      case "writer":
        return res.redirect("/writer");
      default:
        return res.redirect("/login");
    }

  } catch (err) {
    console.error(err);
    res.status(500).render("auth/login", {
      title: "Login | Assignment366",
      layout: false,
      error: "Server error. Please try again."
    });
  }
};

exports.logout = (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
  });
  res.redirect("/login");
};
