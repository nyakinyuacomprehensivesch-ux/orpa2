/*
 * Orpa PostgreSQL-backed datastore (multi-tenant).
 * -----------------------------------------------------------
 * Data model (zone -> schools -> teachers):
 *   users       - accounts (teacher / owner). A teacher is assigned to ONE
 *                 school with a school role ('admin' = whole school,
 *                 'class_teacher' = one grade) plus an assignedGrade.
 *   schools     - the schools inside the owner's zone.
 *   schoolData  - ONE shared grading dataset per school:
 *                 { examName, examTerm, examYear,
 *                   grades: {1..9:{outOf:[],learners:[]}},
 *                   submitted: {1..9:bool}, submittedAt: {1..9:iso} }
 *
 * When DATABASE_URL is set, everything lives in PostgreSQL and survives
 * Render restarts. Without it, we fall back to the JSON file store
 * (data/data.json) for local development. Both paths expose the SAME
 * synchronous API so server.js needs no async juggling after init().
 *
 * IMPORTANT: call init() once at startup before anything else.
 * -----------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

// ---------- JSON fallback ----------
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// The whole in-memory world. PG keeps this in sync via write-through.
let cache = { users: [], schools: [], schoolData: {}, settings: {} };

function normalizeCache() {
  if (!cache || typeof cache !== 'object') cache = {};
  if (!Array.isArray(cache.users)) cache.users = [];
  if (!Array.isArray(cache.schools)) cache.schools = [];
  if (!cache.schoolData || typeof cache.schoolData !== 'object') cache.schoolData = {};
  if (!cache.settings || typeof cache.settings !== 'object') cache.settings = {};
}

function ensureJson() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
  }
}

function loadJson() {
  ensureJson();
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || {};
  } catch (e) {
    cache = {};
  }
  normalizeCache();
  return cache;
}

let writeTimer = null;
function persistJson() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2)); }
    catch (e) { console.error('DB write failed:', e.message); }
  }, 50);
}

function persistSyncJson() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2)); }
  catch (e) { console.error('DB sync write failed:', e.message); }
}

// ---------- PostgreSQL layer ----------
let pool = null;
let usePg = false;

async function initPg() {
  if (!process.env.DATABASE_URL) return false;
  try {
    const pg = require('pg');
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        email         TEXT UNIQUE NOT NULL,
        phone         TEXT DEFAULT '',
        school        TEXT DEFAULT '',
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'teacher',
        status        TEXT NOT NULL DEFAULT 'active',
        token_version INTEGER NOT NULL DEFAULT 1,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      );
    `);

    // Multi-tenant additions (idempotent — safe to run every boot).
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tsc TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS school_role TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_grade INTEGER`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS app_state JSONB`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS app_state_saved_at TIMESTAMPTZ`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS schools (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        logo       TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo TEXT`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS school_data (
        school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
        data      JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Load users
    const ures = await pool.query('SELECT * FROM users');
    cache.users = ures.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone || '',
      school: row.school || '',
      tsc: row.tsc || '',
      passwordHash: row.password_hash,
      role: row.role,
      status: row.status,
      tokenVersion: row.token_version,
      schoolId: row.school_id || null,
      schoolRole: row.school_role || null,
      assignedGrade: row.assigned_grade || null,
      appState: row.app_state || null,
      appStateSavedAt: row.app_state_saved_at || null,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at || null,
    }));

    // Load schools
    const sres = await pool.query('SELECT * FROM schools');
    cache.schools = sres.rows.map((row) => ({
      id: row.id,
      name: row.name,
      logo: row.logo || null,
      createdAt: row.created_at,
    }));

    // Load settings (zone logo, etc.)
    cache.settings = {};
    try {
      const setres = await pool.query('SELECT * FROM settings');
      setres.rows.forEach((row) => { cache.settings[row.key] = row.value; });
    } catch (e) { /* settings optional */ }

    // Load school data
    const dres = await pool.query('SELECT * FROM school_data');
    cache.schoolData = {};
    dres.rows.forEach((row) => { cache.schoolData[row.school_id] = row.data; });

    usePg = true;
    console.log(`[db] PostgreSQL connected — ${cache.users.length} user(s), ${cache.schools.length} school(s).`);
    return true;
  } catch (e) {
    console.error('[db] PostgreSQL init failed, falling back to JSON file:', e.message);
    pool = null;
    return false;
  }
}

// ----- user write-through -----
async function pgInsertUser(user) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO users (id, name, email, phone, school, tsc, password_hash, role, status,
         token_version, school_id, school_role, assigned_grade, app_state, app_state_saved_at,
         created_at, last_login_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO NOTHING`,
      [user.id, user.name, user.email, user.phone || '', user.school || '', user.tsc || '',
       user.passwordHash, user.role, user.status, user.tokenVersion || 1,
       user.schoolId || null, user.schoolRole || null, user.assignedGrade || null,
       user.appState ? JSON.stringify(user.appState) : null, user.appStateSavedAt || null,
       user.createdAt, user.lastLoginAt || null]
    );
  } catch (e) { console.error('[db] pg insert user error:', e.message); }
}

async function pgUpdateUser(id, patch) {
  if (!pool) return;
  try {
    const colMap = {
      name: 'name', email: 'email', phone: 'phone', school: 'school', tsc: 'tsc',
      passwordHash: 'password_hash', role: 'role', status: 'status',
      tokenVersion: 'token_version', schoolId: 'school_id', schoolRole: 'school_role',
      assignedGrade: 'assigned_grade', appState: 'app_state',
      appStateSavedAt: 'app_state_saved_at', lastLoginAt: 'last_login_at',
    };
    const jsonCols = { appState: true };
    const sets = []; const vals = []; let n = 1;
    for (const [key, val] of Object.entries(patch)) {
      const col = colMap[key];
      if (!col) continue;
      sets.push(`${col} = $${n}`);
      vals.push(jsonCols[key] && val != null ? JSON.stringify(val) : val);
      n++;
    }
    if (!sets.length) return;
    vals.push(id);
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${n}`, vals);
  } catch (e) { console.error('[db] pg update user error:', e.message); }
}

async function pgDeleteUser(id) {
  if (!pool) return;
  try { await pool.query('DELETE FROM users WHERE id = $1', [id]); }
  catch (e) { console.error('[db] pg delete user error:', e.message); }
}

// ----- school write-through -----
async function pgInsertSchool(s) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO schools (id, name, logo, created_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING`,
      [s.id, s.name, s.logo || null, s.createdAt]
    );
  } catch (e) { console.error('[db] pg insert school error:', e.message); }
}

async function pgUpdateSchool(id, patch) {
  if (!pool) return;
  try {
    const sets = []; const vals = []; let n = 1;
    if (typeof patch.name === 'string') { sets.push(`name = $${n++}`); vals.push(patch.name); }
    if (typeof patch.logo === 'string' || patch.logo === null) { sets.push(`logo = $${n++}`); vals.push(patch.logo); }
    if (!sets.length) return;
    vals.push(id);
    await pool.query(`UPDATE schools SET ${sets.join(', ')} WHERE id = $${n}`, vals);
  } catch (e) { console.error('[db] pg update school error:', e.message); }
}

async function pgSetSetting(key, value) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]
    );
  } catch (e) { console.error('[db] pg set setting error:', e.message); }
}

async function pgDeleteSchool(id) {
  if (!pool) return;
  try {
    await pool.query('DELETE FROM school_data WHERE school_id = $1', [id]);
    await pool.query('DELETE FROM schools WHERE id = $1', [id]);
  } catch (e) { console.error('[db] pg delete school error:', e.message); }
}

async function pgSaveSchoolData(schoolId, data) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO school_data (school_id, data, updated_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (school_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [schoolId, JSON.stringify(data)]
    );
  } catch (e) { console.error('[db] pg save school_data error:', e.message); }
}

// ---------- Public API ----------
function load() {
  if (usePg) { normalizeCache(); return cache; }
  return loadJson();
}
function persist() { if (!usePg) persistJson(); }
function persistSync() { if (!usePg) persistSyncJson(); }

// ----- users -----
function allUsers() { return cache.users; }
function findByEmail(email) {
  const e = String(email || '').toLowerCase().trim();
  return cache.users.find((u) => u.email === e);
}
function findById(id) { return cache.users.find((u) => u.id === id); }
function addUser(user) {
  cache.users.push(user);
  if (usePg) pgInsertUser(user);
  persist();
  return user;
}
function updateUser(id, patch) {
  const u = findById(id);
  if (!u) return null;
  Object.assign(u, patch);
  if (usePg) pgUpdateUser(id, patch);
  persist();
  return u;
}
function removeUser(id) {
  const i = cache.users.findIndex((u) => u.id === id);
  if (i < 0) return false;
  cache.users.splice(i, 1);
  if (usePg) pgDeleteUser(id);
  persist();
  return true;
}

// ----- schools -----
function normName(n) { return String(n || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function allSchools() { return cache.schools; }
function findSchoolById(id) { return cache.schools.find((s) => s.id === id); }
function findSchoolByName(name) {
  const key = normName(name);
  return cache.schools.find((s) => normName(s.name) === key);
}
function addSchool(school) {
  cache.schools.push(school);
  if (usePg) pgInsertSchool(school);
  persist();
  return school;
}
function updateSchool(id, patch) {
  const s = findSchoolById(id);
  if (!s) return null;
  Object.assign(s, patch);
  if (usePg) pgUpdateSchool(id, patch);
  persist();
  return s;
}
function removeSchool(id) {
  const i = cache.schools.findIndex((s) => s.id === id);
  if (i < 0) return false;
  cache.schools.splice(i, 1);
  delete cache.schoolData[id];
  if (usePg) pgDeleteSchool(id);
  persist();
  return true;
}

// ----- school data (shared grading dataset) -----
function getSchoolData(schoolId) { return cache.schoolData[schoolId] || null; }
function saveSchoolData(schoolId, data) {
  cache.schoolData[schoolId] = data;
  if (usePg) pgSaveSchoolData(schoolId, data);
  persist();
  return data;
}

// ----- settings (global zone-level key/value, e.g. zone watermark logo) -----
function getSetting(key) { return cache.settings[key] != null ? cache.settings[key] : null; }
function setSetting(key, value) {
  cache.settings[key] = value;
  if (usePg) pgSetSetting(key, value);
  persist();
  return value;
}

module.exports = {
  init: initPg,
  load,
  persist,
  persistSync,
  // users
  allUsers, findByEmail, findById, addUser, updateUser, removeUser,
  // schools
  allSchools, findSchoolById, findSchoolByName, addSchool, updateSchool, removeSchool,
  // school data
  getSchoolData, saveSchoolData,
  // settings
  getSetting, setSetting,
  // helpers
  normName,
};
