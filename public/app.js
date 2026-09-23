// ============================================================
//  ORPA GRADING SYSTEM — Full Auth + M-Pesa
// ============================================================

// ========== GRADE CONFIG (from XCEL workbook) ==========
const GRADE_CFG=[
  {g:1,subjects:[{n:'ENGLISH',def:40},{n:'KISWAHILI',def:40},{n:'MATHEMATICS',def:40},{n:'ENVIRONMENTAL',def:40}]},
  {g:2,subjects:[{n:'ENGLISH',def:40},{n:'KISWAHILI',def:40},{n:'MATHEMATICS',def:40},{n:'ENVIRONMENTAL',def:40}]},
  {g:3,subjects:[{n:'ENGLISH',def:40},{n:'KISWAHILI',def:40},{n:'MATHEMATICS',def:40},{n:'ENVIRONMENTAL',def:40}]},
  {g:4,subjects:[{n:'ENGLISH',def:40},{n:'KISWAHILI',def:40},{n:'MATHEMATICS',def:40},{n:'SCIENCE',def:40},{n:'C.A.S',def:40},{n:'S/S',def:40}]},
  {g:5,subjects:[{n:'ENGLISH',def:40},{n:'KISWAHILI',def:40},{n:'MATHEMATICS',def:40},{n:'SCIENCE',def:40},{n:'C.A.S',def:40},{n:'S/S',def:40}]},
  {g:6,subjects:[{n:'ENGLISH',def:40},{n:'KISWAHILI',def:40},{n:'MATHEMATICS',def:40},{n:'SCIENCE',def:40},{n:'C.A.S',def:40},{n:'S/S',def:40}]},
  {g:7,subjects:[{n:'ENGLISH',def:70},{n:'KISWAHILI',def:70},{n:'MATHEMATICS',def:70},{n:'INTEGRATED',def:70},{n:'AGRICULTURE',def:100},{n:'C.A.S',def:70},{n:'CRE',def:70},{n:'S/S',def:70},{n:'PRE-TECHNICAL',def:100}]},
  {g:8,subjects:[{n:'ENGLISH',def:70},{n:'KISWAHILI',def:70},{n:'MATHEMATICS',def:70},{n:'INTEGRATED',def:70},{n:'AGRICULTURE',def:100},{n:'C.A.S',def:70},{n:'CRE',def:70},{n:'S/S',def:70},{n:'PRE-TECHNICAL',def:100}]},
  {g:9,subjects:[{n:'ENGLISH',def:70},{n:'KISWAHILI',def:70},{n:'MATHEMATICS',def:70},{n:'INTEGRATED',def:70},{n:'AGRICULTURE',def:100},{n:'C.A.S',def:70},{n:'CRE',def:70},{n:'S/S',def:70},{n:'PRE-TECHNICAL',def:100}]}
];
const MAX_LEARNERS=150;
const AVG_ROW_LABEL_INDEX=MAX_LEARNERS+1; // column-average (Mean Subject Score) row shows on row 151
const MPESA_AMOUNT=100; // KSh 100

// KNEC KCSE Grading
const KNEC_GRADES=[
  {pct:84,g:'A',pts:12},{pct:80,g:'A-',pts:11},{pct:75,g:'B+',pts:10},
  {pct:70,g:'B',pts:9},{pct:65,g:'B-',pts:8},{pct:60,g:'C+',pts:7},
  {pct:55,g:'C',pts:6},{pct:50,g:'C-',pts:5},{pct:45,g:'D+',pts:4},
  {pct:40,g:'D',pts:3},{pct:35,g:'D-',pts:2},{pct:0,g:'E',pts:1}
];
// CBE 8-Level Performance Scale (Kenya CBC/CBE)
// Zone CBE 8-Level Performance / Ranking Scale
const PL_LEVELS=[
  {pct:90,level:8,band:'EE1',desc:'Exceeding Expectations'},
  {pct:75,level:7,band:'EE2',desc:'Exceeding Expectations'},
  {pct:58,level:6,band:'ME1',desc:'Meeting Expectations'},
  {pct:41,level:5,band:'ME2',desc:'Meeting Expectations'},
  {pct:31,level:4,band:'AE1',desc:'Approaching Expectations'},
  {pct:21,level:3,band:'AE2',desc:'Approaching Expectations'},
  {pct:11,level:2,band:'BE1',desc:'Below Expectations'},
  {pct:1,level:1,band:'BE2',desc:'Below Expectations'}
];

function knecGrade(pct){for(const k of KNEC_GRADES)if(pct>=k.pct)return k;return{g:'E',pts:1}}
function plLevel(pct){for(const p of PL_LEVELS)if(pct>=p.pct)return p;return{level:1,band:'BE2',desc:'Below Expectations'}}

// ========== PASSWORD HASHING (client-side, SHA-256) ==========
async function hashPassword(pw){const enc=new TextEncoder().encode(pw);const buf=await crypto.subtle.digest('SHA-256',enc);return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('')}

// ========== SESSION & STATE ==========
let currentUser=null; // logged-in teacher
let currentGrade=1;
let sessionToken=null;

// Data stored per-user in localStorage
function userKey(){return 'nyak_'+currentUser.id}
function globalKey(k){return 'nyak_global_'+k}

let state={examName:'',examTerm:'',examYear:'',grades:{},archives:[],graduates:[],motto:'',schoolContact:''};

function defaultGrade(g){
  const cfg=GRADE_CFG.find(c=>c.g===g);
  const learners=[];
  for(let i=0;i<MAX_LEARNERS;i++) learners.push({adm:'',name:'',raws:cfg.subjects.map(()=>null)});
  return{outOf:cfg.subjects.map(s=>s.def),learners};
}

// Reconcile a stored grade to the CURRENT template & size. This safely upgrades
// migrated data: pads learners up to MAX_LEARNERS (45 -> 150) and re-shapes each
// learner's marks when the subject count changed (e.g. old 9-subject Grade 6 ->
// new 6-subject upper-primary). Existing names/marks are preserved where they
// still line up; extra old columns are dropped, new ones start blank.
function reconcileGrade(g){
  const cfg=GRADE_CFG.find(c=>c.g===g);
  const nSubj=cfg.subjects.length;
  let gd=state.grades[g];
  if(!gd||typeof gd!=='object'){state.grades[g]=defaultGrade(g);return}
  if(!Array.isArray(gd.outOf)) gd.outOf=cfg.subjects.map(s=>s.def);
  if(gd.outOf.length!==nSubj){
    const fixed=cfg.subjects.map((s,i)=>(typeof gd.outOf[i]==='number'?gd.outOf[i]:s.def));
    gd.outOf=fixed;
  }
  if(!Array.isArray(gd.learners)) gd.learners=[];
  gd.learners.forEach(lr=>{
    if(!lr.raws||!Array.isArray(lr.raws)) lr.raws=cfg.subjects.map(()=>null);
    if(lr.raws.length<nSubj){while(lr.raws.length<nSubj)lr.raws.push(null)}
    else if(lr.raws.length>nSubj){lr.raws=lr.raws.slice(0,nSubj)}
    if(typeof lr.adm!=='string')lr.adm=lr.adm==null?'':String(lr.adm);
    if(typeof lr.name!=='string')lr.name=lr.name==null?'':String(lr.name);
  });
  while(gd.learners.length<MAX_LEARNERS){gd.learners.push({adm:'',name:'',raws:cfg.subjects.map(()=>null)})}
  // Never shrink below entered data, but cap the visible sheet at MAX_LEARNERS.
  if(gd.learners.length>MAX_LEARNERS){
    const extra=gd.learners.slice(MAX_LEARNERS).some(lr=>lr.name&&lr.name.trim());
    if(!extra) gd.learners=gd.learners.slice(0,MAX_LEARNERS);
  }
}

function loadUserState(){
  try{const s=localStorage.getItem(userKey()+'_data');if(s)state=JSON.parse(s)}catch(e){}
  if(!state.grades)state.grades={};
  if(!Array.isArray(state.archives))state.archives=[];
  if(!Array.isArray(state.graduates))state.graduates=[];
  if(typeof state.motto!=='string')state.motto='';
  if(typeof state.schoolContact!=='string')state.schoolContact='';
  for(let g=1;g<=9;g++){ if(!state.grades[g]) state.grades[g]=defaultGrade(g); else reconcileGrade(g); }
  const en=document.getElementById('examName');if(en)en.value=state.examName||'';
  const et=document.getElementById('examTerm');if(et)et.value=state.examTerm||'';
  const ey=document.getElementById('examYear');if(ey)ey.value=state.examYear||'';
}
function saveUserState(){
  state.examName=document.getElementById('examName').value;
  state.examTerm=document.getElementById('examTerm').value;
  state.examYear=document.getElementById('examYear').value;
  localStorage.setItem(userKey()+'_data',JSON.stringify(state));
}
let _saveTimer=null;
function debounceSave(){clearTimeout(_saveTimer);_saveTimer=setTimeout(()=>{saveUserState();toast('💾 Saved')},800)}

// ========== USER DB (localStorage) ==========
function getUsers(){try{return JSON.parse(localStorage.getItem('nyak_users'))||[]}catch(e){return[]}}
function saveUsers(users){localStorage.setItem('nyak_users',JSON.stringify(users))}
function findUserByEmail(email){return getUsers().find(u=>u.email===email.toLowerCase().trim())}
function findUserById(id){return getUsers().find(u=>u.id===id)}

// ========== PAYMENT DB ==========
function getPayments(){try{return JSON.parse(localStorage.getItem(userKey()+'_payments'))||[]}catch(e){return[]}}
function savePayments(p){localStorage.setItem(userKey()+'_payments',JSON.stringify(p))}
function isGradePaid(grade){
  // TESTING MODE: All grades unlocked for testing
  return true;
  /* Original: const payments=getPayments();return payments.some(p=>p.grade===grade&&p.status==='success') */
}
function getGradePayment(grade){return getPayments().find(p=>p.grade===grade&&p.status==='success')}

// ========== AUTH: REGISTER ==========
function showAuth(which){
  document.getElementById('authRegister').style.display=which==='register'?'flex':'none';
  document.getElementById('authLogin').style.display=which==='login'?'flex':'none';
}

async function doRegister(){
  const name=document.getElementById('regName').value.trim();
  const email=document.getElementById('regEmail').value.trim().toLowerCase();
  const phone=document.getElementById('regPhone').value.trim();
  const school=document.getElementById('regSchool').value.trim();
  const pw=document.getElementById('regPassword').value;
  const confirm=document.getElementById('regConfirm').value;
  const errBox=document.getElementById('regErrorBox');

  // Validation
  if(!name){errBox.textContent='Please enter your full name.';errBox.style.display='block';return}
  if(!email||!email.includes('@')){errBox.textContent='Please enter a valid email address.';errBox.style.display='block';return}
  if(!phone||phone.length<9){errBox.textContent='Please enter a valid phone number (9 digits).';errBox.style.display='block';return}
  if(pw.length<6){errBox.textContent='Password must be at least 6 characters.';errBox.style.display='block';return}
  if(pw!==confirm){errBox.textContent='Passwords do not match.';errBox.style.display='block';return}

  // Check duplicate
  if(findUserByEmail(email)){errBox.textContent='An account with this email already exists.';errBox.style.display='block';return}

  const hash=await hashPassword(pw);
  const users=getUsers();
  const id='T'+Date.now().toString(36)+Math.random().toString(36).substr(2,4);
  users.push({id,name,email,phone:'+254'+phone,school,hash,createdAt:new Date().toISOString()});
  saveUsers(users);

  errBox.style.display='none';
  const successBox=document.createElement('div');
  // Switch to login
  showAuth('login');
  document.getElementById('loginSuccessBox').textContent='Account created! Please sign in.';
  document.getElementById('loginSuccessBox').style.display='block';
  document.getElementById('loginEmail').value=email;
}

// ========== AUTH: LOGIN ==========
async function doLogin(){
  const email=document.getElementById('loginEmail').value.trim().toLowerCase();
  const pw=document.getElementById('loginPassword').value;
  const errBox=document.getElementById('loginErrorBox');
  const sucBox=document.getElementById('loginSuccessBox');

  if(!email||!pw){errBox.textContent='Please enter email and password.';errBox.style.display='block';sucBox.style.display='none';return}

  const user=findUserByEmail(email);
  if(!user){errBox.textContent='No account found with this email.';errBox.style.display='block';sucBox.style.display='none';return}

  const hash=await hashPassword(pw);
  if(hash!==user.hash){errBox.textContent='Incorrect password.';errBox.style.display='block';sucBox.style.display='none';return}

  // Login success
  currentUser=user;
  sessionToken='sess_'+Date.now().toString(36);
  localStorage.setItem('nyak_session',JSON.stringify({userId:user.id,token:sessionToken,ts:Date.now()}));

  errBox.style.display='none';sucBox.style.display='none';
  enterApp();
}

function tryRestoreSession(){
  try{
    const sess=JSON.parse(localStorage.getItem('nyak_session'));
    if(!sess)return false;
    // Session valid for 24 hours
    if(Date.now()-sess.ts>86400000)return false;
    const user=findUserById(sess.userId);
    if(!user)return false;
    currentUser=user;
    sessionToken=sess.token;
    return true;
  }catch(e){return false}
}

function doLogout(){
  // Save current state before logout
  if(currentUser)saveUserState();
  currentUser=null;sessionToken=null;
  localStorage.removeItem('nyak_session');
  document.getElementById('appContainer').classList.remove('active');
  showAuth('login');
  document.getElementById('loginSuccessBox').textContent='You have been signed out.';
  document.getElementById('loginSuccessBox').style.display='block';
}

function togglePw(id,btn){
  const inp=document.getElementById(id);
  if(inp.type==='password'){inp.type='text';btn.textContent='🙈'}
  else{inp.type='password';btn.textContent='👁'}
}

// ========== ROLE HELPERS (multi-tenant) ==========
function isSchoolAdmin(){return currentUser&&currentUser.schoolRole==='admin'}
function isClassTeacher(){return currentUser&&currentUser.schoolRole==='class_teacher'}
function allowedGrades(){
  if(isClassTeacher()&&currentUser.assignedGrade) return [Number(currentUser.assignedGrade)];
  return [1,2,3,4,5,6,7,8,9];
}
function canEditGrade(g){
  if(isSchoolAdmin()) return true;
  if(isClassTeacher()) return Number(g)===Number(currentUser.assignedGrade);
  return true; // fallback (legacy single-teacher)
}

// ========== LOGOS & WATERMARK (multi-tenant downloads) ==========
// These data-URL images are populated by the backend layer from the school's
// shared dataset: the school logo (centred header on every download) and the
// zone logo (a faint watermark across every download for every school).
window.__afSchoolLogo = window.__afSchoolLogo || null;
window.__afZoneLogo   = window.__afZoneLogo   || null;
function getSchoolLogo(){ return window.__afSchoolLogo || null; }
function getZoneLogo(){ return window.__afZoneLogo || null; }

// Centred logo + school name header used at the top of every PDF download.
function buildDownloadHeaderHTML(subtitle){
  const logo=getSchoolLogo();
  const school=(currentUser&&(currentUser.schoolName||currentUser.school))||'School';
  let h='<div style="text-align:center;padding:6px 0 10px;border-bottom:2px solid #5B18C4;margin-bottom:12px">';
  if(logo){ h+=`<img src="${logo}" alt="School logo" style="height:66px;width:auto;object-fit:contain;display:block;margin:0 auto 6px">`; }
  h+=`<div style="font-size:18px;font-weight:800;color:#5B18C4;letter-spacing:.3px">${esc(school)}</div>`;
  if(subtitle){ h+=`<div style="font-size:12px;color:#555;margin-top:2px">${esc(subtitle)}</div>`; }
  h+='</div>';
  return h;
}

// Faint centred zone watermark overlay (≈8% opacity) for a PDF page wrapper.
function buildWatermarkHTML(){
  const wm=getZoneLogo();
  if(!wm) return '';
  return `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:0">`+
         `<img src="${wm}" alt="" style="width:70%;max-width:520px;opacity:0.08;object-fit:contain">`+
         `</div>`;
}

// Orpa brand stamp (two-arrow icon + logo) placed in the corner of every PDF
// download so printed sheets are clearly identifiable as Orpa documents.
function buildStampHTML(){
  return `<div style="position:absolute;top:8px;right:10px;display:flex;align-items:center;gap:6px;z-index:2;opacity:.95">`+
         `<img src="orpa-stamp.png" alt="" style="height:30px;width:30px;object-fit:contain">`+
         `<img src="orpa-logo.png" alt="Orpa" style="height:22px;width:auto;object-fit:contain">`+
         `</div>`;
}

// Wrap an element's HTML into a printable page that carries the school-logo
// header and the faint zone watermark, then hand it to html2pdf.
function exportElementToPDF(sourceEl,filename,subtitle,orientation){
  const wrap=document.createElement('div');
  wrap.style.cssText='position:relative;background:#fff;padding:14px 16px;font-family:inherit;';
  wrap.innerHTML=buildWatermarkHTML()+buildStampHTML();
  const content=document.createElement('div');
  content.style.cssText='position:relative;z-index:1';
  content.innerHTML=buildDownloadHeaderHTML(subtitle)+sourceEl.outerHTML;
  wrap.appendChild(content);
  // Render off-screen so it doesn't flash on the page.
  const holder=document.createElement('div');
  holder.style.cssText='position:fixed;left:-99999px;top:0;width:1000px;';
  holder.appendChild(wrap);
  document.body.appendChild(holder);
  return html2pdf().set({
    margin:[8,8,8,8],
    filename:filename,
    image:{type:'jpeg',quality:0.95},
    html2canvas:{scale:2,useCORS:true},
    jsPDF:{unit:'mm',format:'a4',orientation:orientation||'portrait'}
  }).from(wrap).save()
   .then(()=>{document.body.removeChild(holder);toast('✅ PDF downloaded!');})
   .catch(()=>{try{document.body.removeChild(holder);}catch(e){}toast('❌ PDF export failed');});
}

// ---- Backend-provided stubs (overridden by auth-backend.js when present) ----
// They are defined here so app.js works stand-alone and the sidebar buttons
// never call an undefined function.
if(typeof window.submitToOwner!=='function'){
  window.submitToOwner=function(){ toast('ℹ️ Submitting is available once connected to the server.'); };
}
if(typeof window.onSchoolLogoPicked!=='function'){
  window.onSchoolLogoPicked=function(){ toast('ℹ️ Logo upload needs the server connection.'); };
}
if(typeof window.refreshLogoPreview!=='function'){
  window.refreshLogoPreview=function(){
    const box=document.getElementById('logoPreview');if(!box)return;
    const logo=getSchoolLogo();
    box.innerHTML=logo?`<img src="${logo}" alt="School logo" style="max-height:54px;max-width:100%;object-fit:contain">`:'<span style="font-size:11px;color:#888">No logo yet</span>';
  };
}
// Motto / archive / search are wired to the server by auth-backend.js. These
// stand-alone fallbacks keep the buttons safe when the backend is absent.
if(typeof window.saveMotto!=='function'){
  window.saveMotto=function(){ const t=document.getElementById('mottoInput'); if(t){state.motto=t.value.slice(0,200);saveUserState();toast('💾 Motto saved locally');} };
  window.saveSchoolContact=function(){ const t=document.getElementById('schoolContactInput'); if(t){state.schoolContact=t.value.slice(0,200);saveUserState();toast('💾 School address & email saved locally');} };
}
if(typeof window.pushArchive!=='function'){
  window.pushArchive=function(){ toast('ℹ️ Archiving needs the server connection.'); };
}
if(typeof window.runSearch!=='function'){
  window.runSearch=function(){ toast('ℹ️ Search needs the server connection.'); };
}
// Render archive-search results into a dismissible modal overlay.
function showSearchResults(results,q){
  let el=document.getElementById('searchModal');
  if(!el){el=document.createElement('div');el.id='searchModal';el.className='search-overlay';document.body.appendChild(el);}
  let h=`<div class="search-modal"><div class="search-head"><b>Archive results</b>`+
        `<span style="color:#888;font-weight:400"> — ${results.length} found${q?(' for “'+esc(q)+'”'):''}</span>`+
        `<button onclick="closeSearch()" class="search-x">✕</button></div>`;
  if(!results.length){
    h+=`<div style="padding:16px;color:#999">No matching records in the archive. Results appear here once a school admin has PUSHed past exams.</div>`;
  }else{
    h+=`<div class="search-body"><table class="search-tbl"><tr><th>Year</th><th>Term</th><th>Exam</th><th>Grade</th><th>Assess No</th><th>Name</th><th>Avg %</th></tr>`;
    results.forEach(r=>{
      const avg=avgPctFromRaws(r.raws,r.outOf);
      h+=`<tr><td>${esc(String(r.year||''))}</td><td>${esc(String(r.term||''))}</td><td>${esc(r.exam||'')}</td><td>${r.grade}</td><td>${esc(r.adm||'')}</td><td style="text-align:left">${esc(r.name||'')}</td><td class="bold">${avg!==null?avg+'%':'-'}</td></tr>`;
    });
    h+=`</table></div>`;
  }
  h+=`</div>`;
  el.innerHTML=h;el.style.display='flex';
}
function closeSearch(){const el=document.getElementById('searchModal');if(el)el.style.display='none';}

// ========== ENTER APP ==========
function enterApp(){
  document.getElementById('authRegister').style.display='none';
  document.getElementById('authLogin').style.display='none';
  const asg=document.getElementById('awaitingScreen');if(asg)asg.style.display='none';
  document.getElementById('appContainer').classList.add('active');

  // Set user info in UI
  document.getElementById('ddName').textContent=currentUser.name;
  document.getElementById('ddEmail').textContent=currentUser.email;
  document.getElementById('userBtnLabel').textContent='👤 '+currentUser.name.split(' ')[0];
  const schoolDisplay=currentUser.schoolName||currentUser.school||'';
  const _sn=document.getElementById('schoolNameTop');
  if(_sn){_sn.value=schoolDisplay; _sn.readOnly=true; _sn.title='School (assigned by the administrator)';}
  // Role badge next to school name
  const _rl=document.getElementById('roleBadge');
  if(_rl){
    if(isSchoolAdmin())_rl.textContent='School Admin';
    else if(isClassTeacher())_rl.textContent='Class Teacher \u2014 Grade '+currentUser.assignedGrade;
    else _rl.textContent='';
    _rl.style.display=_rl.textContent?'inline-block':'none';
  }

  // A class teacher starts on their own grade.
  const ag=allowedGrades();
  if(isClassTeacher()&&currentUser.assignedGrade) currentGrade=Number(currentUser.assignedGrade);
  else if(!ag.includes(currentGrade)) currentGrade=ag[0];

  loadUserState();
  buildSidebar();
  renderEntry();
}

// ========== SIDEBAR ==========
function buildSidebar(){
  const sb=document.getElementById('sidebar');
  const ag=allowedGrades();
  const grp=(label,list)=>{
    const vis=list.filter(g=>ag.includes(g));
    if(!vis.length) return '';
    let s=`<div class="side-label">${label}</div>`;
    vis.forEach(g=>{s+=`<button class="grade-btn${g===currentGrade?' active':''}" onclick="switchGrade(${g})">Grade ${g}</button>`});
    return s;
  };
  let h='';
  h+=grp('Lower Primary',[1,2,3]);
  const up=grp('Upper Primary',[4,5,6]); if(up)h+=(h?'<div class="sep"></div>':'')+up;
  const js=grp('Junior School',[7,8,9]); if(js)h+=(h?'<div class="sep"></div>':'')+js;

  // Zonal bundle export (all grades 1-9) — school admins only.
  if(isSchoolAdmin()){
    h+='<div class="sep"></div>';
    h+=`<button class="grade-btn bundle-btn" onclick="exportZonalBundle()" title="Export Grades 1-9 score sheets as one Excel workbook for the zonal office" style="background:#C2185B;color:#fff;font-weight:800;border:none">\uD83D\uDCE6 Zonal Bundle</button>`;
  }

  // Submit-to-owner button (marks this school's results as submitted).
  h+='<div class="sep"></div>';
  h+=`<button class="grade-btn submit-btn" id="submitBtn" onclick="submitToOwner()" title="Send this school's completed results to the zonal administrator">\uD83D\uDCE4 Submit to Zone</button>`;

  // School logo upload — school admins only.
  if(isSchoolAdmin()){
    h+=`<div class="logo-box"><div class="ps-label">School Logo</div>`+
       `<div id="logoPreview" class="logo-preview"></div>`+
       `<button class="grade-btn logo-btn" onclick="document.getElementById('schoolLogoInput').click()">\uD83C\uDFEB Upload Logo</button>`+
       `<input type="file" id="schoolLogoInput" accept="image/png,image/jpeg" style="display:none" onchange="onSchoolLogoPicked(this)"></div>`;
  }

  // School admin tools: motto + PUSH results to the searchable archive.
  if(isSchoolAdmin()){
    h+=`<div class="side-tool"><div class="ps-label">School Motto</div>`+
       `<textarea id="mottoInput" rows="2" placeholder="e.g. Strive for Excellence" style="width:100%;box-sizing:border-box;font-size:11px;padding:5px;border:1px solid #d8cbef;border-radius:6px;resize:vertical">${esc(state.motto||'')}</textarea>`+
       `<button class="grade-btn" onclick="saveMotto()" style="margin-top:5px;background:#5B18C4;color:#fff;border:none;font-weight:700">💾 Save Motto</button></div>`;
    h+=`<div class="side-tool"><div class="ps-label">School Address & Email</div>`+
       `<textarea id="schoolContactInput" rows="3" placeholder="e.g. P.O. Box 123-00100, Nairobi&#10;info@myschool.ac.ke" style="width:100%;box-sizing:border-box;font-size:11px;padding:5px;border:1px solid #d8cbef;border-radius:6px;resize:vertical">${esc(state.schoolContact||'')}</textarea>`+
       `<button class="grade-btn" onclick="saveSchoolContact()" style="margin-top:5px;background:#5B18C4;color:#fff;border:none;font-weight:700">💾 Save Address & Email</button></div>`;
    h+=`<button class="grade-btn" onclick="pushArchive()" title="Save the current results into the searchable 3-year archive" style="background:#00796B;color:#fff;font-weight:800;border:none">📌 PUSH to Archive</button>`;
  }

  // Search the archive — admins search the whole school, class teachers their grade.
  h+=`<div class="side-tool"><div class="ps-label">Search Archive</div>`+
     `<input id="searchQ" placeholder="Name or Assess No" style="width:100%;box-sizing:border-box;font-size:11px;padding:5px;border:1px solid #d8cbef;border-radius:6px">`+
     `<button class="grade-btn" onclick="runSearch()" style="margin-top:5px;background:#3949AB;color:#fff;border:none;font-weight:700">🔎 Search</button></div>`;

  // Payment status per grade
  h+='<div class="pay-status"><div class="ps-label">Report Access</div>';
  if(isGradePaid(currentGrade)){h+=`<span class="ps-badge paid">✅ Paid — Unlocked</span>`}
  else{h+=`<span class="ps-badge locked">🔒 KSh 100 to unlock</span>`}
  h+='</div>';

  sb.innerHTML=h;
  if(isSchoolAdmin()) refreshLogoPreview();
}

function switchGrade(g){
  saveUserState();
  currentGrade=g;
  buildSidebar();
  renderEntry();
  // Switch to entry tab
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.tab-btn[data-view="entry"]').classList.add('active');
  showViewByName('entry');
}

// ========== ENTRY TABLE ==========
function renderEntry(){
  const cfg=GRADE_CFG.find(c=>c.g===currentGrade);
  const gd=state.grades[currentGrade];
  const nSubj=cfg.subjects.length;
  const computedAll=computeAll();

  let h='<table class="entry-table" id="entryTbl"><thead>';
  // Row: Subject names + Out Of
  h+='<tr class="r3"><th class="frozen fro-no">NO</th><th class="frozen fro-adm">ASSESS NO</th><th class="frozen fro-name">LEARNER NAME</th>';
  cfg.subjects.forEach((s,si)=>{
    h+=`<th colspan="4" class="col-group" style="border-left:3px solid var(--g1)">${s.n} <input type="number" min="1" max="100" value="${gd.outOf[si]}" onchange="updateOutOf(${si},this.value)" title="Max marks (1-100)"> /</th>`;
  });
  h+=`<th colspan="4" class="col-group" style="border-left:3px solid var(--blue)">SUMMARY</th>`;
  h+='</tr>';
  // Row: Sub-headers
  h+='<tr class="r4"><th class="frozen fro-no"></th><th class="frozen fro-adm"></th><th class="frozen fro-name"></th>';
  cfg.subjects.forEach((s,si)=>{
    const b=si===0?'border-left:3px solid var(--g1)':'';
    h+=`<th style="${b}">RAW</th><th>%</th><th>P/L</th><th>KNEC</th>`;
  });
  h+=`<th style="border-left:3px solid var(--blue)">AVG %</th><th>Grade</th><th>Pts</th><th>Mean Gr</th>`;
  h+='</tr></thead><tbody>';

  // Data rows
  gd.learners.forEach((lr,i)=>{
    const comp=computedAll[i];
    h+=`<tr data-lr="${i}">`;
    h+=`<td class="frozen fro-no">${lr.name?(i+1):''}</td>`;
    h+=`<td class="frozen fro-adm"><input value="${esc(lr.adm)}" onchange="updAdm(${i},this.value)" onpaste="pasteCol(event,${i},'adm')" placeholder="ASSESS NO" title="Assessment number — paste a whole column here" style="width:55px;border:none;background:transparent;font-size:10px"></td>`;
    h+=`<td class="frozen fro-name"><input value="${esc(lr.name)}" onchange="updName(${i},this.value)" onpaste="pasteCol(event,${i},'name')" placeholder="Learner Name" title="Paste a whole column of names here" style="width:100%;border:none;background:transparent;font-size:10px;font-weight:600"></td>`;

    cfg.subjects.forEach((s,si)=>{
      const raw=lr.raws[si];
      const pct=comp.pcts[si];
      const pl=comp.pls[si];
      const knec=comp.knecs[si];
      const b=si===0?'subj-first':'';
      const isAbs=raw==='ABS';
      const isOver=raw!==null&&raw!=='ABS'&&parseFloat(raw)>gd.outOf[si];
      h+=`<td class="raw-input ${b}"><input data-lr="${i}" data-sb="${si}" value="${isAbs?'ABS':raw!==null?raw:''}" oninput="updRaw(${i},${si},this)" onblur="finishRaw(${i},${si},this)" ondblclick="this.select()" onkeydown="navKey(event,${i},${si},this)" type="text" inputmode="numeric" placeholder="–" class="${isOver?'over-warning':''}"></td>`;
      h+=`<td class="calc pct ${b}">${pct!==null?pct+'%':''}</td>`;
      const plCls=pl?`pl-${pl}`:'';
      h+=`<td class="calc ${plCls} ${b}" style="font-size:13px;font-weight:800">${pl||''}</td>`;
      const knCls=knec?`knec-${knec}`:'';
      h+=`<td class="calc ${knCls} ${b}">${knec||''}</td>`;
    });

    h+=`<td class="calc summ summ-avg summ-group">${comp.avgPct!==null?comp.avgPct+'%':''}</td>`;
    h+=`<td class="calc summ">${comp.avgGrade||''}</td>`;
    h+=`<td class="calc summ">${comp.totalPts!==null?comp.totalPts:''}</td>`;
    h+=`<td class="calc summ summ-pos">${comp.meanGrade||''}</td>`;
    h+='</tr>';
  });

  // MSS Row
  const mss=computeMSS(computedAll);
  h+='<tr class="mss-row"><td class="frozen fro-no"></td><td class="frozen fro-adm"></td><td class="frozen fro-name">Mean Subject Score</td>';
  cfg.subjects.forEach((s,si)=>{
    const b=si===0?'subj-first':'';
    h+=`<td class="${b}">${mss.rawAvgs[si]!==null?mss.rawAvgs[si]:''}</td>`;
    h+=`<td class="${b}">${mss.pctAvgs[si]!==null?mss.pctAvgs[si]+'%':''}</td>`;
    h+=`<td class="${b}">${mss.plModes[si]||''}</td>`;
    h+=`<td class="${b}">${mss.knecAvgs[si]||''}</td>`;
  });
  h+=`<td class="summ-group">${mss.overallAvg!==null?mss.overallAvg+'%':''}</td><td>${mss.overallGrade||''}</td><td>${mss.overallPts||''}</td><td>${mss.overallMean||''}</td>`;
  h+='</tr></tbody></table>';
  document.getElementById('sheetWrap').innerHTML=h;
}

function esc(s){return s?String(s).replace(/"/g,'&quot;'):''}

// ========== COMPUTATION ==========
function computeAll(){
  const cfg=GRADE_CFG.find(c=>c.g===currentGrade);
  const gd=state.grades[currentGrade];
  return gd.learners.map(lr=>{
    const pcts=[],pls=[],knecs=[];
    let validPcts=0,sumPcts=0,sumPts=0,validPts=0;
    cfg.subjects.forEach((s,si)=>{
      const raw=lr.raws[si];
      if(raw===null||raw===''||raw==='ABS'){pcts.push(null);pls.push(null);knecs.push(null);return}
      const r=parseFloat(raw);
      if(isNaN(r)||r<0){pcts.push(null);pls.push(null);knecs.push(null);return}
      const o=gd.outOf[si];
      const pct=o>0?Math.round(r/o*1000)/10:0;
      pcts.push(pct);
      const pl=pct>=0?plLevel(pct):null;
      pls.push(pl?pl.level:null);
      const kg=pct>=0?knecGrade(pct):null;
      knecs.push(kg?kg.g:null);
      if(kg){sumPts+=kg.pts;validPts++}
      validPcts++;sumPcts+=pct;
    });
    const avgPct=validPcts>0?Math.round(sumPcts/validPcts*10)/10:null;
    const avgGrade=avgPct!==null?knecGrade(avgPct).g:null;
    const totalPts=validPts>0?sumPts:null;
    const meanGrade=avgPct!==null?knecGrade(avgPct).g:null;
    const avgPL=avgPct!==null?plLevel(avgPct).level:null;return{pcts,pls,knecs,avgPct,avgGrade,avgPL,totalPts,meanGrade};
  });
}

function computeMSS(computedAll){
  const cfg=GRADE_CFG.find(c=>c.g===currentGrade);
  const gd=state.grades[currentGrade];
  const rawAvgs=[],pctAvgs=[],plModes=[],knecAvgs=[];
  cfg.subjects.forEach((s,si)=>{
    let rawSum=0,rawN=0,pctSum=0,pctN=0;
    const plCounts={1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0};
    let knecPtsSum=0,knecPtsN=0;
    gd.learners.forEach((lr,li)=>{
      const raw=lr.raws[si];
      if(raw!==null&&raw!==''&&raw!=='ABS'){const r=parseFloat(raw);if(!isNaN(r)&&r>=0){rawSum+=r;rawN++}}
      const pct=computedAll[li].pcts[si];
      if(pct!==null){pctSum+=pct;pctN++}
      const pl=computedAll[li].pls[si];if(pl)plCounts[pl]=(plCounts[pl]||0)+1;
      const kg=computedAll[li].knecs[si];if(kg){const k=KNEC_GRADES.find(kk=>kk.g===kg);if(k){knecPtsSum+=k.pts;knecPtsN++}}
    });
    rawAvgs.push(rawN>0?Math.round(rawSum/rawN*10)/10:null);
    pctAvgs.push(pctN>0?Math.round(pctSum/pctN*10)/10:null);
    let modePL=null,maxC=0;for(const[lvl,cnt]of Object.entries(plCounts)){if(cnt>maxC){maxC=cnt;modePL=lvl}}
    plModes.push(modePL||null);
    knecAvgs.push(knecPtsN>0?knecGrade(Math.round(knecPtsSum/knecPtsN*10)/10).g:null);
  });
  let allPcts=[];computedAll.forEach(c=>{if(c.avgPct!==null)allPcts.push(c.avgPct)});
  const overallAvg=allPcts.length>0?Math.round(allPcts.reduce((a,b)=>a+b,0)/allPcts.length*10)/10:null;
  const overallGrade=overallAvg?knecGrade(overallAvg).g:null;
  let allPts=[];computedAll.forEach(c=>{if(c.totalPts!==null)allPts.push(c.totalPts)});
  const overallPts=allPts.length>0?allPts.reduce((a,b)=>a+b,0):null;
  const overallMean=overallAvg?knecGrade(overallAvg).g:null;
  return{rawAvgs,pctAvgs,plModes,knecAvgs,overallAvg,overallGrade,overallPts,overallMean};
}

function computePositions(computedAll){
  const gd=state.grades[currentGrade];
  const sorted=gd.learners.map((lr,i)=>({i,avg:computedAll[i].avgPct,name:lr.name,adm:lr.adm}))
    .filter(x=>x.name&&x.avg!==null)
    .sort((a,b)=>b.avg-a.avg);
  // Assign positions iteratively so ties correctly share the previous position.
  // (The old one-liner read arr[idx-1].pos before it existed, giving "undefined".)
  const ranked=[];
  sorted.forEach((x,idx)=>{
    let pos;
    if(idx>0 && ranked[idx-1].avg===x.avg){ pos=ranked[idx-1].pos; }
    else { pos=idx+1; }
    ranked.push(Object.assign({},x,{pos}));
  });
  return ranked;
}

// ========== INPUT HANDLERS ==========
function updName(i,v){state.grades[currentGrade].learners[i].name=v.trim();debounceSave();renderEntry()}
function updAdm(i,v){state.grades[currentGrade].learners[i].adm=v.trim();debounceSave()}
// Paste a whole column of names or assessment numbers starting at row `start`.
// Accepts newline- or tab-separated clipboard text (e.g. copied from Excel).
function pasteCol(e,start,field){
  const cd=e.clipboardData||window.clipboardData;if(!cd)return;
  const txt=cd.getData('text');if(!txt)return;
  const parts=txt.replace(/\r/g,'').split('\n').map(s=>s.replace(/\t.*$/,'').trim());
  // Single value with no line breaks: let the browser handle a normal paste.
  if(parts.length<=1)return;
  e.preventDefault();
  const gd=state.grades[currentGrade];
  let r=start;
  parts.forEach(val=>{
    if(r>=gd.learners.length)return;
    if(val!=='') gd.learners[r][field]=val;
    r++;
  });
  saveUserState();renderEntry();toast('📋 Pasted '+parts.filter(p=>p!=='').length+' rows');
}
function updRaw(i,si,el){
  // Saves data only — NO re-render so user can keep typing multi-digit numbers
  const gd=state.grades[currentGrade];
  let v=el.value.trim();
  if(v===''){gd.learners[i].raws[si]=null;debounceSave();return}
  if(v.toUpperCase()==='ABS'||v.toUpperCase()==='A'){gd.learners[i].raws[si]='ABS';debounceSave();return}
  let num=parseFloat(v);
  if(isNaN(num)){gd.learners[i].raws[si]=null}
  else{
    if(num<0)num=0;
    if(num>100){num=100;el.value='100'} // cap at 100
    gd.learners[i].raws[si]=num;
  }
  debounceSave();
}

function finishRaw(i,si,el){
  // Called on blur — saves, re-renders, then focuses pending cell (e.g. after Tab)
  updRaw(i,si,el);
  renderEntry();
  if(window._pendingFocus){
    const pf=window._pendingFocus;
    window._pendingFocus=null;
    setTimeout(()=>focusCell(pf.i,pf.si),0);
  }
}
function updateOutOf(si,v){
  const gd=state.grades[currentGrade];
  let n=parseInt(v);if(isNaN(n)||n<1)n=1;if(n>100)n=100;
  gd.outOf[si]=n;debounceSave();renderEntry();
}

// ========== KEYBOARD NAVIGATION ==========
function navKey(e,i,si,el){
  const cfg=GRADE_CFG.find(c=>c.g===currentGrade);
  const nSubj=cfg.subjects.length;
  if(e.key==='Tab'||e.key==='Enter'){
    e.preventDefault();
    const back=e.shiftKey;
    let ni=i,nsi=si;
    if(back){if(si>0)nsi=si-1;else if(i>0){ni=i-1;nsi=nSubj-1}}
    else{if(si<nSubj-1)nsi=si+1;else if(i<MAX_LEARNERS-1){ni=i+1;nsi=0}}
    window._pendingFocus={i:ni,si:nsi};
    el.blur(); // triggers onblur → finishRaw → renderEntry → auto-focus pending cell
    return;
  }
  if(e.key==='ArrowDown'){e.preventDefault();window._pendingFocus={i:i+1,si};el.blur();return}
  if(e.key==='ArrowUp'){e.preventDefault();window._pendingFocus={i:i-1,si};el.blur();return}
  // Plain Left/Right arrows move between subject columns Excel-style, but only
  // when the text caret is already at the edge of the cell (so arrows can still
  // move within a typed number). Ctrl+Arrow always jumps regardless of caret.
  if(e.key==='ArrowRight'){
    const atEnd=(el.selectionStart===el.value.length && el.selectionStart===el.selectionEnd);
    if(e.ctrlKey||atEnd){e.preventDefault();window._pendingFocus={i,si:si+1};el.blur();return}
  }
  if(e.key==='ArrowLeft'){
    const atStart=(el.selectionStart===0 && el.selectionStart===el.selectionEnd);
    if(e.ctrlKey||atStart){e.preventDefault();window._pendingFocus={i,si:si-1};el.blur();return}
  }
}
function focusCell(i,si){
  const el=document.querySelector(`input[data-lr="${i}"][data-sb="${si}"]`);
  if(el)el.focus();
}

// ========== VIEW SWITCHING ==========
function showView(v,btn){
  saveUserState();
  const panels=['viewEntry','viewScoresheet','viewReports','viewKPI','viewProfile','viewPayments'];
  panels.forEach(p=>document.getElementById(p).style.display='none');
  if(btn)document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');

  const map={entry:'viewEntry',scoresheet:'viewScoresheet',reports:'viewReports',kpi:'viewKPI',profile:'viewProfile',payments:'viewPayments'};
  document.getElementById(map[v]).style.display='block';

  if(v==='scoresheet')renderScoresheet();
  if(v==='reports')renderReports();
  if(v==='kpi')renderKPI();
  if(v==='profile')renderProfile();
  if(v==='payments')renderPaymentHistory();
  closeUserDD();
}
function showViewByName(v){
  const map={entry:'viewEntry',scoresheet:'viewScoresheet',reports:'viewReports',kpi:'viewKPI',profile:'viewProfile',payments:'viewPayments'};
  ['viewEntry','viewScoresheet','viewReports','viewKPI','viewProfile','viewPayments'].forEach(p=>document.getElementById(p).style.display='none');
  document.getElementById(map[v]).style.display='block';
}

// ========== SCORE-SHEET VIEW (MERIT LIST) ==========
function renderScoresheet(){
  const cfg=GRADE_CFG.find(c=>c.g===currentGrade);
  const gd=state.grades[currentGrade];
  const computed=computeAll();
  const positions=computePositions(computed);
  const paid=isGradePaid(currentGrade);

  let h=`<div class="scorecard ${paid?'':'lock-overlay'}">`;
  h+=`<h2 style="text-align:center;font-size:16px">${esc(currentUser.school||'My School')}</h2>`;
  h+=`<div style="text-align:center;font-size:11px;color:var(--gray);margin-bottom:8px">Grade ${currentGrade} — Merit / Class List &nbsp;|&nbsp; ${state.examName||'[Exam]'} &nbsp;|&nbsp; Term ${state.examTerm||'__'} &nbsp;|&nbsp; ${state.examYear||'____'}</div>`;
  if(paid)h+=`<button onclick="exportScoresheetExcel()" style="float:right;background:var(--g1);color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-bottom:6px">📥 Export Excel</button><div style="clear:both"></div>`;
  h+=`<table><tr><th>Pos</th><th>Assess No</th><th style="text-align:left">Learner</th>`;
  cfg.subjects.forEach(s=>h+=`<th>${s.n}<br><small>P/L (1-8)</small></th>`);
  h+=`<th>AVG P/L</th><th>AVG %</th><th>Grade</th><th>Pts</th></tr>`;

  positions.forEach(x=>{
    const lr=gd.learners[x.i];
    h+=`<tr><td class="bold">${x.pos}</td><td>${esc(lr.adm)}</td><td style="text-align:left;font-weight:600">${esc(lr.name)}</td>`;
    cfg.subjects.forEach((s,si)=>{
      const raw=lr.raws[si];const pl=computed[x.i].pls[si];
      if(raw==='ABS'){h+=`<td style="color:#999;font-size:10px">ABS</td>`;}
      else if(pl){h+=`<td class="pl-${pl}" style="font-weight:800;font-size:16px">${pl}<br><small style="color:#aaa;font-weight:400;font-size:9px">${raw}</small></td>`;}
      else{h+=`<td></td>`;}
    });
    h+=`<td class="pl-${computed[x.i].avgPL}" style="font-weight:800;font-size:16px">${computed[x.i].avgPL||'-'}</td><td class="bold">${x.avg||''}</td><td class="bold">${computed[x.i].avgGrade||''}</td><td>${computed[x.i].totalPts||''}</td></tr>`;
  });
  // Footer: class average per subject (%) and overall total/average.
  const mss=computeMSS(computed);
  h+=`<tr class="totals-row"><td colspan="3" style="text-align:right;font-weight:800">CLASS AVERAGE →</td>`;
  cfg.subjects.forEach((s,si)=>{
    h+=`<td style="font-weight:800">${mss.pctAvgs[si]!==null?plLevel(mss.pctAvgs[si]).level:''}</td>`;
  });
  h+=`<td class="bold">${mss.overallAvg!==null?plLevel(mss.overallAvg).level:''}</td><td class="bold">${mss.overallAvg!==null?mss.overallAvg+'%':''}</td><td class="bold">${mss.overallGrade||''}</td><td>${mss.overallPts||''}</td></tr>`;
  h+='</table>';
  if(!paid){
    h+=`<div class="lock-bg"><div class="lock-icon">🔒</div><div class="lock-msg">Merit list is locked.<br>Pay KSh 100 via M-Pesa to unlock.</div><button class="lock-btn" onclick="openMpesa()">Pay with M-Pesa</button></div>`;
  }
  h+='</div>';
  document.getElementById('viewScoresheet').innerHTML=h;
}

// ========== REPORT CARDS VIEW ==========
function renderReports(){
  const cfg=GRADE_CFG.find(c=>c.g===currentGrade);
  const gd=state.grades[currentGrade];
  const computed=computeAll();
  const positions=computePositions(computed);
  const posMap={};positions.forEach(x=>posMap[x.i]=x.pos);
  const paid=isGradePaid(currentGrade);

  let h='';
  let count=0;
  gd.learners.forEach((lr,i)=>{
    if(!lr.name)return;
    count++;
    const comp=computed[i];
    const pos=posMap[i]||'-';
    const locked=!paid;
    h+=`<div class="report-card ${locked?'lock-overlay':''}">
      <div class="school-name">${esc(currentUser.school||'My School')}</div>
      ${state.schoolContact&&state.schoolContact.trim()?`<div class="rpt-contact">${state.schoolContact.trim().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>')}</div>`:''}
      <div class="subtitle">Grade ${currentGrade} Individual Report Card &nbsp;|&nbsp; ${state.examName||'[Exam]'} &nbsp;|&nbsp; Term ${state.examTerm||'__'} &nbsp;|&nbsp; ${state.examYear||'____'}</div>
      <div class="learner-info">
        <div><span class="lbl">Name:</span> ${esc(lr.name)}</div>
        <div><span class="lbl">Assess No:</span> ${esc(lr.adm)}</div>
        <div><span class="lbl">Position:</span> ${pos} out of ${positions.filter(x=>x.name).length}</div>
        <div><span class="lbl">Mean Grade:</span> ${comp.meanGrade||'-'}</div>
      </div>
      <table class="rpt">
        <tr><th>Subject</th><th>Raw</th><th>Out Of</th><th>%</th><th>P/L</th><th>CBE Level</th><th>KNEC</th><th>Pts</th><th>Remarks</th></tr>`;
    cfg.subjects.forEach((s,si)=>{
      const raw=lr.raws[si];const pct=comp.pcts[si];const pl=comp.pls[si];const knec=comp.knecs[si];
      const kObj=knec?KNEC_GRADES.find(k=>k.g===knec):null;const pts=kObj?kObj.pts:'';
      const remark=generateRemark(pct,pl);
      const band=pct!==null?plLevel(pct).band:'';
      h+=`<tr><td class="subj-name">${s.n}</td><td>${raw==='ABS'?'ABS':raw!==null?raw:''}</td><td>${gd.outOf[si]}</td><td>${pct!==null?pct:''}</td><td>${pl||''}</td><td style="font-weight:700">${band}</td><td>${knec||''}</td><td>${pts}</td><td style="text-align:left;font-size:9px">${remark}</td></tr>`;
    });
    const avgBand=comp.avgPct!==null?plLevel(comp.avgPct).band:'';
    h+=`<tr class="totals-row"><td style="text-align:left">TOTALS / AVERAGES</td><td></td><td></td><td>${comp.avgPct||''}</td><td style="font-weight:800">${comp.avgPL||''}</td><td style="font-weight:800">${avgBand}</td><td>${comp.meanGrade||''}</td><td>${comp.totalPts||''}</td><td></td></tr></table>`;
    h+=`<div class="legend">KNEC: A(84-100=12pts) A-(80-83=11) B+(75-79=10) B(70-74=9) B-(65-69=8) C+(60-64=7) C(55-59=6) C-(50-54=5) D+(45-49=4) D(40-44=3) D-(35-39=2) E(0-34=1)</div>`;
    h+=`<div class="legend">P/L (CBE Levels 1–8): 8=EE1 (90-100%) | 7=EE2 (75-89%) | 6=ME1 (58-74%) | 5=ME2 (41-57%) | 4=AE1 (31-40%) | 3=AE2 (21-30%) | 2=BE1 (11-20%) | 1=BE2 (1-10%)</div>`;
    h+=`<div class="sig-lines"><div>Class Teacher<br>________________</div><div>Head Teacher<br>________________</div><div>Parent/Guardian<br>________________</div></div>`;
    h+=buildTrendGraph(lr,comp);
    if(state.motto&&state.motto.trim()){h+=`<div class="rpt-motto">“${esc(state.motto.trim())}”</div>`;}
    if(!locked)h+=`<button onclick="downloadReportPDF(${i})" style="margin-top:10px;width:100%;padding:8px;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;background:var(--g1);color:#fff">📄 Download PDF</button>`;
    if(locked){
      h+=`<div class="lock-bg"><div class="lock-icon">🔒</div><div class="lock-msg">Report cards are locked.<br>Pay KSh 100 via M-Pesa to download.</div><button class="lock-btn" onclick="openMpesa()">Pay with M-Pesa</button></div>`;
    }
    h+='</div>';
  });
  if(!count)h='<p style="text-align:center;color:#999;margin-top:40px">No learners entered yet. Go to Entry tab to add names and marks.</p>';
  document.getElementById('viewReports').innerHTML=h;
}

function generateRemark(pct,pl){
  if(pct===null||pl===null)return'';
  if(pl>=8)return'Outstanding! Far exceeding expectations.';
  if(pl===7)return'Excellent performance! Keep it up.';
  if(pl===6)return'Good work. Aim higher.';
  if(pl===5)return'Steady progress. Push towards meeting expectations.';
  if(pl===4)return'Approaching target. More effort needed.';
  if(pl===3)return'Below target. Significant effort required.';
  if(pl===2)return'Significant improvement needed. Seek help.';
  if(pl===1)return'Urgent intervention required. Needs close support.';
  return'';
}

// Average % for a set of raw marks against their out-of maxima.
function avgPctFromRaws(raws,outOf){
  if(!Array.isArray(raws)||!Array.isArray(outOf))return null;
  let sum=0,n=0;
  raws.forEach((r,i)=>{
    if(r===null||r===undefined||r==='ABS')return;
    const max=outOf[i];if(!max)return;
    const num=parseFloat(r);if(isNaN(num))return;
    sum+=(num/max)*100;n++;
  });
  if(!n)return null;
  return Math.round(sum/n);
}

// A learner's total-average history across the last 3 archived years, plus the
// present exam. Matched by assessment number (preferred) or name. Rendered as a
// small inline SVG line graph placed after the signatures on the report card.
function buildTrendGraph(lr,comp){
  const key=(lr.adm||'').trim().toLowerCase();
  const nm=(lr.name||'').trim().toLowerCase();
  const pts=[];
  (state.archives||[]).forEach(ar=>{
    let found=null;
    Object.keys(ar.grades||{}).forEach(g=>{
      const gd=ar.grades[g]||{};
      (gd.learners||[]).forEach(l=>{
        const la=(l.adm||'').trim().toLowerCase();
        const ln=(l.name||'').trim().toLowerCase();
        const match=key?la===key:(nm&&ln===nm);
        if(match){const a=avgPctFromRaws(l.raws,gd.outOf);if(a!==null)found=a;}
      });
    });
    if(found!==null){
      pts.push({label:(ar.year||'')+(ar.term?(' T'+ar.term):''),val:found,
                sort:parseInt(ar.year,10)*10+(parseInt(ar.term,10)||0)});
    }
  });
  // Add the present exam as the latest point.
  if(comp&&comp.avgPct!==null&&comp.avgPct!==undefined){
    pts.push({label:(state.examYear||'Now')+(state.examTerm?(' T'+state.examTerm):''),
              val:comp.avgPct,sort:9e9});
  }
  pts.sort((a,b)=>a.sort-b.sort);
  if(pts.length<2){
    return `<div class="trend-box"><div class="trend-title">Performance Trend (last 3 years)</div>`+
           `<div style="font-size:9px;color:#999;padding:6px">Not enough archived history yet — the trend graph appears after results are pushed to the archive over time.</div></div>`;
  }
  const W=440,H=120,pad=26;
  const xs=(i)=>pad+(i*(W-2*pad)/(pts.length-1));
  const ys=(v)=>H-pad-((v/100)*(H-2*pad));
  let poly='',dots='',labels='';
  pts.forEach((p,i)=>{
    const x=xs(i),y=ys(p.val);
    poly+=(i?' ':'')+x.toFixed(1)+','+y.toFixed(1);
    dots+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#5B18C4"></circle>`+
          `<text x="${x.toFixed(1)}" y="${(y-6).toFixed(1)}" font-size="9" text-anchor="middle" fill="#333">${p.val}%</text>`;
    labels+=`<text x="${x.toFixed(1)}" y="${H-8}" font-size="8" text-anchor="middle" fill="#666">${esc(p.label)}</text>`;
  });
  const svg=`<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:460px">`+
    `<line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="#ccc"></line>`+
    `<line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H-pad}" stroke="#ccc"></line>`+
    `<polyline points="${poly}" fill="none" stroke="#5B18C4" stroke-width="2"></polyline>`+
    dots+labels+`</svg>`;
  return `<div class="trend-box"><div class="trend-title">Performance Trend (last 3 years)</div>${svg}</div>`;
}

// ========== KPI DASHBOARD ==========
function renderKPI(){
  const cfg=GRADE_CFG.find(c=>c.g===currentGrade);
  const gd=state.grades[currentGrade];
  const computed=computeAll();
  const positions=computePositions(computed);
  const paid=isGradePaid(currentGrade);
  const active=positions.filter(x=>x.name);
  const nLearners=active.length;

  let avgPcts=active.map(x=>x.avg).filter(v=>v!==null);
  const classAvg=avgPcts.length>0?Math.round(avgPcts.reduce((a,b)=>a+b,0)/avgPcts.length*10)/10:null;
  const classGrade=classAvg?knecGrade(classAvg).g:'-';
  const passRate=avgPcts.length>0?Math.round(avgPcts.filter(p=>p>=50).length/avgPcts.length*1000)/10:null;
  const qualityRate=avgPcts.length>0?Math.round(avgPcts.filter(p=>p>=60).length/avgPcts.length*1000)/10:null;
  const distinctionRate=avgPcts.length>0?Math.round(avgPcts.filter(p=>p>=80).length/avgPcts.length*1000)/10:null;
  const maxScore=avgPcts.length>0?Math.max(...avgPcts):null;
  const minScore=avgPcts.length>0?Math.min(...avgPcts):null;

  const subjStats=cfg.subjects.map((s,si)=>{
    let pcts=[];const plCounts={1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0};
    gd.learners.forEach((lr,li)=>{
      const raw=lr.raws[si];
      if(raw!==null&&raw!==''&&raw!=='ABS'){const r=parseFloat(raw);if(!isNaN(r)&&r>=0){const pct=gd.outOf[si]>0?Math.round(r/gd.outOf[si]*1000)/10:0;pcts.push(pct);plCounts[plLevel(pct).band]++}}
    });
    const avg=pcts.length>0?Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length*10)/10:null;
    const hi=pcts.length>0?Math.max(...pcts):null;const lo=pcts.length>0?Math.min(...pcts):null;
    return{n:s.n,avg,hi,lo,plCounts,nLearners:pcts.length,passRate:pcts.length>0?Math.round(pcts.filter(p=>p>=50).length/pcts.length*1000)/10:null};
  });

  let h=`<div style="max-width:880px;margin:0 auto">
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
    <div class="kpi-card"><div class="kpi-big">${nLearners}<small>Enrolled</small></div></div>
    <div class="kpi-card"><div class="kpi-big">${classAvg||'-'}<small>Class Mean %</small></div></div>
    <div class="kpi-card"><div class="kpi-big">${classGrade}<small>Mean Grade</small></div></div>
    <div class="kpi-card"><div class="kpi-big">${passRate!==null?passRate+'%':'-'}<small>Pass Rate (≥C-)</small></div></div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">
    <div class="kpi-card"><div class="kpi-big">${qualityRate!==null?qualityRate+'%':'-'}<small>Quality (≥C+)</small></div></div>
    <div class="kpi-card"><div class="kpi-big">${distinctionRate!==null?distinctionRate+'%':'-'}<small>Distinction (≥A-)</small></div></div>
    <div class="kpi-card"><div class="kpi-big">${maxScore||'-'} / ${minScore||'-'}<small>Highest / Lowest %</small></div></div>
  </div>`;

  h+=`<div class="scorecard"><h2>Subject-Level Performance</h2><table><tr><th>Subject</th><th>Out Of</th><th>Entries</th><th>Mean %</th><th>Highest</th><th>Lowest</th><th>Pass Rate</th><th>8</th><th>7</th><th>6</th><th>5</th><th>4</th><th>3</th><th>2</th><th>1</th></tr>`;
  subjStats.forEach(s=>{h+=`<tr><td style="text-align:left;font-weight:600;color:var(--g2)">${s.n}</td><td>${gd.outOf[cfg.subjects.findIndex(x=>x.n===s.n)]}</td><td>${s.nLearners}</td><td class="bold">${s.avg||''}</td><td>${s.hi||''}</td><td>${s.lo||''}</td><td>${s.passRate!==null?s.passRate+'%':''}</td><td style="color:#1B5E20;font-weight:800">${s.plCounts[8]||0}</td><td style="color:#2E7D32;font-weight:800">${s.plCounts[7]||0}</td><td style="color:var(--g2);font-weight:700">${s.plCounts[6]||0}</td><td style="color:var(--g2);font-weight:700">${s.plCounts[5]||0}</td><td style="color:var(--orange);font-weight:700">${s.plCounts[4]||0}</td><td style="color:var(--orange);font-weight:700">${s.plCounts[3]||0}</td><td style="color:var(--red);font-weight:800">${s.plCounts[2]||0}</td><td style="color:var(--red);font-weight:800">${s.plCounts[1]||0}</td></tr>`});
  h+='</table></div>';

  const distBands=[
    {label:'Level 8 — EE1 (90-100%)',min:90,max:100,color:'#1B5E20'},
    {label:'Level 7 — EE2 (75-89%)',min:75,max:89,color:'#2E7D32'},
    {label:'Level 6 — ME1 (58-74%)',min:58,max:74,color:'var(--g2)'},
    {label:'Level 5 — ME2 (41-57%)',min:41,max:57,color:'var(--g2)'},
    {label:'Level 4 — AE1 (31-40%)',min:31,max:40,color:'var(--orange)'},
    {label:'Level 3 — AE2 (21-30%)',min:21,max:30,color:'var(--orange)'},
    {label:'Level 2 — BE1 (11-20%)',min:11,max:20,color:'var(--red)'},
    {label:'Level 1 — BE2 (1-10%)',min:0,max:10,color:'var(--red)'}
  ];
  h+=`<div class="scorecard"><h2>CBE Performance Level Distribution</h2><table class="dist-table"><tr><th>CBE Level</th><th>Count</th><th>%</th><th>Distribution</th></tr>`;
  distBands.forEach(b=>{const cnt=avgPcts.filter(p=>p>=b.min&&p<=b.max).length;const pct=nLearners>0?Math.round(cnt/nLearners*1000)/10:0;h+=`<tr><td style="font-weight:800;color:${b.color}">${b.label}</td><td>${cnt}</td><td>${pct}%</td><td><span class="dist-bar" style="width:${Math.max(pct,2)}%;background:${b.color}"></span></td></tr>`});
  h+='</table></div>';
  if(paid)h+=`<div style="text-align:center;margin-top:12px"><button onclick="downloadKPIasPDF()" style="padding:8px 24px;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;background:var(--g1);color:#fff">📄 Download KPI as PDF</button></div>`;
  h+='</div>';
  document.getElementById('viewKPI').innerHTML=h;
}

// ========== PROFILE VIEW ==========
function renderProfile(){
  const isEditing=window._profileEditing||false;
  let h=`<div class="profile-view">
  <div class="pv-card">
    <h3>👤 Teacher Profile</h3>`;

  if(isEditing){
    // ===== EDIT MODE =====
    h+=`<div class="edit-field"><label>Full Name</label><input id="edName" value="${esc(currentUser.name)}" placeholder="Your full name"></div>`;
    h+=`<div class="edit-field"><label>Email Address</label><input id="edEmail" type="email" value="${esc(currentUser.email)}" readonly title="Email cannot be changed (used as login ID)"></div>`;
    h+=`<div class="edit-field"><label>Phone Number (M-Pesa)</label><div style="display:flex;gap:0;align-items:stretch;border:2px solid #e0e0e0;border-radius:6px;overflow:hidden"><div style="background:var(--g5);padding:0 10px;display:flex;align-items:center;font-size:13px;font-weight:800;color:var(--g1);border-right:2px solid #e0e0e0">🇰🇪 +254</div><input id="edPhone" type="tel" value="${esc(currentUser.phone||'').replace('+254','')}" placeholder="7XX XXX XXX" maxlength="9" style="flex:1;border:none;padding:8px 10px;font-size:13px;outline:none;background:transparent"></div></div>`;
    h+=`<div class="edit-field"><label>School / Institution</label><input id="edSchool" value="${esc(currentUser.school)}" placeholder="Your school name"></div>`;
    // Password change section
    h+=`<div class="pw-change-section"><label style="font-size:10px;font-weight:700;color:var(--orange);text-transform:uppercase;letter-spacing:.5px">🔒 Change Password (leave blank to keep current)</label>`;
    h+=`<div class="edit-field" style="margin-top:6px"><label>Current Password</label><input id="edCurPw" type="password" placeholder="Enter current password"></div>`;
    h+=`<div class="edit-field"><label>New Password</label><input id="edNewPw" type="password" placeholder="Min 6 characters"></div>`;
    h+=`<div class="edit-field"><label>Confirm New Password</label><input id="edConfPw" type="password" placeholder="Re-enter new password"></div></div>`;
    h+=`<div class="profile-actions"><button class="save-btn" onclick="saveProfileEdits()">💾 Save Changes</button><button class="cancel-btn" onclick="cancelProfileEdit()">✖ Cancel</button></div>`;
  } else {
    // ===== VIEW MODE =====
    h+=`<button class="edit-btn" onclick="startProfileEdit()">✏️ Edit Profile</button>`;
    h+=`<div class="pv-row"><span class="pv-label">Full Name</span><span class="pv-val">${esc(currentUser.name)}</span></div>`;
    h+=`<div class="pv-row"><span class="pv-label">Email</span><span class="pv-val">${esc(currentUser.email)} <small style="color:#999">(login ID)</small></span></div>`;
    h+=`<div class="pv-row"><span class="pv-label">Phone</span><span class="pv-val">${esc(currentUser.phone)}</span></div>`;
    h+=`<div class="pv-row"><span class="pv-label">School</span><span class="pv-val">${esc(currentUser.school)}</span></div>`;
    h+=`<div class="pv-row"><span class="pv-label">Account Created</span><span class="pv-val">${new Date(currentUser.createdAt).toLocaleDateString('en-KE')}</span></div>`;
  }
  h+=`</div>`;

  // Report access status card
  h+=`<div class="pv-card"><h3>🔓 Report Access Status</h3>`;
  for(let g=1;g<=9;g++){
    const paid=isGradePaid(g);
    const payment=getGradePayment(g);
    h+=`<div class="pv-row"><span class="pv-label">Grade ${g}</span><span class="pv-val" style="color:${paid?'var(--g1)':'var(--orange)'};font-weight:700">${paid?'✅ Unlocked ('+(payment?payment.txId:'')+')':'🔒 Locked'}</span></div>`;
  }
  h+='</div></div>';
  document.getElementById('viewProfile').innerHTML=h;
}

function startProfileEdit(){
  window._profileEditing=true;
  renderProfile();
}

function cancelProfileEdit(){
  window._profileEditing=false;
  renderProfile();
}

async function saveProfileEdits(){
  const name=document.getElementById('edName').value.trim();
  const phone=document.getElementById('edPhone').value.trim();
  const school=document.getElementById('edSchool').value.trim();
  const curPw=document.getElementById('edCurPw').value;
  const newPw=document.getElementById('edNewPw').value;
  const confPw=document.getElementById('edConfPw').value;

  // Validate basic fields
  if(!name){toast('❌ Name cannot be empty');return}
  if(!phone||phone.length<9){toast('❌ Enter a valid 9-digit phone number');return}
  if(!school){toast('❌ School name cannot be empty');return}

  // Handle password change
  if(curPw||newPw||confPw){
    // User wants to change password — all 3 fields required
    if(!curPw){toast('❌ Enter your current password');return}
    if(!newPw||newPw.length<6){toast('❌ New password must be at least 6 characters');return}
    if(newPw!==confPw){toast('❌ New passwords do not match');return}
    // Verify current password
    const curHash=await hashPassword(curPw);
    if(curHash!==currentUser.hash){toast('❌ Current password is incorrect');return}
    // All good — update password
    const newHash=await hashPassword(newPw);
    currentUser.hash=newHash;
  }

  // Update user object
  currentUser.name=name;
  currentUser.phone='+254'+phone;
  currentUser.school=school;

  // Persist to localStorage user DB
  const users=getUsers();
  const idx=users.findIndex(u=>u.id===currentUser.id);
  if(idx>=0){
    users[idx]={...users[idx],name:currentUser.name,phone:currentUser.phone,school:currentUser.school,hash:currentUser.hash};
    saveUsers(users);
  }

  // Update UI
  document.getElementById('ddName').textContent=currentUser.name;
  document.getElementById('userBtnLabel').textContent='👤 '+currentUser.name.split(' ')[0];
  const _snt=document.getElementById('schoolNameTop');if(_snt)_snt.value=currentUser.school||'';

  window._profileEditing=false;
  renderProfile();
  toast('✅ Profile updated!');
}

// ========== PAYMENT HISTORY VIEW ==========
function renderPaymentHistory(){
  const payments=getPayments();
  let h='<div class="pay-history"><div class="ph-card"><h3>💳 M-Pesa Payment History</h3>';
  if(payments.length===0){h+='<div class="ph-empty">No payments yet. Pay KSh 100 per grade to unlock report downloads.</div>'}
  else{
    h+=`<table><tr><th>TX ID</th><th>Grade</th><th>Phone</th><th>Amount</th><th>Status</th><th>Date</th></tr>`;
    payments.forEach(p=>{h+=`<tr><td>${p.txId}</td><td>Grade ${p.grade}</td><td>${p.phone}</td><td>KSh ${p.amount}</td><td style="color:${p.status==='success'?'var(--g1)':'var(--red)'};font-weight:700">${p.status==='success'?'✅ Success':'❌ '+p.status}</td><td>${new Date(p.date).toLocaleString('en-KE')}</td></tr>`});
    h+='</table>';
  }
  h+='</div></div>';
  document.getElementById('viewPayments').innerHTML=h;
}

// ========== M-PESA PAYMENT FLOW ==========
let mpTimerInterval=null;
let mpTargetGrade=null;

function openMpesa(){
  mpTargetGrade=currentGrade;
  document.getElementById('mpGrade').textContent=mpTargetGrade;
  document.getElementById('mpPhone').value=currentUser.phone?currentUser.phone.replace('+254',''):'';
  mpResetToStep1();
  document.getElementById('mpesaOverlay').classList.add('show');
}

function closeMpesa(){
  document.getElementById('mpesaOverlay').classList.remove('show');
  if(mpTimerInterval){clearInterval(mpTimerInterval);mpTimerInterval=null}
}

function mpResetToStep1(){
  document.getElementById('mpStep1').style.display='block';
  document.getElementById('mpStep2').style.display='none';
  document.getElementById('mpStep3').style.display='none';
  document.getElementById('mpStep4').style.display='none';
  document.getElementById('mpPayBtn').disabled=false;
}

async function initiateMpesa(){
  const phone=document.getElementById('mpPhone').value.trim();
  if(!phone||phone.length<9){alert('Please enter a valid phone number.');return}

  const fullPhone='+254'+phone;
  document.getElementById('mpDisplayPhone').textContent=fullPhone;
  document.getElementById('mpPayBtn').disabled=true;

  /*
   * === PRODUCTION INTEGRATION NOTES ===
   *
   * To connect to real Safaricom Daraja API:
   *
   * 1. Backend endpoint needed (Node.js/Python/PHP) that calls:
   *    POST https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest
   *
   * 2. Headers: Authorization = Bearer <access_token from OAuth>
   * 3. Body: {
   *      BusinessShortCode: "174379",
   *      Password: <Base64(ShortCode+Passkey+Timestamp)>,
   *      Timestamp: "YYYYMMDDHHmmss",
   *      TransactionType: "CustomerPayBillOnline",
   *      Amount: 100,
   *      PartyA: "2547XXXXXXX",
   *      PartyB: "174379",
   *      PhoneNumber: "2547XXXXXXX",
   *      CallBackURL: "https://orpa-brand-service.onrender.com/callback",
   *      AccountReference: "ORPA-GR"+grade,
   *      TransactionDesc: "Grade Report Unlock"
   *    }
   *
   * 4. The callback URL receives payment result from Safaricom
   * 5. Your backend updates payment status
   * 6. Frontend polls your backend (or uses WebSocket) to detect success
   *
   * For this prototype, we simulate the flow below.
   */

  // Switch to STK push waiting step
  document.getElementById('mpStep1').style.display='none';
  document.getElementById('mpStep2').style.display='block';

  // Simulate STK push → user enters PIN → confirmation
  let timeLeft=30;
  document.getElementById('mpTimer').textContent=`0:${timeLeft.toString().padStart(2,'0')}`;
  mpTimerInterval=setInterval(()=>{
    timeLeft--;
    document.getElementById('mpTimer').textContent=`0:${timeLeft.toString().padStart(2,'0')}`;
    if(timeLeft<=0){
      clearInterval(mpTimerInterval);mpTimerInterval=null;
      // Simulate success (80% chance) or timeout (20%)
      if(Math.random()>0.2){
        mpesaPaymentSuccess(fullPhone);
      }else{
        mpesaPaymentFailed('Payment timed out. Please try again.');
      }
    }
  },1000);
}

function mpesaPaymentSuccess(phone){
  if(mpTimerInterval){clearInterval(mpTimerInterval);mpTimerInterval=null}

  const txId='QJK'+Date.now().toString(36).toUpperCase()+Math.random().toString(36).substr(2,4).toUpperCase();
  const now=new Date();

  // Record payment
  const payments=getPayments();
  payments.push({
    txId,grade:mpTargetGrade,phone,amount:MPESA_AMOUNT,status:'success',
    date:now.toISOString(),examName:state.examName,examTerm:state.examTerm,examYear:state.examYear
  });
  savePayments(payments);

  // Update UI to success step
  document.getElementById('mpStep2').style.display='none';
  document.getElementById('mpStep3').style.display='block';
  document.getElementById('mpSuccessGrade').textContent=mpTargetGrade;
  document.getElementById('mpTxId').textContent=txId;
  document.getElementById('mpRxPhone').textContent=phone;
  document.getElementById('mpRxGrade').textContent='Grade '+mpTargetGrade;
  document.getElementById('mpRxAmount').textContent='KSh '+MPESA_AMOUNT;
  document.getElementById('mpRxDate').textContent=now.toLocaleString('en-KE');

  // Refresh sidebar to show paid status
  buildSidebar();
  toast('✅ Payment successful! Reports unlocked.');
}

function mpesaPaymentFailed(msg){
  if(mpTimerInterval){clearInterval(mpTimerInterval);mpTimerInterval=null}

  // Record failed payment
  const payments=getPayments();
  payments.push({
    txId:'FAILED-'+Date.now().toString(36),grade:mpTargetGrade,phone:'',amount:MPESA_AMOUNT,status:'failed',
    date:new Date().toISOString()
  });
  savePayments(payments);

  document.getElementById('mpStep2').style.display='none';
  document.getElementById('mpStep4').style.display='block';
  document.getElementById('mpFailMsg').textContent=msg;
}

function mpesaDownloadNow(){
  closeMpesa();
  // Refresh and print
  renderReports();
  showViewByName('reports');
  setTimeout(()=>window.print(),500);
}

// ========== EXCEL / PDF EXPORT ==========
// ========== EXCEL LOGO/WATERMARK HELPERS (ExcelJS) ==========
// SheetJS (community build) cannot embed images, so when the ExcelJS library
// is available we use it to add the centred school-logo header and a faint
// centred zone watermark. If ExcelJS is missing we fall back to plain SheetJS.

// Pre-blend an image over white at a low opacity so it looks like a faint
// watermark (ExcelJS has no per-image opacity). Returns a PNG data URL.
function fadeImageDataURL(dataUrl,opacity){
  return new Promise((resolve)=>{
    try{
      const img=new Image();
      img.onload=function(){
        const c=document.createElement('canvas');
        c.width=img.naturalWidth||300;c.height=img.naturalHeight||300;
        const ctx=c.getContext('2d');
        ctx.fillStyle='#ffffff';ctx.fillRect(0,0,c.width,c.height);
        ctx.globalAlpha=opacity;
        ctx.drawImage(img,0,0,c.width,c.height);
        try{resolve(c.toDataURL('image/png'));}catch(e){resolve(null);}
      };
      img.onerror=function(){resolve(null);};
      img.src=dataUrl;
    }catch(e){resolve(null);}
  });
}

function _dataUrlExt(u){ return /^data:image\/jpe?g/.test(u)?'jpeg':(/^data:image\/gif/.test(u)?'gif':'png'); }

// Build ONE worksheet in an ExcelJS workbook for a grade.
async function _excelAddGradeSheet(wb,g,logoImgId,fadedWmDataUrl){
  const cfg=GRADE_CFG.find(c=>c.g===g);
  const gd=state.grades[g];
  const prev=currentGrade;currentGrade=g;
  const computed=computeAll();
  const positions=computePositions(computed);
  currentGrade=prev;
  const nSubj=cfg.subjects.length;
  const nCols=3+nSubj+4;
  const school=(currentUser&&(currentUser.schoolName||currentUser.school))||'My School';
  const ws=wb.addWorksheet('Grade '+g);

  // Rows 1-4 reserved for the centred logo + titles.
  ws.mergeCells(1,1,4,nCols);
  const tCell=ws.getCell(1,1);
  tCell.value=school+'\nGrade '+g+' \u2014 '+(state.examName||'Exam')+'  \u00b7  Term '+(state.examTerm||'')+'  \u00b7  '+(state.examYear||'');
  tCell.alignment={vertical:'middle',horizontal:'center',wrapText:true};
  tCell.font={bold:true,size:13,color:{argb:'FF5B18C4'}};
  ws.getRow(1).height=22;ws.getRow(2).height=22;ws.getRow(3).height=18;ws.getRow(4).height=18;

  // Centred school logo across the header band.
  if(logoImgId!=null){
    ws.addImage(logoImgId,{ tl:{col:(nCols/2)-0.6,row:0.1}, ext:{width:70,height:66} });
  }

  // Header + data.
  const hdr=['Pos','ADM','Learner'];
  cfg.subjects.forEach(s=>hdr.push(s.n+' (P/L)'));
  hdr.push('AVG P/L','AVG %','Grade','Pts');
  const headerRowIdx=6;
  const hr=ws.getRow(headerRowIdx);
  hr.values=hdr;
  hr.font={bold:true,color:{argb:'FFFFFFFF'}};
  hr.eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF5B18C4'}};c.alignment={horizontal:'center'};});
  positions.forEach(x=>{
    const lr=gd.learners[x.i];
    const row=[x.pos,lr.adm,lr.name];
    cfg.subjects.forEach((s,si)=>{const raw=lr.raws[si];const pl=computed[x.i].pls[si];row.push(raw==='ABS'?'ABS':(pl!==null?pl:''));});
    row.push(computed[x.i].avgPL||'',x.avg||'',computed[x.i].avgGrade||'',computed[x.i].totalPts||'');
    ws.addRow(row);
  });
  // Column widths
  ws.getColumn(1).width=6;ws.getColumn(2).width=12;ws.getColumn(3).width=24;
  for(let k=0;k<nSubj;k++)ws.getColumn(4+k).width=12;
  ws.getColumn(4+nSubj).width=9;ws.getColumn(5+nSubj).width=9;ws.getColumn(6+nSubj).width=9;ws.getColumn(7+nSubj).width=7;

  // Faint centred zone watermark image over the data area.
  if(fadedWmDataUrl){
    const wmId=wb.addImage({base64:fadedWmDataUrl,extension:'png'});
    const lastRow=headerRowIdx+positions.length;
    ws.addImage(wmId,{ tl:{col:(nCols/2)-2.5,row:headerRowIdx+2}, ext:{width:300,height:300} });
  }
}

async function exportGradesExcelJS(gradeList,filename){
  const wb=new ExcelJS.Workbook();
  wb.creator='Orpa';
  // Prepare shared images once.
  const schoolLogo=getSchoolLogo();
  let logoImgId=null;
  if(schoolLogo){ logoImgId=wb.addImage({base64:schoolLogo,extension:_dataUrlExt(schoolLogo)}); }
  let fadedWm=null;
  const zone=getZoneLogo();
  if(zone){ fadedWm=await fadeImageDataURL(zone,0.08); }
  for(const g of gradeList){ await _excelAddGradeSheet(wb,g,logoImgId,fadedWm); }
  const buf=await wb.xlsx.writeBuffer();
  const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}

function exportScoresheetExcel(){
  if(!isGradePaid(currentGrade)){openMpesa();return}
  const filename=`${schoolSlug()}_Grade${currentGrade}_Scoresheet_${state.examName||'Exam'}_T${state.examTerm||''}_${state.examYear||''}.xlsx`;
  if(typeof ExcelJS!=='undefined'){
    exportGradesExcelJS([currentGrade],filename).then(()=>toast('✅ Excel exported!')).catch((e)=>{console.warn(e);toast('❌ Excel export failed');});
    return;
  }
  // ---- Fallback: SheetJS (no embedded logo) ----
  const cfg=GRADE_CFG.find(c=>c.g===currentGrade);
  const gd=state.grades[currentGrade];
  const computed=computeAll();
  const positions=computePositions(computed);
  const hdr=['Pos','ADM','Learner'];
  cfg.subjects.forEach(s=>hdr.push(s.n+' (P/L)'));
  hdr.push('AVG P/L','AVG %','Grade','Pts');
  const aoa=[hdr];
  positions.forEach(x=>{
    const lr=gd.learners[x.i];
    const row=[x.pos,lr.adm,lr.name];
    cfg.subjects.forEach((s,si)=>{const raw=lr.raws[si];const pl=computed[x.i].pls[si];row.push(raw==='ABS'?'ABS':(pl!==null?pl:''))});
    row.push(computed[x.i].avgPL||'',x.avg||'',computed[x.i].avgGrade||'',computed[x.i].totalPts||'');
    aoa.push(row);
  });
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  const wch=[{wch:5},{wch:10},{wch:22}];
  cfg.subjects.forEach(()=>wch.push({wch:10}));
  wch.push({wch:8},{wch:8},{wch:8},{wch:6});
  ws['!cols']=wch;
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Grade '+currentGrade);
  XLSX.writeFile(wb,filename);
  toast('✅ Excel exported!');
}

// ========== ZONAL BUNDLE (Grades 1-9 in one workbook) ==========
function buildGradeAOA(g){
  // Build the score-sheet rows for ONE grade without disturbing the UI.
  const prevGrade=currentGrade;
  currentGrade=g;
  const cfg=GRADE_CFG.find(c=>c.g===g);
  const gd=state.grades[g];
  const computed=computeAll();
  const positions=computePositions(computed);
  currentGrade=prevGrade; // restore immediately

  const schoolName=(currentUser&&currentUser.school)?currentUser.school:'My School';
  const aoa=[];
  // Title rows — school name + the word ZONAL appear on every tab.
  aoa.push([schoolName+' — ZONAL SCORE SHEET']);
  aoa.push(['Grade '+g,(state.examName||'Exam'),'Term '+(state.examTerm||''),(state.examYear||'')]);
  aoa.push([]);
  // Column header row
  const hdr=['Pos','ADM','Learner'];
  cfg.subjects.forEach(s=>hdr.push(s.n+' (P/L)'));
  hdr.push('AVG P/L','AVG %','Grade','Pts');
  aoa.push(hdr);
  // Data rows
  positions.forEach(x=>{
    const lr=gd.learners[x.i];
    const row=[x.pos,lr.adm,lr.name];
    cfg.subjects.forEach((s,si)=>{const raw=lr.raws[si];const pl=computed[x.i].pls[si];row.push(raw==='ABS'?'ABS':(pl!==null?pl:''))});
    row.push(computed[x.i].avgPL||'',x.avg||'',computed[x.i].avgGrade||'',computed[x.i].totalPts||'');
    aoa.push(row);
  });
  return {aoa,nSubj:cfg.subjects.length,rows:positions.length};
}

function exportZonalBundle(){
  const schoolName=(currentUser&&(currentUser.schoolName||currentUser.school))?(currentUser.schoolName||currentUser.school):'';
  // Make sure the latest typed marks are captured before exporting.
  try{saveUserState();}catch(e){}
  const fname=`${schoolSlug()}_ZONAL_BUNDLE_${state.examName||'Exam'}_T${state.examTerm||''}_${state.examYear||''}.xlsx`;
  if(typeof ExcelJS!=='undefined'){
    exportGradesExcelJS([1,2,3,4,5,6,7,8,9],fname)
      .then(()=>toast('✅ Zonal bundle exported (Grades 1-9)'))
      .catch((e)=>{console.warn(e);toast('❌ Bundle export failed');});
    return;
  }
  if(typeof XLSX==='undefined'){toast('❌ Excel library not loaded. Check your connection and retry.');return}
  const wb=XLSX.utils.book_new();
  let totalLearners=0;
  for(let g=1;g<=9;g++){
    const {aoa,nSubj,rows}=buildGradeAOA(g);
    totalLearners+=rows;
    const ws=XLSX.utils.aoa_to_sheet(aoa);
    const wch=[{wch:5},{wch:10},{wch:22}];
    for(let k=0;k<nSubj;k++)wch.push({wch:10});
    wch.push({wch:8},{wch:8},{wch:8},{wch:6});
    ws['!cols']=wch;
    XLSX.utils.book_append_sheet(wb,ws,'Grade '+g);
  }
  XLSX.writeFile(wb,fname);
  toast('✅ Zonal bundle exported ('+totalLearners+' learners across 9 grades)');
}

function downloadReportPDF(learnerIndex){
  if(!isGradePaid(currentGrade)){openMpesa();return}
  const cards=document.querySelectorAll('.report-card');
  if(!cards[learnerIndex])return;
  const el=cards[learnerIndex];
  const lr=state.grades[currentGrade].learners[learnerIndex];
  const filename=`${schoolSlug()}_Grade${currentGrade}_${lr.name||'Learner'}_Report.pdf`;
  exportElementToPDF(el,filename,'Grade '+currentGrade+' \u2014 Learner Report','portrait');
}

function downloadKPIasPDF(){
  if(!isGradePaid(currentGrade)){openMpesa();return}
  const el=document.getElementById('viewKPI');
  const filename=`${schoolSlug()}_Grade${currentGrade}_KPI_Dashboard.pdf`;
  exportElementToPDF(el,filename,'Grade '+currentGrade+' \u2014 KPI Dashboard','landscape');
}

// ========== PRINT (checks payment) ==========
function tryPrint(){
  if(!isGradePaid(currentGrade)){
    openMpesa();
    return;
  }
  renderReports();
  showViewByName('reports');
  setTimeout(()=>window.print(),400);
}

// ========== USER DROPDOWN ==========
function toggleUserDD(){
  document.getElementById('userDD').classList.toggle('show');
}
function closeUserDD(){
  document.getElementById('userDD').classList.remove('show');
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.user-menu'))closeUserDD();
});

// ========== SCHOOL NAME (customizable, applies to all grades 1-9) ==========
let _schoolSaveTimer=null;
function updateSchoolName(v){
  if(!currentUser)return;
  currentUser.school=v.trim();
  clearTimeout(_schoolSaveTimer);
  _schoolSaveTimer=setTimeout(()=>{
    const users=getUsers();const idx=users.findIndex(u=>u.id===currentUser.id);
    if(idx>=0){users[idx].school=currentUser.school;saveUsers(users);}
  },500);
}
function schoolSlug(){
  const s=(currentUser&&currentUser.school)?currentUser.school:'School';
  return s.replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,'').toUpperCase()||'SCHOOL';
}

// ========== TOAST ==========
function toast(msg){
  const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),1500);
}

// ========== INIT ==========
// When the backend layer (auth-backend.js) is present it controls boot via
// window.__bootApp (async session restore against the server). Only fall back
// to the local-only session restore when running without a backend.
if(!window.__ORPA_BACKEND){
  if(tryRestoreSession()){
    enterApp();
  }else{
    showAuth('login');
  }
}
