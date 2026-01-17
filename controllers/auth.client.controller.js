const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { sendMail } = require("../utils/mailer");
const { sendOTPWhatsApp } = require("../utils/twilio");

const JWT_SECRET = process.env.JWT_SECRET;

// =======================
// 1. REGISTRATION - SEND OTP (EMAIL)
// =======================

const getOtpEmailTemplate = (otp) => {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>OTP Verification</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        background-color: #f4f6f8;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      }
      .container {
        max-width: 600px;
        margin: 40px auto;
        background: #ffffff;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 10px 30px rgba(0,0,0,0.08);
      }
      .header {
        background: linear-gradient(135deg, #1e3c72, #2a5298);
        padding: 24px;
        text-align: center;
        color: #ffffff;
      }
      .header h1 {
        margin: 0;
        font-size: 22px;
        letter-spacing: 0.5px;
      }
      .content {
        padding: 32px;
        color: #333333;
      }
      .content p {
        font-size: 15px;
        line-height: 1.6;
        margin: 0 0 16px;
      }
      .otp-box {
        margin: 24px 0;
        text-align: center;
      }
      .otp {
        display: inline-block;
        padding: 16px 28px;
        font-size: 28px;
        letter-spacing: 6px;
        font-weight: bold;
        color: #1e3c72;
        background: #f0f4ff;
        border-radius: 10px;
      }
      .note {
        font-size: 13px;
        color: #666;
        margin-top: 24px;
      }
      .footer {
        padding: 20px;
        text-align: center;
        font-size: 12px;
        color: #888;
        background: #fafafa;
      }
      @media (max-width: 480px) {
        .content {
          padding: 24px;
        }
        .otp {
          font-size: 24px;
          padding: 14px 22px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Assignment 366</h1>
      </div>
      <div class="content">
        <p>Hello 👋</p>

        <p>
          Use the One-Time Password (OTP) below to verify your email address and
          complete your account creation.
        </p>

        <div class="otp-box">
          <div class="otp">${otp}</div>
        </div>

        <p>
          This OTP is valid for <strong>10 minutes</strong>.
          Please do not share it with anyone.
        </p>

        <p class="note">
          If you did not request this verification, you can safely ignore this email.
        </p>
      </div>
      <div class="footer">
        © ${new Date().getFullYear()} Assignment 366 · All rights reserved
      </div>
    </div>
  </body>
  </html>
  `;
};

exports.sendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Invalidate old unused OTPs for this email + purpose
    await db.query(
      `UPDATE user_otps 
       SET is_used = 1 
       WHERE email = ? AND purpose = 'registration' AND is_used = 0`,
      [email]
    );

    // Insert fresh OTP
    await db.query(
      `INSERT INTO user_otps 
        (email, mobile_number, otp, purpose, expires_at, is_used, created_at)
       VALUES (?, NULL, ?, 'registration', ?, 0, NOW())`,
      [email, otp, expiresAt]
    );

    // Send email
    await sendMail({
      to: email,
      subject: "Your OTP for Assignment 366 Account Verification",
      html: getOtpEmailTemplate(otp)
    });

    res.json({
      success: true,
      message: "OTP sent to email"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Failed to send OTP"
    });
  }
};



// =======================
// 2. REGISTRATION - VERIFY & CREATE
// =======================

const getWelcomeEmailTemplate = ({ full_name, email, password }) => {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <style>
      body {
        background-color: #f4f6f8;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial;
        margin: 0;
        padding: 0;
      }
      .container {
        max-width: 600px;
        margin: 40px auto;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.08);
        overflow: hidden;
      }
      .header {
        background: linear-gradient(135deg, #1e3c72, #2a5298);
        color: #fff;
        padding: 28px;
        text-align: center;
      }
      .content {
        padding: 32px;
        color: #333;
      }
      .credentials {
        background: #f0f4ff;
        border-radius: 10px;
        padding: 16px;
        margin: 24px 0;
        font-size: 15px;
      }
      .credentials p {
        margin: 6px 0;
      }
      .footer {
        text-align: center;
        padding: 20px;
        font-size: 12px;
        color: #888;
        background: #fafafa;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Welcome to Assignment 366 🎉</h1>
      </div>

      <div class="content">
        <p>Hello <strong>${full_name}</strong>,</p>

        <p>
          Your account has been successfully created. You can now log in using
          the credentials below:
        </p>

        <div class="credentials">
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Password:</strong> ${password}</p>
        </div>

        <p>
          For security reasons, we strongly recommend changing your password
          after your first login.
        </p>

        <p>
          If you did not request this account, please contact our support team
          immediately.
        </p>

        <p>
          We’re excited to have you with us 🚀
        </p>

        <p>Warm regards,<br/>Assignment 366 Team</p>
      </div>

      <div class="footer">
        © ${new Date().getFullYear()} Assignment 366 · All rights reserved
      </div>
    </div>
  </body>
  </html>
  `;
};

const generatePassword = (length = 10) => {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#";
  let password = "";

  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return password;
};


exports.verifyOtpAndCreate = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const {
      full_name,
      mobile_number,
      email,
      otp,
      referal_code,
      university,
      country
    } = req.body;

    if (!full_name || !mobile_number || !email || !otp || !country) {
      return res.status(400).json({
        success: false,
        message: "Required fields missing"
      });
    }

    /* ---------------------------------
       Verify OTP
    ----------------------------------*/
    const [otpRows] = await connection.query(
      `SELECT id, otp, expires_at
       FROM user_otps
       WHERE email = ?
         AND purpose = 'registration'
         AND is_used = 0
       ORDER BY id DESC
       LIMIT 1`,
      [email]
    );

    if (
      !otpRows.length ||
      otpRows[0].otp !== otp ||
      new Date(otpRows[0].expires_at) < new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP"
      });
    }

    await connection.query(
      "UPDATE user_otps SET is_used = 1 WHERE id = ?",
      [otpRows[0].id]
    );

    /* ---------------------------------
       Country
    ----------------------------------*/
    const [countryRows] = await connection.query(
      `SELECT currency_code
       FROM countries
       WHERE name = ?
       LIMIT 1`,
      [country]
    );

    if (!countryRows.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid country"
      });
    }

    const { currency_code } = countryRows[0];

    await connection.beginTransaction();

    /* ---------------------------------
       Referral Handling
    ----------------------------------*/
    const userReferralCode =
      "A3" + Math.random().toString(36).substring(2, 8).toUpperCase();

    let referralBonus = 0;
    let bdeId = null;
    let referralId = null;

    if (referal_code) {
      const [refRows] = await connection.query(
        `SELECT id, bonus_amount, bde_id, max_uses, used_count, expires_at
         FROM referral_codes
         WHERE code = ?
           AND is_active = 1
           AND (expires_at IS NULL OR expires_at >= NOW())
           AND (max_uses IS NULL OR used_count < max_uses)
         LIMIT 1`,
        [referal_code]
      );

      if (refRows.length) {
        referralBonus = Number(refRows[0].bonus_amount);
        referralId = refRows[0].id;

        const [[bdeUser]] = await connection.query(
          `SELECT user_id
           FROM users
           WHERE user_id = ?
             AND role = 'bde'
             AND is_active = 1`,
          [refRows[0].bde_id]
        );

        if (bdeUser) {
          bdeId = bdeUser.user_id;
        }
      }
    }

    // Generate & hash password
const plainPassword = generatePassword(10);
const passwordHash = await bcrypt.hash(plainPassword, 10);


    /* ---------------------------------
       Create User
    ----------------------------------*/
  const [userResult] = await connection.query(
  `INSERT INTO users (
    full_name,
    email,
    mobile_number,
    whatsapp,
    university,
    currency_code,
    role,
    referal_code,
    bde,
    password_hash,
    is_active,
    is_verified,
    country,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'client', ?, ?, ?, 1, 1, ?, NOW())`,
  [
    full_name,
    email,
    mobile_number,
    mobile_number,
    university || null,
    currency_code,
    userReferralCode,
    bdeId,
    passwordHash,
    country
  ]
);


    const userId = userResult.insertId;

    /* ---------------------------------
       Wallet
    ----------------------------------*/
    await connection.query(
      `INSERT INTO wallets (user_id, balance)
       VALUES (?, ?)`,
      [userId, referralBonus]
    );

    /* ---------------------------------
       Update Referral Usage
    ----------------------------------*/
    if (referralId) {
      await connection.query(
        `UPDATE referral_codes
         SET used_count = used_count + 1
         WHERE id = ?`,
        [referralId]
      );
    }

    /* ---------------------------------
       Cleanup OTP
    ----------------------------------*/
    await connection.query(
      `DELETE FROM user_otps WHERE email = ?`,
      [email]
    );

    await connection.commit();

    await sendMail({
  to: email,
  subject: "Welcome to Assignment 366 – Your Account Details",
  html: getWelcomeEmailTemplate({
    full_name,
    email,
    password: plainPassword
  })
});


    /* ---------------------------------
       JWT
    ----------------------------------*/
    const token = jwt.sign(
      { user_id: userId, role: "client" },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.json({
      success: true,
      message: "Account created successfully",
      token,
      user: {
        user_id: userId,
        full_name,
        email,
        mobile_number,
        university,
        country,
        currency_code
      }
    });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Account creation failed"
    });
  } finally {
    if (connection) connection.release();
  }
};



// =======================
// 3. LOGIN - SEND OTP
// =======================
exports.requestLoginOtp = async (req, res) => {
  try {
    const { whatsapp } = req.body;
    const [users] = await db.query("SELECT user_id, is_active FROM users WHERE (mobile_number = ? OR whatsapp = ?) AND role = \"client\"", [whatsapp, whatsapp]);
    if (!users.length) return res.status(404).json({ success: false, message: "Account not found" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.query("DELETE FROM user_otps WHERE email = ?", [whatsapp]);
    await db.query("INSERT INTO user_otps (email, otp, expires_at) VALUES (?, ?, ?)", [whatsapp, otp, expiresAt]);
    try { await sendOTPWhatsApp(whatsapp, otp); } catch (err) { console.warn("OTP send error", err); }
    res.json({ success: true, message: "OTP sent" });
  } catch (err) { res.status(500).json({ success: false }); }
};

// =======================
// 4. LOGIN - VERIFY OTP
// =======================
exports.verifyLoginOtp = async (req, res) => {
  try {
    const { whatsapp, otp } = req.body;
    const [otpRows] = await db.query("SELECT otp, expires_at FROM user_otps WHERE email = ? ORDER BY id DESC LIMIT 1", [whatsapp]);
    if (!otpRows.length || otpRows[0].otp !== otp || new Date(otpRows[0].expires_at) < new Date()) return res.status(400).json({ success: false, message: "Invalid OTP" });

    const [users] = await db.query("SELECT * FROM users WHERE (mobile_number = ? OR whatsapp = ?) AND role = \"client\" AND is_active = 1", [whatsapp, whatsapp]);
    if (!users.length) return res.status(401).json({ success: false });

    const user = users[0];
    await db.query("DELETE FROM user_otps WHERE email = ?", [whatsapp]);
    const token = jwt.sign({ user_id: user.user_id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ success: true, token, user: { user_id: user.user_id, full_name: user.full_name, role: user.role } });
  } catch (err) { res.status(500).json({ success: false }); }
};

exports.loginClient = async (req, res) => {
  try {
    let { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    email = String(email || "").trim().toLowerCase();

    const [[user]] = await db.query(
      `SELECT 
         user_id,
         full_name,
         email,
         password_hash,
         role,
         is_active,
         is_verified
       FROM users
       WHERE email = ?
         AND role = 'client'
       LIMIT 1`,
      [email]
    );

    if (!user) {
      await bcrypt.compare(password, "$2b$10$invalidsaltinvalidsaltinv");
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "Your account is deactivated"
      });
    }

    if (!user.is_verified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email before logging in"
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const token = jwt.sign(
      { user_id: user.user_id, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        is_verified: user.is_verified
      }
    });

  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({
      success: false,
      message: "Login failed"
    });
  }
};

