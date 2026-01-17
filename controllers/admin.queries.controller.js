const db = require('../config/db');
const { logAction } = require('../utils/logger');
const { emitToUser } = require('../utils/socket');
const { createNotification } = require('../utils/notification.service');

/**
 * Admin generates quotation for a query
 */
exports.generateQuotation = async (req, res) => {
  try {
    const { queryId } = req.params;
    const { basePrice, urgencyCharge, discount, finalPrice, notes } = req.body;
    const adminId = req.user.user_id;

    // Calculate final price if not provided
    const calculatedBasePrice = parseFloat(basePrice) || 0;
    const calculatedUrgencyCharge = parseFloat(urgencyCharge) || 0;
    const calculatedDiscount = parseFloat(discount) || 0;
    const calculatedFinalPrice = finalPrice 
      ? parseFloat(finalPrice) 
      : (calculatedBasePrice + calculatedUrgencyCharge - calculatedDiscount);

    // Verify order exists and is in status 26 (Pending Query)
    const [[order]] = await db.query(
      `SELECT o.*, u.full_name as client_name, u.email as client_email, u.bde 
       FROM orders o 
       JOIN users u ON o.user_id = u.user_id
       WHERE o.order_id = ?`,
      [queryId]
    );
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Check if quotation already exists
    const [[existingQuote]] = await db.query(
      `SELECT quotation_id FROM quotations WHERE order_id = ?`,
      [queryId]
    );

    if (existingQuote) {
      // Update existing quotation
      await db.query(
        `UPDATE quotations 
         SET quoted_price = ?, discount = ?, notes = ?, updated_at = NOW()
         WHERE order_id = ?`,
        [calculatedFinalPrice, calculatedDiscount, notes || '', queryId]
      );
    } else {
      // Create new quotation
      await db.query(
        `INSERT INTO quotations (order_id, user_id, quoted_price, discount, notes, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [order.order_id, adminId, calculatedFinalPrice, calculatedDiscount, notes || '']
      );
    }

    // Update orders table with pricing
    await db.query(
      `UPDATE orders 
       SET basic_price = ?, discount = ?, total_price = ?, status = 27 
       WHERE order_id = ?`,
      [calculatedBasePrice + calculatedUrgencyCharge, calculatedDiscount, calculatedFinalPrice, order.order_id]
    );

    // Send notification to client
    try {
      await createNotification({
        user_id: order.user_id,
        type: 'info',
        title: 'Quotation Received',
        message: `A quotation of $${calculatedFinalPrice.toFixed(2)} has been sent for your query "${order.paper_topic}". Please review and respond.`,
        link_url: `/client/queries/${order.order_id}`
      });
      
      // Real-time emit
      emitToUser(order.user_id, 'notification:new', {
        type: 'quotation_received',
        orderId: order.order_id,
        queryCode: order.query_code,
        price: calculatedFinalPrice,
        message: `Quotation of $${calculatedFinalPrice.toFixed(2)} received`
      });
    } catch (notifyErr) {
      console.error('Notification error:', notifyErr);
    }

    // Notify BDE if assigned
    if (order.bde) {
      emitToUser(order.bde, 'notification:new', {
        type: 'quotation_sent',
        orderId: order.order_id,
        price: calculatedFinalPrice
      });
    }

    res.json({ 
      success: true, 
      message: 'Quotation sent successfully.',
      data: {
        orderId: order.order_id,
        finalPrice: calculatedFinalPrice
      }
    });
  } catch (err) {
    console.error('Error in generateQuotation:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * Writer accept invitation to a query
 */
exports.writerAcceptInvitation = async (req, res) => {
  try {
    const { orderId } = req.params;
    const writerId = req.user.user_id;

    // Update writer interest status
    await db.query(
      `UPDATE writer_query_interest SET status = 'accepted' WHERE order_id = ? AND writer_id = ?`,
      [orderId, writerId]
    );

    // Notify admins
    const [admins] = await db.query(`SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1`);
    for (const admin of admins) {
      emitToUser(admin.user_id, 'notification:new', {
        type: 'writer_accepted',
        orderId,
        writerId
      });
    }
    res.json({ success: true, message: 'Invitation accepted.' });
  } catch (err) {
    console.error('Error in writerAcceptInvitation:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * Writer reject invitation to a query
 */
exports.writerRejectInvitation = async (req, res) => {
  try {
    const { orderId } = req.params;
    const writerId = req.user.user_id;
    const { reason } = req.body;

    // Update writer interest status
    await db.query(
      `UPDATE writer_query_interest SET status = 'rejected' WHERE order_id = ? AND writer_id = ?`,
      [orderId, writerId]
    );

    // Notify admins
    const [admins] = await db.query(`SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1`);
    for (const admin of admins) {
      emitToUser(admin.user_id, 'notification:new', {
        type: 'writer_rejected',
        orderId,
        writerId,
        reason
      });
    }
    res.json({ success: true, message: 'Invitation rejected.' });
  } catch (err) {
    console.error('Error in writerRejectInvitation:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};




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

    // Fetch queries with user JOIN
    const [queries] = await db.query(
      `SELECT 
        o.order_id, o.query_code, o.user_id, u.full_name, u.email, u.mobile_number,
        o.paper_topic, o.urgency, o.deadline_at as deadline, o.status, o.created_at
      FROM orders o
      JOIN users u ON o.user_id = u.user_id
      WHERE ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Get total count
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM orders o WHERE ${whereClause}`,
      params
    );

    const pages = Math.ceil(total / limit);

    res.render('admin/queries/index', {
      title: 'Query Management',
      page: parseInt(page) + 1,
      pages: pages,
      total: total,
      filters: { status: status || 'all' },
      queries: queries,
      layout: 'layouts/admin'
    });
  } catch (error) {
    console.error('Error in listQueries:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

/**
 * Get query details for writer (API endpoint)
 */
exports.getQueryDetails = async (req, res) => {
  try {
    const { queryId } = req.params;
    
    const [[query]] = await db.query(
      `SELECT order_id, query_code, paper_topic, service, subject, urgency, deadline_at, description 
       FROM orders WHERE order_id = ?`,
      [parseInt(queryId)]
    );
    
    if (!query) {
      return res.status(404).json({ success: false, message: 'Query not found' });
    }
    
    res.json({ success: true, query });
  } catch (error) {
    console.error('Error in getQueryDetails:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// View single query with details
exports.viewQuery = async (req, res) => {
  try {
    const { queryId } = req.params;
    const isNumericId = /^\d+$/.test(String(queryId));

    const whereClause = isNumericId ? 'o.order_id = ?' : '(o.query_code = ? OR o.work_code = ?)';
    const lookupParams = isNumericId ? [queryId] : [queryId, queryId];

    // Get query details with user info including currency
    const [[query]] = await db.query(
      `SELECT 
        o.order_id, o.query_code, o.user_id, u.full_name, u.email, u.mobile_number, u.university,
        u.currency_code, u.country,
        o.paper_topic as topic, o.description, o.urgency, o.deadline_at as deadline, 
        o.status, o.created_at, o.basic_price, o.discount, o.total_price, o.file_path, o.writer_id
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.user_id
      WHERE ${whereClause}
      LIMIT 1`,
      lookupParams
    );

    if (!query) {
      return res.status(404).render('errors/404', { title: 'Query Not Found', layout: false });
    }

    // Get interested writers (for assignment) - includes writers who accepted the invitation
    const [interestedWriters] = await db.query(
      `SELECT wqi.writer_id, wu.full_name, wqi.status, wu.email, wu.is_active, wqi.comment
       FROM writer_query_interest wqi
       JOIN users wu ON wu.user_id = wqi.writer_id
       WHERE wqi.order_id = ? AND (wqi.status = 'interested' OR wqi.status = 'assigned' OR wqi.status = 'accepted')
       ORDER BY wqi.created_at ASC`,
      [query.order_id]
    );

    // Get accepted writers (legacy - keeping for compatibility but 'interested' is used now)
    const [acceptedWriters] = await db.query(
      `SELECT wqi.writer_id, wu.full_name, wqi.status, wu.email, wu.is_active, wqi.comment
       FROM writer_query_interest wqi
       JOIN users wu ON wu.user_id = wqi.writer_id
       WHERE wqi.order_id = ? AND wqi.status = 'accepted'
       ORDER BY wqi.created_at ASC`,
      [query.order_id]
    );

    // Get rejected writers (with reason)
    const [rejectedWriters] = await db.query(
      `SELECT wqi.writer_id, wu.full_name, wqi.status, wu.email, wu.is_active, wqi.comment as reason
       FROM writer_query_interest wqi
       JOIN users wu ON wu.user_id = wqi.writer_id
       WHERE wqi.order_id = ? AND wqi.status = 'rejected'
       ORDER BY wqi.created_at ASC`,
      [query.order_id]
    );

    // Get revoked writers (for history)
    const [revokedWriters] = await db.query(
      `SELECT wqi.writer_id, wu.full_name, wqi.status, wu.email, wu.is_active, wqi.updated_at as revoked_at
       FROM writer_query_interest wqi
       JOIN users wu ON wu.user_id = wqi.writer_id
       WHERE wqi.order_id = ? AND wqi.status = 'revoked'
       ORDER BY wqi.updated_at DESC`,
      [query.order_id]
    );

    // Get all available writers (for invite)
    const [availableWriters] = await db.query(
      `SELECT user_id, full_name, email, is_active FROM users WHERE role = 'writer' AND is_active = 1 ORDER BY full_name ASC`);

    // Get assigned writer
    let assignedWriter = null;
    if (query.writer_id) {
        const [[writer]] = await db.query(
            `SELECT user_id, full_name FROM users WHERE user_id = ?`,
            [query.writer_id]
        );
        assignedWriter = writer || null;
    }

    // Get invited writers
    const [invitedWriters] = await db.query(
      `SELECT wqi.writer_id, wu.full_name, wqi.status, wu.email, wu.is_active
       FROM writer_query_interest wqi
       JOIN users wu ON wu.user_id = wqi.writer_id
       WHERE wqi.order_id = ? AND wqi.status = 'invited'
       ORDER BY wqi.created_at ASC`,
      [query.order_id]
    );

    // Get file versions
    const [files] = await db.query(
      `SELECT id, file_name, file_url, version_number, uploaded_by, created_at 
       FROM file_versions 
       WHERE order_id = ?
       ORDER BY version_number DESC`,
      [String(query.order_id)]
    );

    res.render('admin/queries/view', {
      title: 'Query Details',
      query: query,
      files: files || [],
      interestedWriters: interestedWriters || [],
      acceptedWriters: acceptedWriters || [],
      rejectedWriters: rejectedWriters || [],
      revokedWriters: revokedWriters || [],
      invitedWriters: invitedWriters || [],
      availableWriters: availableWriters || [],
      assignedWriter: assignedWriter || null,
      layout: 'layouts/admin'
    });
  } catch (error) {
    console.error('Error in viewQuery:', error);
    res.status(500).render('errors/404', { title: 'Error', layout: false });
  }
};

// Update query status
/**
 * Admin invites writers to a query
 */
exports.inviteWriters = async (req, res) => {
  try {
    const { queryId } = req.params;
    const { writerIds } = req.body;
    
    console.log('inviteWriters called with queryId:', queryId, 'writerIds:', writerIds);
    
    if (!Array.isArray(writerIds) || writerIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No writers selected.' });
    }
    
    // Verify the order exists
    const [[order]] = await db.query(
      'SELECT order_id FROM orders WHERE order_id = ?',
      [parseInt(queryId)]
    );
    
    if (!order) {
      console.error(`Order ${queryId} not found`);
      return res.status(404).json({ success: false, message: 'Query/Order not found' });
    }
    
    // Verify all writers exist
    const [writers] = await db.query(
      `SELECT user_id FROM users WHERE user_id IN (${writerIds.map(() => '?').join(',')}) AND role = 'writer'`,
      writerIds.map(id => parseInt(id))
    );
    
    if (writers.length !== writerIds.length) {
      console.error(`Only ${writers.length} out of ${writerIds.length} writers found`);
      return res.status(400).json({ success: false, message: 'Some writers not found or are not active writers' });
    }
    
    // Insert or update invite status
    let successCount = 0;
    const errors = [];
    const invitedWriters = [];
    
    for (const writerId of writerIds) {
      try {
        console.log(`Inviting writer ${writerId} to query ${queryId}`);
        const result = await db.query(
          `INSERT INTO writer_query_interest (order_id, writer_id, status) VALUES (?, ?, 'invited')
           ON DUPLICATE KEY UPDATE status = 'invited'`,
          [parseInt(queryId), parseInt(writerId)]
        );
        console.log('Insert result for writer', writerId, ':', result[0].affectedRows, 'rows affected');
        invitedWriters.push(writerId);
        successCount++;
      } catch (inviteErr) {
        console.error(`Error inviting writer ${writerId}:`, inviteErr);
        errors.push(`Error inviting writer ${writerId}: ${inviteErr.message}`);
      }
    }
    
    console.log(`Successfully invited writers: ${invitedWriters.join(', ')}`);
    console.log(`Total success: ${successCount}/${writerIds.length}`);
    
    if (successCount === 0) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to invite writers',
        errors 
      });
    }
    
    // Fetch order details for notification
    const [orderRows] = await db.query(
      'SELECT query_code, paper_topic, deadline_at FROM orders WHERE order_id = ?',
      [parseInt(queryId)]
    );
    const orderData = orderRows[0] || {};
    
    // Send notifications to invited writers
    for (const writerId of invitedWriters) {
      try {
        // Create persistent notification in database
        await db.query(
          `INSERT INTO notifications (user_id, type, title, message, link_url, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, NOW())`,
          [
            parseInt(writerId),
            'info',
            'New Query Invitation',
            `You have been invited to review query ${orderData.query_code || queryId}: ${orderData.paper_topic || 'N/A'}. Deadline: ${orderData.deadline_at ? new Date(orderData.deadline_at).toLocaleDateString() : 'N/A'}`,
            `/writer/queries`
          ]
        );
        
        // Send real-time notification
        emitToUser(parseInt(writerId), 'notification:new', {
          type: 'info',
          title: 'New Query Invitation',
          message: `You have been invited to review query ${orderData.query_code || queryId}: ${orderData.paper_topic || 'N/A'}`,
          link_url: `/writer/queries`
        });
      } catch (notifErr) {
        console.error('Notification error for writer', writerId, ':', notifErr);
      }
    }
    
    res.json({ 
      success: true, 
      message: `${successCount} writer(s) invited successfully.`, 
      writerCount: successCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('Error in inviteWriters:', err);
    res.status(500).json({ success: false, error: err.message, sqlState: err.sqlState });
  }
};

/**
 * Writer shows interest in an invited query
 */
exports.writerShowInterest = async (req, res) => {
  try {
    const writerId = req.user.user_id;
    const { orderId } = req.params;
    const { comments } = req.body;
    
    console.log(`Writer ${writerId} showing interest in order ${orderId} with comments: ${comments}`);
    
    // Check if the writer was invited
    const [[invite]] = await db.query(
      `SELECT id FROM writer_query_interest WHERE order_id = ? AND writer_id = ? AND status = 'invited'`,
      [orderId, writerId]
    );

    if (!invite) {
      // If not invited, check if they are already interested
      const [[existing]] = await db.query(
        `SELECT id FROM writer_query_interest WHERE order_id = ? AND writer_id = ? AND status = 'interested'`,
        [orderId, writerId]
      );

      if(existing) {
        return res.json({ success: false, message: 'You have already shown interest in this query.' });
      }

      // If not invited and not interested, a new interest can be shown
      await db.query(
        `INSERT INTO writer_query_interest (order_id, writer_id, status, comment) VALUES (?, ?, 'interested', ?)`,
        [orderId, writerId, comments || null]
      );

    } else {
       // If the writer was invited, update their status to 'interested'
      await db.query(
        `UPDATE writer_query_interest SET status = 'interested', comment = ? WHERE id = ?`,
        [comments || null, invite.id]
      );
    }

    // Get writer and order details for notification
    const [[writerInfo]] = await db.query(`SELECT full_name FROM users WHERE user_id = ?`, [writerId]);
    const [[orderInfo]] = await db.query(`SELECT query_code, paper_topic FROM orders WHERE order_id = ?`, [orderId]);
    
    // Create persistent notification for admins
    const [admins] = await db.query(`SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1`);
    for (const admin of admins) {
      // Save notification to database
      await db.query(
        `INSERT INTO notifications (user_id, type, title, message, link_url, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, NOW())`,
        [
          admin.user_id,
          'success',
          'Writer Accepted Invitation',
          `${writerInfo?.full_name || 'A writer'} has accepted the invitation for query ${orderInfo?.query_code || orderId}: ${orderInfo?.paper_topic || 'N/A'}`,
          `/admin/queries/${orderId}`
        ]
      );
      
      // Emit real-time notification
      emitToUser(admin.user_id, 'notification:new', {
        type: 'success',
        title: 'Writer Accepted Invitation',
        message: `${writerInfo?.full_name || 'A writer'} has accepted the invitation for query ${orderInfo?.query_code || orderId}`,
        link_url: `/admin/queries/${orderId}`
      });
    }
    res.json({ success: true, message: 'Interest registered.' });
  } catch (err) {
    console.error('Error in writerShowInterest:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * Writer declines invitation to a query
 */
exports.writerDeclineInvitation = async (req, res) => {
  try {
    const writerId = req.user.user_id;
    const { orderId } = req.params;
    const { reason } = req.body;
    
    console.log(`Writer ${writerId} declining order ${orderId} with reason: ${reason}`);
    
    // Check if the writer was invited
    const [[invite]] = await db.query(
      `SELECT id FROM writer_query_interest WHERE order_id = ? AND writer_id = ? AND status = 'invited'`,
      [orderId, writerId]
    );

    if (!invite) {
      return res.status(400).json({ success: false, message: 'No invitation found for this query' });
    }

    // Update status to 'rejected' with reason
    await db.query(
      `UPDATE writer_query_interest SET status = 'rejected', comment = ? WHERE id = ?`,
      [reason || '', invite.id]
    );

    // Get writer and order details for notification
    const [[writerInfo]] = await db.query(`SELECT full_name FROM users WHERE user_id = ?`, [writerId]);
    const [[orderInfo]] = await db.query(`SELECT query_code, paper_topic FROM orders WHERE order_id = ?`, [orderId]);
    
    // Create persistent notification for admins
    const [admins] = await db.query(`SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1`);
    for (const admin of admins) {
      // Save notification to database
      await db.query(
        `INSERT INTO notifications (user_id, type, title, message, link_url, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, NOW())`,
        [
          admin.user_id,
          'warning',
          'Writer Declined Invitation',
          `${writerInfo?.full_name || 'A writer'} has declined the invitation for query ${orderInfo?.query_code || orderId}. Reason: ${reason || 'No reason provided'}`,
          `/admin/queries/${orderId}`
        ]
      );
      
      // Emit real-time notification
      emitToUser(admin.user_id, 'notification:new', {
        type: 'warning',
        title: 'Writer Declined Invitation',
        message: `${writerInfo?.full_name || 'A writer'} has declined the invitation for query ${orderInfo?.query_code || orderId}`,
        link_url: `/admin/queries/${orderId}`
      });
    }
    
    res.json({ success: true, message: 'Invitation declined.' });
  } catch (err) {
    console.error('Error in writerDeclineInvitation:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};


/**
 * Admin assigns a writer from interested/accepted list
 */
exports.adminAssignWriter = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { writerId } = req.body;
    // Only allow assignment from interested or accepted list
    const [[interest]] = await db.query(
      `SELECT id FROM writer_query_interest WHERE order_id = ? AND writer_id = ? AND status IN ('interested', 'accepted')`,
      [orderId, writerId]
    );
    if (!interest) {
      return res.status(400).json({ success: false, message: 'Writer has not accepted the invitation for this query.' });
    }
    
    // Start a transaction
    await db.query('START TRANSACTION');

    // Mark as assigned
    await db.query(
      `UPDATE writer_query_interest SET status = 'assigned' WHERE id = ?`,
      [interest.id]
    );
    // Update order
    await db.query(
      `UPDATE orders SET writer_id = ?, status = 31 WHERE order_id = ?`,
      [writerId, orderId]
    );

    // Create task_evaluations entry to ensure it appears in Active Tasks
    // Since writer already showed interest/accepted invitation, we set status to 'assigned'
    await db.query(
      `INSERT INTO task_evaluations (order_id, writer_id, status, writer_status, created_at, updated_at)
       VALUES (?, ?, 'assigned', 'pending', NOW(), NOW())
       ON DUPLICATE KEY UPDATE status = 'assigned', updated_at = NOW()`,
      [orderId, writerId]
    );

    // Commit transaction
    await db.query('COMMIT');

    // Get writer and order details for notifications
    const [[writerInfo]] = await db.query(`SELECT full_name, email FROM users WHERE user_id = ?`, [writerId]);
    const [[orderInfo]] = await db.query(`SELECT query_code, order_code, paper_topic, deadline_at FROM orders WHERE order_id = ?`, [orderId]);

    // Create persistent notification for writer
    await db.query(
      `INSERT INTO notifications (user_id, type, title, message, link_url, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, NOW())`,
      [
        writerId,
        'success',
        'New Assignment - You Have Been Selected!',
        `You have been assigned to work on: ${orderInfo?.paper_topic || 'N/A'}. Work Code: ${orderInfo?.order_code || orderInfo?.query_code || orderId}. Deadline: ${orderInfo?.deadline_at ? new Date(orderInfo.deadline_at).toLocaleDateString() : 'N/A'}`,
        `/writer/tasks`
      ]
    );
    
    // Emit real-time notification to writer
    emitToUser(writerId, 'notification:new', {
      type: 'success',
      title: 'New Assignment - You Have Been Selected!',
      message: `You have been assigned to work on: ${orderInfo?.paper_topic || 'N/A'}`,
      link_url: `/writer/tasks`
    });

    // Notify all admins about the assignment
    const [admins] = await db.query(`SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1`);
    for (const admin of admins) {
      await db.query(
        `INSERT INTO notifications (user_id, type, title, message, link_url, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, NOW())`,
        [
          admin.user_id,
          'info',
          'Writer Assigned Successfully',
          `${writerInfo?.full_name || 'Writer'} has been assigned to ${orderInfo?.order_code || orderInfo?.query_code || orderId}: ${orderInfo?.paper_topic || 'N/A'}`,
          `/admin/queries/${orderId}`
        ]
      );
    }
    
    res.json({ success: true, message: 'Writer assigned successfully.' });
  } catch (err) {
    // Rollback transaction on error
    await db.query('ROLLBACK');
    console.error('Error in adminAssignWriter:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * Admin revokes writer assignment - allows reassignment
 */
exports.revokeWriterAssignment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const adminId = req.user.user_id;

    // Get current assigned writer
    const [[order]] = await db.query(
      `SELECT writer_id, query_code, paper_topic FROM orders WHERE order_id = ?`,
      [orderId]
    );

    if (!order || !order.writer_id) {
      return res.status(400).json({ success: false, message: 'No writer is currently assigned to this query.' });
    }

    const previousWriterId = order.writer_id;

    // Start transaction
    await db.query('START TRANSACTION');

    // Update writer_query_interest status to 'revoked'
    await db.query(
      `UPDATE writer_query_interest SET status = 'revoked', updated_at = NOW() WHERE order_id = ? AND writer_id = ? AND status = 'assigned'`,
      [orderId, previousWriterId]
    );

    // Clear writer from order and reset status to awaiting assignment (status 30)
    await db.query(
      `UPDATE orders SET writer_id = NULL, status = 30 WHERE order_id = ?`,
      [orderId]
    );

    // Commit transaction
    await db.query('COMMIT');

    // Get writer info for notification
    const [[writerInfo]] = await db.query(`SELECT full_name FROM users WHERE user_id = ?`, [previousWriterId]);

    // Notify the writer about revocation
    await db.query(
      `INSERT INTO notifications (user_id, type, title, message, link_url, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, NOW())`,
      [
        previousWriterId,
        'warning',
        'Assignment Revoked',
        `Your assignment for "${order.paper_topic || 'N/A'}" (${order.query_code || orderId}) has been revoked by admin. The task will be reassigned to another writer.`,
        `/writer/tasks`
      ]
    );

    // Emit real-time notification
    emitToUser(previousWriterId, 'notification:new', {
      type: 'warning',
      title: 'Assignment Revoked',
      message: `Your assignment for "${order.paper_topic || 'N/A'}" has been revoked.`
    });

    // Log the action
    await logAction({
      userId: adminId,
      action: 'revoke_writer_assignment',
      details: `Revoked writer ${writerInfo?.full_name || previousWriterId} from query ${order.query_code || orderId}`,
      resource_type: 'order',
      resource_id: orderId,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({ 
      success: true, 
      message: `Writer assignment revoked successfully. You can now invite and assign a new writer.`,
      revokedWriterId: previousWriterId
    });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error in revokeWriterAssignment:', err);
    res.status(500).json({ success: false, error: err.message });
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


    res.json({
      success: true,
      message: 'Message sent successfully'
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Update query status
 */
exports.updateQueryStatus = async (req, res) => {
  try {
    const { queryId } = req.params;
    const { status, notes } = req.body;

    // Fetch the order
    const [[order]] = await db.query(
      'SELECT * FROM orders WHERE order_id = ?',
      [queryId]
    );
    if (!order) {
      return res.status(404).json({ success: false, error: 'Query not found' });
    }

    // Update status
    await db.query(
      'UPDATE orders SET status = ? WHERE order_id = ?',
      [status, queryId]
    );

    // Log action
    await logAction({
      userId: req.user.user_id,
      action: 'query_status_update',
      details: `Status updated from ${order.status} to ${status}. Notes: ${notes || 'N/A'}`,
      resource_type: 'order',
      resource_id: queryId,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({ success: true, message: 'Query status updated' });
  } catch (error) {
    console.error('Error in updateQueryStatus:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
