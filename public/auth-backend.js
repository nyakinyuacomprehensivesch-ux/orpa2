/*
 * Orpa backend integration layer.
 * Loaded AFTER app.js — it overrides the local-only auth functions so the
 * app uses the central server for accounts, and connects a live session
 * (Socket.IO) so the owner can monitor and force-logout users.
 *
 * Grading data (marks) is now ALSO synced to the server via /api/me/state,
 * so teachers see the same data across devices.
 */
(function () {
  window.__ORPA_BACKEND = true;
  const API = ''; // same origin
  const TOKEN_KEY = 'af_token';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

  async function api(pathname, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const t = getToken();
    if (t) headers.Authorization = 'Bearer ' + t;
    // Show "waking up" message for Render free-tier cold start
    var wakingEl = document.getElementById('af-waking-msg');
    if (!wakingEl) {
      wakingEl = document.createElement('div');
      wakingEl.id = 'af-waking-msg';
      wakingEl.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;background:linear-gradient(90deg,#5B18C4,#7C3AED);color:#fff;text-align:center;padding:10px;font-size:14px;z-index:99999;font-family:sans-serif;';
      wakingEl.textContent = '\u26A1 Waking up server, please wait...';
      document.body.appendChild(wakingEl);
    }
    try {
      wakingEl.style.display = 'block';
      const res = await fetch(API + pathname, Object.assign({}, opts, { headers }));
      wakingEl.style.display = 'none';
      let data = null;
      try { data = await res.json(); } catch (e) { data = {}; }
      if (!res.ok) {
        var httpErr = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
        httpErr.status = res.status;   // real HTTP status (e.g. 401 = bad/expired token)
        throw httpErr;
      }
      return data;
    } catch (e) {
      wakingEl.style.display = 'none';
      // A thrown fetch TypeError means the network/server is unreachable
      // (Render cold-start), NOT an authentication failure.
      if (e.name === 'TypeError' || (e.message && e.message.indexOf('Failed to fetch') === 0)) {
        var netErr = new Error('Server is waking up. Please wait a moment and try again.');
        netErr.isNetwork = true;       // flag so callers keep the session
        throw netErr;
      }
      throw e;
    }
  }

  // ---------- School-scoped state sync (shared per school) ----------
  // The grading data now lives on the SCHOOL, not the individual teacher.
  // On login we pull the school's shared dataset, drop it into the same
  // localStorage slot app.js already reads, and remember the role, the
  // assigned grade, the school logo and the zone (watermark) logo.
  // On every local save we push a patch back; the server enforces that a
  // class teacher may only change their own grade.

  let _serverSaveTimer = null;
  const SERVER_SAVE_DELAY = 1500;

  function pushStateToServer() {
    if (!currentUser || currentUser.role === 'owner') return;
    try {
      const raw = localStorage.getItem('nyak_' + currentUser.id + '_data');
      if (!raw) return;
      const d = JSON.parse(raw);
      const patch = {
        examName: d.examName || '',
        examTerm: d.examTerm || '',
        examYear: d.examYear || '',
        grades: d.grades || {},
      };
      api('/api/school/state', { method: 'PUT', body: JSON.stringify(patch) })
        .then(function () { /* saved */ })
        .catch(function (e) { console.warn('[sync] school save failed:', e.message); });
    } catch (e) { console.warn('[sync] push error:', e.message); }
  }

  function scheduleServerPush() {
    clearTimeout(_serverSaveTimer);
    _serverSaveTimer = setTimeout(pushStateToServer, SERVER_SAVE_DELAY);
  }

  // Show the "waiting for the administrator to assign you" screen.
  function showAwaitingScreen(msg) {
    try { document.getElementById('appContainer').classList.remove('active'); } catch (e) {}
    document.getElementById('authRegister').style.display = 'none';
    document.getElementById('authLogin').style.display = 'none';
    let el = document.getElementById('awaitingScreen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'awaitingScreen';
      el.style.cssText = 'max-width:520px;margin:8vh auto;background:#fff;border-radius:16px;padding:32px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.12);font-family:sans-serif';
      document.body.appendChild(el);
    }
    const who = currentUser ? (currentUser.name || '') : '';
    el.innerHTML =
      '<div style="font-size:44px">\u23F3</div>' +
      '<h2 style="color:#5B18C4;margin:8px 0">Almost there' + (who ? ', ' + who.split(' ')[0] : '') + '</h2>' +
      '<p style="color:#444;line-height:1.5">' + (msg || 'Your account has not been assigned to a school yet. The zonal administrator will assign your school and grade shortly.') + '</p>' +
      '<p style="color:#888;font-size:13px">This page refreshes when you sign in again.</p>' +
      '<button id="awaitLogout" style="margin-top:14px;background:#5B18C4;color:#fff;border:none;border-radius:10px;padding:10px 20px;font-weight:700;cursor:pointer">Sign out</button>';
    el.style.display = 'block';
    const btn = document.getElementById('awaitLogout');
    if (btn) btn.onclick = function () { doLogout(); };
  }

  // Owner landing: they manage everything from the admin dashboard.
  function showOwnerScreen() {
    try { document.getElementById('appContainer').classList.remove('active'); } catch (e) {}
    document.getElementById('authRegister').style.display = 'none';
    document.getElementById('authLogin').style.display = 'none';
    let el = document.getElementById('awaitingScreen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'awaitingScreen';
      el.style.cssText = 'max-width:520px;margin:8vh auto;background:#fff;border-radius:16px;padding:32px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.12);font-family:sans-serif';
      document.body.appendChild(el);
    }
    el.innerHTML =
      '<div style="font-size:44px">\uD83D\uDEE1\uFE0F</div>' +
      '<h2 style="color:#5B18C4;margin:8px 0">Zonal Administrator</h2>' +
      '<p style="color:#444">Manage schools, assign teachers, upload the zone logo and view the ranking dashboard.</p>' +
      '<button id="ownerOpenAdmin" style="margin-top:8px;background:#5B18C4;color:#fff;border:none;border-radius:10px;padding:12px 24px;font-weight:800;cursor:pointer;font-size:15px">\uD83D\uDEE1\uFE0F Open Admin Dashboard</button>' +
      '<div><button id="ownerLogout" style="margin-top:14px;background:transparent;color:#888;border:none;cursor:pointer">Sign out</button></div>';
    el.style.display = 'block';
    document.getElementById('ownerOpenAdmin').onclick = function () { window.open('admin.html', '_blank'); };
    document.getElementById('ownerLogout').onclick = function () { doLogout(); };
  }

  // Pull the school's shared dataset into local state, then enter the app.
  // Returns false if the user is unassigned (caller shows the waiting screen).
  async function loadSchoolStateAndEnter() {
    if (!currentUser) return false;
    if (currentUser.role === 'owner') { showOwnerScreen(); injectAdminLink(); connectSocket(); return true; }
    let result;
    try {
      result = await api('/api/school/state');
    } catch (e) {
      if (e && e.status === 409) { showAwaitingScreen(e.message); return false; }
      if (e && e.isNetwork) throw e; // let boot retry
      showAwaitingScreen(e.message || 'Could not load your school data.');
      return false;
    }
    // Merge server assignment info onto the current user object.
    currentUser.schoolId = result.schoolId;
    currentUser.schoolName = result.schoolName;
    currentUser.schoolRole = result.schoolRole;
    currentUser.assignedGrade = result.assignedGrade;
    // Logos for downloads (read by app.js).
    window.__afSchoolLogo = result.schoolLogo || null;
    window.__afZoneLogo = result.zoneLogo || null;
    // Drop the shared dataset into the slot app.js reads.
    const d = result.data || {};
    const localState = {
      examName: d.examName || '',
      examTerm: d.examTerm || '',
      examYear: d.examYear || '',
      grades: d.grades || {},
      submitted: d.submitted || {},
      submittedAt: d.submittedAt || {},
      archives: Array.isArray(d.archives) ? d.archives : [],
      graduates: Array.isArray(d.graduates) ? d.graduates : [],
      motto: typeof d.motto === 'string' ? d.motto : '',
    };
    localStorage.setItem('nyak_' + currentUser.id + '_data', JSON.stringify(localState));
    enterApp();
    connectSocket();
    return true;
  }

  // ---------- Socket / live session ----------
  let socket = null;
  let activityTimer = null;

  function connectSocket() {
    if (typeof io === 'undefined') return; // socket.io client not loaded
    if (socket) { try { socket.disconnect(); } catch (e) {} }
    socket = io({ auth: { token: getToken() } });
    socket.on('force-logout', (info) => {
      const msg = (info && info.reason) || 'Your session was ended by the administrator.';
      hardLogout(msg);
    });
    // Heartbeat so the owner sees "last active" and current grade.
    clearInterval(activityTimer);
    activityTimer = setInterval(() => {
      if (socket && socket.connected) {
        socket.emit('activity', { grade: (typeof currentGrade !== 'undefined' ? currentGrade : null) });
      }
    }, 15000);
  }

  function disconnectSocket() {
    clearInterval(activityTimer);
    if (socket) { try { socket.disconnect(); } catch (e) {} socket = null; }
  }

  function hardLogout(message) {
    disconnectSocket();
    setToken(null);
    currentUser = null;
    try { document.getElementById('appContainer').classList.remove('active'); } catch (e) {}
    showAuth('login');
    const box = document.getElementById('loginSuccessBox');
    if (box) { box.textContent = message || 'You have been signed out.'; box.style.display = 'block'; }
  }

  // ---------- Owner admin link ----------
  function injectAdminLink() {
    if (!currentUser || currentUser.role !== 'owner') return;
    const dd = document.getElementById('userDD');
    if (!dd || dd.querySelector('.dd-admin')) return;
    const item = document.createElement('div');
    item.className = 'dd-item dd-admin';
    item.textContent = '\uD83D\uDEE1\uFE0F Admin Dashboard';
    item.onclick = function () { window.open('admin.html', '_blank'); };
    const header = dd.querySelector('.dd-header');
    if (header && header.nextSibling) dd.insertBefore(item, header.nextSibling);
    else dd.appendChild(item);
  }

  // ---------- Overrides ----------
  doRegister = async function () {
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim().toLowerCase();
    const phone = document.getElementById('regPhone').value.trim();
    const school = document.getElementById('regSchool').value.trim();
    const tscEl = document.getElementById('regTsc');
    const tsc = tscEl ? tscEl.value.trim() : '';
    const pw = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regConfirm').value;
    const errBox = document.getElementById('regErrorBox');
    const showErr = (m) => { errBox.textContent = m; errBox.style.display = 'block'; };

    if (!name) return showErr('Please enter your full name.');
    if (!email || !email.includes('@')) return showErr('Please enter a valid email address.');
    if (!phone || phone.length < 9) return showErr('Please enter a valid phone number (9 digits).');
    if (tscEl && !tsc) return showErr('Please enter your TSC number.');
    if (pw.length < 6) return showErr('Password must be at least 6 characters.');
    if (pw !== confirm) return showErr('Passwords do not match.');

    try {
      await api('/api/register', { method: 'POST', body: JSON.stringify({ name, email, phone: '+254' + phone, school, tsc, password: pw }) });
      errBox.style.display = 'none';
      showAuth('login');
      const s = document.getElementById('loginSuccessBox');
      s.textContent = '\u2705 Account created! It is now awaiting approval by the administrator. Once approved, the administrator will also assign your school and grade.';
      s.style.display = 'block';
      document.getElementById('loginEmail').value = email;
    } catch (e) { showErr(e.message); }
  };

  doLogin = async function () {
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const pw = document.getElementById('loginPassword').value;
    const errBox = document.getElementById('loginErrorBox');
    const sucBox = document.getElementById('loginSuccessBox');
    if (!email || !pw) { errBox.textContent = 'Please enter email and password.'; errBox.style.display = 'block'; sucBox.style.display = 'none'; return; }
    try {
      const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ email, password: pw }) });
      setToken(data.token);
      currentUser = data.user;
      errBox.style.display = 'none'; sucBox.style.display = 'none';
      await loadSchoolStateAndEnter();
      injectAdminLink();
    } catch (e) {
      errBox.textContent = e.message; errBox.style.display = 'block'; sucBox.style.display = 'none';
    }
  };

  doLogout = async function () {
    // Push state to server before logout
    if (currentUser) {
      try { saveUserState(); } catch (e) {}
      try { pushStateToServer(); } catch (e) {}
    }
    try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
    hardLogout('You have been signed out.');
  };

  updateSchoolName = function (v) {
    if (!currentUser) return;
    currentUser.school = v.trim();
    clearTimeout(window._afSchoolTimer);
    window._afSchoolTimer = setTimeout(() => {
      api('/api/me/school', { method: 'PATCH', body: JSON.stringify({ school: currentUser.school }) }).catch(() => {});
    }, 600);
  };

  saveProfileEdits = async function () {
    const name = document.getElementById('edName').value.trim();
    const phone = document.getElementById('edPhone').value.trim();
    const school = document.getElementById('edSchool').value.trim();
    const curPw = document.getElementById('edCurPw').value;
    const newPw = document.getElementById('edNewPw').value;
    const confPw = document.getElementById('edConfPw').value;

    if (!name) return toast('\u274C Name cannot be empty');
    if (!phone || phone.length < 9) return toast('\u274C Enter a valid 9-digit phone number');
    if (!school) return toast('\u274C School name cannot be empty');

    const body = { name, phone: '+254' + phone, school };
    if (curPw || newPw || confPw) {
      if (!curPw) return toast('\u274C Enter your current password');
      if (!newPw || newPw.length < 6) return toast('\u274C New password must be at least 6 characters');
      if (newPw !== confPw) return toast('\u274C New passwords do not match');
      body.currentPassword = curPw; body.newPassword = newPw;
    }
    try {
      const data = await api('/api/me', { method: 'PUT', body: JSON.stringify(body) });
      currentUser = Object.assign(currentUser, data.user);
      document.getElementById('ddName').textContent = currentUser.name;
      document.getElementById('userBtnLabel').textContent = '\uD83D\uDC64 ' + currentUser.name.split(' ')[0];
      const snt = document.getElementById('schoolNameTop'); if (snt) snt.value = currentUser.school || '';
      window._profileEditing = false;
      renderProfile();
      toast('\u2705 Profile updated!');
    } catch (e) { toast('\u274C ' + e.message); }
  };

  // ---------- School features (submit + logo) ----------
  // Save the school motto (admins only). Shown on report-card footers.
  window.saveMotto = async function () {
    const t = document.getElementById('mottoInput');
    const motto = t ? t.value.slice(0, 200) : '';
    try {
      const r = await api('/api/school/motto', { method: 'PUT', body: JSON.stringify({ motto }) });
      if (typeof state === 'object') state.motto = r.motto || '';
      try { saveUserState(); } catch (e) {}
      toast('💾 Motto saved.');
    } catch (e) { toast('❌ ' + e.message); }
  };

  // PUSH the current results into the searchable 3-year archive (admins only).
  window.pushArchive = async function () {
    if (!window.confirm('Push the current exam results into the archive now? Snapshots are kept for the last 3 years and power the report-card trend graph.')) return;
    try { saveUserState(); pushStateToServer(); } catch (e) {}
    // Give the state push a moment to land before archiving on the server.
    setTimeout(async function () {
      try {
        const r = await api('/api/school/archive', { method: 'POST', body: JSON.stringify({}) });
        toast('📌 Archived ' + r.archived.year + (r.archived.term ? (' T' + r.archived.term) : '') + '. Total snapshots: ' + r.count);
      } catch (e) { toast('❌ ' + e.message); }
    }, 400);
  };

  // Search the archive; results shown in a modal by app.js.
  window.runSearch = async function () {
    const q = (document.getElementById('searchQ') || {}).value || '';
    try {
      const r = await api('/api/school/search?q=' + encodeURIComponent(q.trim()));
      if (typeof showSearchResults === 'function') showSearchResults(r.results || [], q.trim());
    } catch (e) { toast('❌ ' + e.message); }
  };

  // Submit the current grade (or, for an admin, all grades) to the zone so it
  // appears on the owner's ranking dashboard.
  window.submitToOwner = async function () {
    if (!currentUser || !currentUser.schoolId) { toast('❌ You are not assigned to a school yet.'); return; }
    try { saveUserState(); pushStateToServer(); } catch (e) {}
    const isAdmin = currentUser.schoolRole === 'admin';
    const grades = isAdmin ? [1,2,3,4,5,6,7,8,9] : [Number(currentUser.assignedGrade)];
    const label = isAdmin ? 'all grades for your school' : ('Grade ' + currentUser.assignedGrade);
    if (!window.confirm('Submit ' + label + ' to the zonal administrator now? You can keep editing and submit again later.')) return;
    try {
      for (const g of grades) {
        await api('/api/school/submit', { method: 'POST', body: JSON.stringify({ grade: g }) });
      }
      toast('✅ Submitted to the zone.');
    } catch (e) { toast('❌ ' + e.message); }
  };

  // Read + resize a picked logo file in the browser to a small data URL, then
  // upload it. Keeping it small (≤ ~320px) keeps downloads fast.
  window.onSchoolLogoPicked = function (input) {
    const file = input && input.files && input.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) { toast('❌ Please pick a PNG, JPG or WEBP image.'); return; }
    const reader = new FileReader();
    reader.onload = function () {
      const img = new Image();
      img.onload = function () {
        const max = 320;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        let dataUrl; try { dataUrl = c.toDataURL('image/png'); } catch (e) { dataUrl = reader.result; }
        api('/api/school/logo', { method: 'POST', body: JSON.stringify({ logo: dataUrl }) })
          .then(function (r) {
            window.__afSchoolLogo = r.schoolLogo || null;
            if (typeof refreshLogoPreview === 'function') refreshLogoPreview();
            toast('✅ School logo updated.');
          })
          .catch(function (e) { toast('❌ ' + e.message); });
      };
      img.onerror = function () { toast('❌ Could not read that image.'); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
  };

  window.refreshLogoPreview = function () {
    const box = document.getElementById('logoPreview'); if (!box) return;
    const logo = window.__afSchoolLogo;
    box.innerHTML = logo
      ? '<img src="' + logo + '" alt="School logo" style="max-height:54px;max-width:100%;object-fit:contain">'
      : '<span style="font-size:11px;color:#888">No logo yet</span>';
  };

  // ---------- Boot (async session restore) ----------
  // IMPORTANT: We must NOT delete the saved token just because the server is
  // slow to respond (Render free-tier cold start can take 30-50s). Deleting
  // the token on a transient network error is what logged teachers out every
  // time the instance had spun down. We only clear the session on a genuine
  // auth failure (HTTP 401), and retry on network errors instead.
  window.__bootApp = async function (attempt) {
    attempt = attempt || 0;
    const t = getToken();
    if (!t) { showAuth('login'); return; }
    try {
      const data = await api('/api/me');
      currentUser = data.user;
      await loadSchoolStateAndEnter();
      injectAdminLink();
    } catch (e) {
      if (e && e.isNetwork) {
        // Server waking up / offline: KEEP the token and retry with backoff.
        if (attempt < 6) {
          setTimeout(function () { window.__bootApp(attempt + 1); }, 5000);
          return;
        }
        // Still unreachable after retries: keep the token, tell the user,
        // and let them retry manually. Do NOT log them out.
        showAuth('login');
        var sb = document.getElementById('loginSuccessBox');
        if (sb) {
          sb.style.display = 'block';
          sb.textContent = 'Could not reach the server. Your login is saved \u2014 please refresh in a moment.';
        }
        return;
      }
      // Genuine auth failure (401) or other error: token is bad/expired.
      setToken(null);
      showAuth('login');
    }
  };

  // ---------- Hook into local saves to also push to server ----------
  // Override saveUserState to also schedule a server push
  const _origSaveUserState = typeof saveUserState === 'function' ? saveUserState : null;
  if (_origSaveUserState) {
    saveUserState = function () {
      _origSaveUserState();
      // Add a timestamp so we can compare local vs server
      try {
        const raw = localStorage.getItem('nyak_' + currentUser.id + '_data');
        if (raw) {
          const d = JSON.parse(raw);
          d._savedAt = Date.now();
          localStorage.setItem('nyak_' + currentUser.id + '_data', JSON.stringify(d));
        }
      } catch (e) {}
      scheduleServerPush();
    };
  }

  window.__bootApp();
})();
