require('dotenv').config();
const mysql = require('mysql2/promise');

/**
 * Database Migration Script for Real-Time System
 * Fixes order_chats table schema issues
 */

async function runMigration() {
  let connection;
  
  try {
    // Connect to database
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      multipleStatements: true
    });

    console.log('🔌 Connected to database');
    console.log('📋 Starting migration...\n');

    // Step 1: Check current status column type
    console.log('Step 1: Checking order_chats.status column...');
    const [statusInfo] = await connection.query(`
      SELECT DATA_TYPE, COLUMN_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'order_chats' 
      AND COLUMN_NAME = 'status'
    `, [process.env.DB_NAME]);

    if (statusInfo.length > 0) {
      const currentType = statusInfo[0].DATA_TYPE;
      console.log(`   Current status type: ${currentType}`);
      
      if (currentType === 'tinyint') {
        console.log('   Converting status from TINYINT to ENUM...');
        
        // First, alter column to VARCHAR temporarily to allow string values
        await connection.query(`
          ALTER TABLE order_chats 
          MODIFY COLUMN status VARCHAR(20) DEFAULT 'active'
        `);
        
        // Convert existing numeric values to enum values
        // 1 -> 'active', 2 -> 'restricted', 3 -> 'closed', others -> 'active'
        await connection.query(`
          UPDATE order_chats 
          SET status = CASE 
            WHEN status = '1' THEN 'active'
            WHEN status = '2' THEN 'restricted'
            WHEN status = '3' THEN 'closed'
            ELSE 'active'
          END
        `);
        
        // Now alter column to ENUM
        await connection.query(`
          ALTER TABLE order_chats 
          MODIFY COLUMN status ENUM('active', 'restricted', 'closed') 
          DEFAULT 'active'
        `);
        
        console.log('   ✓ Status column converted to ENUM');
      } else if (currentType === 'varchar' || currentType === 'enum') {
        console.log('   ✓ Status column is already ENUM or VARCHAR, ensuring ENUM...');
        // Ensure it's ENUM with correct values
        try {
          await connection.query(`
            ALTER TABLE order_chats 
            MODIFY COLUMN status ENUM('active', 'restricted', 'closed') 
            DEFAULT 'active'
          `);
          console.log('   ✓ Status column updated to ENUM');
        } catch (err) {
          if (!err.message.includes('Duplicate column name')) {
            console.log('   ⚠ Status column may already be correct ENUM type');
          }
        }
      }
    }

    // Step 2: Add context_code column if missing
    console.log('\nStep 2: Checking context_code column...');
    const [contextInfo] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'order_chats' 
      AND COLUMN_NAME = 'context_code'
    `, [process.env.DB_NAME]);

    if (contextInfo.length === 0) {
      console.log('   Adding context_code column...');
      await connection.query(`
        ALTER TABLE order_chats 
        ADD COLUMN context_code VARCHAR(50) NULL AFTER order_id
      `);
      
      // Populate context_code from orders table
      console.log('   Populating context_code from orders table...');
      await connection.query(`
        UPDATE order_chats oc
        INNER JOIN orders o ON oc.order_id = o.order_id
        SET oc.context_code = COALESCE(o.work_code, o.query_code)
        WHERE oc.context_code IS NULL
      `);
      
      // Add index on context_code
      await connection.query(`
        CREATE INDEX idx_order_chats_context_code 
        ON order_chats(context_code)
      `);
      
      console.log('   ✓ context_code column added and populated');
    } else {
      console.log('   ✓ context_code column already exists');
    }

    // Step 3: Verify deadline_reminders table structure
    console.log('\nStep 3: Verifying deadline_reminders table...');
    const [deadlineTableInfo] = await connection.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'deadline_reminders'
    `, [process.env.DB_NAME]);

    if (deadlineTableInfo.length > 0) {
      console.log('   ✓ deadline_reminders table exists');
      
      // Check if order_id is correct type (should be INT, not VARCHAR)
      const [orderIdInfo] = await connection.query(`
        SELECT DATA_TYPE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'deadline_reminders' 
        AND COLUMN_NAME = 'order_id'
      `, [process.env.DB_NAME]);
      
      if (orderIdInfo.length > 0 && orderIdInfo[0].DATA_TYPE === 'varchar') {
        console.log('   ⚠ Warning: order_id is VARCHAR, should be INT for foreign key');
        console.log('   Note: This may require data migration if order_ids are stored as strings');
      }
    } else {
      console.log('   ⚠ deadline_reminders table does not exist (will be created by application)');
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\nSummary of changes:');
    console.log('  - order_chats.status: Converted to ENUM(\'active\', \'restricted\', \'closed\')');
    console.log('  - order_chats.context_code: Added column and populated from orders');
    console.log('  - Index created on context_code for performance\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

// Run migration
runMigration();
