\
  // db.js - MySQL helper using mysql2
  const mysql = require('mysql2/promise');
  const dotenv = require('dotenv');
  dotenv.config();
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASS,
    database: process.env.MYSQL_DB,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
  module.exports = pool;
