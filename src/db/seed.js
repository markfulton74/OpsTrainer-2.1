// ============================================
// OpsTrainer 2.1 — Database Seed
// Seeds competency framework + demo org
// ============================================
const db = require('./index');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

function seed() {
  console.log('🌱 Seeding database...');

  // ---- Competency Domains ----
  const domains = [
    { code: 'TECH', name: 'Technical Skills', description: 'Core technical competencies for humanitarian operations', display_order: 1 },
    { code: 'SOFT', name: 'Interpersonal Skills', description: 'Communication, leadership and teamwork', display_order: 2 },
    { code: 'DOMAIN', name: 'Domain Expertise', description: 'Specialist humanitarian knowledge areas', display_order: 3 },
    { code: 'LEAD', name: 'Leadership & Management', description: 'Leading teams and managing programmes', display_order: 4 },
    { code: 'ETHICS', name: 'Ethics & Protection', description: 'Humanitarian principles, ethics and safeguarding', display_order: 5 },
  ];

  const insertDomain = db.prepare(`
    INSERT OR IGNORE INTO competency_domains (id, code, name, description, display_order)
    VALUES (?, ?, ?, ?, ?)
  `);

  const domainIds = {};
  for (const d of domains) {
    const id = uuidv4();
    insertDomain.run(id, d.code, d.name, d.description, d.display_order);
    // Fetch the actual inserted/existing id
    const row = db.prepare('SELECT id FROM competency_domains WHERE code = ?').get(d.code);
    domainIds[d.code] = row.id;
  }
  console.log('✅ Competency domains seeded');

  // ---- Competency Areas ----
  const areas = [
    { domain: 'TECH', code: 'INFO_MGMT', name: 'Information Management', display_order: 1 },
    { domain: 'TECH', code: 'LOG_SUPPLY', name: 'Logistics & Supply Chain', display_order: 2 },
    { domain: 'TECH', code: 'CASH_CVA', name: 'Cash & Voucher Assistance', display_order: 3 },
    { domain: 'TECH', code: 'WASH', name: 'WASH', display_order: 4 },
    { domain: 'SOFT', code: 'COMM', name: 'Communication', display_order: 1 },
    { domain: 'SOFT', code: 'CULTURE', name: 'Cultural Competency', display_order: 2 },
    { domain: 'SOFT', code: 'STRESS', name: 'Stress & Resilience', display_order: 3 },
    { domain: 'DOMAIN', code: 'NEEDS_ASSESS', name: 'Needs Assessment', display_order: 1 },
    { domain: 'DOMAIN', code: 'PROG_MGMT', name: 'Programme Management', display_order: 2 },
    { domain: 'DOMAIN', code: 'MEAL', name: 'Monitoring, Evaluation & Learning', display_order: 3 },
    { domain: 'DOMAIN', code: 'PROTECTION', name: 'Protection', display_order: 4 },
    { domain: 'LEAD', code: 'TEAM_LEAD', name: 'Team Leadership', display_order: 1 },
    { domain: 'LEAD', code: 'STRAT_PLAN', name: 'Strategic Planning', display_order: 2 },
    { domain: 'LEAD', code: 'RESOURCE_MGMT', name: 'Resource Management', display_order: 3 },
    { domain: 'ETHICS', code: 'HUM_PRINCIPLES', name: 'Humanitarian Principles', display_order: 1 },
    { domain: 'ETHICS', code: 'DO_NO_HARM', name: 'Do No Harm', display_order: 2 },
    { domain: 'ETHICS', code: 'SAFEGUARDING', name: 'Safeguarding', display_order: 3 },
  ];

  const insertArea = db.prepare(`
    INSERT OR IGNORE INTO competency_areas (id, domain_id, code, name, display_order)
    VALUES (?, ?, ?, ?, ?)
  `);

  const areaIds = {};
  for (const a of areas) {
    const id = uuidv4();
    insertArea.run(id, domainIds[a.domain], a.code, a.name, a.display_order);
    const row = db.prepare('SELECT id FROM competency_areas WHERE code = ?').get(a.code);
    areaIds[a.code] = row.id;
  }
  console.log('✅ Competency areas seeded');

  // ---- Demo Organisation ----
  const orgId = uuidv4();
  const existingOrg = db.prepare("SELECT id FROM organisations WHERE slug = 'demo-org'").get();
  if (!existingOrg) {
    db.prepare(`
      INSERT INTO organisations (id, name, slug, sector, subscription_tier, subscription_status, max_users)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(orgId, 'Demo Organisation', 'demo-org', 'humanitarian', 'enterprise', 'active', 999);

    // Demo superadmin user
    const adminPw = bcrypt.hashSync('Admin123!', 10);
    db.prepare(`
      INSERT INTO users (id, org_id, email, password_hash, full_name, role, email_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), orgId, 'admin@demo.opstrainer.co.za', adminPw, 'Demo Admin', 'org_admin', 1);

    // Demo learner
    const learnerPw = bcrypt.hashSync('Learner123!', 10);
    db.prepare(`
      INSERT INTO users (id, org_id, email, password_hash, full_name, role, email_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), orgId, 'learner@demo.opstrainer.co.za', learnerPw, 'Demo Learner', 'learner', 1);

    console.log('✅ Demo organisation + users seeded');
    console.log('   Admin:   admin@demo.opstrainer.co.za / Admin123!');
    console.log('   Learner: learner@demo.opstrainer.co.za / Learner123!');
  } else {
    console.log('ℹ️  Demo org already exists, skipping');
  }

  console.log('🎉 Seed complete');
}

seed();
