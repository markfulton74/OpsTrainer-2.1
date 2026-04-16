# OpsTrainer 2.1

> AI-powered humanitarian training platform — built for scale, designed for a $30M exit.

---

## Architecture

```
opstrainer/
├── src/
│   ├── server.js           # Entry point
│   ├── db/
│   │   ├── index.js        # Shared DB instance (SQLite/better-sqlite3)
│   │   ├── schema.sql      # Full DB schema — multi-tenant, org-first
│   │   ├── migrate.js      # Migration runner
│   │   └── seed.js         # Competency framework + demo org
│   ├── middleware/
│   │   └── auth.js         # JWT auth, role guards, token generation
│   ├── routes/
│   │   ├── auth.js         # Register org, login, refresh, logout, /me
│   │   ├── courses.js      # Course CRUD, enrolment, progress tracking
│   │   ├── forge.js        # 🔥 Course Forge — AI course builder
│   │   ├── ai-instructor.js # AI Instructor + CBIR analysis
│   │   ├── certificates.js # Issue, verify (public), org reports
│   │   └── org.js          # Org management, user management, dashboard
│   └── services/
│       └── ai.js           # DeepSeek wrapper (callAI, callAIWithHistory)
├── frontend/               # Frontend (Next.js/React — Phase 2)
├── scripts/                # Utility scripts
├── .env.example
├── package.json
└── README.md
```

---

## Data Model

```
organisations (top level — multi-tenant anchor)
  └── users (roles: superadmin | org_admin | manager | learner)
  └── courses (org-specific OR platform-wide)
       └── modules
            └── lessons (AI-generated HTML content)
            └── questions (MCQ + open-ended + scenarios)
       └── course_competencies (mapped to taxonomy)
  └── enrolments (user × course progress)
       └── lesson_completions
  └── certificates (verifiable, QR-code ready)
  └── cbir_sessions (cognitive-behavioral analysis per response)
  └── ai_sessions (AI instructor conversation history)
  └── forge_jobs (Course Forge generation jobs)
  └── payments (Stripe records)
```

---

## Getting Started

### 1. Clone and install
```bash
git clone https://github.com/markfulton74/OpsTrainer-2.1
cd OpsTrainer-2.1
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your keys
```

### 3. Initialise database
```bash
npm run migrate
npm run seed
```

### 4. Start development server
```bash
npm run dev
```

Demo credentials (after seed):
- Admin: `admin@demo.opstrainer.co.za` / `Admin123!`
- Learner: `learner@demo.opstrainer.co.za` / `Learner123!`

---

## API Reference

### Auth
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/auth/register-org` | None | Create new org + admin user |
| POST | `/api/auth/login` | None | Login |
| POST | `/api/auth/refresh` | None | Refresh access token |
| POST | `/api/auth/logout` | None | Revoke refresh token |
| GET | `/api/auth/me` | Required | Current user + org |

### Courses
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/courses` | Required | List org + platform courses |
| GET | `/api/courses/:id` | Required | Course detail + modules |
| POST | `/api/courses` | Admin | Create course |
| PUT | `/api/courses/:id` | Admin | Update course |
| POST | `/api/courses/:id/enrol` | Required | Enrol in course |
| POST | `/api/courses/:id/lessons/:lessonId/complete` | Required | Mark lesson complete |

### Course Forge 🔥
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/forge/generate-structure` | Admin | Step 1: Generate course outline |
| POST | `/api/forge/generate-module` | Admin | Step 2: Generate module content |
| POST | `/api/forge/publish` | Admin | Step 3: Save course to DB |
| GET | `/api/forge/jobs` | Admin | List forge jobs |
| GET | `/api/forge/jobs/:id` | Admin | Job status + result |

### AI Instructor
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/ai/chat` | Required | Chat with AI instructor |
| POST | `/api/ai/cbir` | Required | CBIR analysis on open response |
| GET | `/api/ai/cbir/report` | Required | User's CBIR report |
| GET | `/api/ai/cbir/org-report` | Manager+ | Org-level CBIR aggregates |

### Certificates
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/certificates/issue/:enrolmentId` | Required | Issue certificate |
| GET | `/api/certificates/verify/:number` | **Public** | Verify certificate (QR target) |
| GET | `/api/certificates/my` | Required | User's certificates |
| GET | `/api/certificates/org` | Admin | All org certificates |

### Organisation
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/org/me` | Required | Org details |
| GET | `/api/org/users` | Admin | List org users |
| POST | `/api/org/users/invite` | Admin | Add user to org |
| PUT | `/api/org/users/:id` | Admin | Update user role/status |
| GET | `/api/org/dashboard` | Admin | Full dashboard stats |

---

## Course Forge — How It Works

The AI course builder runs in 3 steps:

**Step 1 — Generate Structure** (`/api/forge/generate-structure`)
Input: topic, audience, outcomes, optional doctrine text
Output: full course outline — title, modules, lessons, competency mappings

**Step 2 — Generate Module Content** (`/api/forge/generate-module`)
Input: one module's metadata from Step 1
Output: full HTML lesson content + questions for every lesson
Run once per module — can be parallelised for speed.

**Step 3 — Publish** (`/api/forge/publish`)
Input: finalized course_data + all modules_data (reviewed/edited by admin)
Output: course saved to DB, available to org learners immediately.

Total time from idea to live course: ~10-15 minutes.

---

## Security

- JWT access tokens (15min) + refresh tokens (30 days, rotated on use)
- Refresh tokens stored as SHA-256 hashes in DB
- Rate limiting: 200 req/15min general, 20 req/15min on auth routes
- Helmet.js security headers
- bcrypt (rounds=12) for passwords
- All queries use parameterized statements (no SQL injection)
- Org isolation: every DB query filters by `org_id`
- No hardcoded secrets — everything via `.env`

---

## Roadmap

**Phase 1 (current):** Backend foundation — auth, courses, Course Forge, AI, certs, org management

**Phase 2:** Next.js frontend — learner portal, admin dashboard, Course Forge UI

**Phase 3:** Stripe subscriptions — Starter/Team/Enterprise tiers

**Phase 4:** CBIR org benchmarking dashboard + PDF reports

**Phase 5:** Mobile-responsive PWA + offline mode for field use

**Phase 6:** Public course marketplace + API for LMS integrations
