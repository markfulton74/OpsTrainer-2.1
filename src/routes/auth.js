// ============================================
// OpsTrainer 2.1 — Auth Routes
// ============================================
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, generateTokens } = require('../middleware/auth');
const { sendEmail, passwordResetEmail } = require('./email');

const router = express.Router();

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ============================================
// POST /api/auth/register-org
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

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'An account with this email already exists' });
    }

    let slug = slugify(org_name);
    const existingSlug = db.prepare('SELECT id FROM organisations WHERE slug = ?').get(slug);
    if (existingSlug) slug = slug + '-' + Date.now();

    const orgId = uuidv4();
    const trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO organisations (id, name, slug, country, subscription_tier, subscription_status, trial_ends_at, max_users) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(orgId, org_name.trim(), slug, country || null, 'trial', 'trialing', trialEnds, 10);

    // Create default org settings
    db.prepare(
      'INSERT INTO org_settings (org_id) VALUES (?)'
    ).run(orgId);

    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, 12);
    db.prepare(
      'INSERT INTO users (id, org_id, email, password_hash, full_name, role, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, orgId, email.toLowerCase().trim(), passwordHash, full_name.trim(), 'org_admin', 1);

    // Create default user settings
    db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);

    const { accessToken, refreshToken } = generateTokens(userId, orgId, 'org_admin');
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), userId, tokenHash, expiresAt);

    console.log('New org registered: ' + org_name + ' (' + email + ')');

    res.status(201).json({
      success: true, accessToken, refreshToken,
      user: { id: userId, email: email.toLowerCase().trim(), full_name: full_name.trim(), role: 'org_admin' },
      org: { id: orgId, name: org_name.trim(), slug, subscription_tier: 'trial', trial_ends_at: trialEnds }
    });
  } catch (err) {
    console.error('Register-org error:', err);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// ============================================
// POST /api/auth/register-individual
// ============================================
router.post('/register-individual', async (req, res) => {
  try {
    const { full_name, email, password } = req.body;
    if (!full_name || !email || !password) {
      return res.status(400).json({ success: false, error: 'full_name, email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) {
      return res.status(400).json({ success: false, error: 'An account with this email already exists' });
    }

    const orgId = uuidv4();
    const slug = 'individual-' + orgId.substring(0, 8);
    db.prepare(
      'INSERT INTO organisations (id, name, slug, country, subscription_tier, subscription_status, max_users) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(orgId, full_name.trim() + ' (Individual)', slug, null, 'individual', 'active', 1);

    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, 12);
    db.prepare(
      'INSERT INTO users (id, org_id, email, password_hash, full_name, role, email_verified, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, orgId, email.toLowerCase().trim(), passwordHash, full_name.trim(), 'learner', 1, 1);

    // Create default user settings
    db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);

    const { accessToken, refreshToken } = generateTokens(userId, orgId, 'learner');
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), userId, tokenHash, expiresAt);

    console.log('Individual registered: ' + email);

    res.status(201).json({
      success: true, accessToken, refreshToken,
      user: { id: userId, email: email.toLowerCase().trim(), full_name: full_name.trim(), role: 'learner' },
      org: { id: orgId, name: full_name.trim() + ' (Individual)', slug, subscription_tier: 'individual' }
    });
  } catch (err) {
    console.error('Register-individual error:', err);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// ============================================
// POST /api/auth/activate-invite
// ============================================
router.post('/activate-invite', async (req, res) => {
  try {
    const { email, invite_code, password } = req.body;
    if (!email || !invite_code || !password) {
      return res.status(400).json({ success: false, error: 'email, invite_code and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const invite = db.prepare(
      'SELECT * FROM invites WHERE invite_code = ? AND email = ?'
    ).get(invite_code.trim().toUpperCase(), email.toLowerCase().trim());

    if (!invite) return res.status(400).json({ success: false, error: 'Invalid invite code or email address' });
    if (invite.used_at) return res.status(400).json({ success: false, error: 'This invite code has already been used' });
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ success: false, error: 'This invite code has expired. Ask your organisation admin for a new one.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE org_id = ? AND email = ?')
      .get(invite.org_id, email.toLowerCase().trim());
    if (existing) return res.status(400).json({ success: false, error: 'An account with this email already exists in this organisation' });

    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, 12);
    db.prepare(
      'INSERT INTO users (id, org_id, email, password_hash, full_name, role, email_verified, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, invite.org_id, email.toLowerCase().trim(), passwordHash, invite.full_name, invite.role, 1, 1);

    // Create default user settings
    db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);

    db.prepare('UPDATE invites SET used_at = ? WHERE id = ?').run(new Date().toISOString(), invite.id);

    const { accessToken, refreshToken } = generateTokens(userId, invite.org_id, invite.role);
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), userId, tokenHash, expiresAt);

    const org = db.prepare('SELECT name, slug, subscription_tier FROM organisations WHERE id = ?').get(invite.org_id);
    console.log('Invite activated: ' + email);

    res.status(201).json({
      success: true, accessToken, refreshToken,
      user: { id: userId, email: email.toLowerCase().trim(), full_name: invite.full_name, role: invite.role },
      org: { id: invite.org_id, name: org ? org.name : '', slug: org ? org.slug : '', subscription_tier: org ? org.subscription_tier : '' }
    });
  } catch (err) {
    console.error('Activate invite error:', err);
    res.status(500).json({ success: false, error: 'Account activation failed' });
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

    const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1')
      .get(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ success: false, error: 'Invalid email or password' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ success: false, error: 'Invalid email or password' });

    const org = db.prepare('SELECT * FROM organisations WHERE id = ?').get(user.org_id);
    if (org) {
      user.org_name = org.name;
      user.org_slug = org.slug;
      user.subscription_tier = org.subscription_tier;
      user.subscription_status = org.subscription_status;
      user.max_users = org.max_users;
    }

    // Get user settings
    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(user.id);

    const { accessToken, refreshToken } = generateTokens(user.id, user.org_id, user.role);
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), user.id, tokenHash, expiresAt);

    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);

    console.log('Login: ' + email + ' (' + user.role + ')');

    res.json({
      success: true, accessToken, refreshToken,
      user: {
        id: user.id, email: user.email, full_name: user.full_name,
        role: user.role, language: settings ? settings.language : 'en',
        tts_enabled: settings ? settings.tts_enabled : 1
      },
      org: {
        id: user.org_id, name: user.org_name, slug: user.org_slug,
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
// POST /api/auth/forgot-password
// ============================================
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

    // Always return success to prevent email enumeration
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1')
      .get(email.toLowerCase().trim());

    if (user) {
      // Delete any existing reset tokens for this user
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);

      // Generate reset token
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

      db.prepare(
        'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
      ).run(uuidv4(), user.id, tokenHash, expiresAt);

      const appUrl = process.env.APP_URL || 'https://opstrainer.onrender.com';
      const resetUrl = appUrl + '/reset-password?token=' + rawToken;

      await sendEmail({
        to: user.email,
        subject: 'Reset your OpsTrainer password',
        html: passwordResetEmail(resetUrl, user.full_name)
      });

      console.log('Password reset sent to: ' + email);
    }

    // Always return success
    res.json({
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link shortly.'
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, error: 'Failed to process request' });
  }
});

// ============================================
// POST /api/auth/reset-password
// ============================================
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ success: false, error: 'Token and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const resetToken = db.prepare(
      'SELECT * FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL'
    ).get(tokenHash, new Date().toISOString());

    if (!resetToken) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset link. Please request a new one.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(passwordHash, new Date().toISOString(), resetToken.user_id);

    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?')
      .run(new Date().toISOString(), resetToken.id);

    // Invalidate all refresh tokens for security
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(resetToken.user_id);

    console.log('Password reset completed for user: ' + resetToken.user_id);

    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, error: 'Password reset failed' });
  }
});

// ============================================
// GET /api/auth/validate-reset-token
// Check if a reset token is valid before showing the form
// ============================================
router.get('/validate-reset-token', (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, error: 'Token required' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const resetToken = db.prepare(
      'SELECT * FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL'
    ).get(tokenHash, new Date().toISOString());

    if (!resetToken) {
      return res.json({ success: false, valid: false, error: 'Invalid or expired reset link' });
    }

    const user = db.prepare('SELECT full_name, email FROM users WHERE id = ?').get(resetToken.user_id);
    res.json({ success: true, valid: true, email: user ? user.email : '' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Validation failed' });
  }
});

// ============================================
// GET /api/auth/settings
// Get current user settings
// ============================================
router.get('/settings', requireAuth, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, full_name, role, language FROM users WHERE id = ?').get(req.user.id);
    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id);
    res.json({ success: true, user, settings: settings || {} });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
});

// ============================================
// PUT /api/auth/settings
// Update user profile and settings
// ============================================
router.put('/settings', requireAuth, async (req, res) => {
  try {
    const { full_name, email, current_password, new_password, language, tts_enabled } = req.body;
    const userId = req.user.id;

    // Update user fields
    if (full_name) {
      db.prepare('UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?')
        .run(full_name.trim(), new Date().toISOString(), userId);
    }

    if (email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?')
        .get(email.toLowerCase().trim(), userId);
      if (existing) return res.status(400).json({ success: false, error: 'Email already in use' });
      db.prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?')
        .run(email.toLowerCase().trim(), new Date().toISOString(), userId);
    }

    if (current_password && new_password) {
      if (new_password.length < 8) {
        return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
      }
      const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
      const match = await bcrypt.compare(current_password, user.password_hash);
      if (!match) return res.status(400).json({ success: false, error: 'Current password is incorrect' });
      const newHash = await bcrypt.hash(new_password, 12);
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(newHash, new Date().toISOString(), userId);
    }

    // Update user settings
    const existing = db.prepare('SELECT user_id FROM user_settings WHERE user_id = ?').get(userId);
    if (existing) {
      const updates = {};
      if (language !== undefined) updates.language = language;
      if (tts_enabled !== undefined) updates.tts_enabled = tts_enabled ? 1 : 0;
      if (Object.keys(updates).length) {
        updates.updated_at = new Date().toISOString();
        const setClause = Object.keys(updates).map(k => k + ' = ?').join(', ');
        db.prepare('UPDATE user_settings SET ' + setClause + ' WHERE user_id = ?')
          .run(...Object.values(updates), userId);
      }
    } else {
      db.prepare('INSERT INTO user_settings (user_id, language, tts_enabled) VALUES (?, ?, ?)')
        .run(userId, language || 'en', tts_enabled !== false ? 1 : 0);
    }

    const updatedUser = db.prepare('SELECT id, email, full_name, role FROM users WHERE id = ?').get(userId);
    const updatedSettings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);

    res.json({ success: true, user: updatedUser, settings: updatedSettings });
  } catch (err) {
    console.error('Settings update error:', err);
    res.status(500).json({ success: false, error: 'Settings update failed' });
  }
});

// ============================================
// PUT /api/auth/org-settings
// Update org settings (admin only)
// ============================================
router.put('/org-settings', requireAuth, async (req, res) => {
  try {
    const { org_id, role } = req.user;
    if (!['org_admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const { chief_trainer_name, chief_trainer_title, certificate_accent_color } = req.body;

    const existing = db.prepare('SELECT org_id FROM org_settings WHERE org_id = ?').get(org_id);
    if (existing) {
      const updates = {};
      if (chief_trainer_name !== undefined) updates.chief_trainer_name = chief_trainer_name;
      if (chief_trainer_title !== undefined) updates.chief_trainer_title = chief_trainer_title;
      if (certificate_accent_color !== undefined) updates.certificate_accent_color = certificate_accent_color;
      if (Object.keys(updates).length) {
        updates.updated_at = new Date().toISOString();
        const setClause = Object.keys(updates).map(k => k + ' = ?').join(', ');
        db.prepare('UPDATE org_settings SET ' + setClause + ' WHERE org_id = ?')
          .run(...Object.values(updates), org_id);
      }
    } else {
      db.prepare(
        'INSERT INTO org_settings (org_id, chief_trainer_name, chief_trainer_title, certificate_accent_color) VALUES (?, ?, ?, ?)'
      ).run(org_id, chief_trainer_name || 'Chief Trainer', chief_trainer_title || 'Chief Trainer', certificate_accent_color || '#1a56db');
    }

    const settings = db.prepare('SELECT * FROM org_settings WHERE org_id = ?').get(org_id);
    res.json({ success: true, settings });
  } catch (err) {
    console.error('Org settings error:', err);
    res.status(500).json({ success: false, error: 'Failed to update org settings' });
  }
});

// ============================================
// POST /api/auth/refresh
// ============================================
router.post('/refresh', (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, error: 'Refresh token required' });

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + '_refresh');
    } catch (err) {
      return res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
    }

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const stored = db.prepare(
      'SELECT id FROM refresh_tokens WHERE token_hash = ? AND expires_at > ?'
    ).get(tokenHash, new Date().toISOString());

    if (!stored) return res.status(401).json({ success: false, error: 'Refresh token not found or expired' });

    db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(tokenHash);

    const { accessToken, refreshToken: newRefresh } = generateTokens(decoded.userId, decoded.orgId, decoded.role);
    const newHash = crypto.createHash('sha256').update(newRefresh).digest('hex');
    const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), decoded.userId, newHash, newExpiry);

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
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(tokenHash);
    }
    res.json({ success: true });
  } catch (err) {
    res.json({ success: true });
  }
});

// ============================================
// GET /api/auth/me
// ============================================
router.get('/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
