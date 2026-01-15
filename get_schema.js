require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');

async function getDbSchema() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'dev009',
    database: process.env.DB_NAME || 'db_assignment_366'
  });

  try {
    // Get all tables
    const [tables] = await connection.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='db_assignment_366'");
    
    let schema = "# Database Schema - db_assignment_366\n\n";
    schema += `Generated: ${new Date().toLocaleString()}\n\n`;
    schema += "=".repeat(80) + "\n\n";

    for (const table of tables) {
      const tableName = table.TABLE_NAME;
      
      // Get columns for this table
      const [columns] = await connection.query(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, EXTRA, COLUMN_DEFAULT 
         FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA='db_assignment_366' AND TABLE_NAME=?
         ORDER BY ORDINAL_POSITION`,
        [tableName]
      );

      schema += `\n## TABLE: ${tableName}\n`;
      schema += "-".repeat(80) + "\n";
      
      columns.forEach((col, idx) => {
        const constraints = [];
        if (col.COLUMN_KEY === 'PRI') constraints.push('PRIMARY KEY');
        if (col.COLUMN_KEY === 'UNI') constraints.push('UNIQUE');
        if (col.COLUMN_KEY === 'MUL') constraints.push('INDEX');
        if (col.IS_NULLABLE === 'NO') constraints.push('NOT NULL');
        if (col.EXTRA) constraints.push(col.EXTRA.toUpperCase());
        if (col.COLUMN_DEFAULT) constraints.push(`DEFAULT: ${col.COLUMN_DEFAULT}`);

        const constraintStr = constraints.length > 0 ? ` [${constraints.join(', ')}]` : '';
        schema += `  ${idx + 1}. ${col.COLUMN_NAME} (${col.COLUMN_TYPE})${constraintStr}\n`;
      });

      // Get foreign keys
      const [fks] = await connection.query(
        `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA='db_assignment_366' AND TABLE_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [tableName]
      );

      if (fks.length > 0) {
        schema += "\n  Foreign Keys:\n";
        fks.forEach(fk => {
          schema += `    - ${fk.COLUMN_NAME} → ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}\n`;
        });
      }

      schema += "\n";
    }

    schema += "=".repeat(80) + "\n";

    // Save to file
    const filePath = 'DATABASE_SCHEMA.md';
    fs.writeFileSync(filePath, schema);
    
    console.log('\n✅ Database schema saved to: DATABASE_SCHEMA.md\n');
    console.log(schema);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await connection.end();
  }
}

getDbSchema();
