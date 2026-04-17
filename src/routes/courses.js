// ============================================
// OpsTrainer 2.1 — Courses Routes
// GET  /api/courses              — list (org + platform)
// GET  /api/courses/:id          — detail + modules
// POST /api/courses              — create (admin)
// PUT  /api/courses/:id          — update (admin)
// POST /api/courses/:id/enrol    — enrol learner
// GET  /api/courses/:id/progress — learner progress
// POST /api/courses/:id/lessons/:lessonId/complete — mark complete
// ============================================
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ============================================
// GET /api/courses
// Returns platform courses + org's own courses
// ============================================
router.get('/', requireAuth, (req, res) => {
  try {
    const { org_id, role } = req.user;
    const isAdmin = ['org_admin', 'superadmin', 'manager'].includes(role);
    const showAll = isAdmin && req.query.all === '1';

    const publishedFilter = showAll ? '' : 'AND c.is_published = 1';

    const courses = db.prepare(`
      SELECT c.*,
             u.full_name as created_by_name,
             COUNT(DISTINCT e.id) as enrolment_count
      FROM courses c
      LEFT JOIN users u ON u.id = c.created_by
      LEFT JOIN enrolments e ON e.course_id = c.id AND e.org_id = ?
      WHERE (c.org_id = ? OR c.is_platform_course = 1)
      ${publishedFilter}
      GROUP BY c.id
      ORDER BY c.is_platform_course DESC, c.created_at DESC
    `).all(org_id, org_id);

    res.json({ success: true, courses });
  } catch (err) {
    console.error('List courses error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch courses' });
  }
});

// ============================================
// GET /api/courses/:id
// Full course detail with modules and lessons
// ============================================
router.get('/:id', requireAuth, (req, res) => {
  try {
    const { org_id, id: userId } = req.user;
    const { role } = req.user;
    const isAdmin = ['org_admin', 'superadmin', 'manager'].includes(role);
    const publishedClause = isAdmin ? '' : 'AND c.is_published = 1';

    const course = db.prepare(`
      SELECT c.*, u.full_name as created_by_name
      FROM courses c
      LEFT JOIN users u ON u.id = c.created_by
      WHERE c.id = ? AND (c.org_id = ? OR c.is_platform_course = 1) ${publishedClause}
    `).get(req.params.id, org_id);

    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }

    // Modules + lessons
    const modules = db.prepare(`
      SELECT m.*, COUNT(l.id) as lesson_count
      FROM modules m
      LEFT JOIN lessons l ON l.module_id = m.id
      WHERE m.course_id = ?
      GROUP BY m.id
      ORDER BY m.display_order
    `).all(course.id);

    for (const mod of modules) {
      mod.lessons = db.prepare(`
        SELECT id, title, content_type, display_order, estimated_minutes
        FROM lessons WHERE module_id = ? ORDER BY display_order
      `).all(mod.id);
    }

    // User enrolment
    const enrolment = db.prepare(
      'SELECT * FROM enrolments WHERE user_id = ? AND course_id = ?'
    ).get(userId, course.id);

    // Competencies
    const competencies = db.prepare(`
      SELECT co.id, co.code, co.name, co.level, ca.name as area_name, cd.name as domain_name
      FROM course_competencies cc
      JOIN competencies co ON co.id = cc.competency_id
      JOIN competency_areas ca ON ca.id = co.area_id
      JOIN competency_domains cd ON cd.id = ca.domain_id
      WHERE cc.course_id = ?
    `).all(course.id);

    res.json({ success: true, course, modules, enrolment, competencies });
  } catch (err) {
    console.error('Get course error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch course' });
  }
});

// ============================================
// POST /api/courses
// Create a new course (admin only)
// ============================================
router.post('/', requireAdmin, (req, res) => {
  try {
    const { org_id, id: userId } = req.user;
    const {
      title, description, category, difficulty, estimated_hours,
      language, is_free_for_org, price_usd
    } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }

    const id = uuidv4();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    db.prepare(`
      INSERT INTO courses (id, org_id, title, slug, description, category, difficulty,
        estimated_hours, language, is_free_for_org, price_usd, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, org_id, title, slug, description || null, category || null,
      difficulty || 'beginner', estimated_hours || 1.0,
      language || 'en', is_free_for_org !== false ? 1 : 0,
      price_usd || 0, userId
    );

    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
    res.status(201).json({ success: true, course });
  } catch (err) {
    console.error('Create course error:', err);
    res.status(500).json({ success: false, error: 'Failed to create course' });
  }
});

// ============================================
// PUT /api/courses/:id
// ============================================
router.put('/:id', requireAdmin, (req, res) => {
  try {
    const { org_id } = req.user;
    const course = db.prepare('SELECT * FROM courses WHERE id = ? AND org_id = ?').get(req.params.id, org_id);
    if (!course) return res.status(404).json({ success: false, error: 'Course not found' });

    const allowed = ['title', 'description', 'category', 'difficulty', 'estimated_hours',
      'language', 'is_published', 'is_free_for_org', 'price_usd', 'thumbnail_url'];

    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    updates.updated_at = new Date().toISOString();
    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE courses SET ${setClause} WHERE id = ?`)
      .run(...Object.values(updates), req.params.id);

    const updated = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
    res.json({ success: true, course: updated });
  } catch (err) {
    console.error('Update course error:', err);
    res.status(500).json({ success: false, error: 'Failed to update course' });
  }
});

// ============================================
// POST /api/courses/:id/enrol
// ============================================
router.post('/:id/enrol', requireAuth, (req, res) => {
  try {
    const { id: userId, org_id } = req.user;
    const course = db.prepare(`
      SELECT * FROM courses WHERE id = ? AND is_published = 1
      AND (org_id = ? OR is_platform_course = 1)
    `).get(req.params.id, org_id);

    if (!course) return res.status(404).json({ success: false, error: 'Course not found' });

    const existing = db.prepare('SELECT * FROM enrolments WHERE user_id = ? AND course_id = ?')
      .get(userId, req.params.id);
    if (existing) return res.json({ success: true, enrolment: existing, already_enrolled: true });

    const id = uuidv4();
    db.prepare(`
      INSERT INTO enrolments (id, user_id, course_id, org_id, status, started_at)
      VALUES (?, ?, ?, ?, 'enrolled', CURRENT_TIMESTAMP)
    `).run(id, userId, req.params.id, org_id);

    const enrolment = db.prepare('SELECT * FROM enrolments WHERE id = ?').get(id);
    res.status(201).json({ success: true, enrolment });
  } catch (err) {
    console.error('Enrol error:', err);
    res.status(500).json({ success: false, error: 'Enrolment failed' });
  }
});

// ============================================
// POST /api/courses/:id/lessons/:lessonId/complete
// ============================================
router.post('/:id/lessons/:lessonId/complete', requireAuth, (req, res) => {
  try {
    const { id: userId } = req.user;
    const { time_spent_seconds } = req.body;

    const enrolment = db.prepare(
      'SELECT * FROM enrolments WHERE user_id = ? AND course_id = ?'
    ).get(userId, req.params.id);

    if (!enrolment) return res.status(400).json({ success: false, error: 'Not enrolled in this course' });

    // Upsert lesson completion
    const existing = db.prepare('SELECT id FROM lesson_completions WHERE user_id = ? AND lesson_id = ?')
      .get(userId, req.params.lessonId);

    if (!existing) {
      db.prepare(`
        INSERT INTO lesson_completions (id, user_id, lesson_id, enrolment_id, time_spent_seconds)
        VALUES (?, ?, ?, ?, ?)
      `).run(uuidv4(), userId, req.params.lessonId, enrolment.id, time_spent_seconds || 0);
    }

    // Recalculate progress
    const totalLessons = db.prepare(`
      SELECT COUNT(*) as count FROM lessons l
      JOIN modules m ON m.id = l.module_id WHERE m.course_id = ?
    `).get(req.params.id).count;

    const completedLessons = db.prepare(`
      SELECT COUNT(*) as count FROM lesson_completions lc
      JOIN lessons l ON l.id = lc.lesson_id
      JOIN modules m ON m.id = l.module_id
      WHERE lc.user_id = ? AND m.course_id = ?
    `).get(userId, req.params.id).count;

    const progressPct = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
    const status = progressPct >= 100 ? 'completed' : 'in_progress';
    const completedAt = progressPct >= 100 ? new Date().toISOString() : null;

    db.prepare(`
      UPDATE enrolments SET progress_pct = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      ${completedAt ? ', completed_at = ?' : ''}
      WHERE id = ?
    `).run(...[progressPct, status, ...(completedAt ? [completedAt] : []), enrolment.id]);

    res.json({ success: true, progress_pct: progressPct, status });
  } catch (err) {
    console.error('Complete lesson error:', err);
    res.status(500).json({ success: false, error: 'Failed to record completion' });
  }
});

// ============================================
// DELETE /api/courses/:id
// ============================================
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    const { org_id } = req.user;
    const course = db.prepare('SELECT * FROM courses WHERE id = ? AND org_id = ?').get(req.params.id, org_id);
    if (!course) return res.status(404).json({ success: false, error: 'Course not found' });

    // Cascade delete modules, lessons, enrolments
    const modules = db.prepare('SELECT id FROM modules WHERE course_id = ?').all(req.params.id);
    for (const mod of modules) {
      db.prepare('DELETE FROM lessons WHERE module_id = ?').run(mod.id);
    }
    db.prepare('DELETE FROM modules WHERE course_id = ?').run(req.params.id);
    db.prepare('DELETE FROM enrolments WHERE course_id = ?').run(req.params.id);
    db.prepare('DELETE FROM courses WHERE id = ?').run(req.params.id);

    res.json({ success: true });
  } catch (err) {
    console.error('Delete course error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete course' });
  }
});


// ============================================
// MODULES — CRUD
// POST   /api/courses/:id/modules
// PUT    /api/courses/:id/modules/:moduleId
// DELETE /api/courses/:id/modules/:moduleId
// ============================================
router.post('/:id/modules', requireAdmin, (req, res) => {
  try {
    const { org_id } = req.user;
    const course = db.prepare('SELECT * FROM courses WHERE id = ? AND org_id = ?').get(req.params.id, org_id);
    if (!course) return res.status(404).json({ success: false, error: 'Course not found' });

    const { title, description } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'Module title required' });

    const id = require('crypto').randomUUID();
    const maxOrder = db.prepare('SELECT COALESCE(MAX(display_order),0) as m FROM modules WHERE course_id = ?').get(req.params.id).m;

    db.prepare(`INSERT INTO modules (id, course_id, title, description, display_order) VALUES (?, ?, ?, ?, ?)`)
      .run(id, req.params.id, title, description || null, maxOrder + 1);

    const mod = db.prepare('SELECT * FROM modules WHERE id = ?').get(id);
    res.status(201).json({ success: true, module: mod });
  } catch (err) {
    console.error('Create module error:', err);
    res.status(500).json({ success: false, error: 'Failed to create module' });
  }
});

router.put('/:id/modules/:moduleId', requireAdmin, (req, res) => {
  try {
    const { org_id } = req.user;
    const course = db.prepare('SELECT * FROM courses WHERE id = ? AND org_id = ?').get(req.params.id, org_id);
    if (!course) return res.status(404).json({ success: false, error: 'Course not found' });

    const allowed = ['title', 'description', 'display_order'];
    const updates = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    if (!Object.keys(updates).length) return res.status(400).json({ success: false, error: 'Nothing to update' });

    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE modules SET ${setClause} WHERE id = ?`).run(...Object.values(updates), req.params.moduleId);

    const mod = db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.moduleId);
    res.json({ success: true, module: mod });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update module' });
  }
});

router.delete('/:id/modules/:moduleId', requireAdmin, (req, res) => {
  try {
    const { org_id } = req.user;
    const course = db.prepare('SELECT * FROM courses WHERE id = ? AND org_id = ?').get(req.params.id, org_id);
    if (!course) return res.status(404).json({ success: false, error: 'Course not found' });

    db.prepare('DELETE FROM lessons WHERE module_id = ?').run(req.params.moduleId);
    db.prepare('DELETE FROM modules WHERE id = ?').run(req.params.moduleId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete module' });
  }
});

// ============================================
// LESSONS — CRUD
// POST   /api/courses/:id/modules/:moduleId/lessons
// PUT    /api/courses/:id/modules/:moduleId/lessons/:lessonId
// DELETE /api/courses/:id/modules/:moduleId/lessons/:lessonId
// GET    /api/courses/:id/modules/:moduleId/lessons/:lessonId (full content)
// ============================================
router.post('/:id/modules/:moduleId/lessons', requireAdmin, (req, res) => {
  try {
    const { title, content_type, content_html, estimated_minutes } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'Lesson title required' });

    const id = require('crypto').randomUUID();
    const maxOrder = db.prepare('SELECT COALESCE(MAX(display_order),0) as m FROM lessons WHERE module_id = ?').get(req.params.moduleId).m;

    db.prepare(`INSERT INTO lessons (id, module_id, title, content_type, content_html, estimated_minutes, display_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, req.params.moduleId, title, content_type || 'text', content_html || '', estimated_minutes || 10, maxOrder + 1);

    const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(id);
    res.status(201).json({ success: true, lesson });
  } catch (err) {
    console.error('Create lesson error:', err);
    res.status(500).json({ success: false, error: 'Failed to create lesson' });
  }
});

router.put('/:id/modules/:moduleId/lessons/:lessonId', requireAdmin, (req, res) => {
  try {
    const allowed = ['title', 'content_type', 'content_html', 'estimated_minutes', 'display_order'];
    const updates = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    if (!Object.keys(updates).length) return res.status(400).json({ success: false, error: 'Nothing to update' });

    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE lessons SET ${setClause} WHERE id = ?`).run(...Object.values(updates), req.params.lessonId);

    const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.lessonId);
    res.json({ success: true, lesson });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update lesson' });
  }
});

router.delete('/:id/modules/:moduleId/lessons/:lessonId', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM lessons WHERE id = ?').run(req.params.lessonId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete lesson' });
  }
});

router.get('/:id/modules/:moduleId/lessons/:lessonId', requireAuth, (req, res) => {
  try {
    const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.lessonId);
    if (!lesson) return res.status(404).json({ success: false, error: 'Lesson not found' });
    res.json({ success: true, lesson });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch lesson' });
  }
});


module.exports = router;
