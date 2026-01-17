const db = require('../config/db');
const { sendMail } = require('../utils/mailer');
const fs = require('fs');
const path = require('path');
const { logAction } = require('../utils/logger');

/**
 * DELIVERY CONTROLLER
 * Handles final delivery to client and order closure
 */

exports.listReadyForDelivery = async (req, res) => {
  try {
    const [submissions] = await db.query(
      `SELECT 
        s.submission_id, s.order_id, s.writer_id, u.full_name as writer_name,
        o.query_code, o.paper_topic, c.full_name as client_name, c.email as client_email,
        s.created_at, s.file_url, s.status, o.status as order_status
      FROM submissions s
      JOIN users u ON s.writer_id = u.user_id
      JOIN orders o ON s.order_id = o.order_id
      JOIN users c ON o.user_id = c.user_id
      WHERE s.status = 'approved'
      ORDER BY s.created_at ASC`,
      []
    );

    res.render('admin/delivery/index', {
      title: 'Ready for Delivery',
      submissions,
      page: 1,
      pages: 1,
      total: submissions.length,
      filters: {},
      currentPage: 'delivery',
      layout: 'layouts/admin'
    });
  } catch (error) {
    console.error('Error listing delivery submissions:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

exports.deliverFile = async (req, res) => {
  try {
    const { submissionId } = req.params;

    const [[submission]] = await db.query(
      `SELECT 
        s.submission_id, s.order_id, s.file_url,
        o.user_id, c.full_name as client_name, c.email as client_email,
        o.paper_topic
      FROM submissions s
      JOIN orders o ON s.order_id = o.order_id
      JOIN users c ON o.user_id = c.user_id
      WHERE s.submission_id = ?`,
      [submissionId]
    );

    if (!submission) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }

    const filePath = path.join(__dirname, '..', 'uploads', submission.file_url);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    // Update submission status
    await db.query(
      `UPDATE submissions SET status = 'completed', updated_at = NOW() WHERE submission_id = ?`,
      [submissionId]
    );

    // Log action
    await logAction({
        userId: req.user.user_id,
        action: 'file_delivered',
        details: 'File delivered to client',
        resource_type: 'order',
        resource_id: submission.order_id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });


    // Send delivery email
    sendMail({
      to: submission.client_email,
      subject: `Your Completed Order - ${submission.paper_topic}`,
      html: `
        <h2>Your Order is Ready</h2>
        <p>Hello ${submission.client_name},</p>
        <p>Your order has been completed: <strong>${submission.paper_topic}</strong></p>
        <p>You can now download your file from your dashboard.</p>
        <p>Thank you!</p>
      `
    }).catch(err => console.error('Email error:', err));

    res.download(filePath, submission.file_url);
  } catch (error) {
    console.error('Error delivering file:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.completeOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { notes } = req.body;

    const [[order]] = await db.query(
      `SELECT order_id, user_id, work_code, paper_topic FROM orders WHERE order_id = ?`,
      [orderId]
    );

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Update order status (37 - Delivered)
    await db.query(
      `UPDATE orders SET status = 37 WHERE order_id = ?`,
      [orderId]
    );

    // Mark all submissions as completed
    await db.query(
      `UPDATE submissions SET status = 'completed', updated_at = NOW() WHERE order_id = ?`,
      [orderId]
    );

    // Log action
    await logAction({
        userId: req.user.user_id,
        action: 'order_completed',
        details: `Order completed. Notes: ${notes || 'N/A'}`,
        resource_type: 'order',
        resource_id: orderId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });


    // Get client email
    const [[client]] = await db.query(
      `SELECT email, full_name FROM users WHERE user_id = ?`,
      [order.user_id]
    );

    // Send completion email
    if (client) {
      sendMail({
        to: client.email,
        subject: `Order Complete - ${order.paper_topic}`,
        html: `
          <h2>Order Completed</h2>
          <p>Hello ${client.full_name},</p>
          <p>Your order has been completed: <strong>${order.paper_topic}</strong></p>
          <p>You can now download your file from your dashboard.</p>
          <p>Thank you!</p>
        `
      }).catch(err => console.error('Email error:', err));
    }

    res.json({ success: true, message: 'Order completed successfully' });
  } catch (error) {
    console.error('Error completing order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.requestRevision = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    const [[order]] = await db.query(
      `SELECT order_id, user_id, paper_topic FROM orders WHERE order_id = ?`,
      [orderId]
    );

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Create revision request
    await db.query(
      `INSERT INTO revision_requests (order_id, requested_by, reason, status, created_at)
       VALUES (?, ?, ?, 'pending', NOW())`,
      [String(orderId), req.user.user_id, reason || 'Revision requested']
    );

    // Update order status (36 - Revision Required)
    await db.query(
      `UPDATE orders SET status = 36 WHERE order_id = ?`,
      [orderId]
    );

    // Log action
    await logAction({
        userId: req.user.user_id,
        action: 'revision_requested',
        details: `Revision requested: ${reason || 'Client requested changes'}`,
        resource_type: 'order',
        resource_id: orderId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    res.json({ success: true, message: 'Revision requested successfully' });
  } catch (error) {
    console.error('Error requesting revision:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getDeliveryHistory = async (req, res) => {
  try {
    const { orderId } = req.params;

    const [history] = await db.query(
      `SELECT 
        submission_id, order_id, writer_id, file_url, status, created_at, updated_at
      FROM submissions
      WHERE order_id = ?
      ORDER BY created_at DESC`,
      [orderId]
    );

    res.json({ success: true, history });
  } catch (error) {
    console.error('Error getting delivery history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
