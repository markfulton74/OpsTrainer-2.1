// ============================================
// OpsTrainer 2.1 — Certificates Routes
// POST /api/certificates/issue/:enrolmentId — issue cert on completion
// GET  /api/certificates/verify/:number     — public verify (no auth)
// GET  /api/certificates/my                 — user's certificates
// GET  /api/certificates/org               — org admin: all org certs
// ============================================
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function generateCertNumber(orgSlug) {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `OT-${orgSlug.substring(0, 4).toUpperCase()}-${year}-${rand}`;
}

// ============================================
// POST /api/certificates/issue/:enrolmentId
// Issues certificate for a completed enrolment
// ============================================
router.post('/issue/:enrolmentId', requireAuth, (req, res) => {
  try {
    const { id: userId, org_id } = req.user;

    const enrolment = db.prepare(`
      SELECT e.*, c.title as course_title, o.slug as org_slug
      FROM enrolments e
      JOIN courses c ON c.id = e.course_id
      JOIN organisations o ON o.id = e.org_id
      WHERE e.id = ? AND e.user_id = ? AND e.org_id = ?
    `).get(req.params.enrolmentId, userId, org_id);

    if (!enrolment) return res.status(404).json({ success: false, error: 'Enrolment not found' });
    if (enrolment.status !== 'completed') {
      return res.status(400).json({ success: false, error: 'Course not yet completed' });
    }

    // Check if already issued
    const existing = db.prepare('SELECT * FROM certificates WHERE enrolment_id = ?').get(req.params.enrolmentId);
    if (existing) return res.json({ success: true, certificate: existing, already_issued: true });

    const certNumber = generateCertNumber(enrolment.org_slug);
    const certId = uuidv4();
    const verifyUrl = `${process.env.APP_URL || 'https://opstrainer.co.za'}/verify/${certNumber}`;

    // Expiry: 2 years from issue
    const expiresAt = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO certificates (id, user_id, course_id, org_id, enrolment_id, certificate_number, expires_at, verify_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(certId, userId, enrolment.course_id, org_id, req.params.enrolmentId, certNumber, expiresAt, verifyUrl);

    const certificate = db.prepare('SELECT * FROM certificates WHERE id = ?').get(certId);
    console.log(`✅ Certificate issued: ${certNumber} for user ${userId}`);

    res.status(201).json({ success: true, certificate });
  } catch (err) {
    console.error('Issue certificate error:', err);
    res.status(500).json({ success: false, error: 'Failed to issue certificate' });
  }
});

// ============================================
// GET /api/certificates/verify/:number
// PUBLIC — no auth required. QR code target.
// ============================================
router.get('/verify/:number', (req, res) => {
  try {
    const cert = db.prepare(`
      SELECT 
        cert.certificate_number, cert.issued_at, cert.expires_at, cert.is_revoked,
        u.full_name as learner_name,
        c.title as course_title, c.category, c.difficulty,
        o.name as org_name
      FROM certificates cert
      JOIN users u ON u.id = cert.user_id
      JOIN courses c ON c.id = cert.course_id
      JOIN organisations o ON o.id = cert.org_id
      WHERE cert.certificate_number = ?
    `).get(req.params.number);

    if (!cert) {
      return res.status(404).json({
        success: false,
        valid: false,
        error: 'Certificate not found'
      });
    }

    const isExpired = cert.expires_at && new Date(cert.expires_at) < new Date();

    res.json({
      success: true,
      valid: !cert.is_revoked && !isExpired,
      revoked: cert.is_revoked === 1,
      expired: isExpired,
      certificate: {
        number: cert.certificate_number,
        learner_name: cert.learner_name,
        course_title: cert.course_title,
        category: cert.category,
        org_name: cert.org_name,
        issued_at: cert.issued_at,
        expires_at: cert.expires_at
      }
    });
  } catch (err) {
    console.error('Verify certificate error:', err);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

// ============================================
// GET /api/certificates/my
// ============================================
router.get('/my', requireAuth, (req, res) => {
  try {
    const { id: userId } = req.user;
    const certs = db.prepare(`
      SELECT cert.*, c.title as course_title, c.category, c.difficulty, o.name as org_name
      FROM certificates cert
      JOIN courses c ON c.id = cert.course_id
      JOIN organisations o ON o.id = cert.org_id
      WHERE cert.user_id = ? AND cert.is_revoked = 0
      ORDER BY cert.issued_at DESC
    `).all(userId);

    res.json({ success: true, certificates: certs });
  } catch (err) {
    console.error('My certificates error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch certificates' });
  }
});

// ============================================
// GET /api/certificates/org
// Admin: all certificates for the org
// ============================================
router.get('/org', requireAdmin, (req, res) => {
  try {
    const { org_id } = req.user;
    const { user_id, course_id, expired } = req.query;

    let query = `
      SELECT cert.*, u.full_name as learner_name, u.email as learner_email,
             c.title as course_title, c.category
      FROM certificates cert
      JOIN users u ON u.id = cert.user_id
      JOIN courses c ON c.id = cert.course_id
      WHERE cert.org_id = ?
    `;
    const params = [org_id];

    if (user_id) { query += ' AND cert.user_id = ?'; params.push(user_id); }
    if (course_id) { query += ' AND cert.course_id = ?'; params.push(course_id); }
    if (expired === 'true') { query += ' AND cert.expires_at < CURRENT_TIMESTAMP'; }
    if (expired === 'false') { query += ' AND (cert.expires_at IS NULL OR cert.expires_at > CURRENT_TIMESTAMP)'; }

    query += ' ORDER BY cert.issued_at DESC';

    const certs = db.prepare(query).all(...params);

    // Summary stats
    const stats = {
      total: certs.length,
      active: certs.filter(c => !c.is_revoked && (!c.expires_at || new Date(c.expires_at) > new Date())).length,
      expiring_soon: certs.filter(c => {
        if (!c.expires_at) return false;
        const exp = new Date(c.expires_at);
        const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        return exp > new Date() && exp < soon;
      }).length,
      revoked: certs.filter(c => c.is_revoked).length
    };

    res.json({ success: true, certificates: certs, stats });
  } catch (err) {
    console.error('Org certificates error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch org certificates' });
  }
});

module.exports = router;
