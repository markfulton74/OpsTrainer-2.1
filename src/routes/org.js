// ============================================
// OpsTrainer 2.1 — Organisation Routes
// ============================================
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ============================================
// GET /api/org/me
// ============================================
router.get('/me', requireAuth, (req, res) => {
  try {
    const org = db.prepare('SELECT * FROM organisations WHERE id = ?').get(req.user.org_id);
    if (!org) return res.status(404).json({ success: false, error: 'Organisation not found' });
    delete org.stripe_customer_id;
    delete org.stripe_subscription_id;
    res.json({ success: true, org });
  } catch (err) {
    console.error('Org me error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch org' });
  }
});

// ============================================
// GET /api/org/users
// ============================================
router.get('/users', requireAdmin, (req, res) => {
  try {
    const { org_id } = req.user;
    const users = db.prepare(
      'SELECT id, email, full_name, role, is_active, last_login_at, created_at FROM users WHERE org_id = ? ORDER BY full_name'
    ).all(org_id);
    const maxUsers = db.prepare('SELECT max_users FROM organisations WHERE id = ?').get(org_id)?.max_users || 10;
    res.json({ success: true, users, count: users.length, max_users: maxUsers });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

// ============================================
// GET /api/org/invites
// List pending invites for this org
// ============================================
router.get('/invites', requireAdmin, (req, res) => {
  try {
    const { org_id } = req.user;
    const invites = db.prepare(
      'SELECT id, email, full_name, role, invite_code, expires_at, used_at, created_at FROM invites WHERE org_id = ? ORDER BY created_at DESC'
    ).all(org_id);
    res.json({ success: true, invites });
  } catch (err) {
    console.error('List invites error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch invites' });
  }
});

// ============================================
// POST /api/org/invite
// Generate invite code for a new org user
// ============================================
router.post('/invite', requireAdmin, (req, res) => {
  try {
    const { org_id, id: adminId } = req.user;
    const { email, full_name, role = 'learner' } = req.body;

    if (!email || !full_name) {
      return res.status(400).json({ success: false, error: 'email and full_name are required' });
    }

    if (!['learner', 'manager', 'org_admin'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }

    // Check seat limit
    const org = db.prepare('SELECT max_users FROM organisations WHERE id = ?').get(org_id);
    const currentCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE org_id = ? AND is_active = 1').get(org_id).count;
    if (currentCount >= org.max_users) {
      return res.status(400).json({ success: false, error: 'User limit reached. Upgrade your plan to add more users.' });
    }

    // Check not already a user in this org
    const existing = db.prepare('SELECT id FROM users WHERE org_id = ? AND email = ?').get(org_id, email.toLowerCase().trim());
    if (existing) {
      return res.status(400).json({ success: false, error: 'A user with this email already exists in your organisation' });
    }

    // Cancel any existing unused invite for this email in this org
    db.prepare('DELETE FROM invites WHERE org_id = ? AND email = ? AND used_at IS NULL').run(org_id, email.toLowerCase().trim());

    // Generate invite code: OPS-XXXXXX (6 uppercase alphanumeric chars)
    const code = 'OPS-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const inviteId = uuidv4();

    db.prepare(
      'INSERT INTO invites (id, org_id, email, full_name, role, invite_code, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(inviteId, org_id, email.toLowerCase().trim(), full_name.trim(), role, code, expiresAt, adminId);

    const org_details = db.prepare('SELECT name FROM organisations WHERE id = ?').get(org_id);

    console.log('Invite created: ' + code + ' for ' + email + ' (' + role + ')');

    res.status(201).json({
      success: true,
      invite: { id: inviteId, email: email.toLowerCase().trim(), full_name: full_name.trim(), role, invite_code: code, expires_at: expiresAt },
      message: 'Invite code generated. Share this code with ' + full_name.trim() + ': ' + code,
      org_name: org_details ? org_details.name : ''
    });
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ success: false, error: 'Failed to generate invite' });
  }
});

// ============================================
// DELETE /api/org/invites/:id
// Cancel a pending invite
// ============================================
router.delete('/invites/:id', requireAdmin, (req, res) => {
  try {
    const { org_id } = req.user;
    const invite = db.prepare('SELECT * FROM invites WHERE id = ? AND org_id = ?').get(req.params.id, org_id);
    if (!invite) return res.status(404).json({ success: false, error: 'Invite not found' });
    db.prepare('DELETE FROM invites WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete invite error:', err);
    res.status(500).json({ success: false, error: 'Failed to cancel invite' });
  }
});

// ============================================
// PUT /api/org/users/:id
// Update user role or status
// ============================================
router.put('/users/:id', requireAdmin, (req, res) => {
  try {
    const { org_id, id: adminId } = req.user;
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND org_id = ?').get(req.params.id, org_id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (user.id === adminId) return res.status(400).json({ success: false, error: 'Cannot modify your own account here' });

    const { role, is_active } = req.body;
    const updates = {};
    if (role && ['learner', 'manager', 'org_admin'].includes(role)) updates.role = role;
    if (is_active !== undefined) updates.is_active = is_active ? 1 : 0;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'Nothing to update' });
    }

    updates.updated_at = new Date().toISOString();
    const setClause = Object.keys(updates).map(k => k + ' = ?').join(', ');
    db.prepare('UPDATE users SET ' + setClause + ' WHERE id = ?').run(...Object.values(updates), req.params.id);

    const updated = db.prepare('SELECT id, email, full_name, role, is_active FROM users WHERE id = ?').get(req.params.id);
    res.json({ success: true, user: updated });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

// ============================================
// DELETE /api/org/users/:id
// Permanently delete a user from the org
// ============================================
router.delete('/users/:id', requireAdmin, (req, res) => {
  try {
    const { org_id, id: adminId } = req.user;
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND org_id = ?').get(req.params.id, org_id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (user.id === adminId) return res.status(400).json({ success: false, error: 'Cannot delete your own account' });

    // Clean up related data
    db.prepare('DELETE FROM lesson_completions WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM enrolments WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM cbir_sessions WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM ai_sessions WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);

    console.log('User deleted: ' + user.email + ' from org ' + org_id);
    res.json({ success: true, message: 'User account deleted' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

// ============================================
// GET /api/org/dashboard
// ============================================
router.get('/dashboard', requireAdmin, (req, res) => {
  try {
    const { org_id } = req.user;

    const userStats = db.prepare(
      'SELECT COUNT(*) as total_users, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_users FROM users WHERE org_id = ?'
    ).get(org_id);

    const enrolmentStats = db.prepare(
      'SELECT COUNT(*) as total_enrolments, SUM(CASE WHEN status = "completed" THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status = "in_progress" THEN 1 ELSE 0 END) as in_progress FROM enrolments WHERE org_id = ?'
    ).get(org_id);

    const certStats = db.prepare(
      'SELECT COUNT(*) as total_certs FROM certificates WHERE org_id = ? AND is_revoked = 0'
    ).get(org_id);

    const courseStats = db.prepare(
      'SELECT COUNT(*) as org_courses FROM courses WHERE org_id = ? AND is_published = 1'
    ).get(org_id);

    const pendingInvites = db.prepare(
      'SELECT COUNT(*) as count FROM invites WHERE org_id = ? AND used_at IS NULL AND expires_at > ?'
    ).get(org_id, new Date().toISOString());

    const recentUsers = db.prepare(
      'SELECT id, full_name, email, role, created_at FROM users WHERE org_id = ? ORDER BY created_at DESC LIMIT 5'
    ).all(org_id);

    res.json({
      success: true,
      dashboard: {
        users: { ...userStats, pending_invites: pendingInvites ? pendingInvites.count : 0 },
        enrolments: enrolmentStats,
        certificates: certStats,
        courses: courseStats,
        recent_users: recentUsers
      }
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, error: 'Failed to load dashboard' });
  }
});

module.exports = router;
