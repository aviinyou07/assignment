/**
 * CLIENT API CONTROLLER
 * Complete backend implementation for Client role
 * 
 * Client can:
 * - Create queries with file upload
 * - View quotations
 * - Accept quotations
 * - Upload payment receipts
 * - Track order status
 * - Submit feedback and revisions
 * - Use chat (with BDE only)
 * 
 * Client CANNOT:
 * - Edit queries after creation
 * - Assign writers
 * - Change status
 * - Verify payments
 * - See writer identity
 * - See internal notes/pricing details
 */

const db = require('../config/db');
const jwt = require('jsonwebtoken');
const { createAuditLog, createOrderHistory, generateUniqueCode, getUserIfVerified } = require('../utils/audit');
const { createNotification, sendEventNotification, getUnreadNotifications, markAsRead } = require('../utils/notification.service');
const { createNotificationWithRealtime } = require('./notifications.controller');
const { STATUS, STATUS_NAMES, executeAction, isPostPayment, getOrderPhase } = require('../utils/order-state-machine');
const { sendOTPWhatsApp } = require('../utils/twilio');

// =======================
// AUTH: REQUEST OTP
// =======================
exports.requestOtp = async (req, res) => {
  try {
    const { mobile_number } = req.body;

    if (!mobile_number) {
      return res.status(400).json({
        success: false,
        code: 'MOBILE_REQUIRED',
        message: 'Mobile number is required'
      });
    }

    // Check if user exists
    const [[user]] = await db.query(
      `SELECT user_id, full_name, whatsapp, is_active FROM users 
       WHERE mobile_number = ? OR whatsapp = ?
       LIMIT 1`,
      [mobile_number, mobile_number]
    );

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Clear old OTPs
    await db.query('DELETE FROM user_otps WHERE email = ?', [mobile_number]);

    // Store OTP
    await db.query(
      'INSERT INTO user_otps (email, otp, expires_at) VALUES (?, ?, ?)',
      [mobile_number, otp, expiresAt]
    );

    // Send OTP via WhatsApp
    try {
      await sendOTPWhatsApp(mobile_number, otp);
    } catch (whatsappError) {
      console.error('WhatsApp OTP error:', whatsappError);
      // Continue - OTP is stored for testing
    }

    res.json({
      success: true,
      message: 'OTP sent to your WhatsApp',
      data: {
        is_new_user: !user,
        expires_in: 600 // seconds
      }
    });

  } catch (err) {
    console.error('Request OTP error:', err);
    res.status(500).json({
      success: false,
      code: 'OTP_SEND_FAILED',
      message: 'Failed to send OTP'
    });
  }
};

// =======================
// AUTH: VERIFY OTP
// =======================
exports.verifyOtp = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { mobile_number, otp, full_name } = req.body;

    if (!mobile_number || !otp) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_PARAMS',
        message: 'Mobile number and OTP are required'
      });
    }

    // Verify OTP
    const [[otpRecord]] = await db.query(
      'SELECT otp, expires_at FROM user_otps WHERE email = ? ORDER BY id DESC LIMIT 1',
      [mobile_number]
    );

    if (!otpRecord || otpRecord.otp !== otp) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_OTP',
        message: 'Invalid OTP'
      });
    }

    if (new Date(otpRecord.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        code: 'OTP_EXPIRED',
        message: 'OTP has expired'
      });
    }

    // Clear OTP
    await db.query('DELETE FROM user_otps WHERE email = ?', [mobile_number]);

    // Check if user exists
    let [[user]] = await db.query(
      `SELECT user_id, full_name, email, mobile_number, role, is_active, is_verified 
       FROM users 
       WHERE mobile_number = ? OR whatsapp = ?
       LIMIT 1`,
      [mobile_number, mobile_number]
    );

    await connection.beginTransaction();

    // Create new user if doesn't exist
    if (!user) {
      if (!full_name) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          code: 'NAME_REQUIRED',
          message: 'Name is required for new users'
        });
      }

      // Generate referral code
      const referralCode = 'A366' + Math.random().toString(36).substring(2, 8).toUpperCase();

      const [result] = await connection.query(
        `INSERT INTO users 
         (full_name, mobile_number, whatsapp, email, password_hash, role, referal_code, is_active, is_verified, created_at)
         VALUES (?, ?, ?, ?, '', 'client', ?, 1, 1, NOW())`,
        [full_name, mobile_number, mobile_number, `${mobile_number}@client.a366.com`, referralCode]
      );

      user = {
        user_id: result.insertId,
        full_name,
        mobile_number,
        role: 'client',
        is_active: 1,
        is_verified: 1
      };

      // Audit log
      await createAuditLog({
        user_id: user.user_id,
        role: 'client',
        event_type: 'CLIENT_REGISTERED',
        resource_type: 'user',
        resource_id: user.user_id,
        details: `New client registered via OTP: ${mobile_number}`,
        ip_address: req.ip,
        user_agent: req.get('User-Agent')
      });
    }

    await connection.commit();

    // Check if active
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_INACTIVE',
        message: 'Your account is inactive. Please contact support.'
      });
    }

    // Generate JWT
    const token = jwt.sign(
      {
        user_id: user.user_id,
        role: user.role,
        email: user.email
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Audit log
    await createAuditLog({
      user_id: user.user_id,
      role: 'client',
      event_type: 'CLIENT_LOGIN',
      resource_type: 'user',
      resource_id: user.user_id,
      details: `Client logged in via OTP`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          user_id: user.user_id,
          full_name: user.full_name,
          mobile_number: user.mobile_number,
          role: user.role
        }
      }
    });

  } catch (err) {
    await connection.rollback();
    console.error('Verify OTP error:', err);
    res.status(500).json({
      success: false,
      code: 'LOGIN_FAILED',
      message: 'Login failed'
    });
  } finally {
    connection.release();
  }
};

// =======================
// PROFILE: GET
// =======================
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [[user]] = await db.query(
      `SELECT 
        user_id, full_name, email, mobile_number, whatsapp,
        university, country, currency_code, created_at
       FROM users
       WHERE user_id = ? AND role = 'client'
       LIMIT 1`,
      [userId]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'Profile not found'
      });
    }

    res.json({
      success: true,
      data: user
    });

  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({
      success: false,
      code: 'FETCH_ERROR',
      message: 'Failed to fetch profile'
    });
  }
};

// =======================
// PROFILE: UPDATE
// =======================
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { university, course, year, currency_code, country } = req.body;

    // Only allow specific fields to be updated
    const updates = [];
    const params = [];

    if (university !== undefined) {
      updates.push('university = ?');
      params.push(university);
    }
    if (country !== undefined) {
      updates.push('country = ?');
      params.push(country);
    }
    if (currency_code !== undefined) {
      updates.push('currency_code = ?');
      params.push(currency_code);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'NO_UPDATES',
        message: 'No valid fields to update'
      });
    }

    params.push(userId);

    await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`,
      params
    );

    // Audit log
    await createAuditLog({
      user_id: userId,
      role: 'client',
      event_type: 'PROFILE_UPDATED',
      resource_type: 'user',
      resource_id: userId,
      details: `Profile updated: ${updates.join(', ')}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });

  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({
      success: false,
      code: 'UPDATE_ERROR',
      message: 'Failed to update profile'
    });
  }
};

// =======================
// QUERY: CREATE
// =======================
exports.createQuery = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const userId = req.user.user_id;
    const {
      paper_topic,
      service,
      subject,
      urgency,
      description,
      deadline_at
    } = req.body;

    // Validation
    if (!paper_topic || !service || !subject || !urgency || !deadline_at) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS',
        message: 'Required fields: paper_topic, service, subject, urgency, deadline_at'
      });
    }

    // Validate deadline is in future
    const deadlineDate = new Date(deadline_at);
    if (deadlineDate <= new Date()) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_DEADLINE',
        message: 'Deadline must be in the future'
      });
    }

    await connection.beginTransaction();

    // Generate unique query code
    const query_code = generateUniqueCode('QUERY', 8);

    // Get user info
    const [[user]] = await connection.query(
      `SELECT full_name, bde FROM users WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    // Create order/query with initial status (26 - Pending Query)
    const [queryResult] = await connection.query(
      `INSERT INTO orders 
       (query_code, user_id, paper_topic, service, subject, urgency, description, 
        deadline_at, status, acceptance, work_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 26, 0, NULL, NOW())`,
      [query_code, userId, paper_topic, service, subject, urgency, description || null, deadline_at]
    );

    const orderId = queryResult.insertId;

    // Handle file uploads
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await connection.query(
          `INSERT INTO file_versions 
           (order_id, file_url, file_name, uploaded_by, file_size, version_number, created_at)
           VALUES (?, ?, ?, ?, ?, 1, NOW())`,
          [orderId, file.path, file.originalname, userId, file.size]
        );
      }
    }

    await connection.commit();

    // ============================================================================
    // AUTO-GENERATE QUOTATION (ENTERPRISE FLOW)
    // ============================================================================
    // Automatically create a quotation record and move to status 27
    try {
      const defaultPrice = 0.00; // Admin will update this later, but record exists
      await db.query(
        `INSERT INTO quotations (order_id, user_id, quoted_price_usd, notes, created_at)
         VALUES (?, ?, ?, 'Auto-generated quotation. Pending final review.', NOW())`,
        [orderId, userId, defaultPrice]
      );
      
      await db.query(`UPDATE orders SET status = 27 WHERE order_id = ?`, [orderId]);
    } catch (quoteErr) {
      console.error('Auto-quotation failed:', quoteErr);
    }

    // Audit log
    await createAuditLog({
      user_id: userId,
      role: 'client',
      event_type: 'QUERY_CREATED',
      resource_type: 'order',
      resource_id: orderId,
      details: `Query created and auto-quotation generated: ${query_code}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { query_code, paper_topic, service, subject, urgency }
    });

    // Send notifications
    const [admins] = await db.query(
      `SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 3`
    );

    await sendEventNotification('QUERY_CREATED', {
      client: userId,
      admin: admins[0]?.user_id,
      bde: user.bde
    }, {
      query_code,
      paper_topic,
      client_name: user.full_name,
      link_url: `/client/query/${query_code}`
    }, req.io, query_code);

    res.status(201).json({
      success: true,
      message: 'Query created successfully',
      data: {
        order_id: orderId,
        query_code,
        status: 'Pending Query',
        created_at: new Date()
      }
    });

  } catch (err) {
    await connection.rollback();
    console.error('Create query error:', err);
    res.status(500).json({
      success: false,
      code: 'CREATE_ERROR',
      message: 'Failed to create query'
    });
  } finally {
    connection.release();
  }
};

// =======================
// QUERY: LIST
// =======================
exports.listQueries = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { page = 0, limit = 20, status } = req.query;
    const offset = parseInt(page) * parseInt(limit);

    let whereClause = 'o.user_id = ?';
    let params = [userId];

    if (status && status !== 'all') {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }

    const [queries] = await db.query(
      `SELECT 
        o.order_id,
        o.query_code,
        o.work_code,
        o.paper_topic,
        o.service,
        o.subject,
        o.urgency,
        o.deadline_at,
        o.status,
        o.acceptance,
        o.created_at,
        ms.status_name
       FROM orders o
       LEFT JOIN master_status ms ON ms.id = o.status
       WHERE ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM orders o WHERE ${whereClause}`,
      params
    );

    res.json({
      success: true,
      data: {
        queries,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (err) {
    console.error('List queries error:', err);
    res.status(500).json({
      success: false,
      code: 'FETCH_ERROR',
      message: 'Failed to fetch queries'
    });
  }
};

// =======================
// QUERY: GET DETAILS
// =======================
exports.getQueryDetails = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { query_code } = req.params;

    const [[query]] = await db.query(
      `SELECT 
        o.order_id,
        o.query_code,
        o.work_code,
        o.paper_topic,
        o.service,
        o.subject,
        o.urgency,
        o.description,
        o.deadline_at,
        o.status,
        o.acceptance,
        o.created_at,
        ms.status_name
       FROM orders o
       LEFT JOIN master_status ms ON ms.id = o.status
       WHERE o.query_code = ? AND o.user_id = ?
       LIMIT 1`,
      [query_code, userId]
    );

    if (!query) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Query not found'
      });
    }

    // Get attached files (client uploaded only)
    const [files] = await db.query(
      `SELECT file_name, file_url, file_size, created_at
       FROM file_versions
       WHERE order_id = ? AND uploaded_by = ?
       ORDER BY created_at DESC`,
      [query.order_id, userId]
    );

    // Get quotation if exists
    let quotation = null;
    if (query.status >= STATUS.QUOTATION_SENT) {
      const [[q]] = await db.query(
        `SELECT quotation_id, quoted_price_usd, tax, discount, notes, created_at
         FROM quotations WHERE order_id = ? LIMIT 1`,
        [query.order_id]
      );
      quotation = q || null;
    }

    res.json({
      success: true,
      data: {
        ...query,
        files,
        quotation,
        phase: getOrderPhase(query.status),
        can_accept_quotation: query.status === STATUS.QUOTATION_SENT && !query.acceptance,
        can_upload_payment: query.acceptance === 1 && query.status < STATUS.AWAITING_VERIFICATION
      }
    });

  } catch (err) {
    console.error('Get query details error:', err);
    res.status(500).json({
      success: false,
      code: 'FETCH_ERROR',
      message: 'Failed to fetch query details'
    });
  }
};

// =======================
// QUOTATION: VIEW
// =======================
exports.viewQuotation = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { query_code } = req.params;

    // Get order and quotation
    const [[order]] = await db.query(
      `SELECT o.order_id, o.query_code, o.status, o.acceptance
       FROM orders o
       WHERE o.query_code = ? AND o.user_id = ?
       LIMIT 1`,
      [query_code, userId]
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Order not found'
      });
    }

    if (order.status < STATUS.QUOTATION_SENT) {
      return res.status(400).json({
        success: false,
        code: 'NO_QUOTATION',
        message: 'Quotation not yet generated'
      });
    }

    const [[quotation]] = await db.query(
      `SELECT 
        quotation_id,
        order_id,
        quoted_price_usd,
        tax,
        discount,
        notes,
        created_at
       FROM quotations
       WHERE order_id = ?
       LIMIT 1`,
      [order.order_id]
    );

    if (!quotation) {
      return res.status(404).json({
        success: false,
        code: 'QUOTATION_NOT_FOUND',
        message: 'Quotation not found'
      });
    }

    res.json({
      success: true,
      data: {
        ...quotation,
        total: parseFloat(quotation.quoted_price_usd) + parseFloat(quotation.tax || 0) - parseFloat(quotation.discount || 0),
        is_accepted: order.acceptance === 1,
        can_accept: order.status === STATUS.QUOTATION_SENT && order.acceptance !== 1
      }
    });

  } catch (err) {
    console.error('View quotation error:', err);
    res.status(500).json({
      success: false,
      code: 'FETCH_ERROR',
      message: 'Failed to fetch quotation'
    });
  }
};

// =======================
// QUOTATION: ACCEPT
// =======================
exports.acceptQuotation = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { query_code } = req.params;

    // Get order
    const [[order]] = await db.query(
      `SELECT o.order_id, o.status, o.acceptance, o.paper_topic
       FROM orders o
       WHERE o.query_code = ? AND o.user_id = ?
       LIMIT 1`,
      [query_code, userId]
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Order not found'
      });
    }

    if (order.status !== STATUS.QUOTATION_SENT) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_STATUS',
        message: 'Cannot accept quotation at this stage'
      });
    }

    if (order.acceptance === 1) {
      return res.status(400).json({
        success: false,
        code: 'ALREADY_ACCEPTED',
        message: 'Quotation already accepted'
      });
    }

    // Verify quotation exists
    const [[quotation]] = await db.query(
      `SELECT quotation_id FROM quotations WHERE order_id = ? LIMIT 1`,
      [order.order_id]
    );

    if (!quotation) {
      return res.status(404).json({
        success: false,
        code: 'NO_QUOTATION',
        message: 'No quotation to accept'
      });
    }

    // Update acceptance and status
    await db.query(
      `UPDATE orders SET acceptance = 1, status = ? WHERE order_id = ?`,
      [STATUS.ACCEPTED, order.order_id]
    );

    // Audit log
    await createAuditLog({
      user_id: userId,
      role: 'client',
      event_type: 'QUOTATION_ACCEPTED',
      resource_type: 'order',
      resource_id: order.order_id,
      details: `Client accepted quotation for ${query_code}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    // Send notifications
    const [admins] = await db.query(
      `SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1`
    );

    await sendEventNotification('QUOTATION_ACCEPTED', {
      client: userId,
      admin: admins[0]?.user_id
    }, {
      query_code,
      link_url: `/client/payment?query=${query_code}`
    }, req.io, query_code);

    res.json({
      success: true,
      message: 'Quotation accepted. Please upload payment receipt.'
    });

  } catch (err) {
    console.error('Accept quotation error:', err);
    res.status(500).json({
      success: false,
      code: 'ACCEPT_ERROR',
      message: 'Failed to accept quotation'
    });
  }
};

// =======================
// PAYMENT: UPLOAD RECEIPT
// =======================
exports.uploadPaymentReceipt = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { order_id, payment_method } = req.body;

    if (!order_id) {
      return res.status(400).json({
        success: false,
        code: 'ORDER_REQUIRED',
        message: 'Order ID is required'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        code: 'FILE_REQUIRED',
        message: 'Payment receipt file is required'
      });
    }

    // Get order
    const [[order]] = await db.query(
      `SELECT o.order_id, o.query_code, o.status, o.acceptance, q.quoted_price_usd, q.tax, q.discount
       FROM orders o
       LEFT JOIN quotations q ON o.order_id = q.order_id
       WHERE o.order_id = ? AND o.user_id = ?
       LIMIT 1`,
      [order_id, userId]
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Order not found'
      });
    }

    if (order.acceptance !== 1) {
      return res.status(400).json({
        success: false,
        code: 'QUOTATION_NOT_ACCEPTED',
        message: 'Please accept the quotation first'
      });
    }

    // Calculate total
    const total = parseFloat(order.quoted_price_usd || 0) + 
                  parseFloat(order.tax || 0) - 
                  parseFloat(order.discount || 0);

    // Create payment record
    const [paymentResult] = await db.query(
      `INSERT INTO payments 
       (order_id, user_id, amount, payment_method, payment_type, payment_doc, created_at)
       VALUES (?, ?, ?, ?, 'payment_receipt', ?, NOW())`,
      [order_id, userId, total, payment_method || 'bank_transfer', req.file.path]
    );

    // Update order status
    await db.query(
      `UPDATE orders SET status = ? WHERE order_id = ?`,
      [STATUS.AWAITING_VERIFICATION, order_id]
    );

    // Audit log
    await createAuditLog({
      user_id: userId,
      role: 'client',
      event_type: 'PAYMENT_UPLOADED',
      resource_type: 'payment',
      resource_id: paymentResult.insertId,
      details: `Payment receipt uploaded for ${order.query_code}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { order_id, amount: total, payment_method }
    });

    // Notify admin
    const [admins] = await db.query(
      `SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 3`
    );

    await sendEventNotification('PAYMENT_UPLOADED', {
      client: userId,
      admin: admins[0]?.user_id
    }, {
      query_code: order.query_code,
      amount: total,
      currency: 'USD',
      link_url: `/admin/payments/${paymentResult.insertId}`
    }, req.io, order.query_code);

    res.status(201).json({
      success: true,
      message: 'Payment receipt uploaded. Awaiting verification.',
      data: {
        payment_id: paymentResult.insertId,
        status: 'awaiting_verification'
      }
    });

  } catch (err) {
    console.error('Upload payment error:', err);
    res.status(500).json({
      success: false,
      code: 'UPLOAD_ERROR',
      message: 'Failed to upload payment receipt'
    });
  }
};

// =======================
// PAYMENT: GET STATUS
// =======================
exports.getPaymentStatus = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { query_code } = req.params;

    const [[order]] = await db.query(
      `SELECT o.order_id, o.query_code, o.status, o.work_code
       FROM orders o
       WHERE o.query_code = ? AND o.user_id = ?
       LIMIT 1`,
      [query_code, userId]
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Order not found'
      });
    }

    const [payments] = await db.query(
      `SELECT payment_id, amount, payment_method, created_at
       FROM payments
       WHERE order_id = ?
       ORDER BY created_at DESC`,
      [order.order_id]
    );

    let paymentStatus = 'pending';
    if (order.status >= STATUS.PAYMENT_VERIFIED) {
      paymentStatus = 'verified';
    } else if (order.status === STATUS.AWAITING_VERIFICATION) {
      paymentStatus = 'awaiting_verification';
    }

    res.json({
      success: true,
      data: {
        status: paymentStatus,
        work_code: order.work_code,
        payments: payments.map(p => ({
          payment_id: p.payment_id,
          amount: p.amount,
          method: p.payment_method,
          date: p.created_at
        }))
      }
    });

  } catch (err) {
    console.error('Get payment status error:', err);
    res.status(500).json({
      success: false,
      code: 'FETCH_ERROR',
      message: 'Failed to fetch payment status'
    });
  }
};

// =======================
// ORDERS: LIST
// =======================
exports.listOrders = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { page = 0, limit = 20 } = req.query;
    const offset = parseInt(page) * parseInt(limit);

    // Only return orders with work_code (post-payment)
    const [orders] = await db.query(
      `SELECT 
        o.order_id,
        o.query_code,
        o.work_code,
        o.paper_topic,
        o.service,
        o.subject,
        o.deadline_at,
        o.status,
        o.created_at,
        ms.status_name
       FROM orders o
       LEFT JOIN master_status ms ON ms.id = o.status
       WHERE o.user_id = ? AND o.work_code IS NOT NULL
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, parseInt(limit), offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM orders WHERE user_id = ? AND work_code IS NOT NULL`,
      [userId]
    );

    res.json({
      success: true,
      data: {
        orders,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (err) {
    console.error('List orders error:', err);
    res.status(500).json({
      success: false,
      code: 'FETCH_ERROR',
      message: 'Failed to fetch orders'
    });
  }
};

// =======================
// ORDER: TRACK
// =======================
exports.trackOrder = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { work_code } = req.params;

    const [[order]] = await db.query(
      `SELECT 
        o.order_id,
        o.query_code,
        o.work_code,
        o.paper_topic,
        o.service,
        o.subject,
        o.urgency,
        o.deadline_at,
        o.status,
        o.grammarly_score,
        o.ai_score,
        o.plagiarism_score,
        o.created_at,
        ms.status_name
       FROM orders o
       LEFT JOIN master_status ms ON ms.id = o.status
       WHERE o.work_code = ? AND o.user_id = ?
       LIMIT 1`,
      [work_code, userId]
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Order not found'
      });
    }

    // Get order history (excluding internal details)
    const [history] = await db.query(
      `SELECT 
        action_type,
        description,
        created_at
       FROM orders_history
       WHERE order_id = ?
       ORDER BY created_at DESC`,
      [order.order_id]
    );

    res.json({
      success: true,
      data: {
        ...order,
        phase: getOrderPhase(order.status),
        history: history.map(h => ({
          action: h.action_type,
          description: h.description,
          date: h.created_at
        }))
      }
    });

  } catch (err) {
    console.error('Track order error:', err);
    res.status(500).json({
      success: false,
      code: 'FETCH_ERROR',
      message: 'Failed to track order'
    });
  }
};

// =======================
// ORDER: GET DELIVERY FILES
// =======================
exports.getDeliveryFiles = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { work_code } = req.params;

    const [[order]] = await db.query(
      `SELECT order_id, status FROM orders
       WHERE work_code = ? AND user_id = ?
       LIMIT 1`,
      [work_code, userId]
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Order not found'
      });
    }

    // Only show files if order is delivered
    if (order.status < STATUS.DELIVERED) {
      return res.status(400).json({
        success: false,
        code: 'NOT_DELIVERED',
        message: 'Order not yet delivered'
      });
    }

    // Get approved submissions
    const [files] = await db.query(
      `SELECT 
        submission_id,
        file_url,
        grammarly_score,
        ai_score,
        plagiarism_score,
        created_at
       FROM submissions
       WHERE order_id = ? AND status = 'approved'
       ORDER BY created_at DESC`,
      [order.order_id]
    );

    res.json({
      success: true,
      data: {
        files: files.map(f => ({
          id: f.submission_id,
          url: f.file_url,
          quality_scores: {
            grammarly: f.grammarly_score,
            ai: f.ai_score,
            plagiarism: f.plagiarism_score
          },
          delivered_at: f.created_at
        }))
      }
    });

  } catch (err) {
    console.error('Get delivery files error:', err);
    res.status(500).json({
      success: false,
      code: 'FETCH_ERROR',
      message: 'Failed to fetch delivery files'
    });
  }
};

// =======================
// FEEDBACK: SUBMIT
// =======================
exports.submitFeedback = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { work_code } = req.params;
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_RATING',
        message: 'Rating must be between 1 and 5'
      });
    }

    const [[order]] = await db.query(
      `SELECT order_id, status FROM orders
       WHERE work_code = ? AND user_id = ?
       LIMIT 1`,
      [work_code, userId]
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Order not found'
      });
    }

    if (order.status < STATUS.DELIVERED) {
      return res.status(400).json({
        success: false,
        code: 'NOT_DELIVERED',
        message: 'Cannot submit feedback before delivery'
      });
    }

    // Store feedback (in submissions or separate table)
    await db.query(
      `UPDATE submissions SET feedback = ? WHERE order_id = ? AND status = 'approved'`,
      [JSON.stringify({ rating, comment, submitted_at: new Date() }), order.order_id]
    );

    // Audit log
    await createAuditLog({
      user_id: userId,
      role: 'client',
      event_type: 'FEEDBACK_SUBMITTED',
      resource_type: 'order',
      resource_id: order.order_id,
      details: `Client submitted feedback: ${rating}/5`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { rating, comment }
    });

    res.json({
      success: true,
      message: 'Feedback submitted successfully'
    });

  } catch (err) {
    console.error('Submit feedback error:', err);
    res.status(500).json({
      success: false,
      code: 'SUBMIT_ERROR',
      message: 'Failed to submit feedback'
    });
  }
};

// =======================
// REVISION: REQUEST
// =======================
exports.requestRevision = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { work_code } = req.params;
    const { details } = req.body;

    if (!details) {
      return res.status(400).json({
        success: false,
        code: 'DETAILS_REQUIRED',
        message: 'Revision details are required'
      });
    }

    const [[order]] = await db.query(
      `SELECT order_id, status, writer_id FROM orders
       WHERE work_code = ? AND user_id = ?
       LIMIT 1`,
      [work_code, userId]
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Order not found'
      });
    }

    if (order.status !== STATUS.DELIVERED) {
      return res.status(400).json({
        success: false,
        code: 'CANNOT_REQUEST_REVISION',
        message: 'Revisions can only be requested for delivered orders'
      });
    }

    // Create revision request
    await db.query(
      `INSERT INTO revision_requests 
       (order_id, requested_by, details, status, created_at)
       VALUES (?, ?, ?, 'pending', NOW())`,
      [order.order_id, userId, details]
    );

    // Update order status
    await db.query(
      `UPDATE orders SET status = ? WHERE order_id = ?`,
      [STATUS.REVISION_REQUIRED, order.order_id]
    );

    // Audit log
    await createAuditLog({
      user_id: userId,
      role: 'client',
      event_type: 'REVISION_REQUESTED',
      resource_type: 'order',
      resource_id: order.order_id,
      details: `Client requested revision`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { details }
    });

    // Notify writer and admin
    const [admins] = await db.query(
      `SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1`
    );

    await sendEventNotification('REVISION_REQUESTED', {
      writer: order.writer_id,
      admin: admins[0]?.user_id
    }, {
      work_code,
      details: details.substring(0, 100),
      link_url: `/writer/tasks/${order.order_id}`
    }, req.io, work_code);

    res.json({
      success: true,
      message: 'Revision request submitted'
    });

  } catch (err) {
    console.error('Request revision error:', err);
    res.status(500).json({
      success: false,
      code: 'REQUEST_ERROR',
      message: 'Failed to request revision'
    });
  }
};

// =======================
// NOTIFICATIONS: GET
// =======================
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { page = 0, limit = 20 } = req.query;
    const offset = parseInt(page) * parseInt(limit);

    const [notifications] = await db.query(
      `SELECT * FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, parseInt(limit), offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM notifications WHERE user_id = ?`,
      [userId]
    );

    const [[{ unread }]] = await db.query(
      `SELECT COUNT(*) as unread FROM notifications WHERE user_id = ? AND is_read = 0`,
      [userId]
    );

    res.json({
      success: true,
      data: {
        notifications,
        unread_count: unread,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({
      success: false,
      code: 'FETCH_ERROR',
      message: 'Failed to fetch notifications'
    });
  }
};

// =======================
// NOTIFICATIONS: MARK READ
// =======================
exports.markNotificationRead = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { notification_id } = req.params;

    const success = await markAsRead(notification_id, userId);

    if (!success) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (err) {
    console.error('Mark notification error:', err);
    res.status(500).json({
      success: false,
      code: 'UPDATE_ERROR',
      message: 'Failed to mark notification'
    });
  }
};

// =======================
// CHAT: GET HISTORY
// =======================
exports.getChatHistory = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { context_code } = req.params;
    const { page = 0, limit = 50 } = req.query;
    const offset = parseInt(page) * parseInt(limit);

    // Get order
    let query;
    if (context_code.startsWith('QUERY_')) {
      query = `SELECT o.order_id, o.query_code, o.user_id, u.bde
               FROM orders o
               JOIN users u ON o.user_id = u.user_id
               WHERE o.query_code = ?`;
    } else {
      query = `SELECT o.order_id, o.work_code, o.user_id, u.bde
               FROM orders o
               JOIN users u ON o.user_id = u.user_id
               WHERE o.work_code = ?`;
    }

    const [[order]] = await db.query(query, [context_code]);

    if (!order) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Context not found'
      });
    }

    // Validate client owns order
    if (order.user_id !== userId) {
      return res.status(403).json({
        success: false,
        code: 'ACCESS_DENIED',
        message: 'Access denied'
      });
    }

    // Get or create chat metadata
    let [[chat]] = await db.query(
      `SELECT * FROM order_chats WHERE order_id = ? LIMIT 1`,
      [order.order_id]
    );

    if (!chat) {
      const [result] = await db.query(
        `INSERT INTO order_chats (order_id, context_code, chat_name, status, created_at, updated_at)
         VALUES (?, ?, 'Order Chat', 'active', NOW(), NOW())`,
        [order.order_id, context_code]
      );
      [[chat]] = await db.query(`SELECT * FROM order_chats WHERE chat_id = ? LIMIT 1`, [result.insertId]);
    }

    // Ensure participants (client + bde)
    const participants = [];
    if (order.user_id) participants.push({ user_id: order.user_id, role: 'client' });
    if (order.bde) participants.push({ user_id: order.bde, role: 'bde' });
    const participantValues = participants.map(p => `(${chat.chat_id}, ${p.user_id}, '${p.role}', 0, NOW())`).join(',');
    if (participantValues) {
      await db.query(
        `INSERT IGNORE INTO order_chat_participants (chat_id, user_id, role, is_muted, joined_at) VALUES ${participantValues}`
      );
    }

    // Fetch messages from normalized table, hide writer messages from clients
    const [messagesRows] = await db.query(
      `SELECT m.message_id, m.chat_id, m.order_id, m.sender_id, m.sender_role, m.message_type, m.content, m.attachments,
              m.is_deleted, m.is_edited, m.edited_at, m.created_at,
              CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END as is_read
       FROM order_chat_messages m
       LEFT JOIN order_chat_message_reads r ON m.message_id = r.message_id AND r.user_id = ?
       WHERE m.chat_id = ? AND m.sender_role <> 'writer'
       ORDER BY m.created_at ASC
       LIMIT ? OFFSET ?`,
      [userId, chat.chat_id, parseInt(limit), parseInt(offset)]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM order_chat_messages WHERE chat_id = ? AND sender_role <> 'writer'`,
      [chat.chat_id]
    );

    // Mark unread as read
    const unreadIds = messagesRows.filter(m => m.is_read === 0 && m.sender_id !== userId).map(m => m.message_id);
    if (unreadIds.length) {
      const values = unreadIds.map(id => `(${id}, ${userId}, NOW())`).join(',');
      await db.query(`INSERT IGNORE INTO order_chat_message_reads (message_id, user_id, read_at) VALUES ${values}`);
    }

    const messages = messagesRows.map(m => ({
      message_id: m.message_id,
      chat_id: m.chat_id,
      order_id: m.order_id,
      sender_id: m.sender_id,
      sender_role: m.sender_role,
      message_type: m.message_type,
      content: m.content,
      attachments: m.attachments,
      is_deleted: !!m.is_deleted,
      is_edited: !!m.is_edited,
      edited_at: m.edited_at,
      is_read: !!m.is_read,
      is_mine: m.sender_id === userId,
      created_at: m.created_at
    }));

    res.json({
      success: true,
      data: {
        chat_id: chat.chat_id,
        context: context_code,
        status: chat.status,
        messages,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total
        }
      }
    });

  } catch (err) {
    console.error('Get chat history error:', err);
    res.status(500).json({
      success: false,
      code: 'FETCH_ERROR',
      message: 'Failed to fetch chat'
    });
  }
};

// =======================
// CHAT: SEND MESSAGE
// =======================
exports.sendChatMessage = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { context_code } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        code: 'MESSAGE_REQUIRED',
        message: 'Message is required'
      });
    }

    // Get order
    let query;
    if (context_code.startsWith('QUERY_')) {
      query = `SELECT o.order_id, o.user_id, u.bde, u.full_name
               FROM orders o
               JOIN users u ON o.user_id = u.user_id
               WHERE o.query_code = ?`;
    } else {
      query = `SELECT o.order_id, o.user_id, u.bde, u.full_name
               FROM orders o
               JOIN users u ON o.user_id = u.user_id
               WHERE o.work_code = ?`;
    }

    const [[order]] = await db.query(query, [context_code]);

    if (!order || order.user_id !== userId) {
      return res.status(403).json({
        success: false,
        code: 'ACCESS_DENIED',
        message: 'Access denied'
      });
    }

    // Get chat metadata
    let [[chat]] = await db.query(
      `SELECT * FROM order_chats WHERE order_id = ? LIMIT 1`,
      [order.order_id]
    );

    if (!chat) {
      const [result] = await db.query(
        `INSERT INTO order_chats (order_id, context_code, chat_name, status, created_at, updated_at)
         VALUES (?, ?, 'Order Chat', 'active', NOW(), NOW())`,
        [order.order_id, context_code]
      );
      [[chat]] = await db.query(`SELECT * FROM order_chats WHERE chat_id = ? LIMIT 1`, [result.insertId]);
    }

    // Ensure participants (client + bde)
    const participants = [];
    if (order.user_id) participants.push({ user_id: order.user_id, role: 'client' });
    if (order.bde) participants.push({ user_id: order.bde, role: 'bde' });
    const participantValues = participants.map(p => `(${chat.chat_id}, ${p.user_id}, '${p.role}', 0, NOW())`).join(',');
    if (participantValues) {
      await db.query(
        `INSERT IGNORE INTO order_chat_participants (chat_id, user_id, role, is_muted, joined_at) VALUES ${participantValues}`
      );
    }

    // Check chat status
    if (chat.status === 'closed') {
      return res.status(400).json({
        success: false,
        code: 'CHAT_CLOSED',
        message: 'Chat is closed'
      });
    }

    if (chat.status === 'restricted') {
      return res.status(400).json({
        success: false,
        code: 'CHAT_RESTRICTED',
        message: 'Chat is restricted'
      });
    }

    // Insert message
    const [insertRes] = await db.query(
      `INSERT INTO order_chat_messages (chat_id, order_id, sender_id, sender_role, message_type, content, attachments, is_edited, is_deleted, created_at)
       VALUES (?, ?, ?, 'client', 'text', ?, NULL, 0, 0, NOW())`,
      [chat.chat_id, order.order_id, userId, message.trim()]
    );

    const messageId = insertRes.insertId;
    const [[savedMsg]] = await db.query(`SELECT * FROM order_chat_messages WHERE message_id = ? LIMIT 1`, [messageId]);

    const [[senderUser]] = await db.query(`SELECT full_name FROM users WHERE user_id = ?`, [userId]);
    const senderName = senderUser?.full_name || 'You';
    const enrichedMessage = {
      ...savedMsg,
      sender_name: senderName,
      message: savedMsg.content,
      is_mine: true,
      is_read: true
    };
    const emittedMessage = { ...enrichedMessage, is_mine: false, is_read: false };

    // Mark sender read
    await db.query(
      `INSERT IGNORE INTO order_chat_message_reads (message_id, user_id, read_at) VALUES (?, ?, NOW())`,
      [messageId, userId]
    );

    // Emit real-time
    if (req.io) {
      const payload = {
        chat_id: chat.chat_id,
        context_code,
        message: emittedMessage
      };
      req.io.to(`context:${context_code}`).emit('chat:new_message', payload);
      req.io.to('role:admin').emit('chat:new_message', payload);
    }

    // Notifications: send to BDE and admins
    if (req.io) {
      const recipients = [];
      if (order.bde) recipients.push({ id: order.bde, role: 'bde' });

      const buildLink = (targetRole) => {
        if (targetRole === 'admin') return `/admin/queries/${order.order_id}/view`;
        if (targetRole === 'bde') return `/bde/queries/${context_code}`;
        return `/client/orders/${context_code}`;
      };

      for (const r of recipients) {
        await createNotificationWithRealtime(req.io, {
          user_id: r.id,
          type: 'chat',
          title: `New chat from ${senderName}`,
          message: savedMsg.content || 'New message',
          link_url: buildLink(r.role),
          context_code,
          triggered_by: { user_id: userId, role: 'client' }
        });
      }

      const [admins] = await db.query(`SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1`);
      for (const admin of admins) {
        await createNotificationWithRealtime(req.io, {
          user_id: admin.user_id,
          type: 'chat',
          title: `New chat message in ${context_code}`,
          message: savedMsg.content || 'New message',
          link_url: buildLink('admin'),
          context_code,
          triggered_by: { user_id: userId, role: 'client' }
        });
      }
    }

    // Audit log
    await createAuditLog({
      user_id: userId,
      role: 'client',
      event_type: 'CHAT_MESSAGE_SENT',
      resource_type: 'chat',
      resource_id: chat.chat_id,
      details: `Client sent message in ${context_code}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Message sent',
      data: enrichedMessage
    });

  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({
      success: false,
      code: 'SEND_ERROR',
      message: 'Failed to send message'
    });
  }
};
