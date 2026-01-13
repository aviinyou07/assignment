const db = require('../config/db');
const { sendMail } = require('../utils/mailer');
const { logAction } = require('../utils/logger');

/**
 * QUERY MANAGEMENT CONTROLLER
 * Handles all query operations: listing, viewing, assigning writers, generating quotations
 */

// List all queries with pagination and filters
exports.listQueries = async (req, res) => {
  try {
    const { page = 0, status, dateFrom, dateTo } = req.query;
    const limit = 20;
    const offset = page * limit;

    let whereClause = '1=1';
    let params = [];

    if (status && status !== 'all') {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }

    if (dateFrom) {
      whereClause += ' AND DATE(o.created_at) >= DATE(?)';
      params.push(dateFrom);
    }

    if (dateTo) {
      whereClause += ' AND DATE(o.created_at) <= DATE(?)';
      params.push(dateTo);
    }

    // Fetch orders (queries)
    const [queries] = await db.query(
      `SELECT 
        o.order_id , o.query_code, o.user_id, u.full_name, u.email, u.mobile_number,
        o.paper_topic, o.urgency, o.deadline_at as deadline, o.status, o.created_at
      FROM orders o
      JOIN users u ON o.user_id = u.user_id
      WHERE ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    console.log(queries);

    // Get total count
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM orders o WHERE ${whereClause}`,
      params
    );

    const totalPages = Math.ceil(total / limit);

    res.render('admin/queries/index', {
      title: 'Query Management',
      queries,
      page: parseInt(page) + 1,
      pages: totalPages,
      total,
      filters: { status: status || 'all' },
      layout: 'layouts/admin'
    });
  } catch (error) {
    console.error('Error listing queries:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

// View single query with details
exports.viewQuery = async (req, res) => {
  try {
    const { queryId } = req.params;


    // Get order details (query)
    const [[query]] = await db.query(
      `SELECT 
        o.order_id, o.query_code, o.query_code as order_code, o.user_id, u.full_name, u.email, u.mobile_number, u.university,
        o.paper_topic, o.paper_topic as topic, o.description, o.service, o.subject, o.urgency, 
        o.deadline_at as deadline, o.status, o.created_at,
        o.basic_price_usd, o.discount_usd, o.total_price_usd
      FROM orders o
      JOIN users u ON o.user_id = u.user_id
      WHERE o.order_id = ?`,
      [queryId]
    );

    if (!query) {
      return res.status(404).render('errors/404', { title: 'Query Not Found', layout: false });
    }

    // Get assigned writers (from task_evaluations)
    const [assignedWriters] = await db.query(
      `SELECT 
        te.id, te.writer_id, u.full_name, u.email, te.created_at as assigned_at, te.status, te.comment as notes
      FROM task_evaluations te
      JOIN users u ON te.writer_id = u.user_id
      WHERE te.order_id = ?
      ORDER BY te.created_at DESC`,
      [queryId]
    );

    res.render('admin/queries/view', {
      title: `Query ${query.query_code}`,
      query,
      documents: [],
      assignedWriters,
      quotations: [],
      layout: 'layouts/admin'
    });
  } catch (error) {
    console.error('Error viewing query:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

// Get available writers for assignment
exports.getAvailableWriters = async (req, res) => {
  try {
    const [writers] = await db.query(
      `SELECT 
        user_id, full_name, email, role, is_active
      FROM users
      WHERE role = 'writer' AND is_active = 1
      ORDER BY full_name ASC`,
      []
    );

    res.json({ success: true, writers });
  } catch (error) {
    console.error('Error fetching writers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Assign writers to a query (order)
exports.assignWriters = async (req, res) => {
  try {
    const { queryId, writerIds, notes } = req.body;

    if (!queryId || !writerIds || writerIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Query ID and writer IDs required' });
    }

    // Check if order exists
    const [[query]] = await db.query(
      `SELECT order_id, user_id, paper_topic, query_code FROM orders WHERE order_id = ?`,
      [queryId]
    );

    if (!query) {
      return res.status(404).json({ success: false, error: 'Query not found' });
    }

    // Assign writers via task_evaluations
    const assignmentPromises = writerIds.map(writerId => {
      return db.query(
        `INSERT INTO task_evaluations (order_id, writer_id, status, comment, created_at)
         VALUES (?, ?, 'pending', ?, NOW())
         ON DUPLICATE KEY UPDATE status = 'pending', comment = ?`,
        [queryId, writerId, notes || '', notes || '']
      );
    });

    await Promise.all(assignmentPromises);

    // Log action
    await logAction({
        userId: req.user.user_id,
        action: 'assign_writers',
        details: `Assigned ${writerIds.length} writer(s) to order`,
        resource_type: 'order',
        resource_id: queryId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });


    // Send notification emails to writers
    const [writers] = await db.query(
      `SELECT user_id, full_name, email FROM users WHERE user_id IN (?)`,
      [writerIds]
    );

    if (writers && writers.length > 0) {
        writers.forEach(writer => {
            sendMail({
                to: writer.email,
                subject: `New Assignment: ${query.paper_topic}`,
                html: `
                    <p>Hi ${writer.full_name},</p>
                    <p>You have a new assignment: ${query.paper_topic}</p>
                    <p>Query Code: ${query.query_code || 'N/A'}</p>
                    <p>Notes: ${notes || 'No additional notes'}</p>
                `
            }).catch(err => console.error('Email error:', err));
        });
    }


    res.json({
      success: true,
      message: `${writerIds.length} writer(s) assigned successfully`
    });
  } catch (error) {
    console.error('Error assigning writers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Generate quotation for query (order)
exports.generateQuotation = async (req, res) => {
  try {
    const { queryId, basePrice, urgencyCharge, notes } = req.body;

    if (!queryId || !basePrice) {
      return res.status(400).json({ success: false, error: 'Query ID and base price required' });
    }

    // Get order details
    const [[query]] = await db.query(
      `SELECT order_id, user_id, query_code, paper_topic FROM orders WHERE order_id = ?`,
      [queryId]
    );

    if (!query) {
      return res.status(404).json({ success: false, error: 'Query not found' });
    }

    const totalPrice = parseFloat(basePrice) + (parseFloat(urgencyCharge) || 0);

    // Create quotation
    const [result] = await db.query(
      `INSERT INTO quotations (order_id, user_id, quoted_price_usd, notes, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [queryId, query.user_id, totalPrice, notes || '']
    );

    // Update order status to reflect quotation sent
    await db.query(
      `UPDATE orders SET status = 2 WHERE order_id = ?`,
      [queryId]
    );

    // Send quotation email to client
    const [[client]] = await db.query(
      `SELECT email, full_name FROM users WHERE user_id = ?`,
      [query.user_id]
    );

    if (client) {
      sendMail({
        to: client.email,
        subject: `Quotation for Your Order: ${query.paper_topic}`,
        html: `
            <p>Hi ${client.full_name},</p>
            <p>Here is the quotation for your query: ${query.paper_topic}</p>
            <p>Query Code: ${query.query_code}</p>
            <p>Base Price: ${basePrice}</p>
            <p>Urgency Charge: ${urgencyCharge || 0}</p>
            <p>Total Price: ${totalPrice}</p>
            <p>Notes: ${notes || ''}</p>
        `
      }).catch(err => console.error('Email error:', err));
    }

    // Log action
    await logAction({
        userId: req.user.user_id,
        action: 'quotation_generated',
        details: `Generated quotation for ${totalPrice} USD`,
        resource_type: 'order',
        resource_id: queryId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });


    res.json({
      success: true,
      message: 'Quotation generated and sent to client',
      quotationId: result.insertId
    });
  } catch (error) {
    console.error('Error generating quotation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update query status
exports.updateQueryStatus = async (req, res) => {
  try {
    const { queryId } = req.params;
    const { status, notes } = req.body;

    if (!queryId || !status) {
      return res.status(400).json({ success: false, error: 'Query ID and status required' });
    }

    // Get query details for notifications
    const [[query]] = await db.query(
      `SELECT order_id, user_id, query_code, paper_topic, status as oldStatus FROM orders WHERE order_id = ?`,
      [queryId]
    );

    if (!query) {
      return res.status(404).json({ success: false, error: 'Query not found' });
    }

    // Update status
    await db.query(
      `UPDATE orders SET status = ? WHERE order_id = ?`,
      [status, queryId]
    );

    // Log action
    await logAction({
        userId: req.user.user_id,
        action: 'query_status_update',
        details: `Status updated from ${query.oldStatus} to ${status}. Notes: ${notes || 'N/A'}`,
        resource_type: 'order',
        resource_id: queryId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });


    // Send notification to client if status changed significantly
    const [[client]] = await db.query(
      `SELECT email, full_name FROM users WHERE user_id = ?`,
      [query.user_id]
    );

    if (client && ['closed', 'failed', 'quotation_sent'].includes(status)) {
      sendMail({
        to: client.email,
        subject: `Update on Your Query: ${query.paper_topic}`,
        html: `
            <p>Hi ${client.full_name},</p>
            <p>There is an update on your query: ${query.query_code}</p>
            <p>New Status: ${status}</p>
            <p>Notes: ${notes || 'No additional information'}</p>
        `
      }).catch(err => console.error('Email error:', err));
    }

    res.json({
      success: true,
      message: `Query status updated to ${status}`
    });
  } catch (error) {
    console.error('Error updating query status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Reassign writer on rejection
exports.reassignWriter = async (req, res) => {
  try {
    const { taskEvalId, newWriterId } = req.body;

    if (!taskEvalId || !newWriterId) {
      return res.status(400).json({ success: false, error: 'Task Evaluation ID and new writer ID required' });
    }

    // Get the original query assignment
    const [[assignment]] = await db.query(
      `SELECT te.*, o.query_code, o.paper_topic FROM task_evaluations te
       JOIN orders o ON te.order_id = o.order_id
       WHERE te.id = ?`,
      [taskEvalId]
    );

    if (!assignment) {
      return res.status(404).json({ success: false, error: 'Assignment not found' });
    }

    // Update old assignment to rejected
    await db.query(
      `UPDATE task_evaluations SET status = 'not_doable', comment = 'Reassigned by admin' WHERE id = ?`,
      [taskEvalId]
    );

    // Create new assignment
    await db.query(
      `INSERT INTO task_evaluations (order_id, writer_id, status, comment, created_at)
       VALUES (?, ?, 'pending', 'Reassigned after rejection', NOW())`,
      [assignment.order_id, newWriterId]
    );

    // Log action
    await logAction({
        userId: req.user.user_id,
        action: 'query_reassign_writer',
        details: `Writer reassigned for query: ${assignment.query_code}`,
        resource_type: 'order',
        resource_id: assignment.order_id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });


    res.json({
      success: true,
      message: 'Writer reassigned successfully'
    });
  } catch (error) {
    console.error('Error reassigning writer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Send message to client
exports.sendMessageToClient = async (req, res) => {
  try {
    const { queryId } = req.params;
    const { userId, subject, message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    // Get client details
    const [[client]] = await db.query(
      `SELECT user_id, email, full_name FROM users WHERE user_id = ?`,
      [userId]
    );

    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    // Get query details
    const [[query]] = await db.query(
      `SELECT order_id, query_code, paper_topic FROM orders WHERE order_id = ?`,
      [queryId]
    );

    // Send email
    await sendMail({
      to: client.email,
      subject: subject || `Message regarding your query`,
      html: `
        <p>Hi ${client.full_name},</p>
        <p>${message.replace(/\n/g, '<br>')}</p>
        ${query ? `<p><small>Reference: ${query.query_code}</small></p>` : ''}
        <p>Best regards,<br>Admin Team</p>
      `
    });

    // Log action
    await logAction({
      userId: req.user.user_id,
      action: 'message_sent',
      details: `Message sent to client: ${client.email}`,
      resource_type: 'order',
      resource_id: queryId,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Message sent successfully'
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
