const bcrypt = require('bcrypt');
const { sendMail } = require('../utils/mailer');
const db = require('../config/db');

/* =====================================================
   ADMIN DASHBOARD - GET PROFILE
===================================================== */

exports.getDashboard = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [rows] = await db.query(
      `SELECT 
        user_id, full_name, email, mobile_number, whatsapp, 
        university, country, currency_code, role, is_verified, created_at
      FROM users
      WHERE user_id = ? AND role = 'admin' AND is_active = 1`,
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
      : "AD";

    res.render("admin/index", {
      title: "Admin Dashboard",
      layout: "layouts/admin",
      currentPage: "dashboard",
      profile,
      initials
    });

  } catch (err) {
    console.error("Get Admin dashboard error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};

/* =====================================================
   USERS MANAGEMENT - LIST ALL USERS
===================================================== */

exports.listUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    
    // Build filters
    let whereClause = '1=1';
    let params = [];
    
    if (req.query.role && req.query.role !== 'all') {
      whereClause += ' AND role = ?';
      params.push(req.query.role);
    }
    
    if (req.query.is_active && req.query.is_active !== 'all') {
      whereClause += ' AND is_active = ?';
      params.push(req.query.is_active === 'active' ? 1 : 0);
    }
    
    if (req.query.is_verified && req.query.is_verified !== 'all') {
      whereClause += ' AND is_verified = ?';
      params.push(req.query.is_verified === 'verified' ? 1 : 0);
    }
    
    if (req.query.search) {
      whereClause += ' AND (full_name LIKE ? OR email LIKE ? OR mobile_number LIKE ?)';
      const searchTerm = `%${req.query.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM users WHERE ${whereClause}`;
    const [[countResult]] = await db.query(countQuery, params);
    const total = countResult.total;
    const pages = Math.ceil(total / limit);

    // Get users
    const query = `
      SELECT 
        user_id, full_name, email, mobile_number, role, 
        is_active, is_verified, created_at, university
      FROM users
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const [users] = await db.query(query, [...params, limit, offset]);

    res.render("admin/users/index", {
      title: "Manage Users",
      layout: "layouts/admin",
      currentPage: "users",
      users,
      page,
      pages,
      total,
      filters: {
        role: req.query.role || 'all',
        is_active: req.query.is_active || 'all',
        is_verified: req.query.is_verified || 'all',
        search: req.query.search || ''
      }
    });

  } catch (err) {
    console.error("List users error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};

/* =====================================================
   USERS MANAGEMENT - VIEW USER DETAILS
===================================================== */

exports.viewUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user profile
    const [userRows] = await db.query(
      `SELECT 
        user_id, full_name, email, mobile_number, whatsapp, 
        university, country, currency_code, role, is_verified, 
        is_active, created_at, referal_code, bde
      FROM users
      WHERE user_id = ?`,
      [userId]
    );

    if (!userRows.length) {
      return res.status(404).render("errors/404", {
        title: "User Not Found",
        layout: false
      });
    }

    const user = userRows[0];

    // Get wallet info
    const [walletRows] = await db.query(
      `SELECT wallet_id, balance, created_at FROM wallets WHERE user_id = ?`,
      [userId]
    );
    const wallet = walletRows.length ? walletRows[0] : null;

    // Get recent orders
    const [orders] = await db.query(
      `SELECT 
        order_id, query_code, order_code, paper_topic, service, 
        subject, urgency, status, total_price_usd, created_at, 
        deadline_at, writer_id, words_used, pages_used
      FROM orders
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 5`,
      [userId]
    );

    const initials = user.full_name
      ? user.full_name.split(" ").map(n => n[0]).join("").toUpperCase()
      : "US";

    res.render("admin/users/view", {
      title: "User Details",
      layout: "layouts/admin",
      currentPage: "users",
      user,
      wallet,
      orders,
      initials
    });

  } catch (err) {
    console.error("View user error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};

/* =====================================================
   USERS MANAGEMENT - EDIT USER
===================================================== */

exports.editUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const [userRows] = await db.query(
      `SELECT 
        user_id, full_name, email, mobile_number, whatsapp, 
        university, country, currency_code, role, is_verified, 
        is_active, created_at, referal_code, bde
      FROM users
      WHERE user_id = ?`,
      [userId]
    );

    if (!userRows.length) {
      return res.status(404).render("errors/404", {
        title: "User Not Found",
        layout: false
      });
    }

    const user = userRows[0];
    const initials = user.full_name
      ? user.full_name.split(" ").map(n => n[0]).join("").toUpperCase()
      : "US";

    res.render("admin/users/edit", {
      title: "Edit User",
      layout: "layouts/admin",
      currentPage: "users",
      user,
      initials
    });

  } catch (err) {
    console.error("Edit user error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};

/* =====================================================
   USERS MANAGEMENT - UPDATE USER
===================================================== */

exports.updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { full_name, email, mobile_number, whatsapp, university, 
            country, currency_code, role, is_active, is_verified } = req.body;

    // Validation
    if (!full_name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required'
      });
    }

    const [result] = await db.query(
      `UPDATE users 
       SET full_name = ?, email = ?, mobile_number = ?, whatsapp = ?, 
           university = ?, country = ?, currency_code = ?, role = ?,
           is_active = ?, is_verified = ?
       WHERE user_id = ?`,
      [full_name, email, mobile_number, whatsapp, university, country, 
       currency_code, role, is_active ? 1 : 0, is_verified ? 1 : 0, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User updated successfully'
    });

  } catch (err) {
    console.error("Update user error:", err);
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
};

/* =====================================================
   USERS MANAGEMENT - GET CREATE FORM
===================================================== */

exports.getCreateForm = async (req, res) => {
  try {
    res.render("admin/users/create", {
      title: "Create User",
      layout: "layouts/admin",
      currentPage: "users"
    });

  } catch (err) {
    console.error("Get create form error:", err);
    res.status(500).render("errors/500", {
      title: "Server Error",
      layout: false
    });
  }
};

/* =====================================================
   USERS MANAGEMENT - CREATE USER
===================================================== */

exports.createUser = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { full_name, email, mobile_number, whatsapp, university, country, 
            currency_code, role, is_active, is_verified, bde, referal_code } = req.body;

    // Validation
    if (!full_name || !email || !mobile_number || !role) {
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Full name, email, mobile number, and role are required'
      });
    }

    // Check if email already exists
    const [existingUser] = await db.query(
      'SELECT user_id FROM users WHERE email = ?',
      [email]
    );

    if (existingUser.length) {
      connection.release();
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Generate random password
    const plainPassword = Math.floor(10000000 + Math.random() * 90000000).toString();
    const password_hash = await bcrypt.hash(plainPassword, 10);

    // Generate unique referral code
    const generateReferralCode = () =>
      'A366' + Math.random().toString(36).substring(2, 8).toUpperCase();

    let userReferralCode;
    let isUnique = false;

    while (!isUnique) {
      userReferralCode = generateReferralCode();
      const [exists] = await db.query(
        'SELECT user_id FROM users WHERE referal_code = ?',
        [userReferralCode]
      );
      if (!exists.length) isUnique = true;
    }

    await connection.beginTransaction();

    // Create user
    const [userResult] = await connection.query(
      `INSERT INTO users (
        full_name, email, mobile_number, whatsapp, university, 
        country, currency_code, password_hash, role, 
        is_active, is_verified, bde, referal_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [full_name, email, mobile_number, whatsapp || null, university || null,
       country || null, currency_code || null, password_hash, role,
       is_active ? 1 : 1, is_verified ? 1 : 0, bde || null, userReferralCode]
    );

    const userId = userResult.insertId;

    // Create wallet for new user
    await connection.query(
      'INSERT INTO wallets (user_id, balance, created_at) VALUES (?, 0.00, NOW())',
      [userId]
    );

    await connection.commit();
    connection.release();

    // Send welcome email with credentials
    await sendMail({
      to: email,
      subject: 'Welcome to A366 — Your Account Has Been Created',
      html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; background:#f4f6f8; padding:40px;">
        <div style="max-width:600px; margin:auto; background:#ffffff; border-radius:12px; overflow:hidden;">
          
          <div style="background:linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); padding:24px; color:#ffffff;">
            <h2 style="margin:0;">Welcome to A366</h2>
            <p style="margin:4px 0 0; opacity:0.85;">Your account has been successfully created by Administrator</p>
          </div>

          <div style="padding:32px; color:#1f2937;">
            <p>Hello <strong>${full_name}</strong>,</p>

            <p>
              Your A366 account has been created and is now active. As a <strong>${role.toUpperCase()}</strong>, you have access to the platform.
            </p>

            <div style="background:#f9fafb; padding:20px; border-radius:10px; margin:24px 0; border-left: 4px solid #0f172a;">
              <h4 style="margin-top:0; color:#0f172a;">Login Credentials</h4>
              <p style="margin:8px 0;"><strong>Email:</strong> <code style="background:#e5e7eb; padding:2px 6px; border-radius:4px;">${email}</code></p>
              <p style="margin:8px 0;"><strong>Password:</strong> <code style="background:#e5e7eb; padding:2px 6px; border-radius:4px;">${plainPassword}</code></p>
              <p style="margin:8px 0;"><strong>Role:</strong> <code style="background:#e5e7eb; padding:2px 6px; border-radius:4px;">${role.charAt(0).toUpperCase() + role.slice(1)}</code></p>
            </div>

            <div style="background:#eef2ff; padding:16px; border-radius:10px; border-left: 4px solid #4f46e5;">
              <p style="margin:0;"><strong>Your Referral Code:</strong> <code style="background:#e0e7ff; padding:2px 6px; border-radius:4px;">${userReferralCode}</code></p>
            </div>

            <div style="background:#fef3c7; padding:16px; border-radius:10px; margin-top:24px; border-left: 4px solid #f59e0b;">
              <p style="margin:0;"><strong>⚠️ Important:</strong> Please change your password immediately after your first login for security.</p>
            </div>

            <p style="margin-top:32px; color:#6b7280;">
              If you have any questions or need assistance, please contact the support team.
            </p>

            <p style="margin-top:32px; margin-bottom:0;">
              Best regards,<br>
              <strong>Team A366</strong>
            </p>
          </div>

          <div style="background:#f9fafb; text-align:center; padding:16px; font-size:12px; color:#6b7280; border-top:1px solid #e5e7eb;">
            © ${new Date().getFullYear()} A366 Platform. All rights reserved.
          </div>

        </div>
      </div>
      `
    });

    res.json({
      success: true,
      message: 'User created successfully',
      userId
    });

  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error("Create user error:", err);
    res.status(500).json({
      success: false,
      message: 'Failed to create user'
    });
  }
};

/* =====================================================
   ADMIN USERS - DELETE USER
===================================================== */

exports.deleteUser = async (req, res) => {
  const userId = req.params.userId;

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: 'User ID is required'
    });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // Check if user exists and get email
    const [userRows] = await connection.query(
      'SELECT user_id, email FROM users WHERE user_id = ?',
      [userId]
    );

    if (!userRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const userEmail = userRows[0].email;

    // Delete wallet transactions first (references wallets)
    await connection.query('DELETE FROM wallet_transactions WHERE user_id = ?', [userId]);

    // Delete wallet (cascade)
    await connection.query('DELETE FROM wallets WHERE user_id = ?', [userId]);

    // Delete OTPs (by email since user_otps doesn't have user_id)
    await connection.query('DELETE FROM user_otps WHERE email = ?', [userEmail]);

    // Delete orders (if any)
    await connection.query('DELETE FROM orders WHERE user_id = ?', [userId]);

    // Delete user (final)
    await connection.query('DELETE FROM users WHERE user_id = ?', [userId]);

    await connection.commit();
    connection.release();

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (err) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error("Delete user error:", err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
};

