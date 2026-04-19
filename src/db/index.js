// ============================================
// OpsTrainer 2.1 — DB Selector
// Uses JSON file store on free Render tier.
// Swap this file for SQLite when persistent disk is available.
// ============================================
const USE_SQLITE = process.env.USE_SQLITE === 'true';

let db;
if (USE_SQLITE) {
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');
  const DB_PATH = process.env.DB_PATH || './data/opstrainer.db';
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  console.log('✅ SQLite connected:', DB_PATH);
} else {
  db = require('./jsondb');
  console.log('✅ JSON DB adapter active');
}

module.exports = db;
