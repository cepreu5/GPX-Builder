/* GPX конструктор - общи помощни функции: формат на числа, геометрия, съхранение. */
(function () {
  'use strict';

  var R = 6371008.8;
  var RAD = Math.PI / 180;
  var MONTHS = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];

  // Групиране с интервал за хиляди, запетая за десетична (български формат).
  function num(v, dec) {
    if (v == null || !isFinite(v)) return '-';
    dec = dec || 0;
    var neg = v < 0;
    var s = Math.abs(v).toFixed(dec);
    var parts = s.split('.');
    var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (neg ? '-' : '') + int + (parts[1] ? ',' + parts[1] : '');
  }
  function km(m, dec) {
    if (m == null || !isFinite(m)) return '-';
    return num(m / 1000, dec == null ? 1 : dec) + ' км';
  }
  function kmShort(m) { // "км 3,4" стил, без единица
    var v = m / 1000;
    return v < 0.05 ? '0' : num(v, 1);
  }
  function meters(m) { return num(Math.round(m)) + ' м'; }
  function dist(m) { return m < 1000 ? meters(m) : km(m, m < 10000 ? 2 : 1); }
  function pct(v, dec) { return num(v, dec == null ? 1 : dec) + ' %'; }
  function date(t) {
    var d = new Date(t);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function dateShort(t) {
    var d = new Date(t);
    return d.getDate() + ' ' + MONTHS[d.getMonth()];
  }
  function dateDots(t) {
    var d = new Date(t);
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function duration(ms) {
    var m = Math.floor(ms / 60000);
    return Math.floor(m / 60) + ':' + pad(m % 60) + ' ч';
  }

  // Разстояние по голямата окръжност (хаверсинус), в метри.
  function hav(lat1, lon1, lat2, lon2) {
    var dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function bearing(lat1, lon1, lat2, lon2) {
    var y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
    var x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) -
      Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }
  var DIRS = ['север', 'североизток', 'изток', 'югоизток', 'юг', 'югозапад', 'запад', 'северозапад'];
  function dirName(b) { return DIRS[Math.round(b / 45) % 8]; }

  // Натрупано разстояние по поредица точки [[lat,lon,...]].
  function cumulative(pts) {
    var c = new Float64Array(pts.length);
    for (var i = 1; i < pts.length; i++) {
      c[i] = c[i - 1] + hav(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    }
    return c;
  }
  function lengthOf(pts) {
    var s = 0;
    for (var i = 1; i < pts.length; i++) s += hav(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    return s;
  }
  function boundsOf(list) { // list от масиви точки
    var b = null;
    list.forEach(function (pts) {
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        if (!b) b = { s: p[0], n: p[0], w: p[1], e: p[1] };
        else {
          if (p[0] < b.s) b.s = p[0]; if (p[0] > b.n) b.n = p[0];
          if (p[1] < b.w) b.w = p[1]; if (p[1] > b.e) b.e = p[1];
        }
      }
    });
    return b;
  }
  // Точка на отсечката p-q, най-близка до c (в равнинни координати).
  function projectSeg(cx, cy, px, py, qx, qy) {
    var dx = qx - px, dy = qy - py;
    var l2 = dx * dx + dy * dy;
    var t = l2 ? ((cx - px) * dx + (cy - py) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var x = px + t * dx, y = py + t * dy;
    return { t: t, x: x, y: y, d2: (cx - x) * (cx - x) + (cy - y) * (cy - y) };
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function debounce(fn, ms) {
    var t;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  }
  var TR = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sht', 'ъ': 'a', 'ь': 'y', 'ю': 'yu', 'я': 'ya' };
  function slug(s) {
    var out = String(s || '').toLowerCase().split('').map(function (c) { return TR[c] != null ? TR[c] : c; }).join('');
    out = out.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return out.slice(0, 40) || 'marshrut';
  }
  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // Малко хранилище върху IndexedDB, с резерва в паметта, ако браузърът го откаже.
  var DB = (function () {
    var mem = {};
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve) {
        try {
          if (!window.indexedDB) return resolve(null);
          var rq = indexedDB.open('gpx-konstruktor', 1);
          rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
          rq.onsuccess = function () { resolve(rq.result); };
          rq.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
      return dbp;
    }
    function tx(mode, fn) {
      return open().then(function (db) {
        if (!db) return fn(null);
        return new Promise(function (resolve, reject) {
          var t = db.transaction('kv', mode);
          var st = t.objectStore('kv');
          var r = fn(st);
          t.oncomplete = function () { resolve(r ? r.result : null); };
          t.onerror = function () { reject(t.error); };
        });
      });
    }
    return {
      get: function (k) {
        return tx('readonly', function (st) { return st ? st.get(k) : { result: mem[k] }; })
          .then(function (v) { return v && v.result !== undefined && !(v instanceof Blob) && Object.keys(v).length === 1 ? v.result : v; })
          .catch(function () { return mem[k]; });
      },
      set: function (k, v) {
        mem[k] = v;
        return tx('readwrite', function (st) { if (st) st.put(v, k); return null; }).catch(function () { return null; });
      },
      del: function (k) {
        delete mem[k];
        return tx('readwrite', function (st) { if (st) st.delete(k); return null; }).catch(function () { return null; });
      }
    };
  })();

  var LS = {
    get: function (k, d) {
      try { var v = localStorage.getItem('gpxk.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem('gpxk.' + k, JSON.stringify(v)); } catch (e) { /* пълно или забранено */ } }
  };

  window.U = {
    num: num, km: km, kmShort: kmShort, meters: meters, dist: dist, pct: pct,
    date: date, dateShort: dateShort, dateDots: dateDots, duration: duration,
    hav: hav, bearing: bearing, dirName: dirName, cumulative: cumulative, lengthOf: lengthOf,
    boundsOf: boundsOf, projectSeg: projectSeg, uid: uid, esc: esc, debounce: debounce,
    slug: slug, download: download, cssVar: cssVar, DB: DB, LS: LS, RAD: RAD
  };
})();
