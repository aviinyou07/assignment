const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
});

module.exports = pool;

module.exports.connect = async () => {
  try {
    const connection = await pool.getConnection();    
    const logger = require('../utils/logger');
    logger.info('Database connected successfully');
    connection.release();
  } catch (error) {
    const logger = require('../utils/logger');
    logger.error(`Database connection failed: ${error && error.message ? error.message : error}`);
    process.exit(1);
  }
};


