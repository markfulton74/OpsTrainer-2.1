// ============================================
// OpsTrainer 2.1 — JSON Database with JSONBin persistence
// Data persists across Render restarts via JSONBin.io API
// ============================================
const fs = require('fs');
const path = require('path');

const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const JSONBIN_BIN_ID_FILE = path.join(process.cwd(), 'data', 'binid.txt');
const LOCAL_BACKUP = path.join(process.cwd(), 'data', 'opstrainer.json');

// Ensure data dir exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// In-memory store
let store = {};
let binId = null;
let saveTimer = null;
let initialized = false;

// ============================================
// Get or create JSONBin bin ID
// ============================================
function getBinId() {
  // Check env first
  if (process.env.JSONBIN_BIN_ID && process.env.JSONBIN_BIN_ID.length > 5) {
    return process.env.JSONBIN_BIN_ID;
  }
  // Check local file
  if (fs.existsSync(JSONBIN_BIN_ID_FILE)) {
    const id = fs.readFileSync(JSONBIN_BIN_ID_FILE, 'utf8').trim();
    if (id && id.length > 5) return id;
  }
  return null;
}

function saveBinId(id) {
  binId = id;
  try { fs.writeFileSync(JSONBIN_BIN_ID_FILE, id); } catch(e) {}
}

// ============================================
// JSONBin API calls
// ============================================
async function fetchFromJSONBin(id) {
  if (!JSONBIN_API_KEY) return null;
  try {
    const fetch = require('node-fetch');
    const res = await fetch('https://api.jsonbin.io/v3/b/' + id + '/latest', {
      headers: {
        'X-Master-Key': JSONBIN_API_KEY,
        'X-Bin-Meta': 'false'
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch(e) {
    console.error('JSONBin fetch error:', e.message);
    return null;
  }
}

async function pushToJSONBin(data) {
  if (!JSONBIN_API_KEY) return null;
  try {
    const fetch = require('node-fetch');
    if (!binId) {
      // Create new bin
      const res = await fetch('https://api.jsonbin.io/v3/b', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': JSONBIN_API_KEY,
          'X-Bin-Name': 'opstrainer-db',
          'X-Bin-Private': 'true'
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) { console.error('JSONBin create failed:', res.status); return null; }
      const result = await res.json();
      const newId = result.metadata && result.metadata.id;
      if (newId) {
        saveBinId(newId);
        console.log('JSONBin bin created: ' + newId);
        console.log('Add to Render env: JSONBIN_BIN_ID=' + newId);
      }
      return newId;
    } else {
      // Update existing bin
      const res = await fetch('https://api.jsonbin.io/v3/b/' + binId, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': JSONBIN_API_KEY
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) { console.error('JSONBin update failed:', res.status); return null; }
      return binId;
    }
  } catch(e) {
    console.error('JSONBin push error:', e.message);
    return null;
  }
}

// ============================================
// Load on startup
// ============================================
async function load() {
  // Try local backup first (fastest)
  if (fs.existsSync(LOCAL_BACKUP)) {
    try {
      store = JSON.parse(fs.readFileSync(LOCAL_BACKUP, 'utf8'));
      console.log('JSON DB loaded from local backup');
    } catch(e) {
      store = {};
    }
  }

  // Then try JSONBin for latest data
  binId = getBinId();
  if (JSONBIN_API_KEY && binId) {
    try {
      const remote = await fetchFromJSONBin(binId);
      if (remote && typeof remote === 'object' && !remote.message) {
        store = remote;
        // Save locally as backup
        fs.writeFileSync(LOCAL_BACKUP, JSON.stringify(store, null, 2));
        console.log('JSON DB loaded from JSONBin (' + binId + ')');
      }
    } catch(e) {
      console.error('JSONBin load error:', e.message);
    }
  } else if (JSONBIN_API_KEY && !binId) {
    console.log('No JSONBin bin ID found — will create on first save');
  } else {
    console.log('No JSONBIN_API_KEY — using local JSON only');
  }

  initialized = true;
}

// ============================================
// Save (debounced — max once per 3 seconds)
// ============================================
function save() {
  // Always save locally immediately
  try {
    fs.writeFileSync(LOCAL_BACKUP, JSON.stringify(store, null, 2));
  } catch(e) {}

  // Debounce remote save
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function() {
    if (JSONBIN_API_KEY) {
      pushToJSONBin(store).catch(function(e) {
        console.error('JSONBin save error:', e.message);
      });
    }
  }, 3000);
}

// ============================================
// Table helpers
// ============================================
function table(name) {
  if (!store[name]) store[name] = [];
  return store[name];
}

// ============================================
// SQL Parser (same as before)
// ============================================
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
    const fromM = s.match(/\bFROM\s+(\w+)\b/i);
    if (!fromM) return { op: 'select', mainTable: null, joins: [], where: null, groupBy: null, orderBy: null, limit: null, cols: '*' };
    const mainTable = fromM[1].toLowerCase();
    const joinRe = /LEFT\s+(?:OUTER\s+)?JOIN\s+(\w+)\s+(?:AS\s+(\w+)\s+)?ON\s+([^\s]+)\s*=\s*([^\s]+)/gi;
    const joins = [];
    let jm;
    while ((jm = joinRe.exec(s)) !== null) {
      joins.push({ table: jm[1].toLowerCase(), alias: (jm[2]||jm[1]).toLowerCase(), onLeft: jm[3].toLowerCase(), onRight: jm[4].toLowerCase() });
    }
    const whereM = s.match(/\bWHERE\s+(.+?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|$)/i);
    const groupM = s.match(/\bGROUP\s+BY\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|$)/i);
    const orderM = s.match(/\bORDER\s+BY\s+(.+?)(?:\s+LIMIT|$)/i);
    const limitM = s.match(/\bLIMIT\s+(\d+)/i);
    const selM = s.match(/^SELECT\s+(.+?)\s+FROM\b/i);
    return {
      op: 'select', mainTable, joins,
      where: whereM ? whereM[1].trim() : null,
      groupBy: groupM ? groupM[1].trim() : null,
      orderBy: orderM ? orderM[1].trim() : null,
      limit: limitM ? parseInt(limitM[1]) : null,
      cols: selM ? selM[1].trim() : '*'
    };
  }

  return { op: 'unknown', raw: s };
}

// ============================================
// WHERE evaluator
// ============================================
function evalWhere(whereStr, row, params, pIdx) {
  if (!whereStr) return { match: true, consumed: 0 };
  const parts = whereStr.split(/\bAND\b/i);
  let match = true;
  for (const part of parts) {
    const p = part.trim();
    if (/\bIS\s+NOT\s+NULL\b/i.test(p)) {
      const col = p.replace(/\bIS\s+NOT\s+NULL\b/i,'').trim().replace(/\w+\./,'');
      if (row[col] === null || row[col] === undefined) match = false;
    } else if (/\bIS\s+NULL\b/i.test(p)) {
      const col = p.replace(/\bIS\s+NULL\b/i,'').trim().replace(/\w+\./,'');
      if (row[col] !== null && row[col] !== undefined) match = false;
    } else if (p.includes('!=') || p.toUpperCase().includes('<>')) {
      const sep = p.includes('!=') ? '!=' : '<>';
      const [left, right] = p.split(sep).map(x => x.trim());
      const col = left.replace(/\w+\./, '');
      if (right === '?') {
        const val = params[pIdx.i++];
        if (String(row[col]) === String(val)) match = false;
      }
    } else if (p.includes('=')) {
      const [left, right] = p.split('=').map(x => x.trim());
      const col = left.replace(/\w+\./, '');
      if (right === '?') {
        const val = params[pIdx.i++];
        if (String(row[col]) !== String(val)) match = false;
      } else if (right === '1') {
        if (!row[col] && row[col] !== 1) match = false;
      } else if (right === '0') {
        if (row[col] && row[col] !== 0) match = false;
      } else {
        const lit = right.replace(/^['"]|['"]$/g, '');
        if (String(row[col]) !== lit) match = false;
      }
    }
  }
  return { match };
}

function matchRow(row, whereStr, params, startIdx) {
  const pIdx = { i: startIdx };
  const { match } = evalWhere(whereStr, row, params, pIdx);
  return { match, nextIdx: pIdx.i };
}

function applyOrderBy(rows, orderByStr) {
  const parts = orderByStr.split(',').map(s => s.trim());
  return [...rows].sort((a, b) => {
    for (const part of parts) {
      const desc = /\bDESC\b/i.test(part);
      const col = part.replace(/\bDESC\b|\bASC\b/ig, '').replace(/^\w+\./, '').trim();
      const av = a[col], bv = b[col];
      if (av === bv) continue;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return desc ? (av > bv ? -1 : 1) : (av > bv ? 1 : -1);
    }
    return 0;
  });
}

// ============================================
// Execute
// ============================================
function execute(parsed, params, mode) {
  const p = params || [];

  if (parsed.op === 'pragma') return mode === 'run' ? { changes: 0 } : (mode === 'all' ? [] : null);
  if (parsed.op === 'unknown') return mode === 'all' ? [] : null;

  if (parsed.op === 'insert') {
    const t = table(parsed.table);
    const row = {};
    parsed.cols.forEach((col, i) => { row[col] = p[i] !== undefined ? p[i] : null; });
    if (parsed.orIgnore && row.id && t.find(r => r.id === row.id)) return { changes: 0, lastInsertRowid: null };
    if (parsed.orIgnore && row.email && t.find(r => r.email === row.email)) return { changes: 0, lastInsertRowid: null };
    if (!row.created_at && parsed.cols.includes('created_at')) row.created_at = new Date().toISOString();
    if (!row.updated_at && parsed.cols.includes('updated_at')) row.updated_at = new Date().toISOString();
    t.push(row);
    save();
    return { changes: 1, lastInsertRowid: row.id || t.length };
  }

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
          row[col.replace(/\w+\./, '').trim()] = setVals[i];
        });
        row.updated_at = new Date().toISOString();
        changed++;
      }
    }
    if (changed) save();
    return { changes: changed };
  }

  if (parsed.op === 'delete') {
    const t = table(parsed.table);
    const before = t.length;
    if (!parsed.where) { store[parsed.table] = []; save(); return { changes: before }; }
    store[parsed.table] = t.filter(row => !matchRow(row, parsed.where, p, 0).match);
    const changed = before - store[parsed.table].length;
    if (changed) save();
    return { changes: changed };
  }

  if (parsed.op === 'select') {
    if (/COUNT\s*\(\s*\*\s*\)/i.test(parsed.cols)) {
      const t = table(parsed.mainTable);
      let rows = parsed.where ? t.filter(row => matchRow(row, parsed.where, p, 0).match) : t;
      const result = { count: rows.length };
      return mode === 'all' ? [result] : result;
    }

    if (!parsed.mainTable) return mode === 'all' ? [] : null;
    let rows = [...table(parsed.mainTable)];

    for (const join of (parsed.joins || [])) {
      const jt = table(join.table);
      rows = rows.map(baseRow => {
        const leftCol = join.onLeft.replace(/^\w+\./, '');
        const rightCol = join.onRight.replace(/^\w+\./, '');
        const joined = jt.find(jr => String(jr[rightCol]) === String(baseRow[leftCol]) || String(jr[leftCol]) === String(baseRow[rightCol]));
        const merged = { ...baseRow };
        if (joined) {
          for (const [k, v] of Object.entries(joined)) {
            if (!merged[k]) merged[k] = v;
            merged[join.alias + '.' + k] = v;
          }
          if (joined.full_name && !merged.created_by_name) merged.created_by_name = joined.full_name;
          if (joined.name && !merged.org_name) merged.org_name = joined.name;
        }
        return merged;
      });
    }

    if (parsed.where) rows = rows.filter(row => matchRow(row, parsed.where, p, 0).match);
    if (parsed.groupBy) {
      const groupCols = parsed.groupBy.split(',').map(c => c.trim().replace(/^\w+\./, ''));
      const groups = {};
      for (const row of rows) {
        const key = groupCols.map(c => row[c]).join('||');
        if (!groups[key]) groups[key] = { ...row, _count: 0 };
        groups[key]._count++;
      }
      rows = Object.values(groups).map(g => { const r = {...g}; delete r._count; r.enrolment_count = g._count; return r; });
    }
    if (parsed.orderBy) rows = applyOrderBy(rows, parsed.orderBy);
    if (parsed.limit !== null) rows = rows.slice(0, parsed.limit);
    rows = rows.map(r => ({ ...r, enrolment_count: r.enrolment_count||0, is_enrolled: r.is_enrolled||0, progress_pct: r.progress_pct||0 }));
    return mode === 'get' ? (rows[0] || null) : rows;
  }

  return mode === 'all' ? [] : null;
}

// ============================================
// Transaction helper
// ============================================
function transaction(fn) {
  return function(...args) {
    const result = fn(...args);
    save();
    return result;
  };
}

// ============================================
// prepare() — statement object
// ============================================
const cache = {};
function prepare(sql) {
  let parsed = cache[sql];
  if (!parsed) { parsed = parseSql(sql); cache[sql] = parsed; }
  return {
    get: (...params) => execute(parsed, params.flat(), 'get'),
    all: (...params) => execute(parsed, params.flat(), 'all'),
    run: (...params) => execute(parsed, params.flat(), 'run'),
  };
}

// ============================================
// exec() for schema
// ============================================
function exec(sql) {
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
  let m;
  while ((m = tableRe.exec(sql)) !== null) {
    const tbl = m[1].toLowerCase();
    if (!store[tbl]) store[tbl] = [];
  }
  save();
}

function pragma() { return null; }

// ============================================
// Initialize — load data on startup
// ============================================
load().then(() => {
  console.log('JSON DB ready. Tables: ' + Object.keys(store).join(', '));
}).catch(e => {
  console.error('JSON DB init error:', e.message);
});

module.exports = { prepare, exec, pragma, transaction, _store: store, _save: save, _load: load };
