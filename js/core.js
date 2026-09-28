/* GPX конструктор - ядрото: изрязване, търсене на дублиращи се участъци,
   разделяне на части, геометрия на сглобения маршрут. */
(function () {
  'use strict';

  var U = window.U;
  var MPD = 6371008.8 * Math.PI / 180; // метри на градус по меридиана
  var ROUTE_GAP = 30; // над толкова метра между две части е дупка

  // Натрупани разстояния и дължина - пазят се върху обекта, без да се записват.
  function prep(t) {
    if (!t._cum || t._cum.length !== t.pts.length) {
      t._cum = U.cumulative(t.pts);
      t.len = t._cum[t._cum.length - 1] || 0;
    }
    return t;
  }

  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    return a[a.length >> 1];
  }

  // Прагът за дупка в записа (загубен сигнал) зависи от гъстотата на точките.
  function gapLimit(t) {
    var c = t._cum, steps = [];
    var step = Math.max(1, Math.floor(c.length / 400));
    for (var i = step; i < c.length; i += step) steps.push((c[i] - c[i - step]) / step);
    return Math.max(300, median(steps) * 8);
  }

  function liveIntervals(t) {
    var cuts = (t.cuts || []).slice().sort(function (a, b) { return a.a - b.a; });
    var out = [], pos = 0;
    cuts.forEach(function (c) {
      var a = Math.max(0, c.a), b = Math.min(t.len, c.b);
      if (b <= pos) return;
      if (a > pos) out.push([pos, a]);
      pos = Math.max(pos, b);
    });
    if (pos < t.len) out.push([pos, t.len]);
    return out;
  }
  function isCut(t, d) {
    var cs = t.cuts || [];
    for (var i = 0; i < cs.length; i++) if (d >= cs[i].a && d <= cs[i].b) return true;
    return false;
  }

  function overlap(a0, a1, b0, b1) { return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)); }

  /* Анализ на колекцията. Траковете се обхождат по реда на добавяне; точка е дубликат,
     ако лежи по-близо от tol до вече приетото трасе (по-ранни тракове или по-ранна част
     от същия трак), независимо от посоката. */
  function analyze(tracks, tol, overrides) {
    tol = Math.max(1, tol || 20);
    overrides = overrides || [];
    var live = tracks.filter(function (t) { return t.pts && t.pts.length > 1; });
    live.forEach(prep);
    var lat0 = 0, cnt = 0;
    live.forEach(function (t) { lat0 += t.pts[0][0]; cnt++; });
    lat0 = cnt ? lat0 / cnt : 0;
    var kx = Math.cos(lat0 * U.RAD) * MPD, ky = MPD;
    var cell = Math.max(tol, 25) * 2;
    var grid = new Map();
    var minDup = Math.max(100, 4 * tol);
    var minGap = Math.max(60, 3 * tol);
    var lag = Math.max(300, 10 * tol);

    var result = { byTrack: {}, dups: [], parts: [], gaps: [], tol: tol };

    function key(ix, iy) { return ix * 73856093 ^ iy * 19349663; }
    function addSeg(T, j) {
      var x = T.xy, x0 = x[2 * j], y0 = x[2 * j + 1], x1 = x[2 * j + 2], y1 = x[2 * j + 3];
      var ax = Math.floor(Math.min(x0, x1) / cell), bx = Math.floor(Math.max(x0, x1) / cell);
      var ay = Math.floor(Math.min(y0, y1) / cell), by = Math.floor(Math.max(y0, y1) / cell);
      if ((bx - ax + 1) * (by - ay + 1) > 2500) return;
      for (var ix = ax; ix <= bx; ix++) for (var iy = ay; iy <= by; iy++) {
        var k = key(ix, iy), l = grid.get(k);
        if (!l) grid.set(k, l = []);
        l.push(T, j);
      }
    }
    function query(px, py) {
      var ix = Math.floor(px / cell), iy = Math.floor(py / cell);
      var best = null, bd = Infinity;
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
        var l = grid.get(key(ix + dx, iy + dy));
        if (!l) continue;
        for (var m = 0; m < l.length; m += 2) {
          var T = l[m], j = l[m + 1], x = T.xy;
          var r = U.projectSeg(px, py, x[2 * j], x[2 * j + 1], x[2 * j + 2], x[2 * j + 3]);
          if (r.d2 < bd) { bd = r.d2; best = { T: T, j: j, t: r.t }; }
        }
      }
      if (best) best.d = Math.sqrt(bd);
      return best;
    }

    live.forEach(function (t) {
      var n = t.pts.length, xy = new Float64Array(2 * n);
      for (var i = 0; i < n; i++) { xy[2 * i] = t.pts[i][1] * kx; xy[2 * i + 1] = t.pts[i][0] * ky; }
      var T = { t: t, xy: xy };
      var c = t._cum;
      var gl = gapLimit(t);
      var brk = {};
      (t.breaks || []).forEach(function (b) { brk[b] = 1; });
      var cut = new Uint8Array(n);
      for (i = 0; i < n; i++) cut[i] = isCut(t, c[i]) ? 1 : 0;
      var gapAt = new Uint8Array(n); // отсечката i..i+1 е дупка
      for (i = 0; i < n - 1; i++) if (brk[i + 1] || c[i + 1] - c[i] > gl) gapAt[i] = 1;
      function segOk(j) { return !cut[j] && !cut[j + 1] && !gapAt[j]; }

      var dup = new Uint8Array(n), mT = new Array(n), mD = new Float64Array(n);
      var nextOwn = 0;
      for (i = 0; i < n; i++) {
        while (nextOwn < i - 1 && c[i] - c[nextOwn + 1] > lag) { if (segOk(nextOwn)) addSeg(T, nextOwn); nextOwn++; }
        if (cut[i]) continue;
        var q = query(xy[2 * i], xy[2 * i + 1]);
        if (q && q.d <= tol) {
          dup[i] = 1;
          mT[i] = q.T.t;
          mD[i] = q.T.t._cum[q.j] + q.t * (q.T.t._cum[q.j + 1] - q.T.t._cum[q.j]);
        }
      }
      for (; nextOwn < n - 1; nextOwn++) if (segOk(nextOwn)) addSeg(T, nextOwn);

      // Живи отрязъци: без изрязаното, разделени на дупките в записа.
      var pieces = [], gaps = [];
      liveIntervals(t).forEach(function (iv) {
        var a = iv[0];
        for (var j = 0; j < n - 1; j++) {
          if (!gapAt[j]) continue;
          if (c[j] >= a && c[j + 1] <= iv[1]) {
            if (c[j] > a) pieces.push([a, c[j]]);
            gaps.push({ trackId: t.id, kind: 'gap', a: c[j], b: c[j + 1], len: c[j + 1] - c[j] });
            a = c[j + 1];
          }
        }
        if (iv[1] > a) pieces.push([a, iv[1]]);
      });

      var sections = [];
      pieces.forEach(function (pc) {
        // Поредици от точки вътре в отрязъка.
        var idx = [];
        for (var j = 0; j < n; j++) if (c[j] >= pc[0] && c[j] <= pc[1]) idx.push(j);
        var runs = [];
        idx.forEach(function (j, k) {
          var v = dup[j];
          var last = runs[runs.length - 1];
          if (last && last.v === v) { last.k1 = k; } else runs.push({ v: v, k0: k, k1: k });
        });
        function bounds(r, ri) {
          var a = ri === 0 ? pc[0] : (c[idx[r.k0 - 1]] + c[idx[r.k0]]) / 2;
          var b = ri === runs.length - 1 ? pc[1] : (c[idx[r.k1]] + c[idx[r.k1 + 1]]) / 2;
          return [a, b];
        }
        function merge() {
          var out = [];
          runs.forEach(function (r) {
            var last = out[out.length - 1];
            if (last && last.v === r.v) last.k1 = r.k1; else out.push({ v: r.v, k0: r.k0, k1: r.k1 });
          });
          runs = out;
        }
        // Кратки съвпадения (кръстовища) не са дубликати.
        runs.forEach(function (r, ri) { var bb = bounds(r, ri); if (r.v && bb[1] - bb[0] < minDup) r.v = 0; });
        merge();
        // Кратки различни парченца между два дубликата се сливат с тях.
        runs.forEach(function (r, ri) {
          if (r.v || ri === 0 || ri === runs.length - 1) return;
          var bb = bounds(r, ri);
          if (bb[1] - bb[0] < minGap) r.v = 1;
        });
        merge();
        // Трохи в края до дубликат също отиват към него.
        runs.forEach(function (r, ri) {
          if (r.v || runs.length < 2) return;
          if (ri !== 0 && ri !== runs.length - 1) return;
          var bb = bounds(r, ri);
          if (bb[1] - bb[0] < 40) r.v = 1;
        });
        merge();
        runs.forEach(function (r, ri) {
          var bb = bounds(r, ri);
          var s = {
            trackId: t.id, kind: r.v ? 'dup' : 'part', a: bb[0], b: bb[1], len: bb[1] - bb[0],
            key: t.id + ':' + Math.round(bb[0])
          };
          if (r.v) {
            var counts = new Map();
            for (var k = r.k0; k <= r.k1; k++) {
              var mt = mT[idx[k]];
              if (mt) counts.set(mt, (counts.get(mt) || 0) + 1);
            }
            var bestT = null, bc = -1;
            counts.forEach(function (v, kk) { if (v > bc) { bc = v; bestT = kk; } });
            var ds = [];
            for (k = r.k0; k <= r.k1; k++) if (mT[idx[k]] === bestT) ds.push(mD[idx[k]]);
            s.withId = bestT ? bestT.id : null;
            s.withA = ds.length ? Math.min.apply(null, ds) : 0;
            s.withB = ds.length ? Math.max.apply(null, ds) : 0;
            s.dir = ds.length > 1 && ds[ds.length - 1] < ds[0] ? 'обратна' : 'същата';
            s.kept = overrides.some(function (o) {
              return o.trackId === t.id && overlap(s.a, s.b, o.a, o.b) > 0.5 * Math.min(s.len, o.b - o.a);
            });
          }
          sections.push(s);
        });
      });
      (t.cuts || []).forEach(function (cu) {
        sections.push({ trackId: t.id, kind: 'cut', a: cu.a, b: cu.b, len: cu.b - cu.a, key: t.id + ':cut:' + Math.round(cu.a) });
      });
      sections.sort(function (p, q) { return p.a - q.a; });
      gaps.forEach(function (g) { sections.push(g); result.gaps.push(g); });
      result.byTrack[t.id] = sections;
      sections.forEach(function (s) {
        if (s.kind === 'dup') result.dups.push(s);
        if (s.kind === 'part' || (s.kind === 'dup' && s.kept)) result.parts.push(s);
      });
    });
    return result;
  }

  // Точка на разстояние d по трака (с интерполация).
  function pointAt(t, d) {
    prep(t);
    var c = t._cum, pts = t.pts;
    if (d <= 0) return pts[0].slice(0, 3);
    if (d >= t.len) return pts[pts.length - 1].slice(0, 3);
    var lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (c[mid] <= d) lo = mid; else hi = mid; }
    var f = (d - c[lo]) / ((c[hi] - c[lo]) || 1);
    var p = pts[lo], q = pts[hi];
    var e = p[2] != null && q[2] != null ? p[2] + f * (q[2] - p[2]) : (p[2] != null ? p[2] : q[2]);
    return [p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1]), e == null ? null : e];
  }

  // Частта от трака между разстояния a и b.
  function slice(t, a, b) {
    prep(t);
    if (b < a) { var tmp = a; a = b; b = tmp; }
    var c = t._cum, out = [pointAt(t, a)];
    for (var i = 0; i < c.length; i++) if (c[i] > a && c[i] < b) out.push(t.pts[i].slice(0, 3));
    out.push(pointAt(t, b));
    return out;
  }

  // Най-близкото място по трака до дадена точка.
  function nearestOn(pts, cum, lat, lon) {
    var kx = Math.cos(lat * U.RAD) * MPD, ky = MPD;
    var px = lon * kx, py = lat * ky;
    var best = null;
    for (var i = 0; i < pts.length - 1; i++) {
      var r = U.projectSeg(px, py, pts[i][1] * kx, pts[i][0] * ky, pts[i + 1][1] * kx, pts[i + 1][0] * ky);
      if (!best || r.d2 < best.d2) best = { d2: r.d2, i: i, t: r.t };
    }
    if (!best) return null;
    var p = pts[best.i], q = pts[best.i + 1];
    return {
      d: cum[best.i] + best.t * (cum[best.i + 1] - cum[best.i]),
      dist: Math.sqrt(best.d2), i: best.i,
      lat: p[0] + best.t * (q[0] - p[0]), lon: p[1] + best.t * (q[1] - p[1])
    };
  }
  function nearestOnTrack(t, lat, lon) { prep(t); return nearestOn(t.pts, t._cum, lat, lon); }

  // Каква част от [a,b] на трака е под дубликат (неприет) или изрязване.
  function invalidShare(item, analysis) {
    var secs = analysis.byTrack[item.trackId];
    if (!secs) return { share: 1, why: 'тракът липсва' };
    var a = Math.min(item.a, item.b), b = Math.max(item.a, item.b), len = b - a || 1;
    var dupL = 0, cutL = 0;
    secs.forEach(function (s) {
      if (s.kind === 'dup' && !s.kept) dupL += overlap(a, b, s.a, s.b);
      if (s.kind === 'cut') cutL += overlap(a, b, s.a, s.b);
    });
    // Изрязване, което засяга частта, я маркира винаги; дубликат - ако покрива осезаема част от нея.
    var bad = cutL > 20 || dupL > Math.max(100, 0.2 * len);
    return { bad: bad, share: (dupL + cutL) / len, why: cutL > 20 ? 'изрязана' : 'дубликат' };
  }

  /* Геометрия на маршрута: всяка част дава своите точки; чертаните участъци свързват
     съседите си; дупка се отчита само между две съседни части от тракове. */
  function routeGeometry(route, tracksById) {
    var items = [], all = [];
    (route.items || []).forEach(function (it, idx) {
      var pts = [];
      if (it.type === 'part') {
        var t = tracksById[it.trackId];
        if (t) {
          pts = slice(t, it.a, it.b);
          if (it.rev) pts.reverse();
        }
      } else if (it.type === 'draw') {
        pts = (it.pts || []).map(function (p) { return [p.lat, p.lon, null]; });
      }
      items.push({ idx: idx, item: it, pts: pts, missing: it.type === 'part' && !tracksById[it.trackId] });
    });
    var gaps = [];
    var prev = null;
    items.forEach(function (g) {
      if (g.item.type === 'draw') { g.connected = true; prev = g.pts.length ? g : { draw: true }; return; }
      if (!g.pts.length) return;
      if (prev && !prev.draw && prev.pts && prev.pts.length) {
        var e = prev.pts[prev.pts.length - 1], s = g.pts[0];
        var d = U.hav(e[0], e[1], s[0], s[1]);
        if (d > ROUTE_GAP) gaps.push({ beforeIdx: g.idx, afterIdx: prev.idx, d: d, from: e, to: s });
      }
      prev = g;
    });
    items.forEach(function (g) {
      g.start = all.length;
      g.pts.forEach(function (p) {
        var l = all[all.length - 1];
        if (l && Math.abs(l[0] - p[0]) < 1e-7 && Math.abs(l[1] - p[1]) < 1e-7) return;
        all.push(p);
      });
      g.end = all.length - 1;
    });
    var cum = U.cumulative(all);
    items.forEach(function (g) {
      g.len = U.lengthOf(g.pts);
      g.d0 = g.start > 0 && all.length ? cum[Math.max(0, g.start - 1)] : 0;
      g.d1 = g.end >= 0 && all.length ? cum[g.end] : 0;
    });
    return { items: items, pts: all, cum: cum, len: all.length ? cum[cum.length - 1] : 0, gaps: gaps };
  }

  function trackBounds(tracks) {
    return U.boundsOf(tracks.map(function (t) { return t.pts; }));
  }

  window.Core = {
    prep: prep, analyze: analyze, slice: slice, pointAt: pointAt, nearestOn: nearestOn,
    nearestOnTrack: nearestOnTrack, invalidShare: invalidShare, routeGeometry: routeGeometry,
    trackBounds: trackBounds, overlap: overlap, ROUTE_GAP: ROUTE_GAP
  };
})();
