// ============================================
// OpsTrainer 2.1 — Organisation Routes
// GET  /api/org/me              — org details
// GET  /api/org/users           — list users
// POST /api/org/users/invite    — invite user
// PUT  /api/org/users/:id       — update user role/status
// DELETE /api/org/users/:id     — remove user
// GET  /api/org/dashboard       — org admin dashboard stats
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
    // Strip sensitive fields
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
    const users = db.prepare(`
      SELECT id, email, full_name, role, is_active, last_login_at, created_at
      FROM users WHERE org_id = ? ORDER BY full_name
    `).all(org_id);

    const maxUsers = db.prepare('SELECT max_users FROM organisations WHERE id = ?').get(org_id)?.max_users || 10;

    res.json({ success: true, users, count: users.length, max_users: maxUsers });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

// ============================================
// POST /api/org/users/invite
// Adds a learner to the org (simplified invite — no email flow yet)
// ============================================
router.post('/users/invite', requireAdmin, async (req, res) => {
  try {
    const { org_id } = req.user;
    const { email, full_name, role = 'learner', temp_password } = req.body;

    if (!email || !full_name) {
      return res.status(400).json({ success: false, error: 'email and full_name required' });
    }

    // Check seat limit
    const org = db.prepare('SELECT max_users FROM organisations WHERE id = ?').get(org_id);
    const currentCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE org_id = ? AND is_active = 1').get(org_id).count;
    if (currentCount >= org.max_users) {
      return res.status(400).json({ success: false, error: `User limit reached (${org.max_users}). Upgrade your plan to add more users.` });
    }

    const existingInOrg = db.prepare('SELECT id FROM users WHERE org_id = ? AND email = ?').get(org_id, email.toLowerCase().trim());
    if (existingInOrg) {
      return res.status(400).json({ success: false, error: 'User with this email already exists in your organisation' });
    }

    const password = temp_password || Math.random().toString(36).slice(-10) + 'A1!';
    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    db.prepare(`
      INSERT INTO users (id, org_id, email, password_hash, full_name, role, email_verified)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(userId, org_id, email.toLowerCase().trim(), passwordHash, full_name.trim(), role);

    const user = db.prepare('SELECT id, email, full_name, role, created_at FROM users WHERE id = ?').get(userId);

    res.status(201).json({
      success: true,
      user,
      temp_password: password,
      message: 'User created. Share the temporary password with them to log in.'
    });
  } catch (err) {
    console.error('Invite user error:', err);
    res.status(500).json({ success: false, error: 'Failed to invite user' });
  }
});

// ============================================
// PUT /api/org/users/:id
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
    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...Object.values(updates), req.params.id);

    const updated = db.prepare('SELECT id, email, full_name, role, is_active FROM users WHERE id = ?').get(req.params.id);
    res.json({ success: true, user: updated });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

// ============================================
// GET /api/org/dashboard
// Rich stats for the admin dashboard
// ============================================
router.get('/dashboard', requireAdmin, (req, res) => {
  try {
    const { org_id } = req.user;

    const userStats = db.prepare(`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN last_login_at > datetime('now', '-7 days') THEN 1 ELSE 0 END) as active_last_7_days
      FROM users WHERE org_id = ?
    `).get(org_id);

    const enrolmentStats = db.prepare(`
      SELECT 
        COUNT(*) as total_enrolments,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        ROUND(AVG(progress_pct), 0) as avg_progress
      FROM enrolments WHERE org_id = ?
    `).get(org_id);

    const certStats = db.prepare(`
      SELECT COUNT(*) as total_certs,
        SUM(CASE WHEN expires_at > datetime('now') OR expires_at IS NULL THEN 1 ELSE 0 END) as active_certs,
        SUM(CASE WHEN expires_at < datetime('now', '+30 days') AND expires_at > datetime('now') THEN 1 ELSE 0 END) as expiring_soon
      FROM certificates WHERE org_id = ? AND is_revoked = 0
    `).get(org_id);

    const cbirStats = db.prepare(`
      SELECT COUNT(*) as total_analyses, ROUND(AVG(overall_score), 1) as avg_score
      FROM cbir_sessions WHERE org_id = ?
    `).get(org_id);

    const courseStats = db.prepare(`
      SELECT COUNT(*) as org_courses FROM courses WHERE org_id = ? AND is_published = 1
    `).get(org_id);

    const topCourses = db.prepare(`
      SELECT c.title, COUNT(e.id) as enrolments,
        SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) as completions,
        ROUND(AVG(e.progress_pct), 0) as avg_progress
      FROM enrolments e
      JOIN courses c ON c.id = e.course_id
      WHERE e.org_id = ?
      GROUP BY c.id ORDER BY enrolments DESC LIMIT 5
    `).all(org_id);

    const recentActivity = db.prepare(`
      SELECT u.full_name, c.title as course_title, e.status, e.progress_pct, e.updated_at
      FROM enrolments e
      JOIN users u ON u.id = e.user_id
      JOIN courses c ON c.id = e.course_id
      WHERE e.org_id = ?
      ORDER BY e.updated_at DESC LIMIT 10
    `).all(org_id);

    res.json({
      success: true,
      dashboard: {
        users: userStats,
        enrolments: enrolmentStats,
        certificates: certStats,
        cbir: cbirStats,
        courses: courseStats,
        top_courses: topCourses,
        recent_activity: recentActivity
      }
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, error: 'Failed to load dashboard' });
  }
});

module.exports = router;
