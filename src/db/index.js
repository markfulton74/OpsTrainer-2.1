// ============================================
// OpsTrainer 2.1 — Shared DB Instance
// ============================================
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './data/opstrainer.db';

// Ensure data dir exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

let db;
try {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  console.log('✅ SQLite connected:', DB_PATH);
} catch (err) {
  console.error('❌ Database connection failed:', err.message);
  process.exit(1);
}

module.exports = db;
