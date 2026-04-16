// ============================================
// OpsTrainer 2.1 — Auth Routes
// POST /api/auth/register-org
// POST /api/auth/login
// POST /api/auth/refresh
// POST /api/auth/logout
// GET  /api/auth/me
// ============================================
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, generateTokens } = require('../middleware/auth');

const router = express.Router();

// ---- Helpers ----
function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ============================================
// POST /api/auth/register-org
// Creates a new organisation + first admin user
// ============================================
router.post('/register-org', async (req, res) => {
  try {
    const { org_name, email, password, full_name, country } = req.body;

    if (!org_name || !email || !password || !full_name) {
      return res.status(400).json({ success: false, error: 'org_name, email, password and full_name are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    // Check email not already used
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'An account with this email already exists' });
    }

    // Create org slug — ensure uniqueness
    let slug = slugify(org_name);
    const existingSlug = db.prepare('SELECT id FROM organisations WHERE slug = ?').get(slug);
    if (existingSlug) slug = `${slug}-${Date.now()}`;

    // Create org
    const orgId = uuidv4();
    const trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(); // 14 day trial
    db.prepare(`
      INSERT INTO organisations (id, name, slug, country, subscription_tier, subscription_status, trial_ends_at, max_users)
      VALUES (?, ?, ?, ?, 'trial', 'trialing', ?, 10)
    `).run(orgId, org_name.trim(), slug, country || null, trialEnds);

    // Create admin user
    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, 12);
    db.prepare(`
      INSERT INTO users (id, org_id, email, password_hash, full_name, role, email_verified)
      VALUES (?, ?, ?, ?, ?, 'org_admin', 1)
    `).run(userId, orgId, email.toLowerCase().trim(), passwordHash, full_name.trim());

    const { accessToken, refreshToken } = generateTokens(userId, orgId, 'org_admin');

    // Store refresh token hash
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), userId, tokenHash, expiresAt);

    console.log(`✅ New org registered: ${org_name} (${email})`);

    res.status(201).json({
      success: true,
      accessToken,
      refreshToken,
      user: { id: userId, email: email.toLowerCase().trim(), full_name: full_name.trim(), role: 'org_admin' },
      org: { id: orgId, name: org_name.trim(), slug, subscription_tier: 'trial', trial_ends_at: trialEnds }
    });
  } catch (err) {
    console.error('Register-org error:', err);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// ============================================
// POST /api/auth/login
// ============================================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    const user = db.prepare(`
      SELECT u.*, o.name as org_name, o.slug as org_slug,
             o.subscription_tier, o.subscription_status, o.max_users
      FROM users u
      JOIN organisations o ON o.id = u.org_id
      WHERE u.email = ? AND u.is_active = 1
    `).get(email.toLowerCase().trim());

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const { accessToken, refreshToken } = generateTokens(user.id, user.org_id, user.role);

    // Store refresh token
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), user.id, tokenHash, expiresAt);

    // Update last login
    db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    console.log(`✅ Login: ${email} (${user.role})`);

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        language: user.language,
        avatar_url: user.avatar_url
      },
      org: {
        id: user.org_id,
        name: user.org_name,
        slug: user.org_slug,
        subscription_tier: user.subscription_tier,
        subscription_status: user.subscription_status,
        max_users: user.max_users
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// ============================================
// POST /api/auth/refresh
// ============================================
router.post('/refresh', (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'Refresh token required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + '_refresh');
    } catch (err) {
      return res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
    }

    // Verify token exists in DB
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const stored = db.prepare(
      'SELECT id FROM refresh_tokens WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP'
    ).get(tokenHash);

    if (!stored) {
      return res.status(401).json({ success: false, error: 'Refresh token not found or expired' });
    }

    // Rotate: delete old, issue new
    db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(tokenHash);

    const { accessToken, refreshToken: newRefresh } = generateTokens(decoded.userId, decoded.orgId, decoded.role);
    const newHash = crypto.createHash('sha256').update(newRefresh).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), decoded.userId, newHash, expiresAt);

    res.json({ success: true, accessToken, refreshToken: newRefresh });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ success: false, error: 'Token refresh failed' });
  }
});

// ============================================
// POST /api/auth/logout
// ============================================
router.post('/logout', (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const crypto = require('crypto');
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(tokenHash);
    }
    res.json({ success: true });
  } catch (err) {
    res.json({ success: true }); // Always succeed on logout
  }
});

// ============================================
// GET /api/auth/me
// ============================================
router.get('/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
