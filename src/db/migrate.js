// ============================================
// OpsTrainer 2.1 — Database Migration Runner
// ============================================
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './data/opstrainer.db';

function migrate() {
  // Ensure data directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(DB_PATH);
  console.log('📦 Database connected:', DB_PATH);

  // Enable WAL mode for performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Read and execute schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  try {
    db.exec(schema);
    console.log('✅ Schema applied successfully');
  } catch (err) {
    console.error('❌ Schema error:', err.message);
    process.exit(1);
  }

  db.close();
  console.log('🎉 Migration complete');
}

migrate();
