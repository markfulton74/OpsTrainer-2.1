// ============================================
// OpsTrainer 2.1 — Application JavaScript
// ============================================

// STATE
var currentUser = null, currentOrg = null, accessToken = null;
var pageHistory = [];
var currentPageName = '';
var forgeState = { step:1, structure:null, modulesContent:[], jobId:null, documents:[] };
var courseFilter = 'org';
var ttsEnabled = true;
var currentLang = 'en';
var speechSynth = window.speechSynthesis;
var recognition = null;
var aiWarningCount = 0;
var responseStartTime = null;
var settingsSection = 'profile';

var LANGUAGES = {
  en:'English', fr:'French', ar:'Arabic', es:'Spanish',
  pt:'Portuguese', sw:'Swahili', so:'Somali', am:'Amharic',
  ha:'Hausa', ru:'Russian', uk:'Ukrainian', de:'German'
};

// ============================================
// SIDEBAR
// ============================================
function toggleSidebar() {
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebarOverlay');
  var main = document.getElementById('mainContent');
  if (window.innerWidth > 768) {
    sidebar.classList.toggle('collapsed');
    main.classList.toggle('expanded');
  } else {
    sidebar.classList.toggle('mobile-open');
    overlay.classList.toggle('show');
  }
}

function closeSidebar() {
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.remove('show');
}

// ============================================
// NAVIGATION
// ============================================
function navTo(page, pushHistory) {
  if (pushHistory !== false && currentPageName && currentPageName !== page) {
    pageHistory.push(currentPageName);
  }
  currentPageName = page;
  var backBtn = document.getElementById('backBtn');
  if (backBtn) backBtn.classList.toggle('show', pageHistory.length > 0);
  closeSidebar();
  showPage(page);
}

function goBack() {
  if (pageHistory.length === 0) return;
  var prev = pageHistory.pop();
  currentPageName = prev;
  var backBtn = document.getElementById('backBtn');
  if (backBtn) backBtn.classList.toggle('show', pageHistory.length > 0);
  showPage(prev);
}

// ============================================
// AUTH TAB SWITCHING
// ============================================
function switchMainTab(tab) {
  var tabs = document.querySelectorAll('.tabs .tab');
  tabs.forEach(function(t, i) {
    t.classList.toggle('active', (tab==='org'&&i===0)||(tab==='individual'&&i===1));
  });
  document.getElementById('orgPanel').style.display = tab==='org' ? 'block' : 'none';
  document.getElementById('individualPanel').style.display = tab==='individual' ? 'block' : 'none';
}

function switchOrgSubTab(tab) {
  var tabs = document.querySelectorAll('#orgPanel > .subtabs .subtab');
  tabs.forEach(function(t, i) {
    t.classList.toggle('active', (tab==='orgLogin'&&i===0)||(tab==='orgUser'&&i===1));
  });
  document.getElementById('orgLoginPanel').style.display = tab==='orgLogin' ? 'block' : 'none';
  document.getElementById('orgUserPanel').style.display = tab==='orgUser' ? 'block' : 'none';
}

function switchOrgAuthMode(mode) {
  var tabs = document.querySelectorAll('#orgLoginPanel > .subtabs .subtab');
  tabs.forEach(function(t, i) {
    t.classList.toggle('active', (mode==='login'&&i===0)||(mode==='register'&&i===1));
  });
  document.getElementById('orgSignInForm').classList.toggle('hidden', mode !== 'login');
  document.getElementById('orgRegisterForm').classList.toggle('hidden', mode !== 'register');
}

function switchIndividualMode(mode) {
  var tabs = document.querySelectorAll('#individualPanel > .subtabs .subtab');
  tabs.forEach(function(t, i) {
    t.classList.toggle('active', (mode==='login'&&i===0)||(mode==='register'&&i===1));
  });
  document.getElementById('individualSignInForm').classList.toggle('hidden', mode !== 'login');
  document.getElementById('individualRegisterForm').classList.toggle('hidden', mode !== 'register');
}

// ============================================
// FORGOT / RESET PASSWORD
// ============================================
function showForgotPassword() {
  document.getElementById('authMain').classList.add('hidden');
  document.getElementById('forgotForm').classList.remove('hidden');
  document.getElementById('resetForm').classList.add('hidden');
}

function showAuthMain() {
  document.getElementById('authMain').classList.remove('hidden');
  document.getElementById('forgotForm').classList.add('hidden');
  document.getElementById('resetForm').classList.add('hidden');
}

function doForgotPassword() {
  hideAlert('forgotAlert');
  hideAlert('forgotSuccess');
  var email = document.getElementById('forgotEmail').value.trim();
  if (!email) return showAlert('forgotAlert', 'Please enter your email address', 'danger');
  var btn = document.getElementById('forgotBtn');
  btn.disabled = true; btn.textContent = 'Sending...';
  api('POST', '/auth/forgot-password', { email: email }).then(function(data) {
    btn.disabled = false; btn.textContent = 'Send Reset Link';
    if (data.success) showAlert('forgotSuccess', data.message, 'success');
    else showAlert('forgotAlert', data.error, 'danger');
  });
}

function doResetPassword() {
  hideAlert('resetAlert');
  hideAlert('resetSuccess');
  var password = document.getElementById('resetPassword').value;
  var confirm = document.getElementById('resetConfirm').value;
  if (!password || !confirm) return showAlert('resetAlert', 'Please fill in both fields', 'danger');
  if (password !== confirm) return showAlert('resetAlert', 'Passwords do not match', 'danger');
  if (password.length < 8) return showAlert('resetAlert', 'Password must be at least 8 characters', 'danger');
  var token = new URLSearchParams(window.location.search).get('token');
  if (!token) return showAlert('resetAlert', 'Invalid reset link', 'danger');
  api('POST', '/auth/reset-password', { token: token, password: password }).then(function(data) {
    if (!data.success) return showAlert('resetAlert', data.error, 'danger');
    showAlert('resetSuccess', 'Password reset! Redirecting to login...', 'success');
    setTimeout(function() { window.history.replaceState({}, '', '/'); showAuthMain(); }, 2000);
  });
}

// ============================================
// API
// ============================================
function api(method, path, body) {
  var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
  if (accessToken) opts.headers['Authorization'] = 'Bearer ' + accessToken;
  if (body) opts.body = JSON.stringify(body);
  return fetch('/api' + path, opts).then(function(res) {
    return res.json();
  }).catch(function() {
    return { success: false, error: 'Network error' };
  });
}

function showAlert(id, msg, type) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'alert alert-' + type + ' show';
}

function hideAlert(id) {
  var el = document.getElementById(id);
  if (el) el.className = 'alert';
}

// ============================================
// AUTH
// ============================================
function doOrgLogin() {
  hideAlert('orgLoginAlert');
  var email = document.getElementById('orgLoginEmail').value.trim();
  var password = document.getElementById('orgLoginPassword').value;
  if (!email || !password) return showAlert('orgLoginAlert', 'Please enter email and password', 'danger');
  api('POST', '/auth/login', { email: email, password: password }).then(function(data) {
    if (!data.success) return showAlert('orgLoginAlert', data.error, 'danger');
    handleLoginSuccess(data);
  });
}

function doRegisterOrg() {
  hideAlert('orgRegisterAlert');
  var org_name = document.getElementById('regOrgName').value.trim();
  var full_name = document.getElementById('regFullName').value.trim();
  var country = document.getElementById('regCountry').value.trim();
  var email = document.getElementById('regEmail').value.trim();
  var password = document.getElementById('regPassword').value;
  if (!org_name || !full_name || !email || !password) return showAlert('orgRegisterAlert', 'All fields are required', 'danger');
  api('POST', '/auth/register-org', { org_name:org_name, full_name:full_name, country:country, email:email, password:password }).then(function(data) {
    if (!data.success) return showAlert('orgRegisterAlert', data.error, 'danger');
    handleLoginSuccess(data);
  });
}

function doActivateInvite() {
  hideAlert('inviteAlert');
  var email = document.getElementById('inviteEmail').value.trim();
  var invite_code = document.getElementById('inviteCode').value.trim().toUpperCase();
  var password = document.getElementById('invitePassword').value;
  if (!email || !invite_code || !password) return showAlert('inviteAlert', 'All fields are required', 'danger');
  api('POST', '/auth/activate-invite', { email:email, invite_code:invite_code, password:password }).then(function(data) {
    if (!data.success) return showAlert('inviteAlert', data.error, 'danger');
    handleLoginSuccess(data);
  });
}

function doIndividualLogin() {
  hideAlert('indLoginAlert');
  var email = document.getElementById('indLoginEmail').value.trim();
  var password = document.getElementById('indLoginPassword').value;
  if (!email || !password) return showAlert('indLoginAlert', 'Please enter email and password', 'danger');
  api('POST', '/auth/login', { email:email, password:password }).then(function(data) {
    if (!data.success) return showAlert('indLoginAlert', data.error, 'danger');
    handleLoginSuccess(data);
  });
}

function doRegisterIndividual() {
  hideAlert('indRegisterAlert');
  var full_name = document.getElementById('indRegName').value.trim();
  var email = document.getElementById('indRegEmail').value.trim();
  var password = document.getElementById('indRegPassword').value;
  if (!full_name || !email || !password) return showAlert('indRegisterAlert', 'All fields are required', 'danger');
  api('POST', '/auth/register-individual', { full_name:full_name, email:email, password:password }).then(function(data) {
    if (!data.success) return showAlert('indRegisterAlert', data.error, 'danger');
    handleLoginSuccess(data);
  });
}

function handleLoginSuccess(data) {
  accessToken = data.accessToken;
  currentUser = data.user;
  currentOrg = data.org;
  if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
  ttsEnabled = data.user.tts_enabled !== 0;
  currentLang = data.user.language || 'en';
  bootApp();
}

function doLogout() {
  stopSpeaking();
  var rt = localStorage.getItem('refreshToken');
  var p = rt ? api('POST', '/auth/logout', { refreshToken: rt }) : Promise.resolve();
  p.then(function() {
    localStorage.removeItem('refreshToken');
    accessToken = null; currentUser = null; currentOrg = null; pageHistory = [];
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('authPage').style.display = 'flex';
    showAuthMain();
  });
}

// ============================================
// BOOT
// ============================================
function bootApp() {
  document.getElementById('authPage').style.display = 'none';
  document.getElementById('appShell').classList.remove('hidden');
  var initials = currentUser.full_name.split(' ').map(function(n) { return n[0]; }).join('').substring(0,2).toUpperCase();
  document.getElementById('sidebarAvatar').textContent = initials;
  document.getElementById('sidebarUserName').textContent = currentUser.full_name;
  document.getElementById('sidebarUserRole').textContent = currentUser.role.replace('_', ' ');
  document.getElementById('sidebarOrgName').textContent = currentOrg ? currentOrg.name : '';
  var isAdmin = ['org_admin','superadmin','manager'].includes(currentUser.role);
  document.getElementById('adminNav').style.display = isAdmin ? 'block' : 'none';
  pageHistory = [];
  navTo(isAdmin ? 'dashboard' : 'courses', false);
}

// ============================================
// PAGE ROUTING
// ============================================
function showPage(page) {
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  var titles = { courses:'Courses', certificates:'My Certificates', dashboard:'Dashboard', users:'Users & Invites', forge:'Course Forge', settings:'Settings' };
  document.getElementById('topbarTitle').textContent = titles[page] || page;
  document.getElementById('topbarActions').innerHTML = '';
  stopSpeaking();
  if (page==='courses') renderCoursesPage();
  else if (page==='dashboard') renderDashboard();
  else if (page==='users') renderUsersPage();
  else if (page==='forge') renderForgePage();
  else if (page==='certificates') renderCertificatesPage();
  else if (page==='settings') renderSettingsPage();
}

// ============================================
// TTS / VOICE
// ============================================
function speak(text, lang) {
  if (!ttsEnabled || !speechSynth) return;
  stopSpeaking();
  var utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = langToLocale(lang || currentLang);
  utterance.rate = 0.9;
  speechSynth.speak(utterance);
}

function stopSpeaking() {
  if (speechSynth) speechSynth.cancel();
}

function langToLocale(lang) {
  var map = { en:'en-US', fr:'fr-FR', ar:'ar-SA', es:'es-ES', pt:'pt-PT', sw:'sw-KE', so:'so-SO', am:'am-ET', ha:'ha-NG', ru:'ru-RU', uk:'uk-UA', de:'de-DE' };
  return map[lang] || 'en-US';
}

function initSpeechRecognition() {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  var r = new SR();
  r.continuous = false;
  r.interimResults = false;
  r.lang = langToLocale(currentLang);
  return r;
}

// ============================================
// AI DETECTION
// ============================================
function checkAiDetection(text, timeTaken) {
  if (!text || text.length < 50) return false;
  var words = text.split(' ').length;
  var wpm = words / (timeTaken / 60000);
  var tooFast = wpm > 200 && timeTaken < 8000;
  var aiPhrases = ['it is important to note','in conclusion','furthermore','moreover','it should be noted','in summary','to summarize','as previously mentioned','it is essential to'];
  var phraseCount = aiPhrases.filter(function(p) { return text.toLowerCase().includes(p); }).length;
  return phraseCount >= 2 || tooFast;
}

function showAiWarning(containerId) {
  aiWarningCount++;
  var remaining = 3 - aiWarningCount;
  var banner = document.getElementById(containerId);
  if (!banner) return aiWarningCount >= 3;
  banner.classList.add('show');
  banner.innerHTML = '<div class="ai-warning-title">AI-Generated Response Detected</div>' +
    '<p style="font-size:13px;color:#92400e;margin:4px 0">Your response may have been AI-generated. OpsTrainer requires authentic responses.</p>' +
    '<p style="font-size:13px;color:#92400e;margin:8px 0"><strong>' + (remaining > 0 ? remaining + ' warning(s) remaining.' : 'Final warning.') + '</strong></p>' +
    '<button class="btn btn-sm" style="background:#f59e0b;color:white;margin-top:8px" onclick="clearAiWarning(\'' + containerId + '\')">I understand — let me rephrase</button>';
  return aiWarningCount >= 3;
}

function clearAiWarning(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('show');
}

// ============================================
// COURSES PAGE
// ============================================
function renderCoursesPage() {
  document.getElementById('pageContent').innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading courses...</p></div>';
  api('GET', '/courses').then(function(data) {
    if (!data.success) { document.getElementById('pageContent').innerHTML = '<div class="empty-state"><p>Failed to load courses</p></div>'; return; }
    var isIndividual = currentOrg && currentOrg.subscription_tier === 'individual';
    var all = data.courses || [];
    var orgCourses = all.filter(function(c) { return !c.is_platform_course; });
    var platformCourses = all.filter(function(c) { return c.is_platform_course; });
    var html = '';
    if (!isIndividual) {
      html += '<div class="course-tabs">';
      html += '<button class="course-tab-btn ' + (courseFilter==='org'?'active':'') + '" onclick="setCourseFilter(\'org\')">My Org Courses</button>';
      html += '<button class="course-tab-btn ' + (courseFilter==='platform'?'active':'') + '" onclick="setCourseFilter(\'platform\')">OpsTrainer Courses</button>';
      html += '</div>';
    }
    var toShow = isIndividual ? platformCourses : (courseFilter==='org' ? orgCourses : platformCourses);
    if (!toShow.length) {
      html += '<div class="empty-state"><div class="empty-icon">📚</div><p>' + (courseFilter==='org' ? 'No org courses yet. Use Course Forge to create one.' : 'No platform courses available yet.') + '</p></div>';
      document.getElementById('pageContent').innerHTML = html; return;
    }
    html += '<div class="courses-grid">';
    toShow.forEach(function(c) {
      var tc = c.is_platform_course ? 'platform' : (c.forge_generated ? 'forge' : '');
      var prog = c.progress_pct || 0;
      html += '<div class="course-card" onclick="openCourse(\'' + c.id + '\')">';
      html += '<div class="course-card-thumb ' + tc + '"></div><div class="course-card-body">';
      html += '<div class="course-card-badges">';
      if (c.is_platform_course) html += '<span class="badge badge-purple">OpsTrainer</span>';
      if (c.forge_generated) html += '<span class="badge badge-success">AI Generated</span>';
      html += '<span class="badge badge-gray">' + esc(c.difficulty||'beginner') + '</span>';
      if (c.is_enrolled) html += '<span class="badge badge-primary">Enrolled</span>';
      html += '</div>';
      html += '<div class="course-card-title">' + esc(c.title) + '</div>';
      html += '<div class="course-card-desc">' + esc(c.description||'') + '</div>';
      html += '<div class="course-card-meta"><span>' + (c.estimated_hours||1) + 'h</span><span>' + (c.language||'en').toUpperCase() + '</span></div>';
      if (c.is_enrolled) html += '<div class="progress-bar"><div class="progress-bar-fill" style="width:' + prog + '%"></div></div>';
      html += '</div></div>';
    });
    html += '</div>';
    document.getElementById('pageContent').innerHTML = html;
  });
}

function setCourseFilter(f) { courseFilter = f; renderCoursesPage(); }

// ============================================
// COURSE VIEWER
// ============================================
function openCourse(id) {
  api('GET', '/courses/' + id).then(function(data) {
    if (!data.success) { alert('Course not found'); return; }
    var course = data.course, modules = data.modules, enrolment = data.enrolment;
    if (!enrolment) api('POST', '/courses/' + id + '/enrol');
    aiWarningCount = 0;
    var html = '<div class="course-viewer">';
    html += '<div class="course-nav" id="courseNav">';
    html += '<div class="course-nav-header"><div class="course-nav-title">' + esc(course.title) + '</div>';
    html += '<button class="btn btn-ghost btn-sm mt-2" onclick="toggleCourseNav()" style="font-size:11px">Hide menu</button></div>';
    modules.forEach(function(mod, mi) {
      html += '<div class="module-item"><div class="module-header"><div class="module-num">' + (mi+1) + '</div>' + esc(mod.title) + '</div>';
      html += '<div class="lesson-list">';
      (mod.lessons || []).forEach(function(lesson) {
        html += '<div class="lesson-item" id="li-' + lesson.id + '" onclick="openAiLesson(\'' + course.id + '\',\'' + mod.id + '\',\'' + lesson.id + '\')">';
        html += '<span class="lesson-check" id="lc-' + lesson.id + '">○</span>' + esc(lesson.title) + '</div>';
      });
      html += '</div></div>';
    });
    html += '</div>';
    html += '<div class="course-main" id="courseMain"><div class="empty-state"><div class="empty-icon">👈</div><p>Select a lesson to begin</p></div></div>';
    html += '</div>';
    document.getElementById('topbarTitle').textContent = esc(course.title);
    document.getElementById('topbarActions').innerHTML = '<button class="btn btn-secondary btn-sm" onclick="navTo(\'courses\')">Back to Courses</button>';
    document.getElementById('pageContent').innerHTML = html;
    var backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.classList.remove('show');
  });
}

function toggleCourseNav() {
  var nav = document.getElementById('courseNav');
  if (nav) nav.classList.toggle('hidden-nav');
}

function openAiLesson(courseId, moduleId, lessonId) {
  document.querySelectorAll('.lesson-item').forEach(function(l) { l.classList.remove('active'); });
  var el = document.getElementById('li-' + lessonId);
  if (el) el.classList.add('active');
  document.getElementById('courseMain').innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading...</p></div>';
  api('GET', '/courses/' + courseId + '/modules/' + moduleId + '/lessons/' + lessonId).then(function(ld) {
    if (!ld.success) { document.getElementById('courseMain').innerHTML = '<div class="empty-state"><p>Lesson not found</p></div>'; return; }
    renderAiLesson(courseId, moduleId, lessonId, ld.lesson);
  });
}

function renderAiLesson(courseId, moduleId, lessonId, lesson) {
  stopSpeaking();
  var content = lesson.content_html || '<p>No content available.</p>';
  var chunks = splitIntoChunks(content);
  var currentChunk = 0;
  var chatHistory = [];

  function renderChunk(idx) {
    var isLast = idx >= chunks.length - 1;
    var html = '<div class="ai-lesson-container">';
    html += '<div class="tts-controls">';
    html += '<span style="font-size:12px;font-weight:600;color:var(--gray-600)">OpsTrainer AI</span>';
    html += '<button class="btn btn-sm btn-ghost" onclick="toggleTTS()" id="ttsToggleBtn">' + (ttsEnabled ? 'Voice On' : 'Voice Off') + '</button>';
    html += '<select id="langSelect" onchange="changeLang(this.value)" style="font-size:12px;padding:4px 8px;border:1px solid var(--gray-300);border-radius:4px">';
    Object.keys(LANGUAGES).forEach(function(code) {
      html += '<option value="' + code + '"' + (currentLang===code?' selected':'') + '>' + LANGUAGES[code] + '</option>';
    });
    html += '</select></div>';
    html += '<div class="ai-warning-banner" id="aiWarningBanner"></div>';
    html += '<div class="ai-chunk"><div class="ai-chunk-header"><div class="ai-avatar">🤖</div><div class="ai-name">OpsTrainer</div></div>';
    html += '<div class="ai-chunk-content">' + chunks[idx] + '</div>';
    html += '<div class="ai-actions">';
    if (!isLast) html += '<button class="btn btn-primary btn-sm" onclick="nextChunk()">Continue</button>';
    html += '<button class="btn btn-ghost btn-sm" onclick="replayChunk()">Replay</button>';
    html += '</div></div>';
    html += '<div id="chatMessages" class="chat-messages"></div>';
    html += '<div class="chat-input-row">';
    html += '<textarea id="chatInput" class="chat-input" placeholder="Ask OpsTrainer a question..." rows="1" onfocus="responseStartTime=Date.now()"></textarea>';
    html += '<button class="voice-btn" id="voiceBtn" onclick="toggleVoiceInput()" title="Voice input">🎤</button>';
    html += '<button class="btn btn-primary btn-sm" onclick="sendChatMessage()">Send</button>';
    html += '</div>';
    if (isLast) html += '<div class="mt-4"><button class="btn btn-success" onclick="completeLesson(\'' + courseId + '\',\'' + lessonId + '\')">Mark Complete</button></div>';
    html += '</div>';
    document.getElementById('courseMain').innerHTML = html;
    if (ttsEnabled) {
      var plainText = chunks[idx].replace(/<[^>]+>/g, '');
      speak(plainText, currentLang);
    }
    // Add chat keydown handler
    var chatInput = document.getElementById('chatInput');
    if (chatInput) {
      chatInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
      });
    }
  }

  window.nextChunk = function() {
    currentChunk++;
    if (currentChunk < chunks.length) {
      renderChunk(currentChunk);
      setTimeout(function() { askComprehensionQuestion(lesson.title, chunks[currentChunk-1], chatHistory); }, 800);
    }
  };

  window.replayChunk = function() {
    var plainText = chunks[currentChunk].replace(/<[^>]+>/g, '');
    speak(plainText, currentLang);
  };

  window.sendChatMessage = function() {
    var input = document.getElementById('chatInput');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    var timeTaken = responseStartTime ? Date.now() - responseStartTime : 99999;
    input.value = '';
    var detected = checkAiDetection(text, timeTaken);
    if (detected) {
      var blocked = showAiWarning('aiWarningBanner');
      if (blocked) { addChatMessage('ai', 'You have received 3 AI detection warnings. You are blocked from completing this course.'); document.getElementById('chatInput').disabled = true; return; }
      addChatMessage('ai', 'Please rephrase your answer in your own words.');
      return;
    }
    addChatMessage('user', text);
    chatHistory.push({ role:'user', content:text });
    addChatMessage('ai', '...', 'typing-msg');
    var sysPrompt = 'You are OpsTrainer, an expert AI instructor for humanitarian workers. You are teaching "' + lesson.title + '". Respond in ' + LANGUAGES[currentLang] + '. Be concise, warm and practical. Keep responses under 100 words.';
    api('POST', '/ai/chat', { message:text, history:chatHistory.slice(-6), system_prompt:sysPrompt, language:currentLang }).then(function(data) {
      var typing = document.querySelector('.typing-msg');
      if (typing) typing.remove();
      var reply = data.success ? data.reply : 'Sorry, I had trouble responding. Please try again.';
      chatHistory.push({ role:'assistant', content:reply });
      addChatMessage('ai', reply);
      if (ttsEnabled) speak(reply, currentLang);
    });
  };

  window.toggleVoiceInput = function() {
    var btn = document.getElementById('voiceBtn');
    recognition = initSpeechRecognition();
    if (!recognition) { alert('Voice input requires Chrome browser.'); return; }
    btn.classList.add('listening');
    recognition.lang = langToLocale(currentLang);
    recognition.start();
    recognition.onresult = function(e) {
      var transcript = e.results[0][0].transcript;
      var input = document.getElementById('chatInput');
      if (input) input.value = transcript;
      btn.classList.remove('listening');
    };
    recognition.onerror = function() { btn.classList.remove('listening'); };
    recognition.onend = function() { btn.classList.remove('listening'); };
  };

  renderChunk(0);
}

function splitIntoChunks(html) {
  var sections = html.split(/(?=<h[23])/i);
  if (sections.length > 1) return sections.filter(function(s) { return s.trim(); });
  var paras = html.split(/<\/p>\s*<p/i);
  if (paras.length <= 3) return [html];
  var chunkSize = Math.ceil(paras.length / 3);
  var chunks = [];
  for (var i = 0; i < paras.length; i += chunkSize) {
    chunks.push(paras.slice(i, i+chunkSize).join('</p><p'));
  }
  return chunks;
}

function askComprehensionQuestion(lessonTitle, chunkContent, chatHistory) {
  var plainText = chunkContent.replace(/<[^>]+>/g, '').substring(0, 500);
  api('POST', '/ai/chat', {
    message: 'Ask ONE short comprehension question about this content. Keep it under 30 words.',
    history: [{ role:'user', content:'Content: ' + plainText }],
    system_prompt: 'You are OpsTrainer. Ask a single brief comprehension question. Respond in ' + LANGUAGES[currentLang] + '. Just the question, no preamble.',
    language: currentLang
  }).then(function(data) {
    if (data.success && data.reply) {
      addChatMessage('ai', data.reply);
      if (ttsEnabled) speak(data.reply, currentLang);
      chatHistory.push({ role:'assistant', content:data.reply });
    }
  });
}

function addChatMessage(role, text, extraClass) {
  var container = document.getElementById('chatMessages');
  if (!container) return;
  var div = document.createElement('div');
  div.className = 'chat-msg ' + role + (extraClass ? ' ' + extraClass : '');
  var initials = role === 'ai' ? '🤖' : (currentUser ? currentUser.full_name[0] : 'U');
  div.innerHTML = '<div class="chat-msg-avatar ' + role + '">' + initials + '</div><div class="chat-msg-bubble">' + esc(text) + '</div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function toggleTTS() {
  ttsEnabled = !ttsEnabled;
  var btn = document.getElementById('ttsToggleBtn');
  if (btn) btn.textContent = ttsEnabled ? 'Voice On' : 'Voice Off';
  if (!ttsEnabled) stopSpeaking();
}

function changeLang(lang) {
  currentLang = lang;
}

function completeLesson(courseId, lessonId) {
  if (aiWarningCount >= 3) { alert('You are blocked from completing this course due to AI detection violations.'); return; }
  api('POST', '/courses/' + courseId + '/lessons/' + lessonId + '/complete', {}).then(function() {
    var el = document.getElementById('li-' + lessonId);
    if (el) { el.classList.add('completed'); var lc = document.getElementById('lc-' + lessonId); if (lc) lc.textContent = '✓'; }
    addChatMessage('ai', 'Lesson complete! Well done. Select the next lesson when you are ready.');
    if (ttsEnabled) speak('Lesson complete! Well done.', currentLang);
  });
        }

// ============================================
// DASHBOARD
// ============================================
function renderDashboard() {
  document.getElementById('pageContent').innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading...</p></div>';
  api('GET', '/org/dashboard').then(function(data) {
    if (!data.success) { document.getElementById('pageContent').innerHTML = '<div class="empty-state"><p>Failed to load</p></div>'; return; }
    var d = data.dashboard;
    var html = '<div class="stats-grid">';
    html += statCard('👥', 'Total Users', d.users.total_users||0, (d.users.active_users||0) + ' active');
    html += statCard('📋', 'Enrolments', d.enrolments.total_enrolments||0, (d.enrolments.completed||0) + ' completed');
    html += statCard('🏆', 'Certificates', d.certificates.total_certs||0, 'issued');
    html += statCard('📚', 'Courses', d.courses.org_courses||0, 'published');
    html += statCard('✉️', 'Pending Invites', d.users.pending_invites||0, 'awaiting');
    html += '</div>';
    if (d.recent_users && d.recent_users.length) {
      html += '<div class="card"><div class="card-header"><div class="card-title">Recent Team Members</div></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead><tbody>';
      d.recent_users.forEach(function(u) {
        html += '<tr><td>' + esc(u.full_name) + '</td><td>' + esc(u.email) + '</td><td>' + esc(u.role) + '</td><td>' + fmtDate(u.created_at) + '</td></tr>';
      });
      html += '</tbody></table></div></div>';
    }
    document.getElementById('pageContent').innerHTML = html;
  });
}

function statCard(icon, label, value, meta) {
  return '<div class="stat-card"><div class="stat-icon">' + icon + '</div><div class="stat-label">' + label + '</div><div class="stat-value">' + value + '</div><div class="stat-meta">' + meta + '</div></div>';
}

// ============================================
// USERS PAGE
// ============================================
function renderUsersPage() {
  document.getElementById('topbarActions').innerHTML = '<button class="btn btn-primary btn-sm" onclick="openInviteModal()">+ Invite User</button>';
  document.getElementById('pageContent').innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading...</p></div>';
  Promise.all([api('GET', '/org/users'), api('GET', '/org/invites')]).then(function(results) {
    var uData = results[0], iData = results[1];
    var html = '<div class="card"><div class="card-header"><div class="card-title">Team Members (' + (uData.users?uData.users.length:0) + ' / ' + (uData.max_users||10) + ')</div></div>';
    html += '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th><th>Actions</th></tr></thead><tbody>';
    (uData.users || []).forEach(function(u) {
      var isSelf = u.id === currentUser.id;
      html += '<tr><td>' + esc(u.full_name) + (isSelf ? ' <span class="badge badge-primary">You</span>' : '') + '</td>';
      html += '<td>' + esc(u.email) + '</td><td>' + esc(u.role) + '</td>';
      html += '<td><span class="badge ' + (u.is_active ? 'badge-success' : 'badge-gray') + '">' + (u.is_active ? 'Active' : 'Inactive') + '</span></td>';
      html += '<td>' + (u.last_login_at ? fmtDate(u.last_login_at) : 'Never') + '</td><td>';
      if (!isSelf) {
        html += '<button class="btn btn-secondary btn-sm" onclick="toggleUserStatus(\'' + u.id + '\',' + u.is_active + ')" style="margin-right:4px">' + (u.is_active ? 'Deactivate' : 'Activate') + '</button>';
        html += '<button class="btn btn-danger btn-sm" onclick="deleteUser(\'' + u.id + '\',\'' + esc(u.full_name) + '\')">Delete</button>';
      }
      html += '</td></tr>';
    });
    html += '</tbody></table></div></div>';
    var invites = (iData.invites || []).filter(function(i) { return !i.used_at && new Date(i.expires_at) > new Date(); });
    if (invites.length) {
      html += '<div class="card"><div class="card-header"><div class="card-title">Pending Invites (' + invites.length + ')</div></div>';
      html += '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Code</th><th>Expires</th><th>Actions</th></tr></thead><tbody>';
      invites.forEach(function(inv) {
        html += '<tr><td>' + esc(inv.full_name) + '</td><td>' + esc(inv.email) + '</td><td>' + esc(inv.role) + '</td>';
        html += '<td><code style="font-size:13px;font-weight:700;letter-spacing:2px;color:var(--primary)">' + esc(inv.invite_code) + '</code></td>';
        html += '<td>' + fmtDate(inv.expires_at) + '</td><td><button class="btn btn-danger btn-sm" onclick="cancelInvite(\'' + inv.id + '\')">Cancel</button></td></tr>';
      });
      html += '</tbody></table></div></div>';
    }
    document.getElementById('pageContent').innerHTML = html;
  });
}

function toggleUserStatus(userId, cur) {
  api('PUT', '/org/users/' + userId, { is_active: !cur }).then(function(data) {
    if (data.success) renderUsersPage(); else alert(data.error);
  });
}

function deleteUser(userId, name) {
  if (!confirm('Delete ' + name + '? Cannot be undone.')) return;
  api('DELETE', '/org/users/' + userId).then(function(data) {
    if (data.success) renderUsersPage(); else alert(data.error);
  });
}

function cancelInvite(id) {
  if (!confirm('Cancel this invite?')) return;
  api('DELETE', '/org/invites/' + id).then(function(data) {
    if (data.success) renderUsersPage(); else alert(data.error);
  });
}

function openInviteModal() {
  document.getElementById('inviteModal').classList.add('show');
  document.getElementById('inviteModalForm').classList.remove('hidden');
  document.getElementById('inviteModalSuccess').classList.add('hidden');
  document.getElementById('inviteModalName').value = '';
  document.getElementById('inviteModalEmail').value = '';
  document.getElementById('inviteModalRole').value = 'learner';
  hideAlert('inviteModalAlert');
}

function closeInviteModal() {
  document.getElementById('inviteModal').classList.remove('show');
  renderUsersPage();
}

function doSendInvite() {
  hideAlert('inviteModalAlert');
  var full_name = document.getElementById('inviteModalName').value.trim();
  var email = document.getElementById('inviteModalEmail').value.trim();
  var role = document.getElementById('inviteModalRole').value;
  if (!full_name || !email) return showAlert('inviteModalAlert', 'Name and email are required', 'danger');
  api('POST', '/org/invite', { full_name:full_name, email:email, role:role }).then(function(data) {
    if (!data.success) return showAlert('inviteModalAlert', data.error, 'danger');
    document.getElementById('generatedCode').textContent = data.invite.invite_code;
    document.getElementById('invitedName').textContent = full_name;
    document.getElementById('inviteModalForm').classList.add('hidden');
    document.getElementById('inviteModalSuccess').classList.remove('hidden');
  });
}

// ============================================
// SETTINGS PAGE
// ============================================
function renderSettingsPage() {
  var isAdmin = ['org_admin','superadmin'].includes(currentUser.role);
  Promise.all([api('GET', '/auth/settings'), api('GET', '/org/me')]).then(function(results) {
    var settingsData = results[0];
    var html = '<div class="settings-grid">';
    html += '<div class="settings-nav">';
    html += '<div class="settings-nav-item ' + (settingsSection==='profile'?'active':'') + '" onclick="showSettingsSection(\'profile\')">👤 Profile</div>';
    html += '<div class="settings-nav-item ' + (settingsSection==='security'?'active':'') + '" onclick="showSettingsSection(\'security\')">🔒 Password</div>';
    html += '<div class="settings-nav-item ' + (settingsSection==='preferences'?'active':'') + '" onclick="showSettingsSection(\'preferences\')">🌍 Preferences</div>';
    if (isAdmin) html += '<div class="settings-nav-item ' + (settingsSection==='orgSettings'?'active':'') + '" onclick="showSettingsSection(\'orgSettings\')">🏢 Org Settings</div>';
    html += '</div><div>';

    // Profile
    html += '<div class="settings-panel card" id="spProfile"><div class="card-header"><div class="card-title">Profile</div></div><div class="card-body">';
    html += '<div id="profileAlert" class="alert alert-danger"></div><div id="profileSuccess" class="alert alert-success"></div>';
    html += '<div class="form-group"><label class="form-label">Full Name</label><input id="setFullName" type="text" class="form-input" value="' + esc(settingsData.user ? settingsData.user.full_name : '') + '"/></div>';
    html += '<div class="form-group"><label class="form-label">Email Address</label><input id="setEmail" type="email" class="form-input" value="' + esc(settingsData.user ? settingsData.user.email : '') + '"/></div>';
    html += '<button class="btn btn-primary mt-3" onclick="saveProfile()">Save Profile</button></div></div>';

    // Security
    html += '<div class="settings-panel card" id="spSecurity"><div class="card-header"><div class="card-title">Change Password</div></div><div class="card-body">';
    html += '<div id="secAlert" class="alert alert-danger"></div><div id="secSuccess" class="alert alert-success"></div>';
    html += '<div class="form-group"><label class="form-label">Current Password</label><input id="setCurPass" type="password" class="form-input" placeholder="..."/></div>';
    html += '<div class="form-group"><label class="form-label">New Password</label><input id="setNewPass" type="password" class="form-input" placeholder="..."/></div>';
    html += '<div class="form-group"><label class="form-label">Confirm New Password</label><input id="setConfPass" type="password" class="form-input" placeholder="..."/></div>';
    html += '<button class="btn btn-primary mt-3" onclick="savePassword()">Change Password</button></div></div>';

    // Preferences
    html += '<div class="settings-panel card" id="spPreferences"><div class="card-header"><div class="card-title">Preferences</div></div><div class="card-body">';
    html += '<div id="prefSuccess" class="alert alert-success"></div>';
    html += '<div class="form-group"><label class="form-label">Preferred Language</label><select id="setLang" class="form-select">';
    Object.keys(LANGUAGES).forEach(function(code) {
      var sel = (settingsData.settings && settingsData.settings.language === code) || currentLang === code;
      html += '<option value="' + code + '"' + (sel?' selected':'') + '>' + LANGUAGES[code] + '</option>';
    });
    html += '</select></div>';
    var ttsOn = settingsData.settings && settingsData.settings.tts_enabled !== 0;
    html += '<div class="form-group"><label class="form-label">Voice Narration (TTS)</label>';
    html += '<label style="display:flex;align-items:center;gap:8px;margin-top:8px;cursor:pointer"><input type="checkbox" id="setTTS"' + (ttsOn?' checked':'') + ' style="width:16px;height:16px"/> Enable voice narration</label>';
    html += '<p class="form-hint">OpsTrainer will read lesson content aloud in your chosen language.</p></div>';
    html += '<button class="btn btn-primary mt-3" onclick="savePreferences()">Save Preferences</button></div></div>';

    // Org Settings
    if (isAdmin) {
      html += '<div class="settings-panel card" id="spOrgSettings"><div class="card-header"><div class="card-title">Organisation Settings</div></div><div class="card-body">';
      html += '<div id="orgSetAlert" class="alert alert-danger"></div><div id="orgSetSuccess" class="alert alert-success"></div>';
      html += '<p class="text-sm text-muted mb-3">These details appear on certificates issued by your organisation.</p>';
      html += '<div class="form-group"><label class="form-label">Chief Trainer Name</label><input id="setChiefName" type="text" class="form-input" placeholder="e.g. Dr. Jane Smith"/></div>';
      html += '<div class="form-group"><label class="form-label">Chief Trainer Title</label><input id="setChiefTitle" type="text" class="form-input" placeholder="e.g. Head of Learning"/></div>';
      html += '<div class="form-group"><label class="form-label">Certificate Accent Colour</label><input id="setCertColor" type="color" class="form-input" style="height:44px;padding:4px" value="#1a56db"/></div>';
      html += '<div class="divider"></div>';
      html += '<p class="text-sm" style="color:var(--primary);font-weight:600">Premium Feature — Coming Soon</p>';
      html += '<p class="text-sm text-muted mt-2">Upload your organisation logo for white-labelled certificates. Available on Team and Enterprise plans.</p>';
      html += '<button class="btn btn-primary mt-3" onclick="saveOrgSettings()">Save Org Settings</button></div></div>';
    }

    html += '</div></div>';
    document.getElementById('pageContent').innerHTML = html;
    showSettingsSection(settingsSection);
  });
}

function showSettingsSection(section) {
  settingsSection = section;
  document.querySelectorAll('.settings-panel').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.settings-nav-item').forEach(function(n) { n.classList.remove('active'); });
  var panel = document.getElementById('sp' + section.charAt(0).toUpperCase() + section.slice(1));
  if (panel) panel.classList.add('active');
  var navItems = document.querySelectorAll('.settings-nav-item');
  navItems.forEach(function(n) {
    if (n.textContent.toLowerCase().includes(section.toLowerCase().substring(0,4))) n.classList.add('active');
  });
}

function saveProfile() {
  hideAlert('profileAlert'); hideAlert('profileSuccess');
  var full_name = document.getElementById('setFullName').value.trim();
  var email = document.getElementById('setEmail').value.trim();
  if (!full_name || !email) return showAlert('profileAlert', 'Name and email are required', 'danger');
  api('PUT', '/auth/settings', { full_name:full_name, email:email }).then(function(data) {
    if (!data.success) return showAlert('profileAlert', data.error, 'danger');
    currentUser.full_name = data.user.full_name;
    document.getElementById('sidebarUserName').textContent = data.user.full_name;
    var initials = data.user.full_name.split(' ').map(function(n) { return n[0]; }).join('').substring(0,2).toUpperCase();
    document.getElementById('sidebarAvatar').textContent = initials;
    showAlert('profileSuccess', 'Profile updated successfully', 'success');
  });
}

function savePassword() {
  hideAlert('secAlert'); hideAlert('secSuccess');
  var current_password = document.getElementById('setCurPass').value;
  var new_password = document.getElementById('setNewPass').value;
  var confirm = document.getElementById('setConfPass').value;
  if (!current_password || !new_password) return showAlert('secAlert', 'All fields are required', 'danger');
  if (new_password !== confirm) return showAlert('secAlert', 'Passwords do not match', 'danger');
  if (new_password.length < 8) return showAlert('secAlert', 'Password must be at least 8 characters', 'danger');
  api('PUT', '/auth/settings', { current_password:current_password, new_password:new_password }).then(function(data) {
    if (!data.success) return showAlert('secAlert', data.error, 'danger');
    showAlert('secSuccess', 'Password changed successfully', 'success');
    document.getElementById('setCurPass').value = '';
    document.getElementById('setNewPass').value = '';
    document.getElementById('setConfPass').value = '';
  });
}

function savePreferences() {
  var language = document.getElementById('setLang').value;
  var tts_enabled = document.getElementById('setTTS').checked;
  api('PUT', '/auth/settings', { language:language, tts_enabled:tts_enabled }).then(function(data) {
    if (!data.success) return;
    currentLang = language; ttsEnabled = tts_enabled;
    showAlert('prefSuccess', 'Preferences saved', 'success');
  });
}

function saveOrgSettings() {
  hideAlert('orgSetAlert'); hideAlert('orgSetSuccess');
  var chief_trainer_name = document.getElementById('setChiefName').value.trim();
  var chief_trainer_title = document.getElementById('setChiefTitle').value.trim();
  var certificate_accent_color = document.getElementById('setCertColor').value;
  api('PUT', '/auth/org-settings', { chief_trainer_name:chief_trainer_name, chief_trainer_title:chief_trainer_title, certificate_accent_color:certificate_accent_color }).then(function(data) {
    if (!data.success) return showAlert('orgSetAlert', data.error, 'danger');
    showAlert('orgSetSuccess', 'Organisation settings saved', 'success');
  });
      }

// ============================================
// COURSE FORGE
// ============================================
function renderForgePage() {
  forgeState = { step:1, structure:null, modulesContent:[], jobId:null, documents:[] };
  renderForgeStep();
}

function renderForgeStep() {
  var s = forgeState.step;
  var html = '<div class="forge-wizard"><div class="forge-steps">';
  var steps = ['Setup','Review','Refine','Publish'];
  steps.forEach(function(label, i) {
    var num = i + 1;
    var cls = num < s ? 'done' : (num===s ? 'active' : '');
    html += '<div class="forge-step ' + cls + '"><div class="forge-step-num">' + (num<s?'✓':num) + '</div><div class="forge-step-label">' + label + '</div></div>';
    if (i < steps.length-1) html += '<div class="forge-step-line ' + (num<s?'done':'') + '"></div>';
  });
  html += '</div>';
  if (s===1) html += renderForgeStep1();
  else if (s===2) html += renderForgeStep2();
  else if (s===3) html += renderForgeStep3();
  else if (s===4) html += renderForgeStep4();
  html += '</div>';
  document.getElementById('pageContent').innerHTML = html;
}

function renderForgeStep1() {
  var html = '<div class="card"><div class="card-header"><div class="card-title">Step 1 — Course Setup</div></div><div class="card-body">';
  html += '<div class="form-group"><label class="form-label">Course Name *</label><input id="f1Name" type="text" class="form-input" placeholder="e.g. Camp Management in Emergency Response"/></div>';
  html += '<div class="form-group"><label class="form-label">Target Audience *</label><input id="f1Audience" type="text" class="form-input" placeholder="e.g. Field coordinators with 1-2 years experience"/></div>';
  html += '<div class="form-group"><label class="form-label">Learning Outcomes *</label><div id="outcomesContainer">';
  for (var i=1; i<=4; i++) html += '<div class="outcome-row"><input type="text" class="form-input outcome-input" placeholder="Outcome ' + i + '"/><button class="outcome-remove" onclick="removeOutcome(this)">x</button></div>';
  html += '</div><button class="btn btn-ghost btn-sm mt-2" onclick="addOutcome()">+ Add Outcome</button></div>';
  html += '<div class="form-row">';
  html += '<div class="form-group"><label class="form-label">Number of Modules</label><select id="f1Modules" class="form-select"><option value="3">3</option><option value="4" selected>4</option><option value="5">5</option><option value="6">6</option><option value="8">8</option></select></div>';
  html += '<div class="form-group"><label class="form-label">Duration per Module</label><select id="f1Duration" class="form-select"><option value="30">30 min</option><option value="45">45 min</option><option value="60" selected>1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option></select></div>';
  html += '</div><div class="form-row">';
  html += '<div class="form-group"><label class="form-label">Language</label><select id="f1Language" class="form-select"><option value="en">English</option><option value="fr">French</option><option value="ar">Arabic</option><option value="es">Spanish</option><option value="pt">Portuguese</option><option value="sw">Swahili</option></select></div>';
  html += '<div class="form-group"><label class="form-label">Difficulty</label><select id="f1Difficulty" class="form-select"><option value="beginner">Beginner</option><option value="intermediate" selected>Intermediate</option><option value="advanced">Advanced</option></select></div>';
  html += '</div>';
  html += '<div class="form-group"><label class="form-label">Reference Documents (optional)</label>';
  html += '<div class="form-hint">Upload SOPs, guidelines or doctrine documents.</div>';
  html += '<div style="margin-top:8px"><input type="file" id="f1DocInput" multiple accept=".txt,.pdf,.doc,.docx" style="display:none" onchange="handleDocUpload(event)"/>';
  html += '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'f1DocInput\').click()">Attach Documents</button></div>';
  html += '<ul class="doc-list" id="docList"></ul></div>';
  html += '<div id="step1Alert" class="alert alert-danger mt-3"></div>';
  html += '<div style="margin-top:20px"><button class="btn btn-primary" id="step1Btn" onclick="submitStep1()">Generate Structure</button></div>';
  html += '</div></div>';
  return html;
}

function addOutcome() {
  var c = document.getElementById('outcomesContainer');
  var n = c.querySelectorAll('.outcome-row').length + 1;
  var r = document.createElement('div');
  r.className = 'outcome-row';
  r.innerHTML = '<input type="text" class="form-input outcome-input" placeholder="Outcome ' + n + '"/><button class="outcome-remove" onclick="removeOutcome(this)">x</button>';
  c.appendChild(r);
}

function removeOutcome(btn) {
  var rows = document.querySelectorAll('.outcome-row');
  if (rows.length <= 1) return;
  btn.parentElement.remove();
}

function handleDocUpload(e) {
  var files = Array.from(e.target.files);
  files.forEach(function(f) {
    if (!forgeState.documents.find(function(d) { return d.name === f.name; })) forgeState.documents.push(f);
  });
  renderDocList();
}

function renderDocList() {
  var list = document.getElementById('docList');
  if (!list) return;
  list.innerHTML = '';
  forgeState.documents.forEach(function(doc, i) {
    var li = document.createElement('li');
    li.innerHTML = doc.name + ' <span class="text-muted text-sm">(' + (doc.size/1024).toFixed(1) + ' KB)</span><button class="doc-remove" onclick="removeDoc(' + i + ')">x</button>';
    list.appendChild(li);
  });
}

function removeDoc(i) { forgeState.documents.splice(i, 1); renderDocList(); }

function submitStep1() {
  hideAlert('step1Alert');
  var name = document.getElementById('f1Name').value.trim();
  var audience = document.getElementById('f1Audience').value.trim();
  var outcomes = Array.from(document.querySelectorAll('.outcome-input')).map(function(i) { return i.value.trim(); }).filter(Boolean);
  var num_modules = parseInt(document.getElementById('f1Modules').value);
  var duration = parseInt(document.getElementById('f1Duration').value);
  var language = document.getElementById('f1Language').value;
  var difficulty = document.getElementById('f1Difficulty').value;
  if (!name) return showAlert('step1Alert', 'Please enter a course name', 'danger');
  if (!audience) return showAlert('step1Alert', 'Please enter the target audience', 'danger');
  if (outcomes.length < 1) return showAlert('step1Alert', 'Please enter at least one learning outcome', 'danger');
  var btn = document.getElementById('step1Btn');
  btn.disabled = true; btn.textContent = 'Generating...';
  var docPromises = forgeState.documents.map(function(doc) {
    return doc.text().then(function(t) { return '\n\n--- ' + doc.name + ' ---\n' + t.substring(0, 3000); }).catch(function() { return ''; });
  });
  Promise.all(docPromises).then(function(texts) {
    var doctrine_text = texts.join('') || null;
    return api('POST', '/forge/generate-structure', { topic:name, audience:audience, outcomes:outcomes, doctrine_text:doctrine_text, num_modules:num_modules, estimated_hours:(num_modules*duration/60).toFixed(1), language:language, difficulty:difficulty });
  }).then(function(data) {
    btn.disabled = false; btn.textContent = 'Generate Structure';
    if (!data.success) return showAlert('step1Alert', data.error || 'Generation failed', 'danger');
    forgeState.structure = data.structure; forgeState.jobId = data.job_id; forgeState.step = 2; renderForgeStep();
  });
}

function renderForgeStep2() {
  var s = forgeState.structure;
  var html = '<div class="card"><div class="card-header"><div class="card-title">Step 2 — Review Structure</div></div><div class="card-body">';
  html += '<div class="form-group"><label class="form-label">Course Title</label><input id="editTitle" type="text" class="form-input" value="' + esc(s.title) + '"/></div>';
  html += '<div class="form-group"><label class="form-label">Description</label><textarea id="editDesc" class="form-textarea">' + esc(s.description||'') + '</textarea></div>';
  html += '<div class="form-row"><div class="form-group"><label class="form-label">Category</label><input id="editCategory" type="text" class="form-input" value="' + esc(s.category||'') + '"/></div>';
  html += '<div class="form-group"><label class="form-label">Difficulty</label><select id="editDifficulty" class="form-select"><option ' + (s.difficulty==='beginner'?'selected':'') + ' value="beginner">Beginner</option><option ' + (s.difficulty==='intermediate'?'selected':'') + ' value="intermediate">Intermediate</option><option ' + (s.difficulty==='advanced'?'selected':'') + ' value="advanced">Advanced</option></select></div></div>';
  html += '<p class="text-sm text-muted mt-3 mb-3">Click a module to expand and edit lesson titles.</p>';
  (s.modules || []).forEach(function(mod, mi) {
    html += '<div class="module-review-card"><div class="module-review-header" onclick="toggleModuleReview(' + mi + ')"><div class="module-num">' + (mi+1) + '</div>';
    html += '<div class="module-review-title"><input type="text" class="form-input" id="modTitle' + mi + '" value="' + esc(mod.title) + '" onclick="event.stopPropagation()" style="font-weight:700;border:none;padding:0;background:transparent;font-size:14px;"/></div>';
    html += '<span style="color:var(--gray-400);font-size:12px">' + (mod.lessons||[]).length + ' lessons</span></div>';
    html += '<div class="module-review-body" id="modBody' + mi + '">';
    (mod.lessons || []).forEach(function(lesson, li) {
      html += '<div class="lesson-review-row"><span class="lesson-type-badge">' + (lesson.content_type||'lesson') + '</span>';
      html += '<input type="text" class="form-input" id="lessonTitle' + mi + '_' + li + '" value="' + esc(lesson.title) + '" style="flex:1;border-color:transparent;font-size:13px"/>';
      html += '<span class="text-muted text-sm">' + lesson.estimated_minutes + 'min</span></div>';
    });
    html += '</div></div>';
  });
  html += '<div id="step2Alert" class="alert alert-danger mt-3"></div>';
  html += '<div class="flex gap-2 mt-4"><button class="btn btn-secondary" onclick="forgeState.step=1;renderForgeStep()">Back</button><button class="btn btn-primary" onclick="submitStep2()">Generate Content</button></div>';
  html += '</div></div>';
  return html;
}

function toggleModuleReview(mi) { var b = document.getElementById('modBody' + mi); if (b) b.classList.toggle('open'); }

function submitStep2() {
  var s = forgeState.structure;
  s.title = document.getElementById('editTitle').value.trim() || s.title;
  s.description = document.getElementById('editDesc').value.trim() || s.description;
  s.category = document.getElementById('editCategory').value.trim() || s.category;
  s.difficulty = document.getElementById('editDifficulty').value;
  (s.modules || []).forEach(function(mod, mi) {
    var t = document.getElementById('modTitle' + mi); if (t) mod.title = t.value.trim() || mod.title;
    (mod.lessons || []).forEach(function(lesson, li) {
      var l = document.getElementById('lessonTitle' + mi + '_' + li); if (l) lesson.title = l.value.trim() || lesson.title;
    });
  });
  forgeState.structure = s; forgeState.step = 3; renderForgeStep();
  generateAllModules();
}

function generateAllModules() {
  var s = forgeState.structure;
  forgeState.modulesContent = [];
  var idx = 0;
  function next() {
    if (idx >= (s.modules||[]).length) {
      var statusEl = document.getElementById('step3Status');
      if (statusEl) statusEl.innerHTML = '<div class="alert alert-success show">All modules generated. Review below.</div>';
      var btn = document.getElementById('step3NextBtn'); if (btn) btn.disabled = false;
      return;
    }
    var mod = s.modules[idx];
    var statusEl = document.getElementById('step3Status');
    if (statusEl) statusEl.innerHTML = '<div class="alert alert-info show">Generating module ' + (idx+1) + ' of ' + s.modules.length + ': ' + esc(mod.title) + '</div>';
    api('POST', '/forge/generate-module', { job_id:forgeState.jobId, module_index:idx, module_title:mod.title, module_description:mod.description||'', lessons:mod.lessons||[], course_title:s.title, audience:s.audience||'humanitarian workers', doctrine_text:null }).then(function(data) {
      forgeState.modulesContent.push(data.success ? (data.module||data.content) : { module_title:mod.title, lessons:[], error:data.error });
      renderStep3Content();
      idx++; next();
    });
  }
  next();
}

function renderForgeStep3() {
  return '<div class="card"><div class="card-header"><div class="card-title">Step 3 — Review Content</div></div><div class="card-body"><div id="step3Status"><div class="alert alert-info show">Starting content generation...</div></div><div id="step3ModulesContent" style="margin-top:16px"></div><div class="flex gap-2 mt-4"><button class="btn btn-secondary" onclick="forgeState.step=2;renderForgeStep()">Back</button><button class="btn btn-primary" id="step3NextBtn" disabled onclick="forgeState.step=4;renderForgeStep()">Preview and Publish</button></div></div></div>';
}

function renderStep3Content() {
  var c = document.getElementById('step3ModulesContent'); if (!c) return;
  var html = '';
  forgeState.modulesContent.forEach(function(mod, mi) {
    html += '<div class="module-review-card"><div class="module-review-header" onclick="var b=document.getElementById(\'s3mod' + mi + '\');if(b)b.classList.toggle(\'open\')"><div class="module-num">' + (mi+1) + '</div><div class="module-review-title">' + esc(mod.module_title||'Module '+(mi+1)) + '</div>';
    html += mod.error ? '<span class="badge badge-warning">Error</span>' : '<span class="badge badge-success">' + (mod.lessons||[]).length + ' lessons</span>';
    html += '</div><div class="module-review-body" id="s3mod' + mi + '">';
    if (mod.error) { html += '<p class="text-sm text-muted">' + esc(mod.error) + '</p>'; }
    else { (mod.lessons||[]).forEach(function(l) { html += '<div style="padding:8px 0;border-bottom:1px solid var(--gray-100)"><strong style="font-size:13px">' + esc(l.title) + '</strong><div class="text-muted text-sm">' + (l.questions||[]).length + ' questions</div></div>'; }); }
    html += '</div></div>';
  });
  c.innerHTML = html;
}

function renderForgeStep4() {
  var s = forgeState.structure;
  var html = '<div class="card"><div class="card-header"><div class="card-title">Step 4 — Preview and Publish</div></div><div class="card-body">';
  html += '<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius);padding:20px;margin-bottom:20px">';
  html += '<h2 style="font-size:20px;font-weight:800;margin-bottom:8px">' + esc(s.title) + '</h2>';
  html += '<p style="color:var(--gray-600);margin-bottom:12px">' + esc(s.description||'') + '</p>';
  html += '<div class="flex gap-2"><span class="badge badge-gray">' + esc(s.category||'General') + '</span><span class="badge badge-gray">' + esc(s.difficulty||'intermediate') + '</span><span class="badge badge-primary">' + (s.modules||[]).length + ' modules</span></div></div>';
  (s.modules||[]).forEach(function(mod, mi) {
    var content = forgeState.modulesContent[mi];
    var lc = content ? (content.lessons||[]).length : (mod.lessons||[]).length;
    html += '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--gray-100)"><div class="module-num">' + (mi+1) + '</div><div style="flex:1"><strong style="font-size:13px">' + esc(mod.title) + '</strong><div class="text-muted text-sm">' + lc + ' lessons</div></div><span class="badge badge-success">Ready</span></div>';
  });
  html += '<div id="step4Alert" class="alert alert-danger mt-3"></div>';
  html += '<div class="alert alert-info show mt-3">Once published, this course will be immediately available to your organisation learners.</div>';
  html += '<div class="flex gap-2 mt-4"><button class="btn btn-secondary" onclick="forgeState.step=3;renderForgeStep()">Back</button><button class="btn btn-success" id="publishBtn" onclick="doPublish()">Publish Course</button></div>';
  html += '</div></div>';
  return html;
}

function doPublish() {
  hideAlert('step4Alert');
  var btn = document.getElementById('publishBtn'); btn.disabled = true; btn.textContent = 'Publishing...';
  var s = forgeState.structure;
  api('POST', '/forge/publish', { job_id:forgeState.jobId, course_data:{ title:s.title, description:s.description, category:s.category, difficulty:s.difficulty, estimated_hours:s.estimated_hours||2, language:s.language||'en' }, modules_data:forgeState.modulesContent }).then(function(data) {
    if (!data.success) { btn.disabled=false; btn.textContent='Publish Course'; return showAlert('step4Alert', data.error||'Publish failed', 'danger'); }
    document.getElementById('pageContent').innerHTML = '<div class="forge-wizard"><div class="empty-state" style="padding:60px 20px"><div class="empty-icon">🎉</div><h2 style="font-size:22px;font-weight:800;margin-bottom:8px">Course Published!</h2><p style="color:var(--gray-600);margin-bottom:24px"><strong>' + esc(s.title) + '</strong> is now live.</p><div class="flex gap-2" style="justify-content:center"><button class="btn btn-primary" onclick="navTo(\'courses\')">View Courses</button><button class="btn btn-secondary" onclick="renderForgePage()">Build Another</button></div></div></div>';
  });
    }

// ============================================
// CERTIFICATES
// ============================================
function renderCertificatesPage() {
  document.getElementById('pageContent').innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading...</p></div>';
  api('GET', '/certificates/my').then(function(data) {
    if (!data.success) { document.getElementById('pageContent').innerHTML = '<div class="empty-state"><p>Failed to load</p></div>'; return; }
    var certs = data.certificates || [];
    if (!certs.length) { document.getElementById('pageContent').innerHTML = '<div class="empty-state"><div class="empty-icon">🏆</div><p>No certificates yet. Complete a course to earn one.</p></div>'; return; }
    var html = '<div class="courses-grid">';
    certs.forEach(function(c) {
      html += '<div class="card"><div class="card-body"><div class="stat-icon">🏆</div>';
      html += '<div class="card-title" style="margin-bottom:8px">' + esc(c.course_title||'Certificate') + '</div>';
      html += '<p class="text-sm text-muted">No: <strong>' + esc(c.certificate_number) + '</strong></p>';
      html += '<p class="text-sm text-muted mt-2">Issued: ' + fmtDate(c.issued_at) + '</p>';
      html += '<div class="flex gap-2 mt-3"><a href="/api/certificates/verify/' + esc(c.certificate_number) + '" target="_blank" class="btn btn-outline btn-sm">Verify</a>';
      html += '<button class="btn btn-primary btn-sm" onclick="window.open(\'/api/certificates/download/' + c.id + '\',\'_blank\')">Download PDF</button></div>';
      html += '</div></div>';
    });
    html += '</div>';
    document.getElementById('pageContent').innerHTML = html;
  });
}

// ============================================
// UTILS
// ============================================
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(str) {
  if (!str) return '-';
  return new Date(str).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

// ============================================
// AUTO LOGIN + RESET PASSWORD HANDLER
// ============================================
(function() {
  try {
    var params = new URLSearchParams(window.location.search);
    var resetToken = params.get('token');
    if (resetToken && window.location.pathname === '/reset-password') {
      api('GET', '/auth/validate-reset-token?token=' + resetToken).then(function(valid) {
        document.getElementById('authMain').classList.add('hidden');
        document.getElementById('forgotForm').classList.add('hidden');
        document.getElementById('resetForm').classList.remove('hidden');
        if (!valid.valid) showAlert('resetAlert', 'This reset link is invalid or has expired.', 'danger');
      });
      return;
    }
    var rt = localStorage.getItem('refreshToken');
    if (!rt) return;
    api('POST', '/auth/refresh', { refreshToken: rt }).then(function(data) {
      if (!data.success) return;
      accessToken = data.accessToken;
      if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
      return api('GET', '/auth/me').then(function(me) {
        if (!me.success) return;
        currentUser = me.user;
        return Promise.all([api('GET', '/org/me'), api('GET', '/auth/settings')]).then(function(results) {
          currentOrg = results[0].success ? results[0].org : null;
          if (results[1].success && results[1].settings) {
            ttsEnabled = results[1].settings.tts_enabled !== 0;
            currentLang = results[1].settings.language || 'en';
          }
          bootApp();
        });
      });
    });
  } catch(e) {
    console.error('Init error:', e);
  }
})();
