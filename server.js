/*
 * Orpa backend server
 * -----------------------------------------------------------
 * - Central teacher accounts (register / login) with bcrypt.
 * - Owner-only admin API: list users, suspend, activate, delete,
 *   and force-logout (token revocation + live socket kick).
 * - Live session monitoring via Socket.IO presence.
 * - Serves the Orpa PWA frontend from ./public.
 *
 * SECURITY: run this behind HTTPS in production. Set JWT_SECRET,
 * OWNER_EMAIL and OWNER_PASSWORD via environment variables.
 */
const path = require('path');
// Load settings from a local .env file (if present) before anything reads
// process.env. Real environment variables always take precedence.
require('./lib/loadenv')();
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const db = require('./lib/db');
const email = require('./lib/email');
const migrate = require('./lib/migrate');
const grading = require('./lib/grading');

// Fire-and-forget email helper: never let email failures break the API.
function notify(templateName, user, extra) {
  try {
    Promise.resolve(email.sendTemplate(templateName, user, extra))
      .catch((e) => console.error('[email] send error:', e.message));
  } catch (e) {
    console.error('[email] notify error:', e.message);
  }
}

// ---------- Config ----------
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL = process.env.TOKEN_TTL || '7d';
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'owner@orpa.local').toLowerCase();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'changeme123';

if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET not set — using a random secret. Sessions reset on restart. Set JWT_SECRET in production.');
}

// Data is loaded asynchronously in init() below (so the PostgreSQL backend can
// connect before the server starts accepting requests).

// ---------- Seed owner account ----------
function seedOwner() {
  const existing = db.allUsers().find((u) => u.role === 'owner');
  if (existing) return;
  const hash = bcrypt.hashSync(OWNER_PASSWORD, 10);
  db.addUser({
    id: 'OWNER',
    name: 'System Owner',
    email: OWNER_EMAIL,
    phone: '',
    school: 'Orpa HQ',
    passwordHash: hash,
    role: 'owner',
    status: 'active',
    tokenVersion: 1,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  });
  console.log(`[seed] Owner account created: ${OWNER_EMAIL}`);
  if (!process.env.OWNER_PASSWORD) {
    console.warn(`[warn] Owner password defaults to "${OWNER_PASSWORD}". Change it via OWNER_PASSWORD env and delete data/data.json to re-seed, OR change it from the app profile.`);
  }
}
// seedOwner() runs inside init() after the datastore has loaded.

// ---------- Presence (in-memory) ----------
// userId -> { sockets:Set<socketId>, lastActive:number, grade:number|null, name, email }
const presence = new Map();

function presenceSnapshot() {
  const list = [];
  for (const [uid, p] of presence.entries()) {
    list.push({
      id: uid,
      name: p.name,
      email: p.email,
      grade: p.grade,
      lastActive: p.lastActive,
      sockets: p.sockets.size,
    });
  }
  return list;
}

let io; // set after http server is created
function broadcastPresence() {
  if (io) io.to('admins').emit('presence', presenceSnapshot());
}

// ---------- Helpers ----------
function publicUser(u) {
  const school = u.schoolId ? db.findSchoolById(u.schoolId) : null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    school: u.school,
    tsc: u.tsc || '',
    role: u.role,
    status: u.status,
    // multi-tenant assignment
    schoolId: u.schoolId || null,
    schoolName: school ? school.name : (u.school || ''),
    schoolRole: u.schoolRole || null,      // 'admin' | 'class_teacher' | null
    assignedGrade: u.assignedGrade || null, // grade 1-9 for a class teacher
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt || null,
  };
}

function signToken(u) {
  return jwt.sign({ uid: u.id, ver: u.tokenVersion }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const u = db.findById(payload.uid);
    if (!u) return null;
    if (u.status !== 'active') return null;
    if ((u.tokenVersion || 1) !== payload.ver) return null; // revoked / forced-logout
    return u;
  } catch (e) {
    return null;
  }
}

// ---------- App ----------
const app = express();

// Behind a host's HTTPS load balancer (Render/Railway/Nginx), trust the proxy
// so secure cookies, client IPs, and rate-limiting work correctly.
app.set('trust proxy', 1);

// Security response headers. contentSecurityPolicy is disabled because the
// frontend uses inline styles/scripts; everything is same-origin anyway.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// CORS: the frontend is served by THIS same server, so same-origin requests
// need no special CORS. If you host the frontend on a different domain, list
// it in CORS_ORIGIN (comma-separated) to allow it.
const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
if (corsOrigins.length) {
  app.use(cors({ origin: corsOrigins, credentials: true }));
} else {
  app.use(cors()); // same-origin usage; permissive but fine when UI is served here
}

app.use(express.json({ limit: '4mb' }));

// Rate limiters to blunt brute-force / abuse once the app is public.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,                  // 20 login attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,                  // 10 new sign-ups per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-ups from this network. Please try again later.' },
});

// Simple health check for hosting platforms.
app.get('/health', (req, res) => res.json({ ok: true }));

// Auth middleware
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const u = token && verifyToken(token);
  if (!u) return res.status(401).json({ error: 'Not authenticated or session ended.' });
  req.user = u;
  next();
}
function ownerOnly(req, res, next) {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner access required.' });
  next();
}

function genId() {
  return 'T' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
}

// ---------- Auth routes ----------
app.post('/api/register', registerLimiter, (req, res) => {
  const { name, email, phone, school, tsc, password } = req.body || {};
  if (!name || !email || !email.includes('@')) return res.status(400).json({ error: 'Valid name and email required.' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (db.findByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
  const u = {
    id: genId(),
    name: String(name).trim(),
    email: String(email).toLowerCase().trim(),
    phone: phone || '',
    school: school || '',
    tsc: (tsc || '').toString().trim(),
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'teacher',
    // New accounts start as 'pending' — the owner must approve them in the
    // admin panel before they can log in. This prevents unknown sign-ups.
    status: 'pending',
    tokenVersion: 1,
    schoolId: null,
    schoolRole: null,
    assignedGrade: null,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };
  db.addUser(u);
  // Notify the owner that a new account is awaiting approval (best-effort).
  try { notify('pending', u, {}); } catch (e) {}
  res.status(201).json({ ok: true, status: 'pending' });
});

app.post('/api/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const u = db.findByEmail(email || '');
  if (!u || !bcrypt.compareSync(password || '', u.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  if (u.status === 'pending') {
    return res.status(403).json({ error: 'Your account is awaiting approval by the administrator. You will be able to sign in once it is approved.' });
  }
  if (u.status !== 'active') {
    return res.status(403).json({ error: 'This account has been suspended. Contact the administrator.' });
  }
  db.updateUser(u.id, { lastLoginAt: new Date().toISOString() });
  res.json({ token: signToken(u), user: publicUser(u) });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post('/api/logout', auth, (req, res) => {
  res.status(204).end();
});

// Update own profile
app.put('/api/me', auth, (req, res) => {
  const { name, phone, school, currentPassword, newPassword } = req.body || {};
  const patch = {};
  if (typeof name === 'string' && name.trim()) patch.name = name.trim();
  if (typeof phone === 'string') patch.phone = phone;
  if (typeof school === 'string') patch.school = school;
  if (newPassword) {
    if (!bcrypt.compareSync(currentPassword || '', req.user.passwordHash)) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    patch.passwordHash = bcrypt.hashSync(newPassword, 10);
  }
  const u = db.updateUser(req.user.id, patch);
  res.json({ user: publicUser(u) });
});

// Quick school-name update (used by the top-bar field)
app.patch('/api/me/school', auth, (req, res) => {
  const school = (req.body && typeof req.body.school === 'string') ? req.body.school : '';
  const u = db.updateUser(req.user.id, { school });
  res.json({ user: publicUser(u) });
});

// ---------- User state sync (grades / marks across devices) ----------
// GET /api/me/state  — load the user's grading data from the server
app.get('/api/me/state', auth, (req, res) => {
  const u = db.findById(req.user.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  res.json({ state: u.appState || null, savedAt: u.appStateSavedAt || null });
});

// PUT /api/me/state  — save the user's grading data to the server
app.put('/api/me/state', auth, (req, res) => {
  if (!req.body || typeof req.body.state === 'undefined') {
    return res.status(400).json({ error: 'Missing state data.' });
  }
  // Limit payload size (the state object with 9 grades × 45 learners × ~9 subjects)
  const json = JSON.stringify(req.body.state);
  if (json.length > 500000) {
    return res.status(413).json({ error: 'State data too large (max ~500 KB).' });
  }
  const now = new Date().toISOString();
  db.updateUser(req.user.id, { appState: req.body.state, appStateSavedAt: now });
  res.json({ ok: true, savedAt: now });
});

// ---------- School-scoped grading data (shared per school) ----------
function emptySchoolData() {
  return { examName: '', examTerm: '', examYear: '', grades: {}, submitted: {}, submittedAt: {} };
}
function getOrInitSchoolData(schoolId) {
  let d = db.getSchoolData(schoolId);
  if (!d) { d = emptySchoolData(); db.saveSchoolData(schoolId, d); }
  if (!d.grades) d.grades = {};
  if (!d.submitted) d.submitted = {};
  if (!d.submittedAt) d.submittedAt = {};
  return d;
}

// GET the assigned school's shared dataset.
app.get('/api/school/state', auth, (req, res) => {
  const u = req.user;
  if (u.role === 'owner') return res.status(400).json({ error: 'Owner uses the admin dashboard.' });
  if (!u.schoolId) return res.status(409).json({ error: 'no-assignment', message: 'Your account has not been assigned to a school yet. Please wait for the administrator.' });
  const school = db.findSchoolById(u.schoolId);
  if (!school) return res.status(404).json({ error: 'Assigned school no longer exists. Contact the administrator.' });
  const data = getOrInitSchoolData(u.schoolId);
  res.json({
    schoolId: school.id,
    schoolName: school.name,
    schoolLogo: school.logo || null,      // header logo (data URL)
    zoneLogo: db.getSetting('zoneLogo'),  // faint watermark for downloads
    schoolRole: u.schoolRole || null,
    assignedGrade: u.assignedGrade || null,
    data,
  });
});

// PUT a patch of the shared dataset. Class teachers may only touch their own
// grade; admins may touch anything in their school.
app.put('/api/school/state', auth, (req, res) => {
  const u = req.user;
  if (u.role === 'owner') return res.status(400).json({ error: 'Owner cannot edit school data.' });
  if (!u.schoolId) return res.status(409).json({ error: 'no-assignment' });
  const body = req.body || {};
  const json = JSON.stringify(body);
  if (json.length > 3000000) return res.status(413).json({ error: 'Data too large.' });

  const data = getOrInitSchoolData(u.schoolId);
  const isAdmin = u.schoolRole === 'admin';

  if (typeof body.examName === 'string') data.examName = body.examName;
  if (typeof body.examTerm === 'string') data.examTerm = body.examTerm;
  if (typeof body.examYear === 'string') data.examYear = body.examYear;

  if (body.grades && typeof body.grades === 'object') {
    Object.keys(body.grades).forEach((g) => {
      const gn = parseInt(g, 10);
      if (gn < 1 || gn > 9) return;
      if (!isAdmin && gn !== u.assignedGrade) return; // class teacher: own grade only
      data.grades[gn] = body.grades[g];
    });
  }
  db.saveSchoolData(u.schoolId, data);
  res.json({ ok: true });
});

// POST submit a grade (makes it visible on the owner dashboard).
app.post('/api/school/submit', auth, (req, res) => {
  const u = req.user;
  if (u.role === 'owner') return res.status(400).json({ error: 'Owner cannot submit.' });
  if (!u.schoolId) return res.status(409).json({ error: 'no-assignment' });
  const isAdmin = u.schoolRole === 'admin';
  const grade = parseInt((req.body && req.body.grade), 10);
  if (!(grade >= 1 && grade <= 9)) return res.status(400).json({ error: 'Valid grade (1-9) required.' });
  if (!isAdmin && grade !== u.assignedGrade) return res.status(403).json({ error: 'You can only submit your own grade.' });
  const data = getOrInitSchoolData(u.schoolId);
  data.submitted[grade] = true;
  data.submittedAt[grade] = new Date().toISOString();
  db.saveSchoolData(u.schoolId, data);
  res.json({ ok: true, submitted: data.submitted });
});

// ---------- Logos ----------
// A school ADMIN uploads their school logo (small resized data URL from the
// browser). It becomes the centred header image on every download for that
// school. Class teachers can read it but only admins may change it.
const MAX_LOGO_LEN = 700000; // ~500 KB image as a base64 data URL
function validLogo(v, res) {
  if (typeof v !== 'string' || !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(v)) {
    res.status(400).json({ error: 'Please upload a PNG, JPG or WEBP image.' });
    return false;
  }
  if (v.length > MAX_LOGO_LEN) {
    res.status(413).json({ error: 'Logo image is too large. Please use a smaller picture.' });
    return false;
  }
  return true;
}

app.post('/api/school/logo', auth, (req, res) => {
  const u = req.user;
  if (u.role === 'owner') return res.status(400).json({ error: 'Use the zone logo instead.' });
  if (!u.schoolId) return res.status(409).json({ error: 'no-assignment' });
  if (u.schoolRole !== 'admin') return res.status(403).json({ error: 'Only a school admin can change the school logo.' });
  const logo = req.body && req.body.logo;
  if (logo === null || logo === '') {
    db.updateSchool(u.schoolId, { logo: null });
    return res.json({ ok: true, schoolLogo: null });
  }
  if (!validLogo(logo, res)) return;
  db.updateSchool(u.schoolId, { logo });
  res.json({ ok: true, schoolLogo: logo });
});

// The system OWNER uploads a zone logo used as a faint watermark on ALL
// downloads across every school.
app.get('/api/admin/zone-logo', auth, ownerOnly, (req, res) => {
  res.json({ zoneLogo: db.getSetting('zoneLogo') });
});
app.post('/api/admin/zone-logo', auth, ownerOnly, (req, res) => {
  const logo = req.body && req.body.logo;
  if (logo === null || logo === '') {
    db.setSetting('zoneLogo', null);
    return res.json({ ok: true, zoneLogo: null });
  }
  if (!validLogo(logo, res)) return;
  db.setSetting('zoneLogo', logo);
  res.json({ ok: true, zoneLogo: logo });
});

// ---------- Admin routes (owner only) ----------
app.get('/api/admin/users', auth, ownerOnly, (req, res) => {
  const online = new Set(presence.keys());
  const users = db.allUsers().map((u) => ({
    ...publicUser(u),
    online: online.has(u.id),
    lastActive: presence.get(u.id) ? presence.get(u.id).lastActive : null,
  }));
  res.json({ users });
});

app.get('/api/admin/sessions', auth, ownerOnly, (req, res) => {
  res.json({ sessions: presenceSnapshot() });
});

function schoolIdGen() {
  return 'S' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
}

// List all schools with their members + submission status.
app.get('/api/admin/schools', auth, ownerOnly, (req, res) => {
  const online = new Set(presence.keys());
  const schools = db.allSchools().map((s) => {
    const members = db.allUsers()
      .filter((u) => u.schoolId === s.id)
      .map((u) => ({
        id: u.id, name: u.name, email: u.email, status: u.status,
        schoolRole: u.schoolRole || null, assignedGrade: u.assignedGrade || null,
        online: online.has(u.id),
      }));
    const data = db.getSchoolData(s.id) || {};
    const submitted = data.submitted || {};
    return { id: s.id, name: s.name, createdAt: s.createdAt, members, submitted, hasLogo: !!s.logo };
  });
  res.json({ schools });
});

app.post('/api/admin/schools', auth, ownerOnly, (req, res) => {
  const name = (req.body && req.body.name || '').toString().trim();
  if (!name) return res.status(400).json({ error: 'School name required.' });
  if (db.findSchoolByName(name)) return res.status(409).json({ error: 'A school with this name already exists.' });
  const s = db.addSchool({ id: schoolIdGen(), name, createdAt: new Date().toISOString() });
  res.status(201).json({ school: { id: s.id, name: s.name, createdAt: s.createdAt } });
});

app.patch('/api/admin/schools/:id', auth, ownerOnly, (req, res) => {
  const s = db.findSchoolById(req.params.id);
  if (!s) return res.status(404).json({ error: 'School not found.' });
  const name = (req.body && req.body.name || '').toString().trim();
  if (!name) return res.status(400).json({ error: 'School name required.' });
  const dup = db.findSchoolByName(name);
  if (dup && dup.id !== s.id) return res.status(409).json({ error: 'Another school already has this name.' });
  db.updateSchool(s.id, { name });
  res.json({ ok: true });
});

app.delete('/api/admin/schools/:id', auth, ownerOnly, (req, res) => {
  const s = db.findSchoolById(req.params.id);
  if (!s) return res.status(404).json({ error: 'School not found.' });
  // Detach any members first so they don't point at a dead school.
  db.allUsers().filter((u) => u.schoolId === s.id).forEach((u) => {
    db.updateUser(u.id, { schoolId: null, schoolRole: null, assignedGrade: null });
  });
  db.removeSchool(s.id);
  res.json({ ok: true });
});

// Assign (or re-assign) a teacher to a school + role + grade.
app.post('/api/admin/users/:id/assign', auth, ownerOnly, (req, res) => {
  const u = db.findById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (u.role === 'owner') return res.status(400).json({ error: 'Cannot assign the owner.' });
  const { schoolId, schoolRole } = req.body || {};
  let assignedGrade = req.body ? req.body.assignedGrade : null;

  if (!schoolId) {
    // Unassign
    db.updateUser(u.id, { schoolId: null, schoolRole: null, assignedGrade: null });
    return res.json({ ok: true, user: publicUser(db.findById(u.id)) });
  }
  const school = db.findSchoolById(schoolId);
  if (!school) return res.status(404).json({ error: 'School not found.' });
  if (schoolRole !== 'admin' && schoolRole !== 'class_teacher') {
    return res.status(400).json({ error: 'Role must be admin or class_teacher.' });
  }
  if (schoolRole === 'class_teacher') {
    assignedGrade = parseInt(assignedGrade, 10);
    if (!(assignedGrade >= 1 && assignedGrade <= 9)) {
      return res.status(400).json({ error: 'A class teacher needs a grade (1-9).' });
    }
  } else {
    assignedGrade = null; // admin edits the whole school
  }
  db.updateUser(u.id, {
    schoolId: school.id,
    schoolRole,
    assignedGrade,
    school: school.name, // keep the display field in sync
  });
  res.json({ ok: true, user: publicUser(db.findById(u.id)) });
});

// Zone overview: schools ranked best -> poorest across grades 1-9, with
// per-grade averages (only for SUBMITTED grades) and completion stats.
app.get('/api/admin/overview', auth, ownerOnly, (req, res) => {
  const schools = db.allSchools().map((s) => {
    const data = db.getSchoolData(s.id) || {};
    const grades = data.grades || {};
    const submitted = data.submitted || {};
    const perGrade = {};
    const submittedAvgs = [];
    for (let g = 1; g <= 9; g++) {
      const isSub = !!submitted[g];
      const summary = grading.summariseGrade(grades[g]);
      perGrade[g] = {
        submitted: isSub,
        learnerCount: summary.learnerCount,
        // Averages are only revealed once the grade has been SUBMITTED.
        avgPct: isSub ? summary.avgPct : null,
        subjectAvgs: isSub ? summary.subjectAvgs : null,
      };
      if (isSub && summary.avgPct !== null) submittedAvgs.push(summary.avgPct);
    }
    const anySubmitted = submittedAvgs.length > 0;
    const overallAvg = anySubmitted
      ? Math.round((submittedAvgs.reduce((a, b) => a + b, 0) / submittedAvgs.length) * 10) / 10
      : null;
    return {
      id: s.id, name: s.name,
      perGrade,
      overallAvg,
      submittedCount: submittedAvgs.length,
      // A school only appears "live" on the dashboard once it has submitted.
      visible: anySubmitted,
    };
  });

  // Rank visible schools best -> poorest by overall average.
  const ranked = schools.slice().sort((a, b) => {
    if (a.visible !== b.visible) return a.visible ? -1 : 1;
    return (b.overallAvg || -1) - (a.overallAvg || -1);
  });
  ranked.forEach((s, i) => { s.rank = s.visible ? i + 1 : null; });

  // Completion per grade: how many schools have submitted each grade.
  const totalSchools = schools.length;
  const completion = {};
  for (let g = 1; g <= 9; g++) {
    const submittedSchools = schools.filter((s) => s.perGrade[g].submitted).length;
    completion[g] = {
      submitted: submittedSchools,
      total: totalSchools,
      pct: totalSchools ? Math.round((submittedSchools / totalSchools) * 1000) / 10 : 0,
    };
  }

  res.json({ schools: ranked, completion, totalSchools });
});

function kickUserSockets(userId, reason) {
  const p = presence.get(userId);
  if (p && io) {
    for (const sid of p.sockets) {
      io.to(sid).emit('force-logout', { reason: reason || 'Your session was ended by the administrator.' });
      const s = io.sockets.sockets.get(sid);
      if (s) s.disconnect(true);
    }
  }
}

app.post('/api/admin/users/:id/suspend', auth, ownerOnly, (req, res) => {
  const u = db.findById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (u.role === 'owner') return res.status(400).json({ error: 'Cannot suspend the owner account.' });
  db.updateUser(u.id, { status: 'suspended', tokenVersion: (u.tokenVersion || 1) + 1 });
  kickUserSockets(u.id, 'Your account has been suspended by the administrator.');
  notify('suspended', u, { ownerName: req.user.name, reason: (req.body && req.body.reason) || '' });
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/activate', auth, ownerOnly, (req, res) => {
  const u = db.findById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  db.updateUser(u.id, { status: 'active' });
  notify('activated', u, { ownerName: req.user.name });
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/logout', auth, ownerOnly, (req, res) => {
  const u = db.findById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  db.updateUser(u.id, { tokenVersion: (u.tokenVersion || 1) + 1 });
  kickUserSockets(u.id, 'You were signed out by the administrator.');
  notify('forceLogout', u, { ownerName: req.user.name });
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', auth, ownerOnly, (req, res) => {
  const u = db.findById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (u.role === 'owner') return res.status(400).json({ error: 'Cannot delete the owner account.' });
  kickUserSockets(u.id, 'Your account has been removed by the administrator.');
  notify('deleted', u, { ownerName: req.user.name });
  db.removeUser(u.id);
  res.json({ ok: true });
});

// ---------- Android app link (TWA / PWABuilder) ----------
// Serves the Digital Asset Links file that ties the installed Android app to
// this domain, so the packaged app runs full-screen (no browser address bar)
// and no other APK can impersonate this site. express.static ignores dotfiles
// (the .well-known folder), so this file is served by an explicit route.
// After building the APK, put your app's package name + SHA-256 signing
// fingerprint into public/.well-known/assetlinks.json.
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.type('application/json');
  res.sendFile(path.join(__dirname, 'public', '.well-known', 'assetlinks.json'));
});

// ---------- Static frontend ----------
app.use(express.static(path.join(__dirname, 'public')));

// ---------- HTTP + Socket.IO ----------
const server = http.createServer(app);
io = new Server(server, { cors: { origin: corsOrigins.length ? corsOrigins : '*' } });

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const u = token && verifyToken(token);
  if (!u) return next(new Error('unauthorized'));
  socket.user = u;
  next();
});

io.on('connection', (socket) => {
  const u = socket.user;
  if (u.role === 'owner') {
    socket.join('admins');
    socket.emit('presence', presenceSnapshot());
    return; // owner is a monitor, not tracked as a teaching session
  }
  let p = presence.get(u.id);
  if (!p) {
    p = { sockets: new Set(), lastActive: Date.now(), grade: null, name: u.name, email: u.email };
    presence.set(u.id, p);
  }
  p.sockets.add(socket.id);
  p.lastActive = Date.now();
  broadcastPresence();

  socket.on('activity', (data) => {
    p.lastActive = Date.now();
    if (data && typeof data.grade === 'number') p.grade = data.grade;
    broadcastPresence();
  });

  socket.on('disconnect', () => {
    p.sockets.delete(socket.id);
    if (p.sockets.size === 0) presence.delete(u.id);
    broadcastPresence();
  });
});

async function init() {
  try {
    // Connect to PostgreSQL first (loads the cache + flips db into PG mode).
    // Only fall back to the local JSON store when there is no DATABASE_URL
    // or the connection fails — otherwise data would silently go to the
    // ephemeral disk and be lost on every redeploy/restart.
    const connected = await db.init();
    if (!connected) db.load();
  } catch (e) {
    console.error('[fatal] Could not load the datastore:', e.message);
    process.exit(1);
  }
  seedOwner();
  try {
    migrate.run(db);
  } catch (e) {
    console.error('[migrate] migration error (non-fatal):', e.message);
  }
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Orpa server running on http://0.0.0.0:${PORT}`);
    console.log(`Owner login: ${OWNER_EMAIL}`);
    if (!process.env.JWT_SECRET) {
      console.warn('[warn] JWT_SECRET not set — set it in production so logins survive restarts.');
    }
    if (!process.env.DATABASE_URL && !process.env.DATA_DIR) {
      console.log('[info] Using local JSON storage in ./data. On a cloud host, set DATABASE_URL (PostgreSQL) or point DATA_DIR at a persistent disk so data is not lost on redeploy.');
    }
  });
}
init();

process.on('SIGINT', () => { db.persistSync(); process.exit(0); });
process.on('SIGTERM', () => { db.persistSync(); process.exit(0); });
