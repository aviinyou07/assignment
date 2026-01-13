const db = require('../config/db');
const {
  createAuditLog,
  createNotification,
  recordWalletTransaction
} = require('../utils/audit');

/**
 * CLIENT QUOTATION & PAYMENT CONTROLLER
 * 
 * Client can:
 * - View quotations
 * - Accept quotations (does NOT create work_code)
 * - Upload payment receipts
 * 
 * Client CANNOT:
 * - Generate quotations (BDE/Admin only)
 * - Verify payments (Admin only)
 * - Update/delete payments
 */

/**
 * VIEW QUOTATION
 * Client can only view quotations for their own orders
 */
exports.viewQuotation = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { orderId } = req.params;

    // =======================
    // VERIFY CLIENT OWNS ORDER
    // =======================
    const [[order]] = await db.query(
      `SELECT order_id, user_id, query_code FROM orders WHERE order_id = ? LIMIT 1`,
      [orderId]
    );

    if (!order || order.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // =======================
    // FETCH QUOTATION
    // =======================
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
      [orderId]
    );

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'No quotation found for this order'
      });
    }

    return res.json({
      success: true,
      data: quotation
    });

  } catch (err) {
    console.error('Error fetching quotation:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch quotation'
    });
  }
};

/**
 * ACCEPT QUOTATION
 * Sets acceptance = 1 in orders table
 * Does NOT generate work_code (only Admin does this on payment verification)
 */
exports.acceptQuotation = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { orderId } = req.params;

    // =======================
    // VERIFY CLIENT OWNS ORDER
    // =======================
    const [[order]] = await db.query(
      `SELECT order_id, user_id, acceptance FROM orders WHERE order_id = ? LIMIT 1`,
      [orderId]
    );

    if (!order || order.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (order.acceptance === 1) {
      return res.status(400).json({
        success: false,
        message: 'Quotation already accepted'
      });
    }

    // =======================
    // VERIFY QUOTATION EXISTS
    // =======================
    const [[quotation]] = await db.query(
      `SELECT quotation_id FROM quotations WHERE order_id = ? LIMIT 1`,
      [orderId]
    );

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'No quotation to accept'
      });
    }

    // =======================
    // UPDATE ACCEPTANCE
    // =======================
    await db.query(
      `UPDATE orders SET acceptance = 1 WHERE order_id = ?`,
      [orderId]
    );

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: userId,
      role: 'client',
      event_type: 'QUOTATION_ACCEPTED',
      resource_type: 'order',
      resource_id: orderId,
      details: `Client accepted quotation for order ${orderId}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    // =======================
    // SEND NOTIFICATION
    // =======================
    await createNotification({
      user_id: userId,
      type: 'success',
      title: 'Quotation Accepted',
      message: 'Your quotation has been accepted. Please upload payment receipt next.',
      link_url: `/client/orders/${orderId}/payment`
    });

    // Notify admin
    const [admins] = await db.query(
      `SELECT user_id FROM users WHERE role = 'Admin' AND is_active = 1 LIMIT 1`
    );
    if (admins.length > 0) {
      await createNotification({
        user_id: admins[0].user_id,
        type: 'info',
        title: 'Quotation Accepted',
        message: `Client accepted quotation for order ${orderId}`,
        link_url: `/admin/orders/${orderId}`
      });
    }

    return res.json({
      success: true,
      message: 'Quotation accepted. Next, upload payment receipt.'
    });

  } catch (err) {
    console.error('Error accepting quotation:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to accept quotation'
    });
  }
};

/**
 * UPLOAD PAYMENT RECEIPT
 * Client uploads payment proof
 * Payment is ALWAYS unverified initially
 * Only Admin can verify and trigger work_code generation
 */
exports.uploadPaymentReceipt = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    // =======================
    // VERIFY FILE UPLOADED
    // =======================
    if (!req.files || !req.files.receipt) {
      return res.status(400).json({
        success: false,
        message: 'Payment receipt file is required'
      });
    }

    const receiptFile = req.files.receipt;

    // =======================
    // VERIFY CLIENT OWNS ORDER
    // =======================
    const [[order]] = await db.query(
      `SELECT order_id, user_id, acceptance, total_price_usd FROM orders WHERE order_id = ? LIMIT 1`,
      [orderId]
    );

    if (!order || order.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (order.acceptance !== 1) {
      return res.status(400).json({
        success: false,
        message: 'Quotation must be accepted before uploading payment'
      });
    }

    // =======================
    // CHECK IF PAYMENT ALREADY EXISTS
    // =======================
    const [[existingPayment]] = await db.query(
      `SELECT payment_id FROM payments WHERE order_id = ? LIMIT 1`,
      [orderId]
    );

    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: 'Payment already submitted for this order. Awaiting verification.'
      });
    }

    // =======================
    // CREATE PAYMENT RECORD (UNVERIFIED)
    // =======================
    const [paymentResult] = await db.query(
      `INSERT INTO payments 
       (order_id, user_id, amount, payment_method, payment_type, payment_doc, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        orderId,
        userId,
        order.total_price_usd || 0,
        'manual_upload',
        'receipt',
        receiptFile.filename || receiptFile.originalname
      ]
    );

    const paymentId = paymentResult.insertId;

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: userId,
      role: 'client',
      event_type: 'PAYMENT_UPLOADED',
      resource_type: 'payment',
      resource_id: paymentId,
      details: `Client uploaded payment receipt for order ${orderId}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { order_id: orderId, amount: order.total_price_usd }
    });

    // =======================
    // SEND NOTIFICATION TO CLIENT
    // =======================
    await createNotification({
      user_id: userId,
      type: 'success',
      title: 'Payment Receipt Uploaded',
      message: 'Your payment receipt has been submitted. Admin will verify shortly.',
      link_url: `/client/orders/${orderId}`
    });

    // =======================
    // SEND NOTIFICATION TO ADMIN
    // =======================
    const [admins] = await db.query(
      `SELECT user_id FROM users WHERE role = 'Admin' AND is_active = 1 LIMIT 1`
    );
    if (admins.length > 0) {
      await createNotification({
        user_id: admins[0].user_id,
        type: 'critical',
        title: 'Payment Awaiting Verification',
        message: `Payment receipt uploaded for order ${orderId}. Amount: ${order.total_price_usd}`,
        link_url: `/admin/payments/${paymentId}`
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Payment receipt uploaded successfully',
      data: {
        payment_id: paymentId,
        status: 'pending_verification',
        created_at: new Date()
      }
    });

  } catch (err) {
    console.error('Error uploading payment:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload payment receipt'
    });
  }
};

/**
 * GET PAYMENT STATUS
 * Client can check payment status for their order
 */
exports.getPaymentStatus = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { orderId } = req.params;

    // =======================
    // VERIFY CLIENT OWNS ORDER
    // =======================
    const [[order]] = await db.query(
      `SELECT order_id, user_id FROM orders WHERE order_id = ? LIMIT 1`,
      [orderId]
    );

    if (!order || order.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // =======================
    // FETCH PAYMENT
    // =======================
    const [[payment]] = await db.query(
      `SELECT 
        payment_id,
        order_id,
        amount,
        payment_method,
        created_at,
        CASE 
          WHEN EXISTS(SELECT 1 FROM orders WHERE order_id = ? AND work_code IS NOT NULL) THEN 'verified'
          ELSE 'pending'
        END as status
      FROM payments
      WHERE order_id = ?
      LIMIT 1`,
      [orderId, orderId]
    );

    if (!payment) {
      return res.json({
        success: true,
        data: {
          status: 'not_submitted',
          message: 'No payment has been submitted yet'
        }
      });
    }

    return res.json({
      success: true,
      data: payment
    });

  } catch (err) {
    console.error('Error fetching payment status:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payment status'
    });
  }
};

module.exports = exports;
