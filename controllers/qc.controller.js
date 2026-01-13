const db = require('../config/db');
const { logAction } = require('../utils/logger');
const { sendMail } = require('../utils/mailer');

/**
 * QC CONTROLLER
 * Manage submissions QC with proper user JOINs
 */

// List submissions pending QC
exports.listPendingQC = async (req, res) => {
  try {
    const { page = 0, status, dateFrom, dateTo } = req.query;
    const limit = 20;
    const offset = page * limit;

    let whereClause = '1=1';
    let params = [];

    if (status && status !== 'all') {
      whereClause += ' AND s.status = ?';
      params.push(status);
    } else {
      whereClause += ' AND s.status = ?';
      params.push('pending_qc');
    }

    if (dateFrom) {
      whereClause += ' AND DATE(s.created_at) >= DATE(?)';
      params.push(dateFrom);
    }

    if (dateTo) {
      whereClause += ' AND DATE(s.created_at) <= DATE(?)';
      params.push(dateTo);
    }

    // Fetch submissions with full user details
    const [submissions] = await db.query(
      `SELECT 
        s.submission_id, s.order_id, s.writer_id,
        w.full_name as writer_name, w.email as writer_email,
        o.query_code, o.paper_topic as topic, o.deadline_at,
        u.full_name as client_name, u.email as client_email,
        s.grammarly_score, s.ai_score, s.plagiarism_score,
        s.status, s.feedback, s.created_at
      FROM submissions s
      JOIN users w ON s.writer_id = w.user_id
      LEFT JOIN orders o ON s.order_id = o.order_id
      LEFT JOIN users u ON o.user_id = u.user_id
      WHERE ${whereClause}
      ORDER BY s.created_at ASC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Get total count
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM submissions s WHERE ${whereClause}`,
      params
    );

    const totalPages = Math.ceil(total / limit);

    res.render('admin/qc/index', {
      title: 'QC Review',
      page: parseInt(page) + 1,
      pages: totalPages,
      total: total,
      filters: { status: status || 'pending_qc' },
      records: submissions,
      currentPage: 'qc',
      layout: 'layouts/admin'
    });
  } catch (error) {
    console.error('Error listing pending QC:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

// Get QC details for a submission
exports.getQCDetail = async (req, res) => {
  try {
    const { submissionId } = req.params;

    // Get submission details
    const [[submission]] = await db.query(
      `SELECT 
        s.submission_id, s.order_id, s.writer_id, u.full_name as writer_name, u.email as writer_email,
        o.query_code, o.paper_topic, o.deadline_at, o.user_id, c.full_name as client_name, c.email as client_email,
        s.status, s.created_at, s.file_url, s.feedback, s.grammarly_score, s.ai_score, s.plagiarism_score
      FROM submissions s
      JOIN users u ON s.writer_id = u.user_id
      JOIN orders o ON s.order_id = o.order_id
      JOIN users c ON o.user_id = c.user_id
      WHERE s.submission_id = ?`,
      [submissionId]
    );

    if (!submission) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }

    // Get previous submissions for this order
    const [previousSubmissions] = await db.query(
      `SELECT 
        submission_id, status, created_at, file_url
      FROM submissions
      WHERE order_id = ? AND submission_id != ?
      ORDER BY created_at DESC`,
      [submission.order_id, submissionId]
    );

    res.json({
      success: true,
      submission,
      previousSubmissions
    });
  } catch (error) {
    console.error('Error getting QC detail:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Approve submission (QC Pass)
exports.approveSubmission = async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { feedback } = req.body;

    // Get submission details
    const [[submission]] = await db.query(
      `SELECT 
        s.submission_id, s.order_id, s.writer_id, u.full_name as writer_name, u.email as writer_email,
        o.query_code, o.paper_topic, o.user_id, c.full_name as client_name, c.email as client_email
      FROM submissions s
      JOIN users u ON s.writer_id = u.user_id
      JOIN orders o ON s.order_id = o.order_id
      JOIN users c ON o.user_id = c.user_id
      WHERE s.submission_id = ?`,
      [submissionId]
    );

    if (!submission) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }

    // Update submission status
    await db.query(
      `UPDATE submissions SET status = 'approved', feedback = ?, updated_at = NOW() WHERE submission_id = ?`,
      [feedback || 'Approved', submissionId]
    );

    // Log action
    await logAction({
        userId: req.user.user_id,
        action: 'qc_approved',
        details: `QC approved. Feedback: ${feedback || 'N/A'}`,
        resource_type: 'order',
        resource_id: submission.order_id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });


    // Notify writer
    sendMail({
      to: submission.writer_email,
      subject: `Your Submission Approved - ${submission.paper_topic}`,
      html: `
        <h2>Submission Approved</h2>
        <p>Hello ${submission.writer_name},</p>
        <p>Congratulations! Your submission has been approved.</p>
        <p>Feedback: ${feedback || 'Your work meets our quality standards'}</p>
        <p>Thank you!</p>
      `
    }).catch(err => console.error('Email error:', err));

    res.json({
      success: true,
      message: 'Submission approved successfully'
    });
  } catch (error) {
    console.error('Error approving submission:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Reject submission and send back to writer
exports.rejectSubmission = async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { feedback } = req.body;

    if (!feedback) {
      return res.status(400).json({ success: false, error: 'Feedback required for rejection' });
    }

    // Get submission details
    const [[submission]] = await db.query(
      `SELECT 
        s.submission_id, s.order_id, s.writer_id, u.full_name as writer_name, u.email as writer_email,
        o.query_code, o.paper_topic, o.user_id, c.full_name as client_name, c.email as client_email
      FROM submissions s
      JOIN users u ON s.writer_id = u.user_id
      JOIN orders o ON s.order_id = o.order_id
      JOIN users c ON o.user_id = c.user_id
      WHERE s.submission_id = ?`,
      [submissionId]
    );

    if (!submission) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }

    // Update submission status
    await db.query(
      `UPDATE submissions SET status = 'revision_required', feedback = ?, updated_at = NOW() WHERE submission_id = ?`,
      [feedback, submissionId]
    );

    // Log action
    await logAction({
        userId: req.user.user_id,
        action: 'qc_rejected',
        details: `QC rejected. Reason: ${feedback}`,
        resource_type: 'order',
        resource_id: submission.order_id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });


    // Notify writer
    sendMail({
      to: submission.writer_email,
      subject: `Submission Revision Required - ${submission.paper_topic}`,
      html: `
        <h2>Revision Required</h2>
        <p>Hello ${submission.writer_name},</p>
        <p>Your submission requires revision.</p>
        <p>Feedback: ${feedback}</p>
        <p>Please revise and resubmit your work.</p>
      `
    }).catch(err => console.error('Email error:', err));

    res.json({
      success: true,
      message: 'Submission rejected. Writer has been notified'
    });
  } catch (error) {
    console.error('Error rejecting submission:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get QC statistics
exports.getQCStatistics = async (req, res) => {
  try {
    // Overall stats
    const [[stats]] = await db.query(
      `SELECT 
        COUNT(CASE WHEN status = 'pending_qc' THEN 1 END) as pending_qc,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
        COUNT(CASE WHEN status = 'revision_required' THEN 1 END) as revision_required,
        COUNT(CASE WHEN DATE(created_at) = CURDATE() THEN 1 END) as today_submissions
      FROM submissions`,
      []
    );

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error getting QC statistics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
