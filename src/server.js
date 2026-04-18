// ============================================
// OpsTrainer 2.1 — Main Server
// ============================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Security Middleware
// ============================================
app.use(helmet({
  contentSecurityPolicy: false // Disable for SPA flexibility
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  message: { success: false, error: 'Too many requests. Please try again later.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // Strict for auth endpoints
  message: { success: false, error: 'Too many login attempts. Please wait 15 minutes.' }
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register-org', authLimiter);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (ms > 1000) { // Only log slow requests
      console.log(`[${res.statusCode}] ${req.method} ${req.originalUrl} (${ms}ms)`);
    }
  });
  next();
});

// ============================================
// Ensure DB is migrated + seeded on startup
// ============================================
try {
  // Ensure data dir exists
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const db = require('./db');
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
    console.log('✅ Database schema verified');
  }

  // Auto-seed if database is empty (first boot)
  const orgCount = db.prepare('SELECT COUNT(*) as count FROM organisations').get();
  if (orgCount.count === 0) {
    console.log('🌱 Fresh database detected — auto-seeding...');
    require('./db/seed')();
    console.log('✅ Database seeded successfully');
  }
} catch (err) {
  console.error('❌ Database init failed:', err.message);
  process.exit(1);
}

// ============================================
// API Routes
// ============================================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/forge', require('./routes/forge'));
app.use('/api/ai', require('./routes/ai-instructor'));
app.use('/api/certificates', require('./routes/certificates'));
app.use('/api/org', require('./routes/org'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.1.0',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// Static Assets (logo, cert templates, etc.)
// ============================================
const assetsDir = path.join(__dirname, '..', 'assets');
if (fs.existsSync(assetsDir)) {
  app.use('/assets', express.static(assetsDir));
}

// ============================================
// Static Frontend
// ============================================
const publicDir = path.join(__dirname, '..', 'frontend');

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// ============================================
// Global Error Handler
// ============================================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  });
});

// 404 for unknown API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: `Route not found: ${req.originalUrl}` });
});

// ============================================
// Process Error Handlers
// ============================================
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// ============================================
// Start
// ============================================
app.listen(PORT, () => {
  console.log(`\n🚀 OpsTrainer 2.1 running on port ${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/api/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;

