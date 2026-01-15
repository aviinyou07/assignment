require('dotenv').config();
const db = require('./config/db');

async function checkInvitedWriters() {
  try {
    const orderId = 12;
    
    console.log(`Checking invited writers for order_id = ${orderId}...\n`);
    
    // Get all writer_query_interest records for this order
    const [allRecords] = await db.query(
      `SELECT id, order_id, writer_id, status, created_at, updated_at FROM writer_query_interest WHERE order_id = ? ORDER BY created_at DESC`,
      [orderId]
    );
    
    console.log('All records for order_id 12:');
    console.table(allRecords);
    
    // Get only invited writers
    const [invitedRecords] = await db.query(
      `SELECT wqi.id, wqi.order_id, wqi.writer_id, wqi.status, wu.full_name, wu.email, wu.is_active, wqi.created_at, wqi.updated_at
       FROM writer_query_interest wqi
       JOIN users wu ON wu.user_id = wqi.writer_id
       WHERE wqi.order_id = ? AND wqi.status = 'invited'
       ORDER BY wqi.created_at ASC`,
      [orderId]
    );
    
    console.log('\n\nInvited writers (status=invited):');
    console.table(invitedRecords);
    console.log(`\nTotal invited: ${invitedRecords.length}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkInvitedWriters();
