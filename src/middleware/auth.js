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
  const user = db.prepare(`
    SELECT u.id, u.email, u.full_name, u.role, u.org_id, u.is_active,
           o.name as org_name, o.subscription_tier, o.subscription_status
    FROM users u
    JOIN organisations o ON o.id = u.org_id
    WHERE u.id = ? AND u.is_active = 1
  `).get(decoded.userId);

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
