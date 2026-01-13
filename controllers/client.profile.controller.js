const db = require('../config/db');

exports.updateProfile = async (req, res) => {
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

    const { full_name, whatsapp, university, country } = req.body;

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

    if (country !== undefined) {
      fields.push('country = ?');
      values.push(country);
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
