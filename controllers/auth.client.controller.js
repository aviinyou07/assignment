const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { sendMail } = require('../utils/mailer');

const JWT_SECRET = process.env.JWT_SECRET;

// =======================
// SEND OTP
// =======================
exports.sendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email required'
      });
    }

    // Clear old OTPs (important)
    await db.query('DELETE FROM user_otps WHERE email = ?', [email]);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await db.query(
      'INSERT INTO user_otps (email, otp, expires_at) VALUES (?, ?, ?)',
      [email, otp, expiresAt]
    );

    await sendMail({
      to: email,
      subject: 'Your OTP for A366 Account',
      html: `
        <h2>Email Verification</h2>
        <p>Your OTP is:</p>
        <h1>${otp}</h1>
        <p>This OTP expires in 10 minutes.</p>
      `
    });

    res.json({
      success: true,
      message: 'OTP sent to email'
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: 'OTP send failed'
    });
  }
};

// =======================
// VERIFY OTP & CREATE CLIENT
// =======================

exports.verifyOtpAndCreate = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { full_name, email, mobile_number, otp, referal_code } = req.body;

    // =======================
    // BASIC VALIDATION
    // =======================
    if (!email || !mobile_number || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email, mobile number and OTP are required'
      });
    }

    // =======================
    // OTP VERIFICATION
    // =======================
    const [otpRows] = await db.query(
      'SELECT otp, expires_at FROM user_otps WHERE email = ? ORDER BY id DESC LIMIT 1',
      [email]
    );

    if (
      !otpRows.length ||
      otpRows[0].otp !== otp ||
      new Date(otpRows[0].expires_at) < new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // =======================
    // DUPLICATE USER CHECK
    // =======================
    const [existingUser] = await db.query(
      'SELECT user_id FROM users WHERE email = ? OR mobile_number = ?',
      [email, mobile_number]
    );

    if (existingUser.length) {
      return res.status(409).json({
        success: false,
        message: 'User already exists'
      });
    }

    // =======================
    // REFERRAL CODE VALIDATION
    // =======================
    let referralBonus = 0;
    let referralCodeId = null;

    if (referal_code) {
      const [rows] = await db.query(
        `
        SELECT id, bonus_amount
        FROM referral_codes
        WHERE code = ?
          AND is_active = 1
          AND (expires_at IS NULL OR expires_at > NOW())
          AND (max_uses IS NULL OR used_count < max_uses)
        LIMIT 1
        `,
        [referal_code]
      );

      if (rows.length) {
        referralCodeId = rows[0].id;
        referralBonus = Number(rows[0].bonus_amount);
      }
    }

    // =======================
    // PASSWORD GENERATION
    // =======================
    const plainPassword = Math.floor(
      10000000 + Math.random() * 90000000
    ).toString();

    const password_hash = await bcrypt.hash(plainPassword, 10);

    // =======================
    // GENERATE USER REFERRAL CODE
    // =======================
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

    // =======================
    // TRANSACTION START
    // =======================
    await connection.beginTransaction();

    // =======================
    // CREATE USER
    // =======================
    const [userResult] = await connection.query(
      `
      INSERT INTO users (
        full_name,
        email,
        mobile_number,
        password_hash,
        role,
        referal_code,
        is_active,
        created_at
      )
      VALUES (?, ?, ?, ?, 'client', ?, 1, NOW())
      `,
      [
        full_name || '',
        email,
        mobile_number,
        password_hash,
        userReferralCode
      ]
    );

    const userId = userResult.insertId;

    // =======================
    // CREATE WALLET
    // =======================
    await connection.query(
      `
      INSERT INTO wallets (user_id, balance)
      VALUES (?, 0.00)
      `,
      [userId]
    );

    // =======================
    // APPLY REFERRAL BONUS
    // =======================
    if (referralBonus > 0 && referralCodeId) {
      const [updateResult] = await connection.query(
        `
        UPDATE referral_codes
        SET used_count = used_count + 1
        WHERE id = ?
          AND (max_uses IS NULL OR used_count < max_uses)
        `,
        [referralCodeId]
      );

      if (updateResult.affectedRows === 1) {
        await connection.query(
          `
          INSERT INTO wallet_transactions (
            user_id,
            amount,
            type,
            reason,
            created_at
          )
          VALUES (?, ?, 'credit', 'referral_bonus', NOW())
          `,
          [userId, referralBonus]
        );

        await connection.query(
          `
          UPDATE wallets
          SET balance = balance + ?
          WHERE user_id = ?
          `,
          [referralBonus, userId]
        );
      }
    }

    // =======================
    // DELETE OTP
    // =======================
    await connection.query(
      'DELETE FROM user_otps WHERE email = ?',
      [email]
    );

    await connection.commit();

    // =======================
    // SEND EMAIL (PREMIUM)
    // =======================
    await sendMail({
      to: email,
      subject: 'Welcome to A366 — Your Account Is Ready',
      html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; background:#f4f6f8; padding:40px;">
        <div style="max-width:600px; margin:auto; background:#ffffff; border-radius:12px; overflow:hidden;">
          
          <div style="background:#0f172a; padding:24px; color:#ffffff;">
            <h2 style="margin:0;">Welcome to A366</h2>
            <p style="margin:4px 0 0; opacity:0.85;">Your account has been successfully created</p>
          </div>

          <div style="padding:32px; color:#1f2937;">
            <p>Hello <strong>${full_name || 'there'}</strong>,</p>

            <p>
              We’re excited to have you onboard. Your A366 account is now active and ready to use.
            </p>

            <div style="background:#f9fafb; padding:20px; border-radius:10px; margin:24px 0;">
              <h4 style="margin-top:0;">Login Details</h4>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Password:</strong> ${plainPassword}</p>
            </div>

            <div style="background:#eef2ff; padding:16px; border-radius:10px;">
              <p style="margin:0;"><strong>Your Referral Code:</strong> ${userReferralCode}</p>
              ${
                referralBonus
                  ? `<p style="margin-top:8px;">🎁 <strong>₹${referralBonus}</strong> credited to your wallet as a referral bonus.</p>`
                  : ''
              }
            </div>

            <p style="margin-top:24px;">
              For security reasons, we recommend changing your password after logging in.
            </p>

            <p style="margin-top:32px;">
              — Team A366
            </p>
          </div>

          <div style="background:#f9fafb; text-align:center; padding:16px; font-size:12px; color:#6b7280;">
            © ${new Date().getFullYear()} A366. All rights reserved.
          </div>

        </div>
      </div>
      `
    });

    return res.status(201).json({
      success: true,
      message: 'Account created successfully'
    });

  } catch (err) {
    await connection.rollback();
    console.error('verifyOtpAndCreate error:', err);
    return res.status(500).json({
      success: false,
      message: 'Registration failed'
    });
  } finally {
    connection.release();
  }
};




// =======================
// LOGIN CLIENT
// =======================
exports.loginClient = async (req, res) => {
  try {
    const { email, password } = req.body;

    const [users] = await db.query(
      'SELECT * FROM users WHERE email = ? AND role = "client" AND is_active = 1',
      [email]
    );

    if (!users.length) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const user = users[0];

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const token = jwt.sign(
      {
        user_id: user.user_id,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.email,
        role: user.role
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
};
