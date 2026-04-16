// ============================================
// OpsTrainer 2.1 — AI Instructor Routes
// POST /api/ai/chat        — conversational AI instructor
// POST /api/ai/cbir        — CBIR analysis on open responses
// GET  /api/ai/cbir/report — user's CBIR report
// ============================================
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { callAI, callAIWithHistory } = require('../services/ai');

const router = express.Router();

// Supported languages
const LANGUAGE_NAMES = {
  en: 'English', fr: 'French', ar: 'Arabic', es: 'Spanish',
  pt: 'Portuguese', sw: 'Swahili', so: 'Somali', am: 'Amharic',
  ti: 'Tigrinya', ha: 'Hausa', bn: 'Bengali', hi: 'Hindi'
};

// ============================================
// POST /api/ai/chat
// AI Instructor — credential-aware, multi-lingual
// ============================================
router.post('/chat', requireAuth, async (req, res) => {
  try {
    const { id: userId, org_id, full_name } = req.user;
    const { message, history = [], course_id, session_id, language = 'en' } = req.body;

    if (!message) return res.status(400).json({ success: false, error: 'Message is required' });

    // Get course context if provided
    let courseContext = '';
    if (course_id) {
      const course = db.prepare('SELECT title, description, category FROM courses WHERE id = ?').get(course_id);
      if (course) {
        courseContext = `\nCURRENT COURSE: "${course.title}" (${course.category || 'Humanitarian Training'})`;
        if (course.description) courseContext += `\nCourse overview: ${course.description}`;
      }
    }

    // Get user's completed courses for credential awareness
    const completedCourses = db.prepare(`
      SELECT c.title, c.category, cert.issued_at
      FROM enrolments e
      JOIN courses c ON c.id = e.course_id
      LEFT JOIN certificates cert ON cert.enrolment_id = e.id
      WHERE e.user_id = ? AND e.status = 'completed'
      LIMIT 10
    `).all(userId);

    const credentialContext = completedCourses.length > 0
      ? `\nLEARNER CREDENTIALS: ${completedCourses.map(c => `"${c.title}"`).join(', ')}`
      : '';

    const langName = LANGUAGE_NAMES[language] || 'English';

    const systemPrompt = `You are an expert AI instructor for OpsTrainer, a humanitarian training platform.
You specialise in humanitarian operations, protection, logistics, WASH, CVA, and field safety.
You are speaking with ${full_name}.

LANGUAGE: Respond ONLY in ${langName}.
TONE: Professional but approachable. Practical. Field-focused. Never condescending.
STYLE: Use concrete examples from real humanitarian contexts. Be direct and actionable.
${courseContext}
${credentialContext}

RULES:
- Stay within humanitarian training topics
- If asked about something outside your scope, redirect politely
- Adjust depth based on learner's credential level
- Encourage critical thinking — don't just give answers, guide reasoning
- Keep responses focused and concise (150-300 words unless detail is needed)`;

    const reply = await callAIWithHistory(systemPrompt, history, message, { temperature: 0.75, max_tokens: 1500 });

    // Save/update session
    let sessionId = session_id;
    if (!sessionId) {
      sessionId = uuidv4();
      db.prepare(`
        INSERT INTO ai_sessions (id, user_id, org_id, course_id, language, session_data)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(sessionId, userId, org_id, course_id || null, language, JSON.stringify([
        { role: 'user', content: message },
        { role: 'assistant', content: reply }
      ]));
    } else {
      const session = db.prepare('SELECT session_data FROM ai_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
      if (session) {
        const updated = [...(JSON.parse(session.session_data) || []),
          { role: 'user', content: message },
          { role: 'assistant', content: reply }
        ];
        db.prepare('UPDATE ai_sessions SET session_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(JSON.stringify(updated), sessionId);
      }
    }

    res.json({ success: true, reply, session_id: sessionId });
  } catch (err) {
    console.error('AI chat error:', err);
    res.status(500).json({ success: false, error: 'AI instructor unavailable. Please try again.' });
  }
});

// ============================================
// POST /api/ai/cbir
// Cognitive-Behavioral Insight Report analysis
// Runs on every open-ended learner response
// ============================================
router.post('/cbir', requireAuth, async (req, res) => {
  try {
    const { id: userId, org_id } = req.user;
    const { user_response, course_id, module_id, lesson_id, question_id } = req.body;

    if (!user_response || user_response.trim().length < 20) {
      return res.status(400).json({ success: false, error: 'Response too short for analysis' });
    }

    const systemPrompt = `You are a cognitive-behavioral analysis engine for professional humanitarian training assessment.
Analyze learner responses across 6 CBIR pillars and return ONLY valid JSON.
Be rigorous but fair. Score on a 0-5 scale with 0.5 increments.`;

    const userMessage = `Analyze this humanitarian worker's response:

RESPONSE: "${user_response}"

Return JSON with this exact structure (scores 0.0 to 5.0, use 0.5 increments):
{
  "reasoning_quality": {
    "score": 3.5,
    "notes": "Brief observation about logical structure and evidence use"
  },
  "decision_making": {
    "score": 4.0,
    "notes": "Brief observation about deliberation quality and risk recognition"
  },
  "emotional_tone": {
    "score": 3.0,
    "notes": "Brief observation about tone stability and stress indicators"
  },
  "ethical_alignment": {
    "score": 4.5,
    "notes": "Brief observation about humanitarian principles adherence"
  },
  "communication_clarity": {
    "score": 3.5,
    "notes": "Brief observation about clarity and structure of expression"
  },
  "adaptive_thinking": {
    "score": 3.0,
    "notes": "Brief observation about flexibility and creative problem-solving"
  },
  "overall_score": 3.6,
  "summary": "2-3 sentence overall insight",
  "strengths": ["strength 1", "strength 2"],
  "development_areas": ["area 1"],
  "recommendations": ["practical recommendation 1", "practical recommendation 2"]
}`;

    const raw = await callAI(systemPrompt, userMessage, { json_mode: true, temperature: 0.3, max_tokens: 1500 });
    const analysis = JSON.parse(raw);

    // Store in DB
    const cbirId = uuidv4();
    db.prepare(`
      INSERT INTO cbir_sessions (
        id, user_id, org_id, course_id, module_id, lesson_id, question_id,
        user_response, reasoning_quality, decision_making, emotional_tone,
        ethical_alignment, communication_clarity, adaptive_thinking,
        overall_score, ai_insights, ai_recommendations
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cbirId, userId, org_id,
      course_id || null, module_id || null, lesson_id || null, question_id || null,
      user_response,
      analysis.reasoning_quality?.score,
      analysis.decision_making?.score,
      analysis.emotional_tone?.score,
      analysis.ethical_alignment?.score,
      analysis.communication_clarity?.score,
      analysis.adaptive_thinking?.score,
      analysis.overall_score,
      JSON.stringify(analysis),
      JSON.stringify(analysis.recommendations)
    );

    res.json({ success: true, cbir_id: cbirId, analysis });
  } catch (err) {
    console.error('CBIR analysis error:', err);
    res.status(500).json({ success: false, error: 'CBIR analysis failed' });
  }
});

// ============================================
// GET /api/ai/cbir/report
// User's cumulative CBIR report
// ============================================
router.get('/cbir/report', requireAuth, (req, res) => {
  try {
    const { id: userId, org_id } = req.user;
    const { course_id } = req.query;

    const filter = course_id ? 'AND cs.course_id = ?' : '';
    const params = course_id ? [userId, org_id, course_id] : [userId, org_id];

    const sessions = db.prepare(`
      SELECT cs.*, c.title as course_title
      FROM cbir_sessions cs
      LEFT JOIN courses c ON c.id = cs.course_id
      WHERE cs.user_id = ? AND cs.org_id = ? ${filter}
      ORDER BY cs.created_at DESC
      LIMIT 100
    `).all(...params);

    if (sessions.length === 0) {
      return res.json({ success: true, report: null, message: 'No CBIR data yet' });
    }

    // Calculate averages
    const pillars = ['reasoning_quality', 'decision_making', 'emotional_tone',
      'ethical_alignment', 'communication_clarity', 'adaptive_thinking'];

    const averages = {};
    for (const pillar of pillars) {
      const scores = sessions.map(s => s[pillar]).filter(s => s !== null && s !== undefined);
      averages[pillar] = scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
        : null;
    }

    const overallScores = sessions.map(s => s.overall_score).filter(Boolean);
    averages.overall = overallScores.length > 0
      ? Math.round((overallScores.reduce((a, b) => a + b, 0) / overallScores.length) * 10) / 10
      : null;

    // Trend: last 5 vs previous 5
    const recent = sessions.slice(0, 5).map(s => s.overall_score).filter(Boolean);
    const previous = sessions.slice(5, 10).map(s => s.overall_score).filter(Boolean);
    const recentAvg = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
    const previousAvg = previous.length > 0 ? previous.reduce((a, b) => a + b, 0) / previous.length : null;
    const trend = recentAvg && previousAvg ? (recentAvg > previousAvg ? 'improving' : recentAvg < previousAvg ? 'declining' : 'stable') : 'insufficient_data';

    res.json({
      success: true,
      report: {
        session_count: sessions.length,
        averages,
        trend,
        recent_sessions: sessions.slice(0, 10).map(s => ({
          id: s.id,
          course_title: s.course_title,
          overall_score: s.overall_score,
          created_at: s.created_at
        }))
      }
    });
  } catch (err) {
    console.error('CBIR report error:', err);
    res.status(500).json({ success: false, error: 'Failed to generate CBIR report' });
  }
});

// ============================================
// GET /api/ai/cbir/org-report
// Org-level aggregate CBIR — for admin dashboard
// ============================================
router.get('/cbir/org-report', requireAuth, (req, res) => {
  try {
    const { org_id, role } = req.user;
    if (!['org_admin', 'manager', 'superadmin'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Manager access required' });
    }

    const pillars = ['reasoning_quality', 'decision_making', 'emotional_tone',
      'ethical_alignment', 'communication_clarity', 'adaptive_thinking'];

    const avgSelects = pillars.map(p => `ROUND(AVG(${p}), 1) as avg_${p}`).join(', ');

    const orgStats = db.prepare(`
      SELECT 
        COUNT(DISTINCT user_id) as users_analysed,
        COUNT(*) as total_sessions,
        ROUND(AVG(overall_score), 1) as avg_overall,
        ${avgSelects}
      FROM cbir_sessions
      WHERE org_id = ?
    `).get(org_id);

    // Top and bottom performers by pillar
    const userAverages = db.prepare(`
      SELECT 
        u.id, u.full_name,
        COUNT(cs.id) as sessions,
        ROUND(AVG(cs.overall_score), 1) as avg_score
      FROM cbir_sessions cs
      JOIN users u ON u.id = cs.user_id
      WHERE cs.org_id = ?
      GROUP BY u.id
      HAVING sessions >= 3
      ORDER BY avg_score DESC
      LIMIT 20
    `).all(org_id);

    res.json({
      success: true,
      org_report: {
        summary: orgStats,
        user_averages: userAverages
      }
    });
  } catch (err) {
    console.error('Org CBIR report error:', err);
    res.status(500).json({ success: false, error: 'Failed to generate org report' });
  }
});

module.exports = router;
