/*
 * One-time, NON-DESTRUCTIVE migration from the old single-teacher model to
 * the new zone -> schools -> roles model.
 *
 * For every existing teacher who has a school name but no schoolId yet:
 *   1. find (or create) a school with that name inside the zone;
 *   2. attach the teacher to that school as an 'admin' (so they keep the
 *      full-school access they had before — the owner can change this later);
 *   3. seed the SHARED school dataset from the FIRST such teacher's saved
 *      appState (marks) if the school has no dataset yet.
 *
 * Nothing is deleted: the teacher's original appState is left untouched, and
 * a timestamped backup of data.json is written first when running on the JSON
 * store. Safe to run on every boot — it only touches unassigned teachers.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function backupJson() {
  try {
    const DATA_DIR = process.env.DATA_DIR
      ? path.resolve(process.env.DATA_DIR)
      : path.join(__dirname, '..', 'data');
    const DATA_FILE = path.join(DATA_DIR, 'data.json');
    if (!process.env.DATABASE_URL && fs.existsSync(DATA_FILE)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dest = path.join(DATA_DIR, `data.backup.${stamp}.json`);
      fs.copyFileSync(DATA_FILE, dest);
      console.log(`[migrate] Backup written: ${path.basename(dest)}`);
    }
  } catch (e) {
    console.warn('[migrate] Backup skipped:', e.message);
  }
}

function schoolId() {
  return 'S' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
}

function emptySchoolData() {
  return { examName: '', examTerm: '', examYear: '', grades: {}, submitted: {}, submittedAt: {} };
}

function run(db) {
  const teachers = db.allUsers().filter(
    (u) => u.role === 'teacher' && !u.schoolId && (u.school && u.school.trim())
  );
  if (!teachers.length) return { migrated: 0, schools: 0 };

  backupJson();

  let migrated = 0;
  let created = 0;
  teachers.forEach((u) => {
    let school = db.findSchoolByName(u.school);
    if (!school) {
      school = db.addSchool({ id: schoolId(), name: u.school.trim(), createdAt: new Date().toISOString() });
      created++;
    }
    // Attach teacher as admin (retains prior whole-school access).
    db.updateUser(u.id, {
      schoolId: school.id,
      schoolRole: 'admin',
      assignedGrade: null,
    });
    migrated++;

    // Seed the shared dataset from this teacher's marks if empty.
    if (!db.getSchoolData(school.id) && u.appState && u.appState.grades) {
      const sd = emptySchoolData();
      sd.examName = u.appState.examName || '';
      sd.examTerm = u.appState.examTerm || '';
      sd.examYear = u.appState.examYear || '';
      sd.grades = u.appState.grades;
      db.saveSchoolData(school.id, sd);
    }
  });

  console.log(`[migrate] Attached ${migrated} teacher(s) to ${created} new school(s).`);
  return { migrated, schools: created };
}

module.exports = { run };
