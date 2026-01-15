require('dotenv').config();
const db = require('./config/db');

async function testInvite() {
  try {
    console.log('Checking existing orders...');
    
    // Check existing orders
    const [orders] = await db.query(
      `SELECT order_id, query_code, paper_topic FROM orders LIMIT 5`
    );
    
    console.log('Existing orders:', orders);
    
    if (orders.length === 0) {
      console.log('No orders found in database');
      process.exit(0);
    }
    
    const testOrderId = orders[0].order_id;
    console.log(`\nTesting with order_id: ${testOrderId}`);
    
    // Check existing writers
    const [writers] = await db.query(
      `SELECT user_id, full_name FROM users WHERE role = 'writer' LIMIT 1`
    );
    
    console.log('Available writers:', writers);
    
    if (writers.length === 0) {
      console.log('No writers found in database');
      process.exit(0);
    }
    
    const testWriterId = writers[0].user_id;
    console.log(`Testing with writer_id: ${testWriterId}`);
    
    // Test insert
    const result = await db.query(
      `INSERT INTO writer_query_interest (order_id, writer_id, status) VALUES (?, ?, 'invited')
       ON DUPLICATE KEY UPDATE status = 'invited'`,
      [parseInt(testOrderId), parseInt(testWriterId)]
    );
    
    console.log('Insert result:', result);
    
    // Read back
    const [rows] = await db.query(
      `SELECT * FROM writer_query_interest WHERE order_id = ? AND writer_id = ?`,
      [parseInt(testOrderId), parseInt(testWriterId)]
    );
    
    console.log('Read back result:', rows);
    console.log('✓ Insert successful!');
    
    process.exit(0);
  } catch (error) {
    console.error('Test error:', error);
    process.exit(1);
  }
}

testInvite();
