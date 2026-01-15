const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { sendMail } = require("../utils/mailer");
const { sendOTPWhatsApp } = require("../utils/twilio");

const JWT_SECRET = process.env.JWT_SECRET;

// =======================
// 1. REGISTRATION - SEND OTP
// =======================
exports.sendOtp = async (req, res) => {
  try {
    const { whatsapp } = req.body;
    if (!whatsapp) return res.status(400).json({ success: false, message: "WhatsApp number is required" });

    const [existing] = await db.query("SELECT user_id FROM users WHERE mobile_number = ? OR whatsapp = ?", [whatsapp, whatsapp]);
    if (existing.length) return res.status(409).json({ success: false, message: "Mobile number already registered." });

    await db.query("DELETE FROM user_otps WHERE email = ?", [whatsapp]);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.query("INSERT INTO user_otps (email, otp, expires_at) VALUES (?, ?, ?)", [whatsapp, otp, expiresAt]);

    try { await sendOTPWhatsApp(whatsapp, otp); } catch (err) { console.warn("WhatsApp failed:", err.message); }
    res.json({ success: true, message: "OTP sent" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// =======================
// 2. REGISTRATION - VERIFY & CREATE
// =======================
exports.verifyOtpAndCreate = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { full_name, whatsapp, email, otp, referal_code } = req.body;
    if (!full_name || !whatsapp || !otp) return res.status(400).json({ success: false, message: "Required fields missing" });

    const [otpRows] = await db.query("SELECT otp, expires_at FROM user_otps WHERE email = ? ORDER BY id DESC LIMIT 1", [whatsapp]);
    if (!otpRows.length || otpRows[0].otp !== otp || new Date(otpRows[0].expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: "Invalid/Expired OTP" });
    }

    await connection.beginTransaction();
    const userReferralCode = "A3" + Math.random().toString(36).substring(2, 8).toUpperCase();
    let referralBonus = 0, bdeId = null;

    if (referal_code) {
      const [refRows] = await connection.query("SELECT id, bonus_amount, user_id as bde_id FROM referral_codes WHERE code = ? AND is_active = 1 LIMIT 1", [referal_code]);
      if (refRows.length) {
        referralBonus = Number(refRows[0].bonus_amount);
        const [[bdeUser]] = await connection.query("SELECT user_id FROM users WHERE user_id = ? AND role = \"bde\"", [refRows[0].bde_id]);
        if (bdeUser) bdeId = bdeUser.user_id;
      }
    }

    const [userResult] = await connection.query(
      `INSERT INTO users (full_name, email, mobile_number, whatsapp, role, referal_code, is_active, is_verified, bde, created_at) VALUES (?, ?, ?, ?, "client", ?, 1, 1, ?, NOW())`,
      [full_name, email || null, whatsapp, whatsapp, userReferralCode, bdeId]
    );
    const userId = userResult.insertId;
    await connection.query("INSERT INTO wallets (user_id, balance) VALUES (?, ?)", [userId, referralBonus]);
    await connection.query("DELETE FROM user_otps WHERE email = ?", [whatsapp]);
    await connection.commit();

    const token = jwt.sign({ user_id: userId, role: "client" }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ success: true, message: "Account created", token, user: { user_id: userId, full_name, whatsapp } });
  } catch (err) {
    if (connection) await connection.rollback();
    res.status(500).json({ success: false, message: "Creation failed" });
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

exports.loginClient = (req, res) => { res.status(400).json({ success: false, message: "Please use OTP login" }); };
