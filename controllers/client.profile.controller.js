const db = require('../config/db');
const { sendMail } = require('../utils/mailer');
const bcrypt = require('bcrypt');

exports.updatePassword = async (req, res) => {
  try {
    // =======================
    // INPUT
    // =======================
    const userId = req.user.user_id;
    const userEmail = req.user.email;
    const userName = req.user.full_name;
    const { old_password, new_password } = req.body;

    if (!old_password || !new_password) {
      return res.status(400).json({
        success: false,
        message: 'Old password and new password are required'
      });
    }

    // =======================
    // FETCH CURRENT PASSWORD
    // =======================
    const [rows] = await db.query(
      `SELECT password_hash FROM users WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const currentHash = rows[0].password_hash;

    // =======================
    // VERIFY OLD PASSWORD
    // =======================
    const isValid = await bcrypt.compare(old_password, currentHash);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid current password'
      });
    }

    // =======================
    // HASH & UPDATE PASSWORD
    // =======================
    const newHash = await bcrypt.hash(new_password, 10);

    await db.query(
      `UPDATE users SET password_hash = ? WHERE user_id = ?`,
      [newHash, userId]
    );

    // =======================
    // SEND SECURITY EMAIL
    // =======================
    const changeTime = new Date().toLocaleString();

    const emailHtml = `
      <p>Dear ${userName},</p>

      <p>This is to confirm that your account password was successfully changed on <strong>${changeTime}</strong>.</p>

      <p>If you made this change, no further action is required.</p>

      <p><strong>If you did NOT initiate this change</strong>, please contact the administration or support team immediately so we can secure your account.</p>

      <p>For your safety, we recommend:</p>
      <ul>
        <li>Contacting support immediately</li>
        <li>Avoiding login from unknown devices</li>
        <li>Resetting your password again once reviewed</li>
      </ul>

      <p>Regards,<br>
      <strong>A366 Security Team</strong></p>
    `;

    // Fire-and-forget (don’t block response)
    sendMail({
      to: userEmail,
      subject: 'Your Account Password Has Been Updated',
      html: emailHtml
    }).catch(err => {
      console.error('Password change email failed:', err);
    });

    // =======================
    // RESPONSE
    // =======================
    return res.json({
      success: true,
      message: 'Password updated successfully'
    });

  } catch (err) {
    console.error('updatePassword error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update password'
    });
  }
};

exports.updateProfile = async (req, res) => {
  console.log("🧠 BODY:", req.body);
console.log("🧠 BODY KEYS:", Object.keys(req.body));
console.log("🧠 CONTENT-TYPE:", req.headers["content-type"]);

  try {
    const userId = req.user.user_id;
    const role = req.user.role;

    // =======================
    // ROLE CHECK
    // =======================
    if (role !== 'client') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { full_name, whatsapp, university, mobile_number } = req.body;

    const fields = [];
    const values = [];

    if (full_name !== undefined) {
      fields.push('full_name = ?');
      values.push(full_name);
    }

    if (whatsapp !== undefined) {
      fields.push('whatsapp = ?');
      values.push(whatsapp);
    }

    if (university !== undefined) {
      fields.push('university = ?');
      values.push(university);
    }

    if (mobile_number !== undefined) {
      fields.push('mobile_number = ?');
      values.push(mobile_number);
    }

    if (!fields.length) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields provided for update'
      });
    }

    values.push(userId);

    await db.query(
      `
      UPDATE users
      SET ${fields.join(', ')}
      WHERE user_id = ?
      `,
      values
    );

    return res.json({
      success: true,
      message: 'Profile updated successfully'
    });

  } catch (err) {
    console.error('updateProfile error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const role = req.user.role;

    // =======================
    // ROLE CHECK
    // =======================
    if (role !== 'client') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const [rows] = await db.query(
      `
      SELECT
        u.user_id,
        u.full_name,
        u.email,
        u.mobile_number,
        u.whatsapp,
        u.university,
        u.is_active,
        u.country,
        u.referal_code,
        u.is_verified,
        u.created_at,
        w.balance AS wallet_balance
      FROM users u
      LEFT JOIN wallets w ON w.user_id = u.user_id
      WHERE u.user_id = ?
      LIMIT 1
      `,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = rows[0];

    return res.json({
      success: true,
      data: {
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.email,
        mobile_number: user.mobile_number,
        whatsapp: user.whatsapp,
        university: user.university,
        is_active: Boolean(user.is_active),
        is_verified: Boolean(user.is_verified),
        country: user.country,
        referral_code: user.referal_code,
        wallet_balance: Number(user.wallet_balance || 0),
        created_at: user.created_at
      }
    });

  } catch (err) {
    console.error('getProfile error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
    });
  }
};
