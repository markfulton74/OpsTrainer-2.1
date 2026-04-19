// ============================================
// OpsTrainer 2.1 — Auth Middleware
// ============================================
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

/**
 * Verifies JWT and attaches user + org to req
 */
function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing or invalid authorization header' });
  }

  const token = header.slice(7);
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Token expired or invalid' });
  }

  // Fetch user from DB on each request (ensures revoked users are blocked)
  let user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(decoded.userId);
  if (user) {
    const org = db.prepare('SELECT * FROM organisations WHERE id = ?').get(user.org_id);
    if (org) {
      user.org_name = org.name;
      user.subscription_tier = org.subscription_tier;
      user.subscription_status = org.subscription_status;
    }
  }

  if (!user) {
    return res.status(401).json({ success: false, error: 'User not found or deactivated' });
  }

  req.user = user;
  next();
}

/**
 * Requires org_admin or superadmin role
 */
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!['org_admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
  });
}

/**
 * Requires superadmin role (platform-level)
 */
function requireSuperAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: 'Superadmin access required' });
    }
    next();
  });
}

/**
 * Generates access + refresh tokens
 */
function generateTokens(userId, orgId, role) {
  const accessToken = jwt.sign(
    { userId, orgId, role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
  const refreshToken = jwt.sign(
    { userId, orgId, role },
    process.env.JWT_REFRESH_SECRET || JWT_SECRET + '_refresh',
    { expiresIn: '30d' }
  );
  return { accessToken, refreshToken };
}

module.exports = { requireAuth, requireAdmin, requireSuperAdmin, generateTokens };
