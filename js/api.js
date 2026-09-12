
// ============================================================
// api.js — API Helper (token injection, fetch wrapper)
// ============================================================

var API = {
  _token: null,

  setToken: function(token) {
    this._token = token;
    localStorage.setItem('kku_token', token);
  },

  getToken: function() {
    if (!this._token) {
      this._token = localStorage.getItem('kku_token');
    }
    return this._token;
  },

  clearToken: function() {
    this._token = null;
    localStorage.removeItem('kku_token');
  },

  _url: function(action, params) {
    var url = CONFIG.API_URL + '?action=' + action + '&token=' + encodeURIComponent(this.getToken() || '');
    if (params) {
      for (var k in params) {
        url += '&' + k + '=' + encodeURIComponent(params[k]);
      }
    }
    return url;
  },

  get: function(action, params) {
    showLoading(true);
    return fetch(this._url(action, params))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        showLoading(false);
        if (data.error && data.status === 401) {
          handleAuthError();
          throw new Error('Unauthorized');
        }
        return data;
      })
      .catch(function(e) {
        showLoading(false);
        showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', true);
        throw e;
      });
  },

  post: function(action, body) {
    showLoading(true);
    var formBody = 'action=' + action + '&token=' + encodeURIComponent(this.getToken() || '');
    formBody += '&data=' + encodeURIComponent(JSON.stringify(body));
    return fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        showLoading(false);
        if (data.error && data.status === 401) {
          handleAuthError();
          throw new Error('Unauthorized');
        }
        return data;
      })
      .catch(function(e) {
        showLoading(false);
        showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', true);
        throw e;
      });
  }
};
