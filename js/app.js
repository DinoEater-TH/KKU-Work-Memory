// ============================================================
// app.js — Main Application Logic
// ============================================================

var currentScreen = null;
var currentUser = null;
var recognition = null;
var isRecording = false;
var transcript = '';
var currentProblemId = null;

document.addEventListener('DOMContentLoaded', function() {
  waitForGoogleIdentity();
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

      if (screen === 'history') loadHistory();
      if (screen === 'profile') loadProfile();
    });
  });

  document.getElementById('btn-record').addEventListener('click', openTranscriptScreen);

  document.getElementById('btn-history').addEventListener('click', function() {
    navigateTo('history');
    loadHistory();
  });

  document.getElementById('btn-search').addEventListener('click', function() {
    navigateTo('search');
  });

  document.getElementById('btn-knowledge').addEventListener('click', function() {
    navigateTo('search');
  });

  document.getElementById('btn-problems').addEventListener('click', openProblemReport);

  var searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', debounce(performSearch, 400));

  document.getElementById('notif-acknowledge').addEventListener('click', acknowledgeNotif);
  document.getElementById('btn-logout').addEventListener('click', logout);
});

// ── Google Login ──────────────────────────────────────
function waitForGoogleIdentity() {
  if (
    window.google &&
    google.accounts &&
    google.accounts.id
  ) {
    initGSI();
    return;
  }

  setTimeout(waitForGoogleIdentity, 100);
}

function initGSI() {
  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse,
    auto_select: false,
    use_fedcm_for_prompt: false
  });

  google.accounts.id.renderButton(
    document.getElementById('gsi-button'),
    {
      theme: 'outline',
      size: 'large',
      width: 280,
      text: 'signin_with',
      locale: 'th'
    }
  );
}

function handleCredentialResponse(response) {
  var token = response.credential;
  var payload = parseJWT(token);

  if (
    !payload ||
    !payload.email ||
    !payload.email.toLowerCase().endsWith(CONFIG.ALLOWED_DOMAIN)
  ) {
    showLoginError('เฉพาะอีเมล @kku.ac.th เท่านั้น');
    return;
  }

  API.setToken(token);
  currentUser = payload;

  document.getElementById('login-error').classList.add('hidden');

  localStorage.setItem(
    'kku_user',
    JSON.stringify({
      email: payload.email,
      name: payload.name,
      picture: payload.picture
    })
  );

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

  if (!token) return;

  var payload = parseJWT(token);

  if (payload && payload.exp && payload.exp * 1000 > Date.now()) {
    currentUser = payload;
    checkNotifications();
    return;
  }

  API.clearToken();
}

function showLoginError(message) {
  var element = document.getElementById('login-error');
  element.textContent = message;
  element.classList.remove('hidden');
}

function handleAuthError() {
  API.clearToken();
  currentUser = null;

  navigateTo('login');

  var errorElement = document.getElementById('login-error');
  errorElement.textContent = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
  errorElement.classList.remove('hidden');
}

// ── Notifications ─────────────────────────────────────

function checkNotifications() {
  API.get('checkMandatoryNotif')
    .then(function(data) {
      if (data.hasMandatory) {
        document.getElementById('notif-title').textContent =
          data.notification.title;

        document.getElementById('notif-message').textContent =
          data.notification.message;

        navigateTo('notification');
        return;
      }

      navigateTo('home');
      loadEXP();
    })
    .catch(function() {
      navigateTo('home');
      loadEXP();
    });
}

function acknowledgeNotif() {
  API.post('acknowledgeNotif', {})
    .then(function() {
      navigateTo('home');
      loadEXP();
    });
}

// ── Navigation ────────────────────────────────────────

function navigateTo(screen) {
  document.querySelectorAll('.screen').forEach(function(element) {
    element.classList.remove('active');
  });

  var target = document.getElementById('screen-' + screen);

  if (target) {
    target.classList.add('active');
  }

  currentScreen = screen;

  document.querySelectorAll('.nav-btn').forEach(function(button) {
    button.classList.remove('active');

    if (button.dataset.screen === screen) {
      button.classList.add('active');
    }
  });
}

// ── Voice Recording ───────────────────────────────────

function openTranscriptScreen() {
  navigateTo('transcript');

  var screen = document.getElementById('screen-transcript');

  screen.innerHTML = ''
    + '<header class="topbar">'
    + '  <button class="btn-back" data-target="home">←</button>'
    + '  <h2>บันทึกงาน</h2>'
    + '  <div style="width:40px"></div>'
    + '</header>'
    + '<div class="voice-container">'
    + '  <div class="voice-wave"></div>'
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

  document.querySelectorAll('.btn-back').forEach(function(button) {
    button.addEventListener('click', function() {
      navigateTo(this.dataset.target);
    });
  });

  document.getElementById('btn-mic').addEventListener('click', toggleRecording);
  document.getElementById('btn-rerecord').addEventListener('click', resetTranscript);
  document.getElementById('btn-analyze').addEventListener('click', analyzeTranscript);
}

function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

function startRecording() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast('เบราว์เซอร์นี้ไม่รองรับการบันทึกเสียง', true);
    return;
  }

  var SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  recognition = new SpeechRecognition();
  recognition.lang = 'th-TH';
  recognition.interimResults = true;
  recognition.continuous = true;

  recognition.onresult = function(event) {
    var interim = '';
    var finalText = '';

    for (var i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalText += event.results[i][0].transcript;
      } else {
        interim += event.results[i][0].transcript;
      }
    }

    transcript = (transcript + ' ' + finalText).trim();
    updateTranscriptDisplay(transcript, interim);
  };

  recognition.onerror = function(event) {
    if (event.error === 'no-speech') return;

    isRecording = false;
    showToast('ไมโครโฟนผิดพลาด: ' + event.error, true);
    stopRecordingUI();
  };

  recognition.onend = function() {
    if (isRecording) {
      recognition.start();
    } else {
      stopRecordingUI();
    }
  };

  recognition.start();
  isRecording = true;

  document.getElementById('btn-mic').classList.add('recording');
  document.getElementById('voice-hint').textContent = 'กำลังฟัง... พูดได้เลย';
}

function stopRecording() {
  isRecording = false;

  if (recognition) {
    recognition.stop();
  }
}

function stopRecordingUI() {
  var mic = document.getElementById('btn-mic');
  var hint = document.getElementById('voice-hint');

  if (mic) mic.classList.remove('recording');
  if (hint) hint.textContent = 'แตะปุ่มเพื่อพูด';

  if (transcript.trim()) {
    document.getElementById('voice-actions').classList.remove('hidden');
  }
}

function updateTranscriptDisplay(finalText, interim) {
  var element = document.getElementById('voice-transcript');

  element.innerHTML =
    escapeHtml(finalText) +
    ' <span style="color:#888">' +
    escapeHtml(interim) +
    '</span>';
}

function resetTranscript() {
  transcript = '';

  document.getElementById('voice-transcript').textContent = '';
  document.getElementById('voice-actions').classList.add('hidden');
  document.getElementById('voice-hint').textContent = 'แตะปุ่มเพื่อพูด';
}

// ── Rule-Based Analysis ───────────────────────────────

function analyzeTranscript() {
  var parsed = ruleBasedParse(transcript);
  showConfirmForm(parsed);
}

function ruleBasedParse(text) {
  var result = {
    date: '',
    startTime: '',
    endTime: '',
    location: '',
    category: '',
    title: text.substring(0, 60).trim(),
    description: text
  };

  var timeMatch = text.match(
    /(\d{1,2}[:\.]\d{2})\s*(?:น\.?|ถึง)\s*(\d{1,2}[:\.]\d{2})/
  );

  if (timeMatch) {
    result.startTime = timeMatch[1].replace('.', ':');
    result.endTime = timeMatch[2].replace('.', ':');
  } else {
    var singleTime = text.match(/(\d{1,2}[:\.]\d{2})\s*(น\.?)?/);

    if (singleTime) {
      result.startTime = singleTime[1].replace('.', ':');
    }
  }

  var locationMatch = text.match(
    /(?:ที่|ตึก|ห้อง|อาคาร|ชั้น)\s*([\u0E00-\u0E7Fa-zA-Z0-9\.\/\-]+)/
  );

  if (locationMatch) {
    result.location = locationMatch[0];
  }

  var categories = {
    'ถ่ายภาพ,ถ่ายรูป,รูปภาพ,กล้อง': 'ถ่ายภาพ',
    'วิดีโอ,ตัดต่อ,คลิป': 'วิดีโอ',
    'ประชุม,นัด,หารือ,อบรม': 'ประชุม',
    'เอกสาร,รายงาน,บันทึก': 'งานเอกสาร',
    'ซ่อม,แก้ไข,บำรุง,เสีย': 'ซ่อมบำรุง'
  };

  for (var categoryKeywords in categories) {
    var keywords = categoryKeywords.split(',');

    for (var i = 0; i < keywords.length; i++) {
      if (text.indexOf(keywords[i]) !== -1) {
        result.category = categories[categoryKeywords];
        break;
      }
    }

    if (result.category) break;
  }

  return result;
}

// ── Work Form ─────────────────────────────────────────

function showConfirmForm(parsed) {
  var screen = document.getElementById('screen-transcript');

  screen.innerHTML = ''
    + '<header class="topbar">'
    + '  <button class="btn-back" data-target="home">←</button>'
    + '  <h2>ยืนยันข้อมูล</h2>'
    + '  <div style="width:40px"></div>'
    + '</header>'
    + '<form id="confirm-form" class="confirm-form">'
    + '  <div class="form-group">'
    + '    <label>ข้อความเสียง</label>'
    + '    <div class="form-transcript">' + escapeHtml(transcript) + '</div>'
    + '  </div>'
    + '  <div class="form-group">'
    + '    <label>หัวข้องาน</label>'
    + '    <input type="text" id="f-title" value="' + escapeAttr(parsed.title) + '">'
    + '  </div>'
    + '  <div class="form-row">'
    + '    <div class="form-group">'
    + '      <label>วันที่</label>'
    + '      <input type="date" id="f-date">'
    + '    </div>'
    + '    <div class="form-group">'
    + '      <label>หมวดหมู่</label>'
    + '      <select id="f-category">'
    + '        <option value="">เลือก</option>'
    + '        <option value="ถ่ายภาพ"' + selectedOption(parsed.category, 'ถ่ายภาพ') + '>ถ่ายภาพ</option>'
    + '        <option value="วิดีโอ"' + selectedOption(parsed.category, 'วิดีโอ') + '>วิดีโอ</option>'
    + '        <option value="ประชุม"' + selectedOption(parsed.category, 'ประชุม') + '>ประชุม</option>'
    + '        <option value="งานเอกสาร"' + selectedOption(parsed.category, 'งานเอกสาร') + '>งานเอกสาร</option>'
    + '        <option value="ซ่อมบำรุง"' + selectedOption(parsed.category, 'ซ่อมบำรุง') + '>ซ่อมบำรุง</option>'
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
    + '    <textarea id="f-description" rows="3">' + escapeHtml(parsed.description) + '</textarea>'
    + '  </div>'
    + '  <button type="submit" class="btn btn-primary btn-block">บันทึกงาน</button>'
    + '</form>';

  document.querySelectorAll('.btn-back').forEach(function(button) {
    button.addEventListener('click', function() {
      navigateTo(this.dataset.target);
    });
  });

  document.getElementById('confirm-form').addEventListener('submit', function(event) {
    event.preventDefault();
    saveWork();
  });
}

function selectedOption(currentValue, expectedValue) {
  return currentValue === expectedValue ? ' selected' : '';
}

function escapeAttr(value) {
  if (!value) return '';

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function saveWork() {
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

  API.post('createWork', data)
    .then(function(result) {
      if (result.success) {
        transcript = '';
        showToast('บันทึกงานสำเร็จ');
        navigateTo('home');
        loadEXP();
        return;
      }

      showToast(result.message || 'บันทึกงานไม่สำเร็จ', true);
    });
}

// ── History ───────────────────────────────────────────

function loadHistory() {
  API.get('getWorkHistory', { limit: 50 })
    .then(function(data) {
      var list = document.getElementById('history-list');

      if (!data.workLogs || data.workLogs.length === 0) {
        list.innerHTML = '<div class="empty-state">ยังไม่มีบันทึกงาน</div>';
        return;
      }

      list.innerHTML = data.workLogs.map(function(work) {
        return ''
          + '<div class="list-item" onclick="viewWorkDetail(\'' + work.workId + '\')">'
          + '  <div class="list-item-title">' + escapeHtml(work.title || '(ไม่มีชื่อ)') + '</div>'
          + '  <div class="list-item-sub">'
          + escapeHtml(work.workDate || '')
          + ' | ' + escapeHtml(work.category || '')
          + ' | ' + escapeHtml(work.location || '')
          + '  </div>'
          + '  <div class="list-item-badge">' + escapeHtml(work.status || '') + '</div>'
          + '</div>';
      }).join('');
    });
}

function viewWorkDetail(workId) {
  API.get('getWorkDetail', { workId: workId })
    .then(function(work) {
      alert([
        'หัวข้อ: ' + (work.title || '-'),
        'วันที่: ' + (work.workDate || '-'),
        'เวลา: ' + (work.startTime || '-') + ' - ' + (work.endTime || '-'),
        'สถานที่: ' + (work.location || '-'),
        'หมวดหมู่: ' + (work.category || '-'),
        'รายละเอียด: ' + (work.description || '-'),
        'สถานะ: ' + (work.status || '-')
      ].join('\n'));
    });
}

// ── Knowledge Search ──────────────────────────────────

function performSearch() {
  var query = document.getElementById('search-input').value.trim();

  if (query.length < 2) {
    document.getElementById('search-results').innerHTML = '';
    return;
  }

  API.get('searchKnowledge', { query: query })
    .then(function(data) {
      var element = document.getElementById('search-results');

      if (!data.results || data.results.length === 0) {
        element.innerHTML = '<div class="empty-state">ไม่พบผลลัพธ์</div>';
        return;
      }

      element.innerHTML = data.results.map(function(result) {
        var solutions = result.solutions.map(function(solution) {
          return '<div class="solution-item">💡 ' + escapeHtml(solution.description) + '</div>';
        }).join('');

        return ''
          + '<div class="list-item" onclick="viewProblemDetail(\'' + result.problemId + '\')">'
          + '  <div class="list-item-title">🔧 ' + escapeHtml(result.title) + '</div>'
          + '  <div class="list-item-sub">' + escapeHtml(result.description || '').substring(0, 80) + '</div>'
          + solutions
          + '</div>';
      }).join('');
    });
}

function viewProblemDetail(problemId) {
  currentProblemId = problemId;

  API.get('getSolutions', { problemId: problemId })
    .then(function(data) {
      var element = document.getElementById('problem-detail-content');

      var solutionsHtml = (data.solutions || []).map(function(solution) {
        return ''
          + '<div class="solution-card">'
          + '  <p>' + escapeHtml(solution.description) + '</p>'
          + '  <div class="feedback-btns">'
          + '    <button class="btn-fb positive" onclick="giveFeedback(\'' + solution.solutionId + '\', \'Positive\')">👍 มีประโยชน์</button>'
          + '    <button class="btn-fb negative" onclick="giveFeedback(\'' + solution.solutionId + '\', \'Negative\')">👎 ไม่ช่วย</button>'
          + '  </div>'
          + '  <div id="fb-' + solution.solutionId + '" class="feedback-result"></div>'
          + '</div>';
      }).join('');

      element.innerHTML = ''
        + '<button class="btn btn-outline btn-sm" onclick="openAddSolution()">+ เพิ่มวิธีแก้</button>'
        + '<div class="solutions-list">' + solutionsHtml + '</div>';

      navigateTo('problem-detail');

      (data.solutions || []).forEach(function(solution) {
        API.get('getFeedback', { solutionId: solution.solutionId })
          .then(function(feedback) {
            var feedbackElement = document.getElementById('fb-' + solution.solutionId);

            if (feedbackElement) {
              feedbackElement.textContent =
                '👍 ' + feedback.positive + ' | 👎 ' + feedback.negative;
            }
          });
      });
    });
}

function giveFeedback(solutionId, type) {
  API.post('submitFeedback', {
    solutionId: solutionId,
    problemId: currentProblemId,
    feedbackType: type
  }).then(function(result) {
    if (result.success) {
      showToast('ขอบคุณสำหรับความคิดเห็น');
      viewProblemDetail(currentProblemId);
      loadEXP();
      return;
    }

    showToast(result.message || 'ไม่สามารถส่งความคิดเห็นได้', true);
  });
}

function openAddSolution() {
  var description = prompt('วิธีแก้ไข:');

  if (!description || !description.trim()) return;

  API.post('addSolution', {
    problemId: currentProblemId,
    description: description.trim()
  }).then(function(result) {
    if (result.success) {
      showToast('เพิ่มวิธีแก้แล้ว');
      viewProblemDetail(currentProblemId);
      return;
    }

    showToast(result.message || 'ไม่สามารถเพิ่มได้', true);
  });
}

// ── Problems ──────────────────────────────────────────

function openProblemReport() {
  var title = prompt('หัวข้อปัญหา:');

  if (!title || !title.trim()) return;

  var description = prompt('รายละเอียด (ไม่บังคับ):');

  API.post('reportProblem', {
    title: title.trim(),
    description: (description || '').trim()
  }).then(function(result) {
    if (result.success) {
      showToast('รายงานปัญหาแล้ว');
      return;
    }

    showToast(result.message || 'ไม่สามารถบันทึกได้', true);
  });
}

// ── Profile and EXP ───────────────────────────────────

function loadProfile() {
  API.get('getEXP')
    .then(function(expData) {
      var storedUser = localStorage.getItem('kku_user');
      var user = storedUser ? JSON.parse(storedUser) : {};
      var element = document.getElementById('profile-content');

      var transactionsHtml = '';

      if (expData.recentTransactions && expData.recentTransactions.length > 0) {
        transactionsHtml = '<h3>ธุรกรรมล่าสุด</h3>'
          + expData.recentTransactions.map(function(transaction) {
            var amount = Number(transaction.amount) || 0;

            return ''
              + '<div class="tx-item">'
              + '  <span class="tx-action">' + escapeHtml(transaction.action) + '</span>'
              + '  <span class="tx-amount ' + (amount >= 0 ? 'positive' : 'negative') + '">'
              + (amount >= 0 ? '+' : '') + amount
              + '  </span>'
              + '</div>';
          }).join('');
      }

      element.innerHTML = ''
        + '<div class="profile-header">'
        + '  <div class="profile-avatar">' + escapeHtml(user.name ? user.name.charAt(0) : '?') + '</div>'
        + '  <h2>' + escapeHtml(user.name || 'ผู้ใช้') + '</h2>'
        + '  <p class="profile-email">' + escapeHtml(user.email || '') + '</p>'
        + '</div>'
        + '<div class="exp-card">'
        + '  <div class="exp-number">' + (expData.exp || 0) + '</div>'
        + '  <div class="exp-label">EXP</div>'
        + '</div>'
        + transactionsHtml;

      document.getElementById('exp-badge').textContent =
        (expData.exp || 0) + ' EXP';
    });
}

function loadEXP() {
  API.get('getEXP')
    .then(function(data) {
      document.getElementById('exp-badge').textContent =
        (data.exp || 0) + ' EXP';
    });
}

// ── Logout ────────────────────────────────────────────

function logout() {
  API.clearToken();
  currentUser = null;

  localStorage.removeItem('kku_user');

  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.disableAutoSelect();
  }

  navigateTo('login');
}

// ── Helpers ───────────────────────────────────────────

function escapeHtml(value) {
  if (value === null || value === undefined) return '';

  var element = document.createElement('div');
  element.textContent = String(value);
  return element.innerHTML;
}

function showToast(message, isError) {
  var element = document.getElementById('toast');

  element.textContent = message;
  element.className = 'toast ' + (isError ? 'toast-error' : 'toast-success');
  element.classList.remove('hidden');

  setTimeout(function() {
    element.classList.add('hidden');
  }, 3000);
}

function showLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
}

function debounce(callback, delay) {
  var timer;

  return function() {
    var context = this;
    var args = arguments;

    clearTimeout(timer);

    timer = setTimeout(function() {
      callback.apply(context, args);
    }, delay);
  };
}
