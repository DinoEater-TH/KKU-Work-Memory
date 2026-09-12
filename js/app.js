// ============================================================
// app.js — Main Application Logic
// ============================================================

var currentScreen = null;
var currentUser = null;
var recognition = null;
var isRecording = false;
var transcript = '';
var currentProblemId = null;

// ── Init ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  initGSI();
  checkStoredToken();

  document.querySelectorAll('.btn-back').forEach(function(btn) {
    btn.addEventListener('click', function() {
      navigateTo(this.dataset.target);
    });
  });

  document.querySelectorAll('.nav-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var screen = this.dataset.screen;
      navigateTo(screen);
      document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      if (screen === 'history') loadHistory();
      if (screen === 'search') {}
      if (screen === 'profile') loadProfile();
    });
  });

  document.getElementById('btn-record').addEventListener('click', openTranscriptScreen);
  document.getElementById('btn-history').addEventListener('click', function() { navigateTo('history'); loadHistory(); });
  document.getElementById('btn-search').addEventListener('click', function() { navigateTo('search'); });
  document.getElementById('btn-knowledge').addEventListener('click', function() { navigateTo('search'); });
  document.getElementById('btn-problems').addEventListener('click', openProblemReport);

  var searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', debounce(performSearch, 400));

  document.getElementById('notif-acknowledge').addEventListener('click', acknowledgeNotif);
  document.getElementById('btn-logout').addEventListener('click', logout);

  window.addEventListener('online', function() {
    SyncWorker.flush();
  });

  setTimeout(function() {
    SyncWorker.flush();
  }, 800);

  setInterval(function() {
    SyncWorker.flush();
  }, 30000);
});

// ── Google Identity Services ──────────────────────────

function initGSI() {
  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse,
    auto_select: false,
    use_fedcm_for_prompt: false
  });

  google.accounts.id.renderButton(
    document.getElementById('gsi-button'),
    { theme: 'outline', size: 'large', width: 280, text: 'signin_with', locale: 'th' }
  );
}

function handleCredentialResponse(response) {
  var token = response.credential;
  var payload = parseJWT(token);

  if (!payload || !payload.email || !payload.email.toLowerCase().endsWith(CONFIG.ALLOWED_DOMAIN)) {
    showLoginError('เฉพาะอีเมล @kku.ac.th เท่านั้น');
    return;
  }

  API.setToken(token);
  currentUser = payload;
  document.getElementById('login-error').classList.add('hidden');
  localStorage.setItem('kku_user', JSON.stringify({ email: payload.email, name: payload.name, picture: payload.picture }));
  checkNotifications();
}

function parseJWT(token) {
  try {
    var base64Url = token.split('.')[1];
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch (e) {
    return null;
  }
}

function checkStoredToken() {
  var token = API.getToken();
  if (token) {
    var payload = parseJWT(token);
    if (payload && payload.exp && payload.exp * 1000 > Date.now()) {
      currentUser = payload;
      checkNotifications();
      return;
    }
    API.clearToken();
  }
}

function showLoginError(msg) {
  var el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function handleAuthError() {
  API.clearToken();
  currentUser = null;
  navigateTo('login');
  document.getElementById('login-error').classList.remove('hidden');
  document.getElementById('login-error').textContent = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
}

function checkNotifications() {
  API.get('checkMandatoryNotif').then(function(data) {
    if (data.hasMandatory) {
      document.getElementById('notif-title').textContent = data.notification.title;
      document.getElementById('notif-message').textContent = data.notification.message;
      navigateTo('notification');
    } else {
      navigateTo('home');
      loadEXP();
      SyncWorker.flush();
    }
  }).catch(function() {
    navigateTo('home');
    loadEXP();
    SyncWorker.flush();
  });
}

function acknowledgeNotif() {
  API.post('acknowledgeNotif', {}).then(function() {
    navigateTo('home');
    loadEXP();
  });
}

function navigateTo(screen) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  var target = document.getElementById('screen-' + screen);
  if (target) target.classList.add('active');
  currentScreen = screen;

  document.querySelectorAll('.nav-btn').forEach(function(b) {
    b.classList.remove('active');
    if (b.dataset.screen === screen) b.classList.add('active');
  });
}

function openTranscriptScreen() {
  navigateTo('transcript');
  var sc = document.getElementById('screen-transcript');
  sc.innerHTML = ''
    + '<header class="topbar">'
    + '  <button class="btn-back" data-target="home">←</button>'
    + '  <h2>บันทึกงาน</h2>'
    + '  <div style="width:40px"></div>'
    + '</header>'
    + '<div class="voice-container">'
    + '  <div class="voice-wave" id="voice-wave"></div>'
    + '  <p class="voice-hint" id="voice-hint">แตะปุ่มเพื่อพูด</p>'
    + '  <div class="voice-transcript" id="voice-transcript"></div>'
    + '  <button class="btn-mic" id="btn-mic">'
    + '    <span class="mic-icon">🎤</span>'
    + '  </button>'
    + '</div>'
    + '<div class="voice-actions hidden" id="voice-actions">'
    + '  <button class="btn btn-primary" id="btn-analyze">วิเคราะห์และยืนยัน</button>'
    + '  <button class="btn btn-outline" id="btn-rerecord">พูดใหม่</button>'
    + '</div>';

  document.querySelectorAll('.btn-back').forEach(function(btn) {
    btn.addEventListener('click', function() { navigateTo(this.dataset.target); });
  });

  document.getElementById('btn-mic').addEventListener('click', toggleRecording);
  document.getElementById('btn-rerecord').addEventListener('click', resetTranscript);
  document.getElementById('btn-analyze').addEventListener('click', analyzeTranscript);
}

function toggleRecording() {
  if (isRecording) stopRecording();
  else startRecording();
}

function startRecording() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast('เบราว์เซอร์นี้ไม่รองรับการบันทึกเสียง', true);
    return;
  }

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'th-TH';
  recognition.interimResults = true;
  recognition.continuous = true;

  recognition.onresult = function(event) {
    var interim = '';
    var finalText = '';
    for (var i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
      else interim += event.results[i][0].transcript;
    }
    transcript = (transcript + ' ' + finalText).trim();
    updateTranscriptDisplay(transcript, interim);
  };

  recognition.onerror = function(event) {
    if (event.error === 'no-speech') return;
    showToast('ไมโครโฟนผิดพลาด: ' + event.error, true);
    stopRecordingUI();
  };

  recognition.onend = function() {
    if (isRecording) recognition.start();
    else stopRecordingUI();
  };

  recognition.start();
  isRecording = true;
  document.getElementById('btn-mic').classList.add('recording');
  document.getElementById('voice-hint').textContent = 'กำลังฟัง... พูดได้เลย';
}

function stopRecording() {
  isRecording = false;
  if (recognition) recognition.stop();
}

function stopRecordingUI() {
  document.getElementById('btn-mic').classList.remove('recording');
  document.getElementById('voice-hint').textContent = 'แตะปุ่มเพื่อพูด';
  if (transcript.trim()) {
    document.getElementById('voice-actions').classList.remove('hidden');
  }
}

function updateTranscriptDisplay(finalText, interim) {
  var el = document.getElementById('voice-transcript');
  el.innerHTML = finalText + ' <span style="color:#888">' + interim + '</span>';
}

function resetTranscript() {
  transcript = '';
  document.getElementById('voice-transcript').innerHTML = '';
  document.getElementById('voice-actions').classList.add('hidden');
  document.getElementById('voice-hint').textContent = 'แตะปุ่มเพื่อพูด';
}

function analyzeTranscript() {
  var parsed = ruleBasedParse(transcript);
  showConfirmForm(parsed);
}

function ruleBasedParse(text) {
  var result = {
    date: '', startTime: '', endTime: '', location: '', category: '', title: '', description: text
  };

  var datePatterns = [
    /(\d{1,2})\s*[\/\-]\s*(\d{1,2})\s*[\/\-]\s*(\d{2,4})/g,
    /(\d{1,2})\s*(ม\.?ค|ก\.?พ|มี\.?ค|เม\.?ย|พ\.?ค|มิ\.?ย|ก\.?ค|ส\.?ค|ก\.?ย|ต\.?ค|พ\.?ย|ธ\.?ค)/i,
    /(วันนี้|เมื่อวาน|พรุ่งนี้)/i
  ];

  for (var i = 0; i < datePatterns.length; i++) {
    var match = datePatterns[i].exec(text);
    if (match) { result.date = match[0]; break; }
  }

  var timeMatch = text.match(/(\d{1,2}[:\.]\d{2})\s*(?:น\.?|ถึง)\s*(\d{1,2}[:\.]\d{2})/);
  if (timeMatch) {
    result.startTime = timeMatch[1].replace('.', ':');
    result.endTime = timeMatch[2].replace('.', ':');
  } else {
    var singleTime = text.match(/(\d{1,2}[:\.]\d{2})\s*(น\.?)?/);
    if (singleTime) result.startTime = singleTime[1].replace('.', ':');
  }

  var locMatch = text.match(/(?:ที่|ตึก|ห้อง|อาคาร|ชั้น)\s*([\u0E00-\u0E7Fa-zA-Z0-9\.\/\-]+)/);
  if (locMatch) result.location = locMatch[0];

  var categories = {
    'ถ่ายภาพ,ถ่ายรูป,รูปภาพ,กล้อง': 'ถ่ายภาพ',
    'วิดีโอ,ตัดต่อ,คลิป': 'วิดีโอ',
    'ประชุม,นัด,หารือ,อบรม': 'ประชุม',
    'เอกสาร,รายงาน,บันทึก': 'งานเอกสาร',
    'ซ่อม,แก้ไข,บำรุง,เสีย': 'ซ่อมบำรุง'
  };

  for (var ck in categories) {
    var keys = ck.split(',');
    for (var j = 0; j < keys.length; j++) {
      if (text.indexOf(keys[j]) !== -1) {
        result.category = categories[ck];
        break;
      }
    }
    if (result.category) break;
  }

  result.title = text.substring(0, 60).trim();
  return result;
}

function showConfirmForm(parsed) {
  var sc = document.getElementById('screen-transcript');
  sc.innerHTML = ''
    + '<header class="topbar">'
    + '  <button class="btn-back" data-target="home">←</button>'
    + '  <h2>ยืนยันข้อมูล</h2>'
    + '  <div style="width:40px"></div>'
    + '</header>'
    + '<form id="confirm-form" class="confirm-form">'
    + '  <div class="form-group">'
    + '    <label>ข้อความเสียง</label>'
    + '    <div class="form-transcript">' + transcript + '</div>'
    + '  </div>'
    + '  <div class="form-group">'
    + '    <label>หัวข้องาน</label>'
    + '    <input type="text" id="f-title" value="' + escapeAttr(parsed.title) + '">'
    + '  </div>'
    + '  <div class="form-row">'
    + '    <div class="form-group">'
    + '      <label>วันที่</label>'
    + '      <input type="date" id="f-date" value="' + escapeAttr(parsed.date) + '">'
    + '    </div>'
    + '    <div class="form-group">'
    + '      <label>หมวดหมู่</label>'
    + '      <select id="f-category">'
    + '        <option value="">เลือก</option>'
    + '        <option value="ถ่ายภาพ"' + (parsed.category === 'ถ่ายภาพ' ? ' selected' : '') + '>ถ่ายภาพ</option>'
    + '        <option value="วิดีโอ"' + (parsed.category === 'วิดีโอ' ? ' selected' : '') + '>วิดีโอ</option>'
    + '        <option value="ประชุม"' + (parsed.category === 'ประชุม' ? ' selected' : '') + '>ประชุม</option>'
    + '        <option value="งานเอกสาร"' + (parsed.category === 'งานเอกสาร' ? ' selected' : '') + '>งานเอกสาร</option>'
    + '        <option value="ซ่อมบำรุง"' + (parsed.category === 'ซ่อมบำรุง' ? ' selected' : '') + '>ซ่อมบำรุง</option>'
    + '      </select>'
    + '    </div>'
    + '  </div>'
    + '  <div class="form-row">'
    + '    <div class="form-group">'
    + '      <label>เวลาเริ่ม</label>'
    + '      <input type="time" id="f-start" value="' + escapeAttr(parsed.startTime) + '">'
    + '    </div>'
    + '    <div class="form-group">'
    + '      <label>เวลาสิ้นสุด</label>'
    + '      <input type="time" id="f-end" value="' + escapeAttr(parsed.endTime) + '">'
    + '    </div>'
    + '  </div>'
    + '  <div class="form-group">'
    + '    <label>สถานที่</label>'
    + '    <input type="text" id="f-location" value="' + escapeAttr(parsed.location) + '">'
    + '  </div>'
    + '  <div class="form-group">'
    + '    <label>รายละเอียด</label>'
    + '    <textarea id="f-description" rows="3">' + escapeAttr(parsed.description) + '</textarea>'
    + '  </div>'
    + '  <button type="submit" class="btn btn-primary btn-block">บันทึกงาน</button>'
    + '</form>';

  document.querySelectorAll('.btn-back').forEach(function(btn) {
    btn.addEventListener('click', function() { navigateTo(this.dataset.target); });
  });

  document.getElementById('confirm-form').addEventListener('submit', function(e) {
    e.preventDefault();
    saveWork();
  });
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function saveWork() {
  var btn = document.querySelector('#confirm-form button[type="submit"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'บันทึกแล้ว';
  }

  var data = {
    title: document.getElementById('f-title').value,
    workDate: document.getElementById('f-date').value,
    category: document.getElementById('f-category').value,
    startTime: document.getElementById('f-start').value,
    endTime: document.getElementById('f-end').value,
    location: document.getElementById('f-location').value,
    description: document.getElementById('f-description').value,
    originalTranscript: transcript
  };

  var now = new Date().toISOString();
  var localId = 'L-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  var local = {
    localId: localId,
    workId: null,
    syncStatus: 'pending',
    status: 'Recorded',
    hasEvidence: false,
    createdAt: now,
    updatedAt: now,
    title: data.title,
    workDate: data.workDate,
    category: data.category,
    startTime: data.startTime,
    endTime: data.endTime,
    location: data.location,
    description: data.description,
    originalTranscript: data.originalTranscript
  };

  WorkStore.upsertLocal(local);
  WorkStore.enqueue({
    opId: 'OP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    type: 'createWork',
    localId: localId,
    payload: data,
    attempts: 0,
    lastError: null
  });

  showToast('บันทึกบนเครื่องแล้ว — กำลังซิงค์ขึ้นเซิร์ฟเวอร์');
  transcript = '';
  navigateTo('home');
  SyncWorker.flush();
}

function syncBadgeLabel(w) {
  if (w.syncStatus === 'pending' || w.syncStatus === 'syncing') return 'รอซิงค์';
  if (w.syncStatus === 'failed') return 'ซิงค์ไม่สำเร็จ';
  return w.status || 'Recorded';
}

function syncBadgeClass(w) {
  if (w.syncStatus === 'pending' || w.syncStatus === 'syncing') return 'badge-pending';
  if (w.syncStatus === 'failed') return 'badge-failed';
  return 'badge-' + String(w.status || 'recorded').toLowerCase();
}

function renderHistoryList(items) {
  var list = document.getElementById('history-list');
  if (!items || items.length === 0) {
    list.innerHTML = '<div class="empty-state">ยังไม่มีบันทึกงาน</div>';
    return;
  }

  list.innerHTML = items.map(function(w) {
    var key = w.workId || w.localId || '';
    var safeKey = String(key).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return '<div class="list-item" onclick="viewWorkDetail(\'' + safeKey + '\')">'
      + '<div class="list-item-title">' + escapeHtml(w.title || '(ไม่มีชื่อ)') + '</div>'
      + '<div class="list-item-sub">'
      + (w.workDate || '') + ' | ' + (w.category || '') + ' | ' + (w.location || '')
      + '</div>'
      + '<div class="list-item-badge ' + syncBadgeClass(w) + '">' + escapeHtml(syncBadgeLabel(w)) + '</div>'
      + '</div>';
  }).join('');
}

function loadHistory() {
  var localItems = WorkStore.listLocal();
  renderHistoryList(localItems);
  SyncWorker.flush();

  API.get('getWorkHistory', { limit: 50 }, { silent: true }).then(function(data) {
    var merged = WorkStore.mergeWithServer(data.workLogs || []);
    renderHistoryList(merged);
  }).catch(function() {
    if (!localItems.length) {
      document.getElementById('history-list').innerHTML =
        '<div class="empty-state">โหลดประวัติไม่สำเร็จ (ยังแสดงรายการบนเครื่องถ้ามี)</div>';
    }
  });
}

function performSearch() {
  var query = document.getElementById('search-input').value.trim();
  if (query.length < 2) {
    document.getElementById('search-results').innerHTML = '';
    return;
  }

  API.get('searchKnowledge', { query: query }).then(function(data) {
    var el = document.getElementById('search-results');
    if (!data.results || data.results.length === 0) {
      el.innerHTML = '<div class="empty-state">ไม่พบผลลัพธ์</div>';
      return;
    }

    el.innerHTML = data.results.map(function(r) {
      var solutionsHtml = r.solutions.map(function(s) {
        return '<div class="solution-item">💡 ' + escapeHtml(s.description) + '</div>';
      }).join('');
      return '<div class="list-item" onclick="viewProblemDetail(\'' + r.problemId + '\')">'
        + '<div class="list-item-title">🔧 ' + escapeHtml(r.title) + '</div>'
        + '<div class="list-item-sub">' + escapeHtml(r.description || '').substring(0, 80) + '</div>'
        + solutionsHtml
        + '</div>';
    }).join('');
  });
}

function viewProblemDetail(problemId) {
  currentProblemId = problemId;
  API.get('getSolutions', { problemId: problemId }).then(function(data) {
    var el = document.getElementById('problem-detail-content');

    var solutionsHtml = (data.solutions || []).map(function(s) {
      return '<div class="solution-card">'
        + '<p>' + escapeHtml(s.description) + '</p>'
        + '<div class="feedback-btns">'
        + '  <button class="btn-fb positive" onclick="giveFeedback(\'' + s.solutionId + '\',\'Positive\')">👍 มีประโยชน์</button>'
        + '  <button class="btn-fb negative" onclick="giveFeedback(\'' + s.solutionId + '\',\'Negative\')">👎 ไม่ช่วย</button>'
        + '</div>'
        + '<div id="fb-' + s.solutionId + '" class="feedback-result"></div>'
        + '</div>';
    }).join('');

    el.innerHTML = ''
      + '<button class="btn btn-outline btn-sm" onclick="openAddSolution()">+ เพิ่มวิธีแก้</button>'
      + '<div class="solutions-list">' + solutionsHtml + '</div>';

    navigateTo('problem-detail');

    (data.solutions || []).forEach(function(s) {
      API.get('getFeedback', { solutionId: s.solutionId }).then(function(fb) {
        var fbEl = document.getElementById('fb-' + s.solutionId);
        if (fbEl) fbEl.textContent = '👍 ' + fb.positive + ' | 👎 ' + fb.negative;
      });
    });
  });
}

function giveFeedback(solutionId, type) {
  API.post('submitFeedback', {
    solutionId: solutionId,
    problemId: currentProblemId,
    feedbackType: type
  }).then(function(res) {
    if (res.success) {
      showToast('ขอบคุณสำหรับความคิดเห็น!');
      viewProblemDetail(currentProblemId);
      loadEXP();
    } else {
      showToast(res.message || 'ไม่สามารถส่งความคิดเห็นได้', true);
    }
  });
}

function openAddSolution() {
  var desc = prompt('วิธีแก้ไข:');
  if (!desc || !desc.trim()) return;

  API.post('addSolution', { problemId: currentProblemId, description: desc.trim() }).then(function(res) {
    if (res.success) {
      showToast('เพิ่มวิธีแก้แล้ว!');
      viewProblemDetail(currentProblemId);
    } else {
      showToast(res.message || 'ไม่สามารถเพิ่มได้', true);
    }
  });
}

function openProblemReport() {
  var title = prompt('หัวข้อปัญหา:');
  if (!title || !title.trim()) return;
  var desc = prompt('รายละเอียด (optional):');

  API.post('reportProblem', { title: title.trim(), description: (desc || '').trim() }).then(function(res) {
    if (res.success) showToast('รายงานปัญหาแล้ว!');
    else showToast(res.message || 'ไม่สามารถบันทึกได้', true);
  });
}

function loadProfile() {
  API.get('getEXP').then(function(expData) {
    var stored = localStorage.getItem('kku_user');
    var user = stored ? JSON.parse(stored) : {};
    var el = document.getElementById('profile-content');

    var txHtml = '';
    if (expData.recentTransactions) {
      txHtml = '<h3>ธุรกรรมล่าสุด</h3>'
        + expData.recentTransactions.map(function(tx) {
          return '<div class="tx-item">'
            + '<span class="tx-action">' + tx.action + '</span>'
            + '<span class="tx-amount ' + (tx.amount > 0 ? 'positive' : 'negative') + '">'
            + (tx.amount > 0 ? '+' : '') + tx.amount + '</span>'
            + '</div>';
        }).join('');
    }

    el.innerHTML = ''
      + '<div class="profile-header">'
      + '  <div class="profile-avatar">' + (user.name ? user.name.charAt(0) : '?') + '</div>'
      + '  <h2>' + escapeHtml(user.name || 'ผู้ใช้') + '</h2>'
      + '  <p class="profile-email">' + escapeHtml(user.email || '') + '</p>'
      + '</div>'
      + '<div class="exp-card">'
      + '  <div class="exp-number">' + (expData.exp || 0) + '</div>'
      + '  <div class="exp-label">EXP</div>'
      + '</div>'
      + txHtml;

    document.getElementById('exp-badge').textContent = (expData.exp || 0) + ' EXP';
  });
}

function loadEXP() {
  API.get('getEXP').then(function(data) {
    document.getElementById('exp-badge').textContent = (data.exp || 0) + ' EXP';
  });
}

function logout() {
  API.clearToken();
  currentUser = null;
  localStorage.removeItem('kku_user');
  google.accounts.id.disableAutoSelect();
  navigateTo('login');
}

function viewWorkDetail(id) {
  var local = null;
  if (id && String(id).indexOf('L-') === 0) local = WorkStore.getByLocalId(id);
  else local = WorkStore.getByWorkId(id);

  function showDetail(w, syncNote) {
    alert([
      'หัวข้อ: ' + (w.title || '-'),
      'วันที่: ' + (w.workDate || '-'),
      'เวลา: ' + (w.startTime || '-') + ' - ' + (w.endTime || '-'),
      'สถานที่: ' + (w.location || '-'),
      'หมวดหมู่: ' + (w.category || '-'),
      'รายละเอียด: ' + (w.description || '-'),
      'สถานะ: ' + (w.status || '-'),
      syncNote ? 'ซิงค์: ' + syncNote : ''
    ].filter(Boolean).join('\n'));
  }

  if (local && (!local.workId || local.syncStatus === 'pending' || local.syncStatus === 'failed')) {
    showDetail(local, syncBadgeLabel(local));
    return;
  }

  var workId = (local && local.workId) || id;
  if (!workId || String(workId).indexOf('L-') === 0) {
    if (local) showDetail(local, syncBadgeLabel(local));
    else showToast('ไม่พบรายการ', true);
    return;
  }

  API.get('getWorkDetail', { workId: workId }).then(function(w) {
    showDetail(w, local ? syncBadgeLabel(local) : 'ซิงค์แล้ว');
  });
}

function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(msg, isError) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + (isError ? 'toast-error' : 'toast-success');
  el.classList.remove('hidden');
  setTimeout(function() { el.classList.add('hidden'); }, 3000);
}

function showLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
}

function debounce(fn, delay) {
  var timer;
  return function() {
    var ctx = this, args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(ctx, args); }, delay);
  };
}
