// ============================================
// OpsTrainer 2.1 — JSON File Database
// Temporary persistence layer for Render free tier.
// Mimics better-sqlite3 API so all routes work unchanged.
// Data stored in: ./data/opstrainer.json
// ============================================
const fs   = require('fs');
const path = require('path');

const DB_FILE = process.env.JSON_DB_PATH || path.join(process.cwd(), 'data', 'opstrainer.json');

// ─── ensure data dir ────────────────────────────────────────
const dir = path.dirname(DB_FILE);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// ─── in-memory store ────────────────────────────────────────
let store = {};

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      store = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('⚠️  JSON DB load failed, starting fresh:', e.message);
    store = {};
  }
}

function save() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error('❌ JSON DB save failed:', e.message);
  }
}

load();
console.log('✅ JSON DB loaded from', DB_FILE);

// ─── table helpers ──────────────────────────────────────────
function table(name) {
  if (!store[name]) store[name] = [];
  return store[name];
}

function allTables() { return Object.keys(store); }

// ─── tiny SQL parser ────────────────────────────────────────
// Supports the subset of SQL used in OpsTrainer routes:
//   SELECT … FROM t [LEFT JOIN …]* [WHERE …] [GROUP BY …] [ORDER BY …] [LIMIT n]
//   INSERT INTO t (cols) VALUES (?)
//   INSERT OR IGNORE INTO t (cols) VALUES (?)
//   UPDATE t SET col=? [, col=?]* WHERE …
//   DELETE FROM t WHERE …
//   SELECT COUNT(*) as count FROM t
//   PRAGMA …  (ignored / return empty)

function parseSql(sql) {
  const s = sql.replace(/\s+/g, ' ').trim();
  const up = s.toUpperCase();

  if (up.startsWith('PRAGMA')) return { op: 'pragma' };

  if (up.startsWith('INSERT')) {
    const orIgnore = /INSERT\s+OR\s+IGNORE/i.test(s);
    const m = s.match(/INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (!m) throw new Error('Cannot parse INSERT: ' + s.substring(0, 120));
    const cols = m[2].split(',').map(c => c.trim());
    return { op: 'insert', table: m[1].toLowerCase(), cols, orIgnore };
  }

  if (up.startsWith('UPDATE')) {
    const m = s.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+)/i);
    if (!m) throw new Error('Cannot parse UPDATE: ' + s.substring(0, 120));
    const setCols = m[2].split(',').map(p => {
      const [k] = p.split('=');
      return k.replace(/\w+\./, '').trim();
    });
    return { op: 'update', table: m[1].toLowerCase(), setCols, where: m[3] };
  }

  if (up.startsWith('DELETE')) {
    const m = s.match(/DELETE\s+FROM\s+(\w+)\s+(?:WHERE\s+(.+))?/i);
    if (!m) throw new Error('Cannot parse DELETE: ' + s.substring(0, 120));
    return { op: 'delete', table: m[1].toLowerCase(), where: m[2] || null };
  }

  if (up.startsWith('SELECT')) {
    // Extract primary table (first FROM token)
    const fromM = s.match(/\bFROM\s+(\w+)\b/i);
    if (!fromM) return { op: 'select', tables: [], joins: [], where: null, groupBy: null, orderBy: null, limit: null, cols: '*' };

    const mainTable = fromM[1].toLowerCase();

    // Extract LEFT JOINs
    const joinRe = /LEFT\s+(?:OUTER\s+)?JOIN\s+(\w+)\s+(?:AS\s+(\w+)\s+)?ON\s+([^\s]+)\s*=\s*([^\s]+)/gi;
    const joins = [];
    let jm;
    while ((jm = joinRe.exec(s)) !== null) {
      joins.push({ table: jm[1].toLowerCase(), alias: (jm[2] || jm[1]).toLowerCase(), onLeft: jm[3].toLowerCase(), onRight: jm[4].toLowerCase() });
    }

    const whereM = s.match(/\bWHERE\s+(.+?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|$)/i);
    const groupM = s.match(/\bGROUP\s+BY\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|$)/i);
    const orderM = s.match(/\bORDER\s+BY\s+(.+?)(?:\s+LIMIT|$)/i);
    const limitM = s.match(/\bLIMIT\s+(\d+)/i);

    const selM = s.match(/^SELECT\s+(.+?)\s+FROM\b/i);

    return {
      op: 'select',
      mainTable,
      joins,
      where: whereM ? whereM[1].trim() : null,
      groupBy: groupM ? groupM[1].trim() : null,
      orderBy: orderM ? orderM[1].trim() : null,
      limit: limitM ? parseInt(limitM[1]) : null,
      cols: selM ? selM[1].trim() : '*'
    };
  }

  return { op: 'unknown', raw: s };
}

// ─── WHERE clause evaluator ─────────────────────────────────
function evalWhere(whereStr, row, params, pIdx) {
  if (!whereStr) return { match: true, consumed: 0 };

  // Split on AND / OR (simple left-to-right, no precedence)
  // We only handle AND for now
  const parts = whereStr.split(/\bAND\b/i);
  let consumed = 0;
  let match = true;

  for (const part of parts) {
    const p = part.trim();
    // Handle: col = ? | col IS NULL | col IS NOT NULL | col != ? | col LIKE ? | (expr)
    if (/\bIS\s+NOT\s+NULL\b/i.test(p)) {
      const col = p.replace(/\bIS\s+NOT\s+NULL\b/i, '').trim().replace(/\w+\./,'');
      if (row[col] === null || row[col] === undefined) { match = false; }
    } else if (/\bIS\s+NULL\b/i.test(p)) {
      const col = p.replace(/\bIS\s+NULL\b/i, '').trim().replace(/\w+\./,'');
      if (row[col] !== null && row[col] !== undefined) { match = false; }
    } else if (p.includes('!=') || p.toUpperCase().includes('<>')) {
      const sep = p.includes('!=') ? '!=' : '<>';
      const [left, right] = p.split(sep).map(x => x.trim());
      const col = left.replace(/\w+\./, '');
      if (right === '?') {
        const val = params[pIdx.i++];
        if (String(row[col]) === String(val)) { match = false; }
        consumed++;
      }
    } else if (p.includes('=')) {
      const [left, right] = p.split('=').map(x => x.trim());
      const col = left.replace(/\w+\./, '');
      if (right === '?') {
        const val = params[pIdx.i++];
        consumed++;
        if (String(row[col]) !== String(val)) { match = false; }
      } else if (right === '1') {
        if (!row[col] && row[col] !== 1) { match = false; }
      } else if (right === '0') {
        if (row[col] && row[col] !== 0) { match = false; }
      } else {
        // literal value — strip quotes
        const lit = right.replace(/^['"]|['"]$/g, '');
        if (String(row[col]) !== lit) { match = false; }
      }
    }
  }

  return { match, consumed };
}

// ─── row matcher (used for get/all/delete/update) ────────────
function matchRow(row, whereStr, params, startIdx) {
  const pIdx = { i: startIdx };
  const { match } = evalWhere(whereStr, row, params, pIdx);
  return { match, nextIdx: pIdx.i };
}

// ─── column resolver for SELECT ─────────────────────────────
function resolveCol(colExpr, row) {
  // strip table alias prefix: u.full_name → full_name
  const c = colExpr.trim().replace(/^\w+\./, '');
  return row[c];
}

// ─── aggregate helpers ──────────────────────────────────────
function applyGroupBy(rows, groupByCols) {
  const groups = {};
  for (const row of rows) {
    const key = groupByCols.map(c => row[c.trim().replace(/^\w+\./, '')]).join('||');
    if (!groups[key]) groups[key] = { ...row, _rows: [] };
    groups[key]._rows.push(row);
  }
  return Object.values(groups).map(g => {
    // aggregate COUNT(DISTINCT …) and SUM(…)
    const out = { ...g };
    delete out._rows;
    // enrolment_count placeholder — always 0 in JSON mode
    out.enrolment_count = g._rows.length;
    return out;
  });
}

function applyOrderBy(rows, orderByStr) {
  const parts = orderByStr.split(',').map(s => s.trim());
  return [...rows].sort((a, b) => {
    for (const part of parts) {
      const desc = /\bDESC\b/i.test(part);
      const col = part.replace(/\bDESC\b|\bASC\b/ig, '').replace(/^\w+\./, '').trim();
      const av = a[col]; const bv = b[col];
      if (av === bv) continue;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = av > bv ? 1 : -1;
      return desc ? -cmp : cmp;
    }
    return 0;
  });
}

// ─── execute a parsed statement ─────────────────────────────
function execute(parsed, params, mode) {
  // mode: 'get' | 'all' | 'run'
  const p = params || [];

  if (parsed.op === 'pragma') return mode === 'run' ? { changes: 0 } : (mode === 'all' ? [] : null);
  if (parsed.op === 'unknown') { console.warn('JSONDB unknown SQL op:', parsed.raw && parsed.raw.substring(0,80)); return mode === 'all' ? [] : null; }

  // ── INSERT ──────────────────────────────────────────────
  if (parsed.op === 'insert') {
    const t = table(parsed.table);
    const row = {};
    parsed.cols.forEach((col, i) => { row[col] = p[i] !== undefined ? p[i] : null; });
    // OR IGNORE: skip if same primary key exists
    if (parsed.orIgnore && row.id) {
      const exists = t.find(r => r.id === row.id);
      if (exists) return { changes: 0, lastInsertRowid: null };
    }
    // Also treat UNIQUE constraints as ignore (email, slug uniqueness)
    if (parsed.orIgnore && row.email) {
      if (t.find(r => r.email === row.email)) return { changes: 0, lastInsertRowid: null };
    }
    if (parsed.orIgnore && row.slug && row.org_id) {
      if (t.find(r => r.slug === row.slug && r.org_id === row.org_id)) return { changes: 0, lastInsertRowid: null };
    }
    // auto timestamps
    if (parsed.cols.includes('created_at') && !row.created_at) row.created_at = new Date().toISOString();
    if (parsed.cols.includes('updated_at') && !row.updated_at) row.updated_at = new Date().toISOString();
    t.push(row);
    save();
    return { changes: 1, lastInsertRowid: row.id || t.length };
  }

  // ── UPDATE ──────────────────────────────────────────────
  if (parsed.op === 'update') {
    const t = table(parsed.table);
    const nCols = parsed.setCols.length;
    const setVals = p.slice(0, nCols);
    const whereParams = p.slice(nCols);
    let changed = 0;
    for (const row of t) {
      const { match } = matchRow(row, parsed.where, whereParams, 0);
      if (match) {
        parsed.setCols.forEach((col, i) => {
          const c = col.replace(/\w+\./, '').trim();
          row[c] = setVals[i];
        });
        row.updated_at = new Date().toISOString();
        changed++;
      }
    }
    if (changed) save();
    return { changes: changed };
  }

  // ── DELETE ──────────────────────────────────────────────
  if (parsed.op === 'delete') {
    const t = table(parsed.table);
    const before = t.length;
    if (!parsed.where) {
      store[parsed.table] = [];
      save();
      return { changes: before };
    }
    store[parsed.table] = t.filter(row => {
      const { match } = matchRow(row, parsed.where, p, 0);
      return !match;
    });
    const changed = before - store[parsed.table].length;
    if (changed) save();
    return { changes: changed };
  }

  // ── SELECT ──────────────────────────────────────────────
  if (parsed.op === 'select') {
    // COUNT(*) shortcut
    if (/COUNT\s*\(\s*\*\s*\)/i.test(parsed.cols)) {
      const t = table(parsed.mainTable);
      let rows = t;
      if (parsed.where) {
        rows = t.filter(row => matchRow(row, parsed.where, p, 0).match);
      }
      const result = { count: rows.length };
      return mode === 'all' ? [result] : result;
    }

    // Build base rows from main table
    let rows = [...table(parsed.mainTable)];

    // Apply LEFT JOINs
    for (const join of (parsed.joins || [])) {
      const jt = table(join.table);
      rows = rows.map(baseRow => {
        // onLeft / onRight: e.g. u.id = c.created_by
        const leftCol = join.onLeft.replace(/^\w+\./, '');
        const rightCol = join.onRight.replace(/^\w+\./, '');
        // find matching row in joined table
        const joined = jt.find(jr => String(jr[rightCol]) === String(baseRow[leftCol]) ||
                                      String(jr[leftCol]) === String(baseRow[rightCol]));
        const merged = { ...baseRow };
        if (joined) {
          // prefix joined cols with alias to avoid overwrites (then also add unprefixed)
          for (const [k, v] of Object.entries(joined)) {
            if (!merged[k]) merged[k] = v;            // don't overwrite base cols
            merged[`${join.alias}.${k}`] = v;         // also store prefixed
          }
          // Handle common rename patterns: full_name as created_by_name
          if (joined.full_name && !merged.created_by_name) merged.created_by_name = joined.full_name;
          if (joined.name && !merged.org_name) merged.org_name = joined.name;
        }
        return merged;
      });
    }

    // Apply WHERE
    if (parsed.where) {
      rows = rows.filter(row => matchRow(row, parsed.where, p, 0).match);
    }

    // Apply GROUP BY
    if (parsed.groupBy) {
      const groupCols = parsed.groupBy.split(',').map(c => c.trim().replace(/^\w+\./, ''));
      rows = applyGroupBy(rows, groupCols);
    }

    // Apply ORDER BY
    if (parsed.orderBy) {
      rows = applyOrderBy(rows, parsed.orderBy);
    }

    // Apply LIMIT
    if (parsed.limit !== null) {
      rows = rows.slice(0, parsed.limit);
    }

    // Add virtual fields needed by the app
    rows = rows.map(r => ({
      ...r,
      enrolment_count: r.enrolment_count || 0,
      is_enrolled: r.is_enrolled || 0,
      progress_pct: r.progress_pct || 0,
    }));

    if (mode === 'get') return rows[0] || null;
    return rows;
  }

  return mode === 'all' ? [] : null;
}

// ─── transaction helper ─────────────────────────────────────
function transaction(fn) {
  return function(...args) {
    const result = fn(...args);
    save();
    return result;
  };
}

// ─── prepare() → statement object ───────────────────────────
const cache = {};
function prepare(sql) {
  let parsed = cache[sql];
  if (!parsed) {
    parsed = parseSql(sql);
    cache[sql] = parsed;
  }
  return {
    get:  (...params) => execute(parsed, params.flat(), 'get'),
    all:  (...params) => execute(parsed, params.flat(), 'all'),
    run:  (...params) => execute(parsed, params.flat(), 'run'),
  };
}

// ─── exec() for multi-statement SQL (schema) ────────────────
function exec(sql) {
  // Extract table names from CREATE TABLE statements and ensure they exist in store
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
  let m;
  while ((m = tableRe.exec(sql)) !== null) {
    const tbl = m[1].toLowerCase();
    if (!store[tbl]) {
      store[tbl] = [];
    }
  }
  save();
}

// ─── pragma() no-op ─────────────────────────────────────────
function pragma() { return null; }

module.exports = { prepare, exec, pragma, transaction, _store: store, _save: save, _load: load };
