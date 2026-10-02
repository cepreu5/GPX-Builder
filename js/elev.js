/* CX Tracks - надморска височина: пре-пробонасяне през ~50 м, Open-Meteo
   (резерва OpenTopoData), изглаждане, изкачване, спускане и наклон. */
(function () {
  'use strict';

  var U = window.U;
  var STEP = 50;
  var cache = new Map(); // "lat,lon" (5 знака) -> височина
  var loaded = false;
  var saveLater = U.debounce(function () {
    var obj = {};
    var n = 0;
    cache.forEach(function (v, k) { if (n++ < 60000) obj[k] = v; });
    U.DB.set('elev-cache', obj);
  }, 1500);

  function k(lat, lon) { return lat.toFixed(5) + ',' + lon.toFixed(5); }

  function loadCache() {
    if (loaded) return Promise.resolve();
    loaded = true;
    return U.DB.get('elev-cache').then(function (o) {
      if (o) Object.keys(o).forEach(function (kk) { cache.set(kk, o[kk]); });
    }).catch(function () { /* няма кеш */ });
  }

  // Точки през равни отстояния по линията.
  function resample(pts, cum, step) {
    step = step || STEP;
    var total = cum[cum.length - 1] || 0;
    var n = Math.max(2, Math.ceil(total / step) + 1);
    var out = [], j = 0;
    for (var i = 0; i < n; i++) {
      var d = Math.min(total, i * total / (n - 1));
      while (j < cum.length - 2 && cum[j + 1] < d) j++;
      var seg = cum[j + 1] - cum[j] || 1;
      var f = Math.max(0, Math.min(1, (d - cum[j]) / seg));
      var p = pts[j], q = pts[j + 1] || p;
      out.push({ d: d, lat: p[0] + f * (q[0] - p[0]), lon: p[1] + f * (q[1] - p[1]) });
    }
    return out;
  }

  function fetchJson(url, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 15000);
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { clearTimeout(t); throw e; });
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function openMeteo(batch) {
    var la = batch.map(function (p) { return p.lat.toFixed(5); }).join(',');
    var lo = batch.map(function (p) { return p.lon.toFixed(5); }).join(',');
    return fetchJson('https://api.open-meteo.com/v1/elevation?latitude=' + la + '&longitude=' + lo).then(function (j) {
      if (!j || !Array.isArray(j.elevation) || j.elevation.length !== batch.length) throw new Error('лош отговор');
      return j.elevation;
    });
  }
  function openTopo(batch) {
    var loc = batch.map(function (p) { return p.lat.toFixed(5) + ',' + p.lon.toFixed(5); }).join('|');
    return fetchJson('https://api.opentopodata.org/v1/srtm30m?locations=' + encodeURIComponent(loc)).then(function (j) {
      if (!j || !Array.isArray(j.results)) throw new Error('лош отговор');
      return j.results.map(function (r) { return r.elevation; });
    });
  }

  // Попълва височините на пробите; връща {ok, source, failed}.
  function fill(samples, onProgress) {
    return loadCache().then(function () {
      var need = [];
      var seen = {};
      samples.forEach(function (s) {
        var kk = k(s.lat, s.lon);
        if (cache.has(kk)) s.ele = cache.get(kk);
        else if (!seen[kk]) { seen[kk] = 1; need.push(s); }
      });
      if (!need.length) { assign(); return { ok: true, source: 'кеш' }; }
      var batches = [];
      for (var i = 0; i < need.length; i += 100) batches.push(need.slice(i, i + 100));
      var source = 'Open-Meteo', failed = false, done = 0;
      var chain = Promise.resolve();
      batches.forEach(function (b, bi) {
        chain = chain.then(function () {
          if (failed) return;
          var first = source === 'Open-Meteo' ? openMeteo(b) : openTopo(b);
          return first.catch(function () {
            if (source === 'Open-Meteo') { source = 'OpenTopoData'; return wait(bi ? 1100 : 0).then(function () { return openTopo(b); }); }
            throw new Error('няма отговор');
          }).then(function (els) {
            b.forEach(function (s, ii) { if (els[ii] != null && isFinite(els[ii])) cache.set(k(s.lat, s.lon), els[ii]); });
            done += b.length;
            if (onProgress) onProgress(done / need.length);
            if (source === 'OpenTopoData') return wait(1100);
          }).catch(function () { failed = true; });
        });
      });
      return chain.then(function () {
        saveLater();
        assign();
        var missing = samples.filter(function (s) { return s.ele == null; }).length;
        return { ok: missing === 0, source: source, failed: failed, missing: missing };
      });
      function assign() {
        samples.forEach(function (s) { var v = cache.get(k(s.lat, s.lon)); if (v != null) s.ele = v; });
      }
    });
  }

  // Плъзгаща се средна - махаме шума на DEM преди изкачването.
  function smooth(vals, win) {
    var out = new Array(vals.length), h = Math.floor(win / 2);
    for (var i = 0; i < vals.length; i++) {
      var s = 0, n = 0;
      for (var j = Math.max(0, i - h); j <= Math.min(vals.length - 1, i + h); j++) {
        if (vals[j] != null) { s += vals[j]; n++; }
      }
      out[i] = n ? s / n : null;
    }
    return out;
  }

  // Профил от пробите: изгладени височини, изкачване, спускане, наклон по участъци.
  function profile(samples) {
    // Празни стойности - запълваме линейно от съседите.
    var raw = samples.map(function (s) { return s.ele == null ? null : s.ele; });
    var any = raw.some(function (v) { return v != null; });
    if (!any) return null;
    for (var i = 0; i < raw.length; i++) {
      if (raw[i] != null) continue;
      var a = i - 1; while (a >= 0 && raw[a] == null) a--;
      var b = i + 1; while (b < raw.length && raw[b] == null) b++;
      raw[i] = a < 0 ? raw[b] : b >= raw.length ? raw[a] : raw[a] + (raw[b] - raw[a]) * (i - a) / (b - a);
    }
    var sm = smooth(raw, 5);
    var up = 0, down = 0;
    for (i = 1; i < sm.length; i++) {
      var dd = sm[i] - sm[i - 1];
      if (dd > 0) up += dd; else down -= dd;
    }
    // Наклон по участъци от около 250 м.
    var total = samples[samples.length - 1].d;
    var bucket = total > 20000 ? 500 : 250;
    var grades = [];
    var j0 = 0;
    for (i = 1; i < samples.length; i++) {
      if (samples[i].d - samples[j0].d >= bucket || i === samples.length - 1) {
        var run = samples[i].d - samples[j0].d;
        if (run > 30) grades.push({ d0: samples[j0].d, d1: samples[i].d, g: (sm[i] - sm[j0]) / run * 100 });
        j0 = i;
      }
    }
    var maxUp = 0, maxDown = 0;
    grades.forEach(function (g) { if (g.g > maxUp) maxUp = g.g; if (-g.g > maxDown) maxDown = -g.g; });
    var min = Infinity, max = -Infinity;
    sm.forEach(function (v) { if (v < min) min = v; if (v > max) max = v; });
    return {
      d: samples.map(function (s) { return s.d; }), ele: sm, up: up, down: down,
      min: min, max: max, grades: grades, maxUp: maxUp, maxDown: maxDown, total: total,
      avgUp: total ? up / total * 100 : 0
    };
  }

  // Височина по разстояние от профила (за износа в GPX).
  function eleAt(prof, d) {
    if (!prof) return null;
    var ds = prof.d, lo = 0, hi = ds.length - 1;
    if (d <= ds[0]) return prof.ele[0];
    if (d >= ds[hi]) return prof.ele[hi];
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (ds[m] <= d) lo = m; else hi = m; }
    var f = (d - ds[lo]) / ((ds[hi] - ds[lo]) || 1);
    return prof.ele[lo] + f * (prof.ele[hi] - prof.ele[lo]);
  }

  window.Elev = { resample: resample, fill: fill, profile: profile, eleAt: eleAt, STEP: STEP, cacheKey: k, cache: cache, loadCache: loadCache };
})();
