require('dotenv').config();
const db = require('./config/db');

async function checkAvailableWriters() {
  try {
    console.log('Checking available writers...\n');
    
    const [writers] = await db.query(
      `SELECT user_id, full_name, email, is_active FROM users WHERE role = 'writer' AND is_active = 1 ORDER BY full_name ASC`
    );
    
    console.log('Available writers:');
    console.table(writers);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkAvailableWriters();
