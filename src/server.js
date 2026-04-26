// ============================================
// OpsTrainer 2.1 — Main Server (v2.1.2)
// ============================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ============================================
// Security Middleware
// ============================================
app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:5173', 'https://opstrainer.onrender.com'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// Rate Limiting
// ============================================
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, error: 'Too many requests. Please try again later.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'Too many attempts. Please wait 15 minutes.' }
});

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { success: false, error: 'Too many password reset requests. Please wait an hour.' }
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register-org', authLimiter);
app.use('/api/auth/register-individual', authLimiter);
app.use('/api/auth/activate-invite', authLimiter);
app.use('/api/auth/forgot-password', forgotLimiter);

// ============================================
// Request Logging
// ============================================
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (ms > 1000) {
      console.log('[' + res.statusCode + '] ' + req.method + ' ' + req.originalUrl + ' (' + ms + 'ms)');
    }
  });
  next();
});

// ============================================
// Database Init + Auto-seed
// ============================================
try {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const db = require('./db');

  // Apply schema
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
    console.log('Schema applied');
  }

  // Auto-seed if fresh
  const orgCount = db.prepare('SELECT COUNT(*) as count FROM organisations').get();
  if (!orgCount || orgCount.count === 0) {
    console.log('Fresh database — auto-seeding...');
    require('./db/seed')();
    console.log('Seeded successfully');
  } else {
    console.log('Database ready (' + orgCount.count + ' org(s))');
  }
} catch (err) {
  console.error('Database init failed:', err.message);
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

// ============================================
// Health Check
// ============================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.1.2',
    timestamp: new Date().toISOString(),
    db: process.env.USE_SQLITE === 'true' ? 'sqlite' : 'json'
  });
});

// ============================================
// Static Assets
// ============================================
const assetsDir = path.join(__dirname, '..', 'assets');
if (fs.existsSync(assetsDir)) {
  app.use('/assets', express.static(assetsDir));
}

// ============================================
// Static Frontend + SPA Routing
// ============================================
const publicDir = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));

  // Password reset page — serve index.html with token in URL
  app.get('/reset-password', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // Catch-all SPA route
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
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// 404 for unknown API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: 'Route not found: ' + req.originalUrl });
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
  console.log('OpsTrainer 2.1.2 running on port ' + PORT);
  console.log('Health: http://localhost:' + PORT + '/api/health');
  console.log('Environment: ' + (process.env.NODE_ENV || 'development'));
});

module.exports = app;
