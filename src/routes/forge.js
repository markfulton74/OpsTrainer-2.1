// ============================================
// OpsTrainer 2.1 — Course Forge Routes
// The AI-powered course builder
//
// POST /api/forge/generate-structure  — Step 1: Generate course outline
// POST /api/forge/generate-module     — Step 2: Generate module content
// POST /api/forge/publish             — Step 3: Save course to DB
// GET  /api/forge/jobs                — List org's forge jobs
// GET  /api/forge/jobs/:id            — Get job status + result
// ============================================
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { callAI } = require('../services/ai');

const router = express.Router();

// ============================================
// POST /api/forge/generate-structure
// Step 1 of Course Forge — generates the full
// course outline from high-level inputs
// ============================================
router.post('/generate-structure', requireAdmin, async (req, res) => {
  try {
    const { org_id, id: userId } = req.user;
    const {
      topic,
      audience,
      outcomes,
      doctrine_text,
      num_modules = 4,
      estimated_hours = 2.0,
      language = 'en'
    } = req.body;

    if (!topic || !audience || !outcomes || !Array.isArray(outcomes) || outcomes.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'topic, audience, and outcomes (array) are required'
      });
    }

    // Create forge job record
    const jobId = uuidv4();
    db.prepare(`
      INSERT INTO forge_jobs (id, org_id, created_by, status, topic, audience, outcomes,
        doctrine_text, num_modules, estimated_hours, language)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId, org_id, userId, 'generating', topic, audience,
      JSON.stringify(outcomes), doctrine_text || null,
      num_modules, estimated_hours, language
    );

    const systemPrompt = `You are an expert instructional designer specialising in humanitarian training.
Your task is to design professional, field-relevant training courses for humanitarian workers.
You must respond with ONLY valid JSON, no markdown, no explanation.
${doctrine_text ? `\nImportant: This organisation uses the following doctrine/protocols — incorporate them throughout:\n${doctrine_text.substring(0, 3000)}` : ''}`;

    const userMessage = `Design a humanitarian training course with these parameters:

TOPIC: ${topic}
TARGET AUDIENCE: ${audience}
LEARNING OUTCOMES:
${outcomes.map((o, i) => `${i + 1}. ${o}`).join('\n')}
NUMBER OF MODULES: ${num_modules}
ESTIMATED TOTAL HOURS: ${estimated_hours}
LANGUAGE: ${language}

Return a JSON object with this exact structure:
{
  "title": "Full course title",
  "subtitle": "One line subtitle",
  "description": "2-3 sentence course description",
  "category": "e.g. Protection | Logistics | WASH | CVA | Leadership | etc",
  "difficulty": "beginner|intermediate|advanced",
  "key_takeaways": ["takeaway 1", "takeaway 2", "takeaway 3"],
  "modules": [
    {
      "order": 1,
      "title": "Module title",
      "description": "What this module covers in 1-2 sentences",
      "estimated_minutes": 30,
      "lessons": [
        {
          "order": 1,
          "title": "Lesson title",
          "content_type": "lesson|scenario|assessment",
          "estimated_minutes": 10,
          "key_concepts": ["concept1", "concept2"]
        }
      ],
      "competency_codes": ["e.g. HUM_PRINCIPLES, NEEDS_ASSESS — use existing codes or suggest new ones"]
    }
  ],
  "suggested_competencies": ["list of competency codes relevant to this course"],
  "assessment_approach": "Brief description of how learning will be assessed"
}`;

    let structureJson;
    try {
      const raw = await callAI(systemPrompt, userMessage, { json_mode: true, temperature: 0.6, max_tokens: 4000 });
      structureJson = JSON.parse(raw);
    } catch (aiErr) {
      const errMsg = aiErr.message || 'Unknown AI error';
      console.error('AI generation error:', errMsg);
      db.prepare("UPDATE forge_jobs SET status = 'failed', error_message = ? WHERE id = ?")
        .run(`AI generation failed: ${errMsg}`, jobId);
      // Return the actual error so the client can show it
      return res.status(500).json({ 
        success: false, 
        error: errMsg.includes('DEEPSEEK_API_KEY not configured') 
          ? 'DEEPSEEK_API_KEY not configured on the server'
          : errMsg.includes('401') || errMsg.includes('403')
          ? 'DeepSeek API key is invalid or unauthorised'
          : errMsg.includes('429')
          ? 'DeepSeek rate limit reached — please wait a moment and try again'
          : `AI generation failed: ${errMsg}`
      });
    }

    // Save structure to job
    db.prepare("UPDATE forge_jobs SET generated_structure = ? WHERE id = ?")
      .run(JSON.stringify(structureJson), jobId);

    console.log(`✅ Forge structure generated: "${structureJson.title}" (job: ${jobId})`);

    res.json({
      success: true,
      job_id: jobId,
      structure: structureJson
    });
  } catch (err) {
    console.error('Forge generate-structure error:', err);
    res.status(500).json({ success: false, error: 'Structure generation failed' });
  }
});

// ============================================
// POST /api/forge/generate-module
// Step 2 — Generate full content for one module
// Call once per module (can be parallelised on frontend)
// ============================================
router.post('/generate-module', requireAdmin, async (req, res) => {
  try {
    const { job_id, module_index, module_title, module_description, lessons, course_title, audience, doctrine_text } = req.body;

    if (!module_title || !lessons || !Array.isArray(lessons)) {
      return res.status(400).json({ success: false, error: 'module_title and lessons array required' });
    }

    const systemPrompt = `You are an expert instructional designer creating field-relevant humanitarian training content.
Write in clear, practical language appropriate for experienced humanitarian workers.
Avoid jargon. Use real-world examples, field scenarios, and actionable guidance.
Respond with ONLY valid JSON.
${doctrine_text ? `\nIncorporate this organisation's doctrine where relevant:\n${doctrine_text.substring(0, 2000)}` : ''}`;

    const userMessage = `Generate full content for this training module.

COURSE: ${course_title}
AUDIENCE: ${audience}
MODULE: ${module_title}
DESCRIPTION: ${module_description || 'No additional description provided'}

LESSONS TO GENERATE:
${lessons.map((l, i) => `${i + 1}. "${l.title}" (type: ${l.content_type}, ~${l.estimated_minutes} min)`).join('\n')}

Return JSON with this exact structure:
{
  "module_title": "${module_title}",
  "lessons": [
    {
      "title": "Lesson title",
      "content_type": "lesson|scenario|assessment",
      "estimated_minutes": 15,
      "content_html": "<h2>Title</h2><p>Full lesson content in HTML format. Use h2, h3, p, ul, ol, li, strong, em tags. Be thorough — 400-800 words minimum per lesson.</p>",
      "questions": [
        {
          "question_text": "Question text here?",
          "question_type": "mcq|open_ended|scenario",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correct_answer": "Option A",
          "explanation": "Why this is correct",
          "difficulty": "easy|medium|hard"
        }
      ]
    }
  ]
}

For scenario lessons: create a realistic field situation and 2-3 open-ended questions requiring critical thinking.
For assessment lessons: create 5 MCQ questions covering the module's key concepts.
For regular lessons: create 2 MCQ questions and 1 open-ended question.`;

    const raw = await callAI(systemPrompt, userMessage, { json_mode: true, temperature: 0.7, max_tokens: 6000 });
    const moduleContent = JSON.parse(raw);

    res.json({ success: true, module_index, module: moduleContent, content: moduleContent });
  } catch (err) {
    console.error('Forge generate-module error:', err);
    res.status(500).json({ success: false, error: `Module generation failed: ${err.message}` });
  }
});

// ============================================
// POST /api/forge/publish
// Step 3 — Save the finalized course to DB
// ============================================
router.post('/publish', requireAdmin, async (req, res) => {
  try {
    const { org_id, id: userId } = req.user;
    const { job_id, course_data, modules_data } = req.body;

    if (!course_data || !modules_data || !Array.isArray(modules_data)) {
      return res.status(400).json({ success: false, error: 'course_data and modules_data required' });
    }

    // Get job for metadata
    let job = null;
    if (job_id) {
      job = db.prepare('SELECT * FROM forge_jobs WHERE id = ? AND org_id = ?').get(job_id, org_id);
    }

    // Create course
    const courseId = uuidv4();
    let slug = (course_data.title || 'course').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existingSlug = db.prepare('SELECT id FROM courses WHERE org_id = ? AND slug = ?').get(org_id, slug);
    if (existingSlug) slug = `${slug}-${Date.now()}`;

    db.prepare(`
      INSERT INTO courses (
        id, org_id, title, slug, description, category, difficulty,
        estimated_hours, language, is_published, is_free_for_org,
        forge_generated, forge_topic, forge_audience, forge_outcomes, forge_doctrine,
        created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?, ?, ?, ?)
    `).run(
      courseId, org_id,
      course_data.title, slug, course_data.description || null,
      course_data.category || null, course_data.difficulty || 'intermediate',
      course_data.estimated_hours || 2.0, course_data.language || 'en',
      job?.topic || course_data.title,
      job?.audience || null,
      job?.outcomes || null,
      job?.doctrine_text || null,
      userId
    );

    // Insert modules + lessons + questions
    const insertModule = db.prepare(`
      INSERT INTO modules (id, course_id, title, description, display_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertLesson = db.prepare(`
      INSERT INTO lessons (id, module_id, title, content_html, content_type, display_order, estimated_minutes, ai_generated)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const insertQuestion = db.prepare(`
      INSERT INTO questions (id, course_id, lesson_id, question_text, question_type, options, correct_answer, explanation, difficulty, ai_generated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    const publishAll = db.transaction(() => {
      for (let mi = 0; mi < modules_data.length; mi++) {
        const mod = modules_data[mi];
        const moduleId = uuidv4();
        insertModule.run(moduleId, courseId, mod.module_title || `Module ${mi + 1}`, mod.description || null, mi + 1);

        if (mod.lessons && Array.isArray(mod.lessons)) {
          for (let li = 0; li < mod.lessons.length; li++) {
            const lesson = mod.lessons[li];
            const lessonId = uuidv4();
            insertLesson.run(
              lessonId, moduleId,
              lesson.title || `Lesson ${li + 1}`,
              lesson.content_html || '',
              lesson.content_type || 'lesson',
              li + 1,
              lesson.estimated_minutes || 15
            );

            if (lesson.questions && Array.isArray(lesson.questions)) {
              for (const q of lesson.questions) {
                insertQuestion.run(
                  uuidv4(), courseId, lessonId,
                  q.question_text,
                  q.question_type || 'mcq',
                  q.options ? JSON.stringify(q.options) : null,
                  q.correct_answer || null,
                  q.explanation || null,
                  q.difficulty || 'medium'
                );
              }
            }
          }
        }
      }
    });

    publishAll();

    // Update forge job
    if (job_id) {
      db.prepare("UPDATE forge_jobs SET status = 'published', course_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(courseId, job_id);
    }

    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
    console.log(`✅ Course Forge published: "${course.title}" (${courseId})`);

    res.status(201).json({ success: true, course_id: courseId, course });
  } catch (err) {
    console.error('Forge publish error:', err);
    res.status(500).json({ success: false, error: 'Publish failed' });
  }
});

// ============================================
// GET /api/forge/jobs
// ============================================
router.get('/jobs', requireAdmin, (req, res) => {
  try {
    const { org_id } = req.user;
    const jobs = db.prepare(`
      SELECT fj.*, u.full_name as created_by_name, c.title as course_title
      FROM forge_jobs fj
      LEFT JOIN users u ON u.id = fj.created_by
      LEFT JOIN courses c ON c.id = fj.course_id
      WHERE fj.org_id = ?
      ORDER BY fj.created_at DESC
      LIMIT 50
    `).all(org_id);

    res.json({ success: true, jobs });
  } catch (err) {
    console.error('Forge jobs error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch jobs' });
  }
});

// ============================================
// GET /api/forge/jobs/:id
// ============================================
router.get('/jobs/:id', requireAdmin, (req, res) => {
  try {
    const { org_id } = req.user;
    const job = db.prepare('SELECT * FROM forge_jobs WHERE id = ? AND org_id = ?').get(req.params.id, org_id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });

    if (job.generated_structure) {
      job.generated_structure = JSON.parse(job.generated_structure);
    }

    res.json({ success: true, job });
  } catch (err) {
    console.error('Forge job detail error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch job' });
  }
});

module.exports = router;
