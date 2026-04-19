// ============================================
// OpsTrainer 2.1 — Database Seed
// Works with both SQLite and JSON DB adapter
// ============================================
const db = require('./index');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

function seed() {
  console.log('🌱 Seeding database...');

  // ─── Competency Domains ──────────────────────────────────
  const domains = [
    { code: 'TECH',   name: 'Technical Skills',        description: 'Core technical competencies for humanitarian operations', display_order: 1 },
    { code: 'SOFT',   name: 'Interpersonal Skills',     description: 'Communication, leadership and teamwork',                  display_order: 2 },
    { code: 'DOMAIN', name: 'Domain Expertise',         description: 'Specialist humanitarian knowledge areas',                  display_order: 3 },
    { code: 'LEAD',   name: 'Leadership & Management',  description: 'Leading teams and managing programmes',                   display_order: 4 },
    { code: 'ETHICS', name: 'Ethics & Protection',      description: 'Humanitarian principles, ethics and safeguarding',        display_order: 5 },
  ];

  const domainIds = {};
  for (const d of domains) {
    const existing = db.prepare('SELECT id FROM competency_domains WHERE code = ?').get(d.code);
    const id = existing ? existing.id : uuidv4();
    domainIds[d.code] = id;
    if (!existing) {
      db.prepare('INSERT OR IGNORE INTO competency_domains (id, code, name, description, display_order) VALUES (?, ?, ?, ?, ?)')
        .run(id, d.code, d.name, d.description, d.display_order);
    }
  }
  console.log('✅ Competency domains seeded');

  // ─── Competency Areas ────────────────────────────────────
  const areas = [
    { domain: 'TECH',   code: 'INFO_MGMT',      name: 'Information Management',   display_order: 1 },
    { domain: 'TECH',   code: 'LOG_SUPPLY',      name: 'Logistics & Supply Chain', display_order: 2 },
    { domain: 'TECH',   code: 'CASH_CVA',        name: 'Cash & Voucher Assistance',display_order: 3 },
    { domain: 'TECH',   code: 'WASH',            name: 'WASH',                     display_order: 4 },
    { domain: 'SOFT',   code: 'COMM',            name: 'Communication',            display_order: 1 },
    { domain: 'SOFT',   code: 'CULTURE',         name: 'Cultural Competency',      display_order: 2 },
    { domain: 'SOFT',   code: 'STRESS',          name: 'Stress & Resilience',      display_order: 3 },
    { domain: 'DOMAIN', code: 'NEEDS_ASSESS',    name: 'Needs Assessment',         display_order: 1 },
    { domain: 'DOMAIN', code: 'PROG_MGMT',       name: 'Programme Management',     display_order: 2 },
    { domain: 'DOMAIN', code: 'MEAL',            name: 'Monitoring, Evaluation & Learning', display_order: 3 },
    { domain: 'DOMAIN', code: 'PROTECTION',      name: 'Protection',               display_order: 4 },
    { domain: 'LEAD',   code: 'TEAM_LEAD',       name: 'Team Leadership',          display_order: 1 },
    { domain: 'LEAD',   code: 'STRAT_PLAN',      name: 'Strategic Planning',       display_order: 2 },
    { domain: 'LEAD',   code: 'RESOURCE_MGMT',   name: 'Resource Management',      display_order: 3 },
    { domain: 'ETHICS', code: 'HUM_PRINCIPLES',  name: 'Humanitarian Principles',  display_order: 1 },
    { domain: 'ETHICS', code: 'SAFEGUARDING',    name: 'Safeguarding',             display_order: 2 },
    { domain: 'ETHICS', code: 'ACCOUNTABILITY',  name: 'Accountability',           display_order: 3 },
  ];

  const areaIds = {};
  for (const a of areas) {
    const existing = db.prepare('SELECT id FROM competency_areas WHERE code = ?').get(a.code);
    const id = existing ? existing.id : uuidv4();
    areaIds[a.code] = id;
    if (!existing) {
      db.prepare('INSERT OR IGNORE INTO competency_areas (id, domain_id, code, name, display_order) VALUES (?, ?, ?, ?, ?)')
        .run(id, domainIds[a.domain], a.code, a.name, a.display_order);
    }
  }
  console.log('✅ Competency areas seeded');

  // ─── Demo Organisation ───────────────────────────────────
  const existingOrg = db.prepare("SELECT id FROM organisations WHERE slug = 'demo-org'").get();
  const orgId = existingOrg ? existingOrg.id : uuidv4();
  if (!existingOrg) {
    db.prepare(`INSERT OR IGNORE INTO organisations (id, name, slug, country, subscription_tier, subscription_status, max_users)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, 'Demo Organisation', 'demo-org', 'ZA', 'enterprise', 'active', 9999);
  }
  console.log('✅ Demo org seeded');

  // ─── Demo Users ──────────────────────────────────────────
  const adminEmail = 'admin@demo.opstrainer.co.za';
  const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!existingAdmin) {
    const passwordHash = bcrypt.hashSync('Admin123!', 12);
    db.prepare(`INSERT OR IGNORE INTO users (id, org_id, email, password_hash, full_name, role, email_verified, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), orgId, adminEmail, passwordHash, 'Demo Admin', 'org_admin', 1, 1);
    console.log('✅ Demo admin user seeded (admin@demo.opstrainer.co.za / Admin123!)');
  }

  const learnerEmail = 'learner@demo.opstrainer.co.za';
  const existingLearner = db.prepare('SELECT id FROM users WHERE email = ?').get(learnerEmail);
  if (!existingLearner) {
    const passwordHash = bcrypt.hashSync('Learner123!', 12);
    db.prepare(`INSERT OR IGNORE INTO users (id, org_id, email, password_hash, full_name, role, email_verified, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), orgId, learnerEmail, passwordHash, 'Demo Learner', 'learner', 1, 1);
    console.log('✅ Demo learner user seeded');
  }

  console.log('✅ Database seeding complete');
}

module.exports = seed;
