const db = require('../config/db');

/**
 * Get queries where writer is invited
 */
exports.listInvitedQueries = async (req, res) => {
  try {
    const writerId = req.user.user_id;
    const [queries] = await db.query(
      `SELECT o.order_id, o.query_code, o.paper_topic as topic, o.service, o.urgency, o.deadline_at, o.status
       FROM orders o
       JOIN writer_query_interest wqi ON wqi.order_id = o.order_id
       WHERE wqi.writer_id = ? AND wqi.status = 'invited'
       ORDER BY o.created_at DESC`,
      [writerId]
    );
    res.json({ success: true, queries });
  } catch (err) {
    console.error('Error fetching invited queries:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
