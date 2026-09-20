/*
 * Shared grading config + summary maths for the OWNER dashboard aggregation.
 * Mirrors the client (public/app.js) so the server can rank schools and draw
 * completion graphs without trusting numbers sent from the browser.
 *
 * Grade 6 is upper-primary (6-subject) format, same as grades 4 & 5.
 */
const GRADE_CFG = [
  { g: 1, subjects: ['ENGLISH', 'KISWAHILI', 'MATHEMATICS', 'ENVIRONMENTAL'] },
  { g: 2, subjects: ['ENGLISH', 'KISWAHILI', 'MATHEMATICS', 'ENVIRONMENTAL'] },
  { g: 3, subjects: ['ENGLISH', 'KISWAHILI', 'MATHEMATICS', 'ENVIRONMENTAL'] },
  { g: 4, subjects: ['ENGLISH', 'KISWAHILI', 'MATHEMATICS', 'SCIENCE', 'C.A.S', 'S/S'] },
  { g: 5, subjects: ['ENGLISH', 'KISWAHILI', 'MATHEMATICS', 'SCIENCE', 'C.A.S', 'S/S'] },
  { g: 6, subjects: ['ENGLISH', 'KISWAHILI', 'MATHEMATICS', 'SCIENCE', 'C.A.S', 'S/S'] },
  { g: 7, subjects: ['ENGLISH', 'KISWAHILI', 'MATHEMATICS', 'INTEGRATED', 'AGRICULTURE', 'C.A.S', 'CRE', 'S/S', 'PRE-TECHNICAL'] },
  { g: 8, subjects: ['ENGLISH', 'KISWAHILI', 'MATHEMATICS', 'INTEGRATED', 'AGRICULTURE', 'C.A.S', 'CRE', 'S/S', 'PRE-TECHNICAL'] },
  { g: 9, subjects: ['ENGLISH', 'KISWAHILI', 'MATHEMATICS', 'INTEGRATED', 'AGRICULTURE', 'C.A.S', 'CRE', 'S/S', 'PRE-TECHNICAL'] },
];

function subjectCount(g) {
  const c = GRADE_CFG.find((x) => x.g === g);
  return c ? c.subjects.length : 0;
}

/*
 * Summarise ONE grade's dataset.
 * gradeData = { outOf:[...], learners:[{adm,name,raws:[...]}] }
 * Returns { learnerCount, avgPct, subjectAvgs:[...] } where avgPct is the mean
 * of each named learner's own average %, on a 0-100 scale (null if no data).
 */
function summariseGrade(gradeData) {
  const out = { learnerCount: 0, avgPct: null, subjectAvgs: [] };
  if (!gradeData || !Array.isArray(gradeData.learners)) return out;
  const outOf = Array.isArray(gradeData.outOf) ? gradeData.outOf : [];
  const nSubj = outOf.length || (gradeData.learners[0] && gradeData.learners[0].raws ? gradeData.learners[0].raws.length : 0);
  const subjSum = new Array(nSubj).fill(0);
  const subjN = new Array(nSubj).fill(0);
  const learnerAvgs = [];
  let learnerCount = 0;

  gradeData.learners.forEach((lr) => {
    if (!lr || !lr.name || !String(lr.name).trim()) return;
    learnerCount++;
    const raws = Array.isArray(lr.raws) ? lr.raws : [];
    let pctSum = 0, pctN = 0;
    for (let si = 0; si < nSubj; si++) {
      const raw = raws[si];
      if (raw === null || raw === '' || raw === undefined || raw === 'ABS') continue;
      const r = parseFloat(raw);
      if (isNaN(r) || r < 0) continue;
      const o = outOf[si] > 0 ? outOf[si] : 100;
      const pct = Math.round((r / o) * 1000) / 10;
      pctSum += pct; pctN++;
      subjSum[si] += pct; subjN[si]++;
    }
    if (pctN > 0) learnerAvgs.push(Math.round((pctSum / pctN) * 10) / 10);
  });

  out.learnerCount = learnerCount;
  out.avgPct = learnerAvgs.length
    ? Math.round((learnerAvgs.reduce((a, b) => a + b, 0) / learnerAvgs.length) * 10) / 10
    : null;
  out.subjectAvgs = subjSum.map((s, i) => (subjN[i] > 0 ? Math.round((s / subjN[i]) * 10) / 10 : null));
  return out;
}

module.exports = { GRADE_CFG, subjectCount, summariseGrade };
