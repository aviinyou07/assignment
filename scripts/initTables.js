require("dotenv").config();
const db = require("../config/db");

async function initializeTables() {
  try {
    const connection = await db.getConnection();
    
    console.log("Creating writer_query_interest table if not exists...");
    
    await connection.query(`
      CREATE TABLE IF NOT EXISTS writer_query_interest (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        writer_id INT NOT NULL,
        status VARCHAR(50) DEFAULT 'interested',
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_writer_query (order_id, writer_id),
        FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
        FOREIGN KEY (writer_id) REFERENCES users(user_id) ON DELETE CASCADE,
        INDEX idx_status (status),
        INDEX idx_writer_id (writer_id)
      )
    `);
    
    console.log("✓ writer_query_interest table created successfully");
    
    connection.release();
    process.exit(0);
  } catch (error) {
    console.error("Error initializing tables:", error);
    process.exit(1);
  }
}

initializeTables();
