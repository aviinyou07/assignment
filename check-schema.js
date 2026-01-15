const db = require('./config/db');

async function checkSchema() {
  try {
    const [columns] = await db.query('DESCRIBE orders');
    console.log('Orders table schema:');
    columns.forEach(col => {
      console.log(`${col.Field}: ${col.Type}`);
    });
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit(0);
  }
}

checkSchema();
