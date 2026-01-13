const db = require('../config/db');
const {
  createAuditLog,
  createNotification,
  generateUniqueCode,
  recordWalletTransaction,
  createOrderHistory
} = require('../utils/audit');
const notificationsController = require('./notifications.controller');
const { emitChatSystemMessage } = require('../utils/realtime');

/**
 * ADMIN PAYMENT VERIFICATION CONTROLLER
 * 
 * CRITICAL FLOW:
 * 1. Admin verifies payment receipt
 * 2. Generate work_code
 * 3. Convert query to confirmed order
 * 4. Trigger writer assignment
 * 5. Deduct from client wallet (if applicable)
 * 6. Create audit trail
 * 7. Send notifications
 * 
 * Only Admin can perform these operations
 */

/**
 * LIST UNVERIFIED PAYMENTS
 * Admin views all payments pending verification
 */
exports.listUnverifiedPayments = async (req, res) => {
  try {
    const { page = 0, limit = 20, status = 'pending' } = req.query;
    const offset = parseInt(page) * parseInt(limit);

    let whereClause = '1=1';
    let params = [];

    // Filter for unverified payments (orders WITHOUT work_code)
    if (status === 'pending') {
      whereClause += ` AND NOT EXISTS (
        SELECT 1 FROM orders o WHERE o.order_id = p.order_id AND o.work_code IS NOT NULL
      )`;
    } else if (status === 'verified') {
      whereClause += ` AND EXISTS (
        SELECT 1 FROM orders o WHERE o.order_id = p.order_id AND o.work_code IS NOT NULL
      )`;
    }

    // =======================
    // FETCH PAYMENTS
    // =======================
    const [payments] = await db.query(
      `SELECT 
        p.payment_id,
        p.order_id,
        p.user_id,
        u.full_name,
        u.email,
        o.query_code,
        o.paper_topic,
        o.total_price_usd,
        p.amount,
        p.payment_method,
        p.payment_doc,
        p.created_at,
        CASE 
          WHEN o.work_code IS NOT NULL THEN 'verified'
          ELSE 'pending'
        END as status
      FROM payments p
      JOIN users u ON p.user_id = u.user_id
      LEFT JOIN orders o ON p.order_id = o.order_id
      WHERE ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // =======================
    // GET TOTAL COUNT
    // =======================
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM payments p
       LEFT JOIN orders o ON p.order_id = o.order_id
       WHERE ${whereClause}`,
      params
    );

    const totalPages = Math.ceil(total / parseInt(limit));

    return res.json({
      success: true,
      data: {
        payments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: totalPages
        }
      }
    });

  } catch (err) {
    console.error('Error listing payments:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payments'
    });
  }
};

/**
 * VERIFY PAYMENT & GENERATE WORK_CODE
 * CRITICAL OPERATION - ONLY ADMIN
 * 
 * Steps:
 * 1. Validate payment and order exist
 * 2. Check payment matches order amount
 * 3. Generate work_code
 * 4. Update order with work_code (confirms the order)
 * 5. Update payment status
 * 6. Deduct from client wallet (if configured)
 * 7. Create audit log
 * 8. Send notifications
 * 9. Trigger writer assignment (Admin can assign writer next)
 */
exports.verifyPayment = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const adminId = req.user.user_id;
    const { payment_id, notes, approve = true } = req.body;

    if (!payment_id) {
      return res.status(400).json({
        success: false,
        message: 'Payment ID is required'
      });
    }

    if (!approve) {
      return res.status(400).json({
        success: false,
        message: 'Use rejectPayment endpoint for rejections'
      });
    }

    await connection.beginTransaction();

    // =======================
    // FETCH PAYMENT WITH ORDER
    // =======================
    const [[payment]] = await connection.query(
      `SELECT p.*, o.order_id, o.total_price_usd, o.user_id, o.work_code
       FROM payments p
       LEFT JOIN orders o ON p.order_id = o.order_id
       WHERE p.payment_id = ?
       LIMIT 1`,
      [payment_id]
    );

    if (!payment) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // =======================
    // PREVENT DOUBLE VERIFICATION
    // =======================
    if (payment.work_code) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Payment already verified'
      });
    }

    // =======================
    // VALIDATE AMOUNT
    // =======================
    const expectedAmount = parseFloat(payment.total_price_usd) || parseFloat(payment.amount);
    const paidAmount = parseFloat(payment.amount);

    if (paidAmount < expectedAmount * 0.95) {
      // Allow 5% tolerance
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `Payment amount mismatch. Expected: ${expectedAmount}, Received: ${paidAmount}`
      });
    }

    // =======================
    // GENERATE WORK_CODE
    // =======================
    const work_code = generateUniqueCode('WORK', 12);

    // =======================
    // UPDATE ORDER WITH WORK_CODE (CONFIRMS ORDER)
    // =======================
    await connection.query(
      `UPDATE orders SET work_code = ? WHERE order_id = ?`,
      [work_code, payment.order_id]
    );

    // =======================
    // OPTIONAL: DEDUCT FROM WALLET
    // =======================
    const [[walletConfig]] = await connection.query(
      `SELECT id FROM payments WHERE payment_method = 'wallet' AND order_id = ? LIMIT 1`,
      [payment.order_id]
    );

    if (walletConfig) {
      const [[wallet]] = await connection.query(
        `SELECT balance FROM wallets WHERE user_id = ? LIMIT 1`,
        [payment.user_id]
      );

      if (wallet && wallet.balance >= paidAmount) {
        await connection.query(
          `UPDATE wallets SET balance = balance - ? WHERE user_id = ?`,
          [paidAmount, payment.user_id]
        );

        await connection.query(
          `INSERT INTO wallet_transactions (user_id, amount, type, reason, reference_id, created_at)
           VALUES (?, ?, 'debit', 'Order payment', ?, NOW())`,
          [payment.user_id, paidAmount, payment.order_id]
        );
      }
    }

    // =======================
    // CREATE ORDER HISTORY
    // =======================
    await createOrderHistory({
      order_id: payment.order_id,
      modified_by: adminId,
      modified_by_name: 'Admin',
      modified_by_role: 'Admin',
      action_type: 'PAYMENT_VERIFIED',
      description: `Payment verified and work_code generated: ${work_code}. ${notes || ''}`
    });

    await connection.commit();

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: adminId,
      role: 'admin',
      event_type: 'PAYMENT_VERIFIED',
      resource_type: 'payment',
      resource_id: payment_id,
      details: `Admin verified payment for order ${payment.order_id}. Work code: ${work_code}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: {
        payment_id,
        order_id: payment.order_id,
        amount: paidAmount,
        work_code
      }
    });

    // =======================
    // SEND NOTIFICATIONS WITH REALTIME
    // =======================
    
    // Get BDE ID from user record
    const [[userRecord]] = await db.query(
      `SELECT bde FROM users WHERE user_id = ? LIMIT 1`,
      [payment.user_id]
    );
    
    const bdeId = userRecord?.bde;

    // Notify client
    await notificationsController.createNotificationWithRealtime(
      req.io,
      {
        user_id: payment.user_id,
        type: 'success',
        title: 'Payment Verified',
        message: `Your payment has been verified. Work code: ${work_code}. Assignment in progress...`,
        link_url: `/client/orders/${payment.order_id}`,
        context_code: work_code,
        triggered_by: {
          user_id: adminId,
          role: 'admin',
          ip_address: req.ip,
          user_agent: req.get('User-Agent')
        }
      }
    );

    // Notify BDE if assigned
    if (bdeId) {
      await notificationsController.createNotificationWithRealtime(
        req.io,
        {
          user_id: bdeId,
          type: 'success',
          title: 'Payment Verified',
          message: `Payment for order ${payment.order_id} has been verified. Work code: ${work_code}. Order is now in progress.`,
          link_url: `/bde/orders/${payment.order_id}`,
          context_code: work_code,
          triggered_by: {
            user_id: adminId,
            role: 'admin',
            ip_address: req.ip,
            user_agent: req.get('User-Agent')
          }
        }
      );
    }

    // Add system message to chat
    await emitChatSystemMessage(
      req.io,
      payment.order_id,
      work_code,
      `Payment verified by Admin. Work code generated: ${work_code}. Assignment work begins now.`
    );

    return res.json({
      success: true,
      message: 'Payment verified successfully',
      data: {
        payment_id,
        order_id: payment.order_id,
        work_code,
        status: 'verified'
      }
    });

  } catch (err) {
    await connection.rollback();
    console.error('Error verifying payment:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: err.message
    });
  } finally {
    connection.release();
  }
};

/**
 * REJECT PAYMENT
 * Admin can reject payment if verification fails
 * Sends notification to client to resubmit
 */
exports.rejectPayment = async (req, res) => {
  try {
    const adminId = req.user.user_id;
    const { payment_id, rejection_reason } = req.body;

    if (!payment_id || !rejection_reason) {
      return res.status(400).json({
        success: false,
        message: 'Payment ID and rejection reason are required'
      });
    }

    // =======================
    // FETCH PAYMENT
    // =======================
    const [[payment]] = await db.query(
      `SELECT p.*, o.order_id, o.user_id
       FROM payments p
       LEFT JOIN orders o ON p.order_id = o.order_id
       WHERE p.payment_id = ?
       LIMIT 1`,
      [payment_id]
    );

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // =======================
    // DELETE UNVERIFIED PAYMENT
    // =======================
    await db.query(
      `DELETE FROM payments WHERE payment_id = ? AND NOT EXISTS (
        SELECT 1 FROM orders WHERE order_id = payment.order_id AND work_code IS NOT NULL
      )`,
      [payment_id]
    );

    // =======================
    // AUDIT LOG
    // =======================
    await createAuditLog({
      user_id: adminId,
      role: 'admin',
      event_type: 'PAYMENT_REJECTED',
      resource_type: 'payment',
      resource_id: payment_id,
      details: `Admin rejected payment for order ${payment.order_id}. Reason: ${rejection_reason}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { payment_id, rejection_reason }
    });

    // =======================
    // SEND NOTIFICATION
    // =======================
    await createNotification({
      user_id: payment.user_id,
      type: 'warning',
      title: 'Payment Rejected',
      message: `Your payment was rejected: ${rejection_reason}. Please resubmit with correct receipt.`,
      link_url: `/client/orders/${payment.order_id}/payment`
    });

    return res.json({
      success: true,
      message: 'Payment rejected successfully',
      data: {
        payment_id,
        order_id: payment.order_id,
        status: 'rejected'
      }
    });

  } catch (err) {
    console.error('Error rejecting payment:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to reject payment'
    });
  }
};

module.exports = exports;
