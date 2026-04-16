#!/bin/bash
set -e

echo "OpsTrainer 2.1 starting..."

mkdir -p ./data

echo "Running migrations..."
node src/db/migrate.js

SEED_CHECK=$(node -e "
const db = require('./src/db');
try {
  const org = db.prepare(\"SELECT id FROM organisations WHERE slug = 'demo-org'\").get();
  console.log(org ? 'skip' : 'seed');
} catch(e) { console.log('seed'); }
" 2>/dev/null || echo "seed")

if [ "$SEED_CHECK" = "seed" ]; then
  echo "Fresh database — seeding..."
  node src/db/seed.js
else
  echo "Database already seeded — skipping"
fi

echo "Starting server..."
node src/server.js

