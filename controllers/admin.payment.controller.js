const db = require('../config/db');
const { sendMail } = require('../utils/mailer');
const fs = require('fs');
const path = require('path');
const { logAction } = require('../utils/logger');

/**
 * PAYMENT VERIFICATION CONTROLLER
 * Only admin can verify payments - critical flow
 */

// List all payments with pagination
exports.listPayments = async (req, res) => {
  try {
    const { page = 0, status, dateFrom, dateTo } = req.query;
    const limit = 20;
    const offset = page * limit;

    let whereClause = '1=1';
    let params = [];

    if (status && status !== 'all') {
      whereClause += ' AND p.payment_method = ?';
      params.push(status);
    }

    if (dateFrom) {
      whereClause += ' AND DATE(p.created_at) >= DATE(?)';
      params.push(dateFrom);
    }

    if (dateTo) {
      whereClause += ' AND DATE(p.created_at) <= DATE(?)';
      params.push(dateTo);
    }

    // Fetch payments
    const [payments] = await db.query(
      `SELECT 
        p.payment_id, p.order_id, p.user_id, u.full_name, u.email,
        o.query_code, o.paper_topic as topic, o.total_price,
        p.amount, p.payment_method, p.payment_doc as receipt_filename, p.created_at as uploaded_at
      FROM payments p
      JOIN users u ON p.user_id = u.user_id
      LEFT JOIN orders o ON p.order_id = o.order_id
      WHERE ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Get total count
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM payments p WHERE ${whereClause}`,
      params
    );

    const totalPages = Math.ceil(total / limit);

    res.render('admin/payments/index', {
      title: 'Payment Verification',
      payments,
      page: parseInt(page) + 1,
      pages: totalPages,
      total,
      filters: { status: status || 'all' },
      layout: 'layouts/admin'
    });
  } catch (error) {
    console.error('Error listing payments:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

// View payment receipt
exports.viewPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const [[payment]] = await db.query(
      `SELECT 
        p.payment_id, p.order_id, p.user_id, u.full_name, u.email, u.mobile_number,
        o.order_id as order_full, o.query_code, o.paper_topic as topic, o.total_price, o.status as order_status,
        p.amount, p.payment_method, p.payment_doc as receipt_filename,
        p.created_at as uploaded_at
      FROM payments p
      JOIN users u ON p.user_id = u.user_id
      LEFT JOIN orders o ON p.order_id = o.order_id
      WHERE p.payment_id = ?`,
      [paymentId]
    );

    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    res.json({ success: true, payment });
  } catch (error) {
    console.error('Error viewing payment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Download receipt file
exports.downloadReceipt = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const [[payment]] = await db.query(
      `SELECT payment_doc as receipt_filename FROM payments WHERE payment_id = ?`,
      [paymentId]
    );

    if (!payment || !payment.receipt_filename) {
      return res.status(404).json({ success: false, error: 'Receipt not found' });
    }

    const filePath = path.join(__dirname, '..', 'uploads', payment.receipt_filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    res.download(filePath, payment.receipt_filename);
  } catch (error) {
    console.error('Error downloading receipt:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Verify payment (CRITICAL - Admin only)
exports.verifyPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { verificationStatus, notes } = req.body;

    if (!paymentId || !verificationStatus) {
      return res.status(400).json({ success: false, error: 'Payment ID and verification status required' });
    }

    // Get payment details
    const [[payment]] = await db.query(
      `SELECT 
        p.payment_id, p.order_id, p.user_id, p.amount, p.payment_method, p.payment_type,
        u.full_name, u.email, o.order_id as order_exists, o.total_price, o.status as order_status
      FROM payments p
      JOIN users u ON p.user_id = u.user_id
      LEFT JOIN orders o ON p.order_id = o.order_id
      WHERE p.payment_id = ?`,
      [paymentId]
    );

    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    if (verificationStatus === 'verified') {
      const { updateOrderStatus } = require('../utils/workflow.service');
      const { STATUS } = require('../utils/order-state-machine');

      let newStatus;
      let eventName;
      let workCode = null;

      // Determine next status based on payment type
      if (payment.payment_type === '50_percent') {
        newStatus = STATUS.PARTIAL_PAYMENT_VERIFIED;
        eventName = 'PAYMENT_50_VERIFIED';
      } else if (payment.payment_type === 'final') {
        newStatus = STATUS.PAYMENT_VERIFIED;
        eventName = 'PAYMENT_VERIFIED';
        // Generate work_code for final payment
        workCode = `WC${Date.now()}${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
        
        // Update order with work code
        if (payment.order_exists) {
          await db.query(
            `UPDATE orders SET work_code = ? WHERE order_id = ?`,
            [workCode, payment.order_id]
          );
        }
      } else {
        // Legacy full payment
        newStatus = STATUS.PAYMENT_VERIFIED;
        eventName = 'PAYMENT_VERIFIED';
        workCode = `WC${Date.now()}${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
        
        if (payment.order_exists) {
          await db.query(
            `UPDATE orders SET work_code = ? WHERE order_id = ?`,
            [workCode, payment.order_id]
          );
        }
      }

      // Update order status
      const statusResult = await updateOrderStatus(
        payment.order_id,
        newStatus,
        'admin',
        {
          userId: req.user.user_id,
          userName: req.user.full_name,
          io: req.io,
          reason: `Payment verified: ${payment.payment_type || 'full'} payment of $${payment.amount}`
        }
      );

      if (!statusResult.success) {
        return res.status(400).json({ success: false, error: statusResult.error });
      }

      // Log action
      await logAction({
        userId: req.user.user_id,
        action: 'payment_verified',
        details: `${payment.payment_type || 'Full'} payment verified. Amount: $${payment.amount}${workCode ? `. Work Code: ${workCode}` : ''}`,
        resource_type: 'order',
        resource_id: payment.order_id || 0,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      // Send payment confirmation email to client
      const paymentLabel = payment.payment_type === '50_percent' ? '50%' : 
                          payment.payment_type === 'final' ? 'final' : 'full';
      
      sendMail({
        to: payment.email,
        subject: `Payment Verified - ${paymentLabel.charAt(0).toUpperCase() + paymentLabel.slice(1)} Payment Confirmed`,
        html: `
          <h2>Payment Verified</h2>
          <p>Hello ${payment.full_name},</p>
          <p>Your ${paymentLabel} payment of $${payment.amount} has been verified successfully.</p>
          ${workCode ? `<p>Your work code: <strong>${workCode}</strong></p>` : ''}
          ${payment.payment_type === '50_percent' ? '<p>Work will begin shortly. You will be notified when ready for final payment.</p>' : ''}
          ${payment.payment_type === 'final' ? '<p>Your content is now ready for download!</p>' : ''}
          <p>Thank you for your order!</p>
        `
      }).catch(err => console.error('Email error:', err));

      res.json({
        success: true,
        message: `${paymentLabel} payment verified successfully`,
        workCode,
        newStatus: statusResult.newStatus
      });
    } else if (verificationStatus === 'rejected') {
      // Log action
      await logAction({
        userId: req.user.user_id,
        action: 'payment_rejected',
        details: `Payment rejected. Reason: ${notes || 'N/A'}`,
        resource_type: 'order',
        resource_id: payment.order_id || 0,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });


      // Send rejection email to client
      sendMail({
        to: payment.email,
        subject: 'Payment Verification Failed - Please Resubmit',
        html: `
          <h2>Payment Verification Failed</h2>
          <p>Hello ${payment.full_name},</p>
          <p>Unfortunately, your payment could not be verified.</p>
          <p>Reason: ${notes || 'Receipt does not meet verification criteria'}</p>
          <p>Please correct the issue and resubmit your payment receipt.</p>
        `
      }).catch(err => console.error('Email error:', err));

      res.json({
        success: true,
        message: 'Payment rejected. Client has been notified'
      });
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Mark payment as completed
exports.updatePaymentStage = async (req, res) => {
  try {
    const { paymentId } = req.params;

    if (!paymentId) {
      return res.status(400).json({ success: false, error: 'Payment ID required' });
    }

    // Get payment details
    const [[payment]] = await db.query(
      `SELECT p.payment_id, p.order_id, p.user_id, u.email, u.full_name
       FROM payments p
       JOIN users u ON p.user_id = u.user_id
       WHERE p.payment_id = ?`,
      [paymentId]
    );

    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    // Log action
    await logAction({
        userId: req.user.user_id,
        action: 'payment_completed',
        details: `Payment completed and processed`,
        resource_type: 'order',
        resource_id: payment.order_id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });


    // Send notification email
    sendMail({
      to: payment.email,
      subject: 'Payment Completed',
      html: `
        <h2>Payment Completed</h2>
        <p>Hello ${payment.full_name},</p>
        <p>Your payment has been received and fully processed.</p>
        <p>Thank you for your order!</p>
      `
    }).catch(err => console.error('Email error:', err));

    res.json({
      success: true,
      message: 'Payment completed successfully'
    });
  } catch (error) {
    console.error('Error updating payment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
