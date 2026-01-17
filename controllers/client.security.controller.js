const bcrypt = require('bcrypt');
const db = require('../config/db');
const { sendMail } = require('../utils/mailer');
const twilioClient = require('../utils/twilio');
const { generateOtp, getExpiryTime } = require('../utils/otp');

/* =====================================================
   EMAIL UPDATE (OTP TO OLD EMAIL)
===================================================== */

exports.requestEmailOtp = async (req, res) => {
  try {
    const { new_email } = req.body;
    const userId = req.user.user_id;

    if (!new_email) {
      return res.status(400).json({ success: false, message: 'New email required' });
    }

    // Check new email not already used
    const [exists] = await db.query(
      'SELECT user_id FROM users WHERE email = ?',
      [new_email]
    );
    if (exists.length) {
      return res.status(409).json({ success: false, message: 'Email already in use' });
    }

    // Get OLD email
    const [[user]] = await db.query(
      'SELECT email FROM users WHERE user_id = ?',
      [userId]
    );

    const otp = generateOtp();
    const expiresAt = getExpiryTime();

    // Invalidate previous OTPs
    await db.query(
      `
      UPDATE user_otps
      SET is_used = 1
      WHERE email = ? AND purpose = 'update_email'
      `,
      [user.email]
    );

    await db.query(
      `
      INSERT INTO user_otps (email, otp, purpose, expires_at)
      VALUES (?, ?, 'update_email', ?)
      `,
      [user.email, otp, expiresAt]
    );

    await sendMail({
      to: user.email, // OLD EMAIL
      subject: 'A366 — Verify Email Change',
      html: `
        <h2>Email Change Request</h2>
        <p>You requested to change your email to:</p>
        <p><strong>${new_email}</strong></p>
        <h1>${otp}</h1>
        <p>Valid for ${process.env.OTP_EXPIRY_MINUTES} minutes.</p>
      `
    });

    res.json({ success: true, message: 'OTP sent to your current email' });

  } catch (err) {
    console.error('requestEmailOtp error:', err);
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
};

exports.verifyEmailOtp = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { new_email, otp } = req.body;
    const userId = req.user.user_id;

    await connection.beginTransaction();

    const [[user]] = await connection.query(
      'SELECT email FROM users WHERE user_id = ?',
      [userId]
    );

    const oldEmail = user.email;

    const [rows] = await connection.query(
      `
      SELECT id
      FROM user_otps
      WHERE email = ?
        AND otp = ?
        AND purpose = 'update_email'
        AND is_used = 0
        AND expires_at > NOW()
      LIMIT 1
      `,
      [oldEmail, otp]
    );

    if (!rows.length) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    await connection.query(
      'UPDATE users SET email = ? WHERE user_id = ?',
      [new_email, userId]
    );

    await connection.query(
      'UPDATE user_otps SET is_used = 1 WHERE id = ?',
      [rows[0].id]
    );

    await connection.commit();

    // Confirmation emails
    await sendMail({
      to: new_email,
      subject: 'A366 — Email Updated Successfully',
      html: `<p>Your email has been updated successfully.</p>`
    });

    await sendMail({
      to: oldEmail,
      subject: 'A366 — Security Alert: Email Changed',
      html: `<p>Your account email was changed. If this wasn’t you, contact support immediately.</p>`
    });

    res.json({ success: true, message: 'Email updated successfully' });

  } catch (err) {
    await connection.rollback();
    console.error('verifyEmailOtp error:', err);
    res.status(500).json({ success: false, message: 'Email update failed' });
  } finally {
    connection.release();
  }
};

/* =====================================================
   MOBILE UPDATE (OTP TO OLD MOBILE)
===================================================== */

exports.requestMobileOtp = async (req, res) => {
  try {
    const { new_mobile } = req.body;
    const userId = req.user.user_id;

    if (!new_mobile) {
      return res.status(400).json({ success: false, message: 'New mobile required' });
    }

    const [exists] = await db.query(
      'SELECT user_id FROM users WHERE mobile_number = ?',
      [new_mobile]
    );
    if (exists.length) {
      return res.status(409).json({ success: false, message: 'Mobile already in use' });
    }

    const [[user]] = await db.query(
      'SELECT mobile_number, email FROM users WHERE user_id = ?',
      [userId]
    );

    const otp = generateOtp();
    const expiresAt = getExpiryTime();

    await db.query(
      `
      UPDATE user_otps
      SET is_used = 1
      WHERE mobile_number = ? AND purpose = 'update_mobile'
      `,
      [user.mobile_number]
    );

    await db.query(
      `
      INSERT INTO user_otps (mobile_number, otp, purpose, expires_at)
      VALUES (?, ?, 'update_mobile', ?)
      `,
      [user.mobile_number, otp, expiresAt]
    );

    await twilioClient.messages.create({
      body: `A366 OTP: ${otp} (valid ${process.env.OTP_EXPIRY_MINUTES} min)`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: user.mobile_number.startsWith('+')
        ? user.mobile_number
        : `+91${user.mobile_number}`
    });

    res.json({ success: true, message: 'OTP sent to your current mobile number' });

  } catch (err) {
    console.error('requestMobileOtp error:', err);
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
};

exports.verifyMobileOtp = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { new_mobile, otp } = req.body;
    const userId = req.user.user_id;

    await connection.beginTransaction();

    const [[user]] = await connection.query(
      'SELECT mobile_number, email FROM users WHERE user_id = ?',
      [userId]
    );

    const [rows] = await connection.query(
      `
      SELECT id
      FROM user_otps
      WHERE mobile_number = ?
        AND otp = ?
        AND purpose = 'update_mobile'
        AND is_used = 0
        AND expires_at > NOW()
      LIMIT 1
      `,
      [user.mobile_number, otp]
    );

    if (!rows.length) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    await connection.query(
      'UPDATE users SET mobile_number = ? WHERE user_id = ?',
      [new_mobile, userId]
    );

    await connection.query(
      'UPDATE user_otps SET is_used = 1 WHERE id = ?',
      [rows[0].id]
    );

    await connection.commit();

    await sendMail({
      to: user.email,
      subject: 'A366 — Mobile Number Updated',
      html: `<p>Your mobile number was updated successfully.</p>`
    });

    res.json({ success: true, message: 'Mobile number updated successfully' });

  } catch (err) {
    await connection.rollback();
    console.error('verifyMobileOtp error:', err);
    res.status(500).json({ success: false, message: 'Mobile update failed' });
  } finally {
    connection.release();
  }
};

/* =====================================================
   PASSWORD UPDATE (OTP TO EMAIL)
===================================================== */

exports.requestPasswordOtp = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [[user]] = await db.query(
      'SELECT email FROM users WHERE user_id = ?',
      [userId]
    );

    const otp = generateOtp();
    const expiresAt = getExpiryTime();

    await db.query(
      `
      UPDATE user_otps
      SET is_used = 1
      WHERE email = ? AND purpose = 'update_password'
      `,
      [user.email]
    );

    await db.query(
      `
      INSERT INTO user_otps (email, otp, purpose, expires_at)
      VALUES (?, ?, 'update_password', ?)
      `,
      [user.email, otp, expiresAt]
    );

    await sendMail({
      to: user.email,
      subject: 'A366 — Password Change OTP',
      html: `
        <p>Your OTP to change password:</p>
        <h1>${otp}</h1>
        <p>Valid for ${process.env.OTP_EXPIRY_MINUTES} minutes.</p>
      `
    });

    res.json({ success: true, message: 'OTP sent to registered email' });

  } catch (err) {
    console.error('requestPasswordOtp error:', err);
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
};

exports.verifyPasswordOtp = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { otp, new_password } = req.body;
    const userId = req.user.user_id;

    if (!new_password || new_password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    await connection.beginTransaction();

    const [[user]] = await connection.query(
      'SELECT email FROM users WHERE user_id = ?',
      [userId]
    );

    const [rows] = await connection.query(
      `
      SELECT id
      FROM user_otps
      WHERE email = ?
        AND otp = ?
        AND purpose = 'update_password'
        AND is_used = 0
        AND expires_at > NOW()
      LIMIT 1
      `,
      [user.email, otp]
    );

    if (!rows.length) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    const hash = await bcrypt.hash(new_password, 10);

    await connection.query(
      'UPDATE users SET password_hash = ? WHERE user_id = ?',
      [hash, userId]
    );

    await connection.query(
      'UPDATE user_otps SET is_used = 1 WHERE id = ?',
      [rows[0].id]
    );

    await connection.commit();

    await sendMail({
      to: user.email,
      subject: 'A366 — Password Changed',
      html: `
        <p>Your password was changed successfully.</p>
        <p>If this wasn’t you, reset immediately.</p>
      `
    });

    res.json({ success: true, message: 'Password updated successfully' });

  } catch (err) {
    await connection.rollback();
    console.error('verifyPasswordOtp error:', err);
    res.status(500).json({ success: false, message: 'Password update failed' });
  } finally {
    connection.release();
  }
};


exports.deleteUserAccount = async (req, res) => {
  const userId = req.user.user_id;

  let connection;

  try {
    connection = await db.getConnection();

    // =======================
    // FETCH USER DETAILS FIRST
    // =======================
    const [[user]] = await connection.query(
      'SELECT email, full_name FROM users WHERE user_id = ? LIMIT 1',
      [userId]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // =======================
    // TRANSACTION
    // =======================
    await connection.beginTransaction();

    await connection.query(
      'DELETE FROM wallets WHERE user_id = ?',
      [userId]
    );

    const [deleteResult] = await connection.query(
      'DELETE FROM users WHERE user_id = ?',
      [userId]
    );

    if (deleteResult.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await connection.commit();

    // =======================
    // SEND CONFIRMATION EMAIL
    // =======================
    await sendMail({
      to: user.email,
      subject: 'A366 — Account Deleted Successfully',
      html: `
        <h2>Account Deletion Confirmation</h2>

        <p>Hello ${user.full_name || 'User'},</p>

        <p>
          This email confirms that your <strong>A366</strong> account has been
          permanently deleted as per your request.
        </p>

        <p>
          All personal data associated with your account has been removed from
          our systems in accordance with our data retention and privacy policies.
        </p>

        <p>
          <strong>If you did not initiate this action</strong>, please contact
          our support team immediately.
        </p>

        <p>
          Thank you for being a part of A366. We’re sorry to see you go — and
          you’re always welcome back.
        </p>

        <p style="margin-top:24px;">
          Regards,<br/>
          <strong>A366 Security Team</strong>
        </p>
      `
    });

    return res.json({
      success: true,
      message: 'Account permanently deleted'
    });

  } catch (err) {
    if (connection) await connection.rollback();

    console.error('deleteUserAccount error:', err);
    return res.status(500).json({
      success: false,
      message: 'Account deletion failed'
    });

  } finally {
    if (connection) connection.release();
  }
};


