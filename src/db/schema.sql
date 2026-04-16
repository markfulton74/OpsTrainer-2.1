-- ============================================
-- OpsTrainer 2.1 — Core Database Schema
-- Multi-tenant, org-first architecture
-- ============================================

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ============================================
-- ORGANISATIONS (top of the hierarchy)
-- ============================================
CREATE TABLE IF NOT EXISTS organisations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  website TEXT,
  sector TEXT DEFAULT 'humanitarian',
  country TEXT,
  size TEXT CHECK(size IN ('small','medium','large','enterprise')) DEFAULT 'small',
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  subscription_tier TEXT CHECK(subscription_tier IN ('starter','team','enterprise','trial')) DEFAULT 'trial',
  subscription_status TEXT CHECK(subscription_status IN ('active','past_due','cancelled','trialing')) DEFAULT 'trialing',
  trial_ends_at DATETIME,
  max_users INTEGER DEFAULT 10,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- USERS
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT CHECK(role IN ('superadmin','org_admin','manager','learner')) DEFAULT 'learner',
  avatar_url TEXT,
  language TEXT DEFAULT 'en',
  is_active INTEGER DEFAULT 1,
  email_verified INTEGER DEFAULT 0,
  last_login_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(org_id, email)
);

-- ============================================
-- REFRESH TOKENS
-- ============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- COMPETENCY FRAMEWORK
-- ============================================
CREATE TABLE IF NOT EXISTS competency_domains (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS competency_areas (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  domain_id TEXT NOT NULL REFERENCES competency_domains(id),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS competencies (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  area_id TEXT NOT NULL REFERENCES competency_areas(id),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  level TEXT CHECK(level IN ('foundation','intermediate','advanced','expert')) DEFAULT 'foundation',
  display_order INTEGER DEFAULT 0
);

-- ============================================
-- COURSES
-- ============================================
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id TEXT REFERENCES organisations(id) ON DELETE CASCADE,
  -- NULL org_id = platform course (available to all orgs)
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  category TEXT,
  difficulty TEXT CHECK(difficulty IN ('beginner','intermediate','advanced')) DEFAULT 'beginner',
  estimated_hours REAL DEFAULT 1.0,
  language TEXT DEFAULT 'en',
  is_published INTEGER DEFAULT 0,
  is_platform_course INTEGER DEFAULT 0,
  -- Course Forge metadata
  forge_generated INTEGER DEFAULT 0,
  forge_topic TEXT,
  forge_audience TEXT,
  forge_outcomes TEXT, -- JSON array
  forge_doctrine TEXT, -- org doctrine used in generation
  -- Pricing
  price_usd REAL DEFAULT 0,
  is_free_for_org INTEGER DEFAULT 1,
  created_by TEXT REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(org_id, slug)
);

CREATE TABLE IF NOT EXISTS course_competencies (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  competency_id TEXT NOT NULL REFERENCES competencies(id),
  PRIMARY KEY (course_id, competency_id)
);

-- ============================================
-- MODULES & LESSONS
-- ============================================
CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_free_preview INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content_html TEXT, -- AI-generated or manually written HTML
  content_type TEXT CHECK(content_type IN ('lesson','scenario','assessment','video')) DEFAULT 'lesson',
  display_order INTEGER DEFAULT 0,
  estimated_minutes INTEGER DEFAULT 15,
  -- AI generation metadata
  ai_generated INTEGER DEFAULT 0,
  ai_prompt_used TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- ASSESSMENTS & QUESTIONS
-- ============================================
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lesson_id TEXT REFERENCES lessons(id) ON DELETE CASCADE,
  module_id TEXT REFERENCES modules(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type TEXT CHECK(question_type IN ('mcq','open_ended','scenario')) DEFAULT 'mcq',
  options TEXT, -- JSON array for MCQ
  correct_answer TEXT,
  explanation TEXT,
  competency_id TEXT REFERENCES competencies(id),
  difficulty TEXT CHECK(difficulty IN ('easy','medium','hard')) DEFAULT 'medium',
  ai_generated INTEGER DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- ENROLMENTS & PROGRESS
-- ============================================
CREATE TABLE IF NOT EXISTS enrolments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  status TEXT CHECK(status IN ('enrolled','in_progress','completed','abandoned')) DEFAULT 'enrolled',
  progress_pct INTEGER DEFAULT 0,
  started_at DATETIME,
  completed_at DATETIME,
  enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, course_id)
);

CREATE TABLE IF NOT EXISTS lesson_completions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  enrolment_id TEXT NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
  completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  time_spent_seconds INTEGER DEFAULT 0,
  UNIQUE(user_id, lesson_id)
);

-- ============================================
-- CERTIFICATES
-- ============================================
CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id),
  org_id TEXT NOT NULL REFERENCES organisations(id),
  enrolment_id TEXT REFERENCES enrolments(id),
  certificate_number TEXT UNIQUE NOT NULL,
  issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  verify_url TEXT,
  pdf_url TEXT,
  is_revoked INTEGER DEFAULT 0,
  revoked_at DATETIME,
  revoked_reason TEXT
);

-- ============================================
-- CBIR — Cognitive-Behavioral Insight Reports
-- ============================================
CREATE TABLE IF NOT EXISTS cbir_sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  course_id TEXT REFERENCES courses(id),
  module_id TEXT REFERENCES modules(id),
  lesson_id TEXT REFERENCES lessons(id),
  question_id TEXT REFERENCES questions(id),
  user_response TEXT NOT NULL,
  -- CBIR Pillar Scores (0-5 each)
  reasoning_quality REAL,
  decision_making REAL,
  emotional_tone REAL,
  ethical_alignment REAL,
  communication_clarity REAL,
  adaptive_thinking REAL,
  -- Composite
  overall_score REAL,
  ai_insights TEXT, -- JSON
  ai_recommendations TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- AI INSTRUCTOR SESSIONS
-- ============================================
CREATE TABLE IF NOT EXISTS ai_sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  course_id TEXT REFERENCES courses(id),
  session_data TEXT, -- JSON: full conversation history
  language TEXT DEFAULT 'en',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- COURSE FORGE JOBS
-- ============================================
CREATE TABLE IF NOT EXISTS forge_jobs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id TEXT NOT NULL REFERENCES organisations(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  status TEXT CHECK(status IN ('pending','generating','review','published','failed')) DEFAULT 'pending',
  -- Input
  topic TEXT NOT NULL,
  audience TEXT NOT NULL,
  outcomes TEXT NOT NULL, -- JSON array
  doctrine_text TEXT,
  num_modules INTEGER DEFAULT 4,
  estimated_hours REAL DEFAULT 2.0,
  language TEXT DEFAULT 'en',
  -- Output
  course_id TEXT REFERENCES courses(id),
  generated_structure TEXT, -- JSON
  error_message TEXT,
  started_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- PAYMENTS
-- ============================================
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id TEXT NOT NULL REFERENCES organisations(id),
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_invoice_id TEXT,
  amount_usd REAL NOT NULL,
  currency TEXT DEFAULT 'usd',
  status TEXT CHECK(status IN ('pending','succeeded','failed','refunded')) DEFAULT 'pending',
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_courses_org ON courses(org_id);
CREATE INDEX IF NOT EXISTS idx_modules_course ON modules(course_id);
CREATE INDEX IF NOT EXISTS idx_lessons_module ON lessons(module_id);
CREATE INDEX IF NOT EXISTS idx_enrolments_user ON enrolments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrolments_course ON enrolments(course_id);
CREATE INDEX IF NOT EXISTS idx_cbir_user ON cbir_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_cbir_org ON cbir_sessions(org_id);
CREATE INDEX IF NOT EXISTS idx_certificates_user ON certificates(user_id);
CREATE INDEX IF NOT EXISTS idx_certificates_number ON certificates(certificate_number);
CREATE INDEX IF NOT EXISTS idx_forge_jobs_org ON forge_jobs(org_id);
