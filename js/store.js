// ============================================================
// store.js — Local work cache + sync queue (localStorage)
// ============================================================

var WorkStore = {
  KEY_WORKS: 'kku_works',
  KEY_QUEUE: 'kku_sync_queue',

  _read: function(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch (e) {
      return [];
    }
  },

  _write: function(key, arr) {
    localStorage.setItem(key, JSON.stringify(arr));
  },

  listLocal: function() {
    return this._read(this.KEY_WORKS);
  },

  getByLocalId: function(localId) {
    var list = this._read(this.KEY_WORKS);
    for (var i = 0; i < list.length; i++) {
      if (list[i].localId === localId) return list[i];
    }
    return null;
  },

  getByWorkId: function(workId) {
    if (!workId) return null;
    var list = this._read(this.KEY_WORKS);
    for (var i = 0; i < list.length; i++) {
      if (list[i].workId === workId) return list[i];
    }
    return null;
  },

  upsertLocal: function(work) {
    var list = this._read(this.KEY_WORKS);
    var i = -1;
    for (var n = 0; n < list.length; n++) {
      if (
        (work.localId && list[n].localId === work.localId) ||
        (work.workId && list[n].workId === work.workId)
      ) {
        i = n;
        break;
      }
    }
    if (i >= 0) list[i] = work;
    else list.unshift(work);
    this._write(this.KEY_WORKS, list);
    return work;
  },

  markSynced: function(localId, workId) {
    var list = this._read(this.KEY_WORKS);
    for (var i = 0; i < list.length; i++) {
      if (list[i].localId === localId) {
        if (workId) list[i].workId = workId;
        list[i].syncStatus = 'synced';
        list[i].updatedAt = new Date().toISOString();
        break;
      }
    }
    this._write(this.KEY_WORKS, list);
  },

  markFailed: function(localId, message) {
    var list = this._read(this.KEY_WORKS);
    for (var i = 0; i < list.length; i++) {
      if (list[i].localId === localId) {
        list[i].syncStatus = 'failed';
        list[i].lastError = message || 'sync failed';
        list[i].updatedAt = new Date().toISOString();
        break;
      }
    }
    this._write(this.KEY_WORKS, list);
  },

  pendingOps: function() {
    return this._read(this.KEY_QUEUE);
  },

  enqueue: function(op) {
    var q = this._read(this.KEY_QUEUE);
    q.push(op);
    this._write(this.KEY_QUEUE, q);
  },

  updateOp: function(op) {
    var q = this._read(this.KEY_QUEUE);
    for (var i = 0; i < q.length; i++) {
      if (q[i].opId === op.opId) {
        q[i] = op;
        break;
      }
    }
    this._write(this.KEY_QUEUE, q);
  },

  dequeueDone: function(opId) {
    var q = this._read(this.KEY_QUEUE).filter(function(o) {
      return o.opId !== opId;
    });
    this._write(this.KEY_QUEUE, q);
  },

  removeLocal: function(localId) {
    var list = this._read(this.KEY_WORKS).filter(function(w) {
      return w.localId !== localId && w.workId !== localId;
    });
    this._write(this.KEY_WORKS, list);
  },

  mergeWithServer: function(serverLogs) {
    var local = this._read(this.KEY_WORKS);
    var byWorkId = {};
    var pendingOnly = [];
    var i;

    for (i = 0; i < local.length; i++) {
      if (local[i].workId) byWorkId[local[i].workId] = local[i];
      else if (local[i].syncStatus === 'pending' || local[i].syncStatus === 'failed' || local[i].syncStatus === 'syncing') {
        pendingOnly.push(local[i]);
      }
    }

    var merged = [];
    var seen = {};

    for (i = 0; i < pendingOnly.length; i++) {
      merged.push(pendingOnly[i]);
      if (pendingOnly[i].localId) seen['L:' + pendingOnly[i].localId] = true;
    }

    for (i = 0; i < (serverLogs || []).length; i++) {
      var s = serverLogs[i];
      var prev = byWorkId[s.workId];
      var row = {
        localId: prev && prev.localId ? prev.localId : null,
        workId: s.workId,
        syncStatus: 'synced',
        title: s.title,
        workDate: s.workDate,
        startTime: s.startTime,
        endTime: s.endTime,
        location: s.location,
        category: s.category,
        description: s.description,
        status: s.status,
        hasEvidence: s.hasEvidence,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt || s.createdAt
      };
      merged.push(row);
      seen['W:' + s.workId] = true;
    }

    this._write(this.KEY_WORKS, merged);
    return merged;
  }
};

var SyncWorker = {
  _busy: false,
  MAX_ATTEMPTS: 5,
  _pendingNotification: false,

  _notify: function() {
    if (this._pendingNotification) return;
    var ops = WorkStore.pendingOps();
    if (ops.length === 0) return;
    this._pendingNotification = true;
    if (typeof showToast === 'function') {
      try { showToast('กำลังซิงค์ ' + ops.length + ' รายการ...'); } catch(e){}
    }
  },

  flush: function() {
    if (this._busy) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (!API.getToken()) return;

    var ops = WorkStore.pendingOps();
    if (!ops.length) return;

    this._busy = true;
    this._runNext(ops.slice(), 0);
  },

  _actionFor: function(type) {
    if (type === 'updateWork') return 'updateWork';
    if (type === 'deleteWork') return 'deleteWork';
    return 'createWork';
  },

  _runNext: function(ops, idx) {
    var self = this;
    if (idx >= ops.length) {
      self._busy = false;
      self._pendingNotification = false;
      return;
    }

    var op = ops[idx];
    if (op.attempts >= self.MAX_ATTEMPTS) {
      WorkStore.markFailed(op.localId, op.lastError || 'เกินจำนวนครั้งที่ลอง');
      self._runNext(ops, idx + 1);
      return;
    }

    var list = WorkStore.listLocal();
    for (var i = 0; i < list.length; i++) {
      if (list[i].localId === op.localId) {
        list[i].syncStatus = 'syncing';
        WorkStore.upsertLocal(list[i]);
        break;
      }
    }

    var action = self._actionFor(op.type);
    API.post(action, op.payload, { silent: true })
      .then(function(res) {
        if (res && res.success) {
          if (op.type === 'deleteWork') {
            WorkStore.removeLocal(op.localId);
          } else {
            WorkStore.markSynced(op.localId, res.workId || null);
          }
          WorkStore.dequeueDone(op.opId);

          if (typeof showToast === 'function') {
            try { showToast('ซิงค์สำเร็จ'); } catch(e) {}
          }
          if (typeof loadEXP === 'function') {
            try { loadEXP(); } catch (e) {}
          }
          self._runNext(ops, idx + 1);
        } else {
          op.attempts = (op.attempts || 0) + 1;
          op.lastError = (res && res.message) || 'ไม่สำเร็จ';
          WorkStore.updateOp(op);
          WorkStore.markFailed(op.localId, op.lastError);
          if (typeof showToast === 'function') {
            try { showToast('ซิงค์ไม่สำเร็จ: ' + op.lastError, true); } catch(e) {}
          }
          self._busy = false;
          self._pendingNotification = false;
        }
      })
      .catch(function(err) {
        op.attempts = (op.attempts || 0) + 1;
        op.lastError = (err && err.message) || 'network';
        WorkStore.updateOp(op);
        WorkStore.markFailed(op.localId, 'รอเครือข่าย/เซิร์ฟเวอร์');
        self._busy = false;
        self._pendingNotification = false;
      });
  }
};
