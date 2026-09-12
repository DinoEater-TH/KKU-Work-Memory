
    }
    return url;
  },

  get: function(action, params) {
    showLoading(true);
  get: function(action, params, opts) {
    var silent = opts && opts.silent;
    if (!silent) showLoading(true);
    return fetch(this._url(action, params))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        showLoading(false);
        if (!silent) showLoading(false);
        if (data.error && data.status === 401) {
          handleAuthError();
          throw new Error('Unauthorized');
        }
        return data;
      })
      .catch(function(e) {
        showLoading(false);
        showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', true);
        if (!silent) showLoading(false);
        if (!silent) showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', true);
        throw e;
      });
  },

  post: function(action, body) {
    showLoading(true);
  post: function(action, body, opts) {
    var silent = opts && opts.silent;
    if (!silent) showLoading(true);
    var formBody = 'action=' + action + '&token=' + encodeURIComponent(this.getToken() || '');
    formBody += '&data=' + encodeURIComponent(JSON.stringify(body));
    return fetch(CONFIG.API_URL, {
      method: 'POST',
      body: formBody
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        showLoading(false);
        if (!silent) showLoading(false);
        if (data.error && data.status === 401) {
          handleAuthError();
          throw new Error('Unauthorized');
        }
        return data;
      })
      .catch(function(e) {
        showLoading(false);
        showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', true);
        if (!silent) showLoading(false);
        if (!silent) showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', true);
        throw e;
      });
  }
};
