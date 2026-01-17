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
 * - Accept quotations (triggers 50% payment request)
 * - Upload 50% payment receipts
 * - Upload final payment receipts
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
        quoted_price,
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
    // UPDATE ACCEPTANCE AND STATUS
    // =======================
    const { updateOrderStatus } = require('../utils/workflow.service');
    const { STATUS } = require('../utils/order-state-machine');
    
    const statusResult = await updateOrderStatus(
      orderId,
      STATUS.ACCEPTED,
      'client',
      {
        userId: userId,
        userName: req.user.full_name,
        io: req.io,
        reason: 'Client accepted quotation'
      }
    );

    if (!statusResult.success) {
      return res.status(400).json({
        success: false,
        message: statusResult.error
      });
    }

    // =======================
    // TRIGGER PAYMENT REQUEST WORKFLOW
    // =======================
    const { processWorkflowEvent } = require('../utils/workflow.service');
    await processWorkflowEvent('PAYMENT_50_REQUESTED', order, { client_id: userId }, {
      currency: '$',
      amount: order.total_price.toFixed(2),
      half_amount: (order.total_price / 2).toFixed(2)
    }, req.io);

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

    return res.json({
      success: true,
      message: 'Quotation accepted. Next, upload 50% payment receipt.'
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
 * Client uploads payment proof for 50% or final payment
 * Payment is ALWAYS unverified initially
 * Only Admin can verify payments
 */
exports.uploadPaymentReceipt = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { orderId, paymentType } = req.body; // paymentType: '50_percent' or 'final'

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
      `SELECT o.order_id, o.user_id, o.acceptance, o.total_price, o.status,
              p.payment_id, p.payment_type
       FROM orders o
       LEFT JOIN payments p ON o.order_id = p.order_id
       WHERE o.order_id = ? LIMIT 1`,
      [orderId]
    );

    if (!order || order.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // =======================
    // DETERMINE PAYMENT TYPE AND VALIDATE
    // =======================
    let actualPaymentType = paymentType;
    let expectedAmount = order.total_price;

    if (!actualPaymentType) {
      // Auto-determine based on order status
      if (order.status === 28) { // ACCEPTED
        actualPaymentType = '50_percent';
        expectedAmount = order.total_price / 2;
      } else if (order.status === 34) { // APPROVED
        actualPaymentType = 'final';
        expectedAmount = order.total_price / 2;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Invalid order status for payment upload'
        });
      }
    }

    // Validate payment type
    if (actualPaymentType === '50_percent' && order.status !== 28 && order.status !== 29) {
      return res.status(400).json({
        success: false,
        message: '50% payment can only be uploaded after quotation acceptance'
      });
    }

    if (actualPaymentType === 'final' && order.status !== 34 && order.status !== 42) {
      return res.status(400).json({
        success: false,
        message: 'Final payment can only be uploaded after work approval'
      });
    }

    // =======================
    // CHECK IF PAYMENT ALREADY EXISTS FOR THIS TYPE
    // =======================
    const [[existingPayment]] = await db.query(
      `SELECT payment_id FROM payments 
       WHERE order_id = ? AND payment_type = ? LIMIT 1`,
      [orderId, actualPaymentType]
    );

    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: `${actualPaymentType === '50_percent' ? '50%' : 'Final'} payment already submitted for this order. Awaiting verification.`
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
        expectedAmount,
        'manual_upload',
        actualPaymentType,
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
      details: `Client uploaded ${actualPaymentType} payment receipt for order ${orderId}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      event_data: { order_id: orderId, payment_type: actualPaymentType, amount: expectedAmount }
    });

    // =======================
    // SEND NOTIFICATION TO CLIENT
    // =======================
    const eventName = actualPaymentType === '50_percent' ? 'PAYMENT_50_UPLOADED' : 'PAYMENT_FINAL_UPLOADED';
    
    await createNotification({
      user_id: userId,
      type: 'success',
      title: 'Payment Receipt Uploaded',
      message: `Your ${actualPaymentType === '50_percent' ? '50%' : 'final'} payment receipt has been submitted. Admin will verify shortly.`,
      link_url: `/client/orders/${orderId}`
    });

    // =======================
    // TRIGGER WORKFLOW EVENT
    // =======================
    const { processWorkflowEvent } = require('../utils/workflow.service');
    await processWorkflowEvent(eventName, order, { client_id: userId }, {
      currency: '$',
      amount: expectedAmount.toFixed(2),
      half_amount: (order.total_price / 2).toFixed(2)
    }, req.io);

    return res.status(201).json({
      success: true,
      message: `${actualPaymentType === '50_percent' ? '50%' : 'Final'} payment receipt uploaded successfully. Awaiting verification.`,
      data: {
        payment_id: paymentId,
        payment_type: actualPaymentType,
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
