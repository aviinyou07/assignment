const bcrypt = require('bcrypt');
const db = require('../config/db');
const { sendMail } = require('../utils/mailer');
const { generateOtp, getExpiryTime } = require('../utils/otp');

/* =====================================================
   UPDATE PROFILE
===================================================== */

// Render Edit Profile Page
exports.getEditProfile = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const [rows] = await db.query(
      `SELECT user_id, full_name, email, mobile_number, whatsapp, university, country, currency_code, role, is_verified, created_at
       FROM users
       WHERE user_id = ? AND role = 'writer' AND is_active = 1`,
      [userId]
    );
    if (!rows.length) {
      return res.status(404).render("errors/404", {
        title: "Profile Not Found",
        layout: false
      });
    }
    const profile = rows[0];
    res.render("writer/edit-profile", {
      title: "Edit Profile",
      layout: "layouts/writer",
      profile
    });
  } catch (err) {
    console.error("Edit profile error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};

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

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { full_name, mobile_number, whatsapp, university, country, currency_code } = req.body;

    // Validation
    if (!full_name || !mobile_number) {
      return res.status(400).json({
        success: false,
        message: 'Name and mobile number are required'
      });
    }

    const [result] = await db.query(
      `UPDATE users 
       SET full_name = ?, mobile_number = ?, whatsapp = ?, 
           university = ?, country = ?, currency_code = ?
       WHERE user_id = ? AND role = 'writer'`,
      [full_name, mobile_number, whatsapp, university, country, currency_code, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Writer profile not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });

  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

/* =====================================================
   PASSWORD CHANGE - REQUEST OTP
===================================================== */

exports.requestPasswordOtp = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [userRows] = await db.query(
      'SELECT email FROM users WHERE user_id = ? AND role = "writer"',
      [userId]
    );

    if (!userRows.length) {
      return res.status(404).json({
        success: false,
        message: 'Writer not found'
      });
    }

    const user = userRows[0];
    const otp = generateOtp();
    const expiresAt = getExpiryTime();

    // Invalidate previous OTPs
    await db.query(
      `UPDATE user_otps
       SET is_used = 1
       WHERE email = ? AND purpose = 'update_password'`,
      [user.email]
    );

    // Insert new OTP
    await db.query(
      `INSERT INTO user_otps (email, otp, purpose, expires_at)
       VALUES (?, ?, 'update_password', ?)`,
      [user.email, otp, expiresAt]
    );

    // Send email
    await sendMail({
      to: user.email,
      subject: 'A366 — Password Change OTP',
      html: `
        <h2>Password Change Request</h2>
        <p>You requested to change your password.</p>
        <p>Your OTP is:</p>
        <h1 style="color: #4f46e5; font-size: 2.5rem; letter-spacing: 0.2em;">${otp}</h1>
        <p>Valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes.</p>
        <p style="color: #999; font-size: 0.9rem;">If you didn't request this, ignore this email.</p>
      `
    });

    res.json({
      success: true,
      message: 'OTP sent to your registered email'
    });

  } catch (err) {
    console.error('requestPasswordOtp error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP'
    });
  }
};

/* =====================================================
   PASSWORD CHANGE - VERIFY OTP & UPDATE PASSWORD
===================================================== */

exports.verifyPasswordOtp = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { otp, new_password, confirm_password } = req.body;
    const userId = req.user.user_id;

    // Validation
    if (!otp || !new_password || !confirm_password) {
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'OTP and password are required'
      });
    }

    if (new_password !== confirm_password) {
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match'
      });
    }

    if (new_password.length < 8) {
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    await connection.beginTransaction();

    // Get user email
    const [userRows] = await connection.query(
      'SELECT email FROM users WHERE user_id = ? AND role = "writer"',
      [userId]
    );

    if (!userRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'Writer not found'
      });
    }

    const user = userRows[0];

    // Verify OTP
    const [otpRows] = await connection.query(
      `SELECT id FROM user_otps
       WHERE email = ? AND otp = ? AND purpose = 'update_password'
       AND is_used = 0 AND expires_at > NOW()
       LIMIT 1`,
      [user.email, otp]
    );

    if (!otpRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(new_password, 10);

    // Update password
    await connection.query(
      'UPDATE users SET password_hash = ? WHERE user_id = ?',
      [passwordHash, userId]
    );

    // Mark OTP as used
    await connection.query(
      'UPDATE user_otps SET is_used = 1 WHERE id = ?',
      [otpRows[0].id]
    );

    await connection.commit();
    connection.release();

    // Send confirmation email
    await sendMail({
      to: user.email,
      subject: 'A366 — Password Changed Successfully',
      html: `
        <h2>Password Changed</h2>
        <p>Your password has been changed successfully.</p>
        <p>If this wasn't you, please reset your password immediately.</p>
        <p style="color: #999; font-size: 0.9rem; margin-top: 2rem;">
          A366 Security Team<br>
          This is an automated message, please do not reply.
        </p>
      `
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('verifyPasswordOtp error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
};
