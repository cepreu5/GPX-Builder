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

  // Сливане на застъпващи се отрязъци {a,b}.
  function mergeIv(list) {
    var out = [];
    list.slice().sort(function (p, q) { return p.a - q.a; }).forEach(function (x) {
      var l = out[out.length - 1];
      if (l && x.a <= l.b + 1) l.b = Math.max(l.b, x.b); else out.push({ a: x.a, b: x.b });
    });
    return out;
  }

  /* Дубликат [a,b] спрямо решенията на трака (t.skips - махнатите с маркера участъци):
     покритото е махнато ('dup'), останалото чака маркер ('pend'). Трохите се сливат. */
  function splitBySkips(skips, a, b, minDup) {
    var iv = mergeIv((skips || []).map(function (s) { return { a: Math.max(a, s.a), b: Math.min(b, s.b) }; })
      .filter(function (x) { return x.b - x.a > 0; }));
    var out = [], pos = a;
    iv.forEach(function (x) {
      if (x.a > pos) out.push({ v: 'pend', a: pos, b: x.a });
      out.push({ v: 'dup', a: x.a, b: x.b });
      pos = x.b;
    });
    if (pos < b) out.push({ v: 'pend', a: pos, b: b });
    function merge() {
      var m = [];
      out.forEach(function (x) { var l = m[m.length - 1]; if (l && l.v === x.v) l.b = x.b; else m.push(x); });
      out = m;
    }
    out.forEach(function (x) { if (x.v === 'dup' && x.b - x.a < 40) x.v = 'pend'; });
    merge();
    if (out.some(function (x) { return x.v === 'dup'; })) out.forEach(function (x) { if (x.v === 'pend' && x.b - x.a < minDup) x.v = 'dup'; });
    merge();
    return out;
  }

  /* Анализ на колекцията. Траковете се обхождат по реда на добавяне; точка е дубликат,
     ако лежи по-близо от tol до вече приетото трасе (по-ранни тракове или по-ранна част
     от същия трак), независимо от посоката. */
  function analyze(tracks, tol) {
    tol = Math.max(1, tol == null ? 20 : tol);
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

    // dups - махнатите (след клик върху маркера), pend - намерените, които чакат клик;
    // closedGaps - дупките в записа, по-къси от отклонението, затворени сами.
    var result = { byTrack: {}, dups: [], pend: [], parts: [], gaps: [], closedGaps: [], tol: tol };

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

      // Живи отрязъци: без изрязаното, разделени на дупките в записа. Дупка, по-къса от
      // отклонението, се затваря сама (освен ако е отворена пак - t.openGaps).
      var pieces = [], gaps = [];
      var reopened = t.openGaps || [];
      liveIntervals(t).forEach(function (iv) {
        var a = iv[0];
        for (var j = 0; j < n - 1; j++) {
          if (!gapAt[j]) continue;
          if (c[j] >= a && c[j + 1] <= iv[1]) {
            var glen = c[j + 1] - c[j];
            if (glen < tol && !reopened.some(function (v) { return Math.abs(v - c[j]) <= 1; })) {
              gaps.push({ trackId: t.id, kind: 'gap', closed: true, a: c[j], b: c[j + 1], len: glen });
              continue;
            }
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
          if (!r.v) { sections.push(s); return; }
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
          // Непотвърденият дубликат е приет участък (брои се и се хваща) с маркер по средата.
          splitBySkips(t.skips, s.a, s.b, minDup).forEach(function (x) {
            var o = {};
            for (var kk in s) o[kk] = s[kk];
            o.a = x.a; o.b = x.b; o.len = x.b - x.a; o.key = t.id + ':' + Math.round(x.a);
            if (x.v === 'pend') { o.kind = 'part'; o.pend = true; }
            sections.push(o);
          });
        });
      });
      (t.cuts || []).forEach(function (cu) {
        sections.push({ trackId: t.id, kind: 'cut', a: cu.a, b: cu.b, len: cu.b - cu.a, key: t.id + ':cut:' + Math.round(cu.a) });
      });
      sections.sort(function (p, q) { return p.a - q.a; });
      gaps.forEach(function (g) { sections.push(g); (g.closed ? result.closedGaps : result.gaps).push(g); });
      result.byTrack[t.id] = sections;
      sections.forEach(function (s) { if (s.kind === 'dup') result.dups.push(s); });
    });
    result.junctions = findJunctions(live, result, tol, kx, ky);
    live.forEach(function (t) {
      result.byTrack[t.id].forEach(function (s) {
        if (s.kind === 'part') (s.pend ? result.pend : result.parts).push(s);
      });
    });
    return result;
  }

  var JOIN_MIN = 40; // по-къси парчета при разделяне в точка на прекъсване не се правят

  // Най-близкото място до точка, само в участъка [a,b] на трака.
  function nearestInRange(t, a, b, lat, lon, kx, ky) {
    var c = t._cum, pts = t.pts, px = lon * kx, py = lat * ky, best = null;
    for (var i = 0; i < pts.length - 1; i++) {
      if (c[i + 1] < a || c[i] > b) continue;
      var r = U.projectSeg(px, py, pts[i][1] * kx, pts[i][0] * ky, pts[i + 1][1] * kx, pts[i + 1][0] * ky);
      if (!best || r.d2 < best.d2) best = { d2: r.d2, d: c[i] + r.t * (c[i + 1] - c[i]) };
    }
    if (best) { best.dist = Math.sqrt(best.d2); best.d = Math.max(a, Math.min(b, best.d)); }
    return best;
  }

  // Пресичане на две отсечки: връща дела по първата или null.
  function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
    var rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
    var den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-9) return null;
    var qx = cx - ax, qy = cy - ay;
    var t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
  }

  /* Точки на прекъсване: където приетите участъци на два трака се събират или се делят
     (краищата на обща отсечка, край на участък при друг трак) и където два трака само се
     пресичат. Приетите участъци се разделят в тези точки, така че от всяка точка тръгват
     отделни клонове. Всяка точка носи клоновете си: {trackId, a, b, key, from:'a'|'b'}. */
  function findJunctions(live, result, tol, kx, ky) {
    var jt = Math.max(ROUTE_GAP, 1.5 * tol);
    var byId = {}, cand = [];
    live.forEach(function (t) { byId[t.id] = t; });
    // Непотвърдените дубликати лежат върху чуждо трасе: не се делят и не са клонове.
    function partsOf(id) { return result.byTrack[id].filter(function (s) { return s.kind === 'part' && !s.pend; }); }
    var anyDup = [];
    live.forEach(function (t) { result.byTrack[t.id].forEach(function (s) { if (s.kind === 'dup' || s.pend) anyDup.push(s); }); });
    // 1. Краищата на дубликатите (махнати или не), до които има приет участък от същия трак.
    anyDup.forEach(function (d) {
      var ps = partsOf(d.trackId);
      [d.a, d.b].forEach(function (e) {
        if (ps.some(function (p) { return Math.abs(p.a - e) < 1 || Math.abs(p.b - e) < 1; })) cand.push(pointAt(byId[d.trackId], e));
      });
    });
    // 2. Край на приет участък при приет участък от друг трак.
    live.forEach(function (t) {
      partsOf(t.id).forEach(function (p) {
        [p.a, p.b].forEach(function (e) {
          var q = pointAt(t, e);
          var near = live.some(function (o) {
            return o !== t && partsOf(o.id).some(function (op) {
              var n = nearestInRange(o, op.a, op.b, q[0], q[1], kx, ky);
              return n && n.dist <= tol;
            });
          });
          if (near) cand.push(q);
        });
      });
    });
    // 3. Пресичания на приети участъци от различни тракове (решетка от отсечки).
    var cell = 250, grid = new Map();
    live.forEach(function (t, ti) {
      var c = t._cum, pts = t.pts, ps = partsOf(t.id);
      for (var j = 0; j < pts.length - 1; j++) {
        var inPart = ps.some(function (p) { return c[j] >= p.a - 0.5 && c[j + 1] <= p.b + 0.5; });
        if (!inPart) continue;
        var x0 = pts[j][1] * kx, y0 = pts[j][0] * ky, x1 = pts[j + 1][1] * kx, y1 = pts[j + 1][0] * ky;
        var ax = Math.floor(Math.min(x0, x1) / cell), bx = Math.floor(Math.max(x0, x1) / cell);
        var ay = Math.floor(Math.min(y0, y1) / cell), by = Math.floor(Math.max(y0, y1) / cell);
        if ((bx - ax + 1) * (by - ay + 1) > 400) continue;
        for (var ix = ax; ix <= bx; ix++) for (var iy = ay; iy <= by; iy++) {
          var k = ix + ':' + iy, l = grid.get(k);
          if (!l) grid.set(k, l = []);
          l.push([ti, j, x0, y0, x1, y1]);
        }
      }
    });
    grid.forEach(function (l) {
      for (var m = 0; m < l.length; m++) for (var n = m + 1; n < l.length; n++) {
        var p = l[m], q = l[n];
        if (p[0] === q[0]) continue;
        var f = segCross(p[2], p[3], p[4], p[5], q[2], q[3], q[4], q[5]);
        if (f == null) continue;
        cand.push([(p[3] + f * (p[5] - p[3])) / ky, (p[2] + f * (p[4] - p[2])) / kx, null]);
      }
    });
    // Близките точки се сливат; остава първата (краищата на дубликатите са с предимство).
    var js = [];
    cand.forEach(function (q) {
      if (!js.some(function (j) { return U.hav(j.lat, j.lon, q[0], q[1]) <= jt; })) js.push({ lat: q[0], lon: q[1] });
    });
    // Разделяне на приетите участъци в точките.
    live.forEach(function (t) {
      var out = [];
      result.byTrack[t.id].forEach(function (s) {
        if (s.kind !== 'part' || s.pend) { out.push(s); return; }
        var at = [];
        js.forEach(function (j) {
          var n = nearestInRange(t, s.a, s.b, j.lat, j.lon, kx, ky);
          if (n && n.dist <= jt && n.d - s.a > JOIN_MIN && s.b - n.d > JOIN_MIN) at.push(n.d);
        });
        at.sort(function (x, y) { return x - y; });
        var a = s.a;
        at.forEach(function (d) {
          if (d - a < JOIN_MIN || s.b - d < JOIN_MIN) return;
          out.push({ trackId: t.id, kind: 'part', a: a, b: d, len: d - a, key: t.id + ':' + Math.round(a) });
          a = d;
        });
        out.push(a === s.a ? s : { trackId: t.id, kind: 'part', a: a, b: s.b, len: s.b - a, key: t.id + ':' + Math.round(a) });
      });
      result.byTrack[t.id] = out;
    });
    // Клоновете: приетите участъци с край в точката.
    js.forEach(function (j) {
      j.key = Math.round(j.lat * 1e5) + ':' + Math.round(j.lon * 1e5);
      j.branches = [];
      live.forEach(function (t) {
        partsOf(t.id).forEach(function (s) {
          var pa = pointAt(t, s.a), pb = pointAt(t, s.b);
          var da = U.hav(j.lat, j.lon, pa[0], pa[1]), db = U.hav(j.lat, j.lon, pb[0], pb[1]);
          var from = da <= db ? 'a' : 'b';
          if (Math.min(da, db) <= jt) j.branches.push({ trackId: t.id, a: s.a, b: s.b, len: s.len, key: s.key, from: from });
        });
      });
    });
    return js.filter(function (j) { return j.branches.length >= 2; });
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

  // Каква част от [a,b] на трака е под дубликат или изрязване.
  function invalidShare(item, analysis) {
    var secs = analysis.byTrack[item.trackId];
    if (!secs) return { share: 1, why: 'тракът липсва' };
    var a = Math.min(item.a, item.b), b = Math.max(item.a, item.b), len = b - a || 1;
    var dupL = 0, cutL = 0;
    secs.forEach(function (s) {
      if (s.kind === 'dup') dupL += overlap(a, b, s.a, s.b);
      if (s.kind === 'cut') cutL += overlap(a, b, s.a, s.b);
    });
    // Изрязване, което засяга частта, я маркира винаги; дубликат - ако покрива осезаема част от нея.
    var bad = cutL > 20 || dupL > Math.max(100, 0.2 * len);
    return { bad: bad, share: (dupL + cutL) / len, why: cutL > 20 ? 'изрязана' : 'дубликат' };
  }

  /* Махнат дубликат, който свързва края на една част с началото на следващата: лежи
     върху трака на едната от тях и краищата му са при двата края (в двете посоки).
     Връща точките на общата отсечка, подредени от края на предишната част нататък. */
  function sharedLink(prev, next, analysis, tracksById, tol) {
    var e = prev.pts[prev.pts.length - 1], s = next.pts[0], best = null;
    var ids = [prev.item.trackId];
    if (next.item.trackId !== prev.item.trackId) ids.push(next.item.trackId);
    ids.forEach(function (id) {
      var t = tracksById[id];
      if (!t) return;
      (analysis.byTrack[id] || []).forEach(function (d) {
        if (d.kind !== 'dup') return;
        var p0 = pointAt(t, d.a), p1 = pointAt(t, d.b);
        [[p0, p1, false], [p1, p0, true]].forEach(function (c) {
          var de = U.hav(e[0], e[1], c[0][0], c[0][1]), ds = U.hav(s[0], s[1], c[1][0], c[1][1]);
          if (de <= tol && ds <= tol && (!best || de + ds < best.score)) {
            best = { score: de + ds, trackId: id, a: d.a, b: d.b, rev: c[2] };
          }
        });
      });
    });
    if (!best) return null;
    var pts = slice(tracksById[best.trackId], best.a, best.b);
    if (best.rev) pts.reverse();
    return { item: { type: 'shared', trackId: best.trackId, a: best.a, b: best.b, rev: best.rev }, pts: pts };
  }

  /* Геометрия на маршрута: всяка част дава своите точки; чертаните участъци свързват
     съседите си; дупка се отчита само между две съседни части от тракове. Ако между
     тях лежи махнат дубликат (общата отсечка), маршрутът минава през него веднъж:
     вмъква се елемент {type:'shared'} с idx null, който не е в route.items. */
  function routeGeometry(route, tracksById, analysis) {
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
    var gaps = [], out = [], autoGaps = [];
    var prev = null;
    var tol = Math.max(ROUTE_GAP, analysis ? analysis.tol * 1.5 : 0);
    items.forEach(function (g) {
      if (g.item.type === 'draw') { g.connected = true; prev = g.pts.length ? g : { draw: true }; out.push(g); return; }
      if (!g.pts.length) { out.push(g); return; }
      if (prev && !prev.draw && prev.pts && prev.pts.length) {
        var e = prev.pts[prev.pts.length - 1], s = g.pts[0];
        var d = U.hav(e[0], e[1], s[0], s[1]);
        if (d > ROUTE_GAP) {
          var link = analysis && sharedLink(prev, g, analysis, tracksById, tol);
          var gp = { beforeIdx: g.idx, afterIdx: prev.idx, d: d, from: e, to: s };
          if (link) out.push({ idx: null, shared: true, item: link.item, pts: link.pts });
          else if (analysis && d < analysis.tol && !isReopened(route, e, s)) {
            // Дупка под отклонението се свързва направо сама; не е в route.items.
            gp.kind = 'route';
            autoGaps.push(gp);
            out.push({ idx: null, auto: true, gap: gp, item: { type: 'autogap' }, pts: [e.slice(0, 3), s.slice(0, 3)] });
          } else gaps.push(gp);
        }
      }
      out.push(g);
      prev = g;
    });
    items = out;
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
      if (g.auto) { g.gap.d1 = g.d1; g.gap.d0 = g.d1 - g.gap.d; }
      // Затворените сами дупки в записа, които попадат в частта.
      if (g.item.type === 'part' && analysis && tracksById[g.item.trackId]) {
        var lo = Math.min(g.item.a, g.item.b), hi = Math.max(g.item.a, g.item.b), tt = tracksById[g.item.trackId];
        (analysis.closedGaps || []).forEach(function (cg) {
          if (cg.trackId !== g.item.trackId || cg.a < lo - 0.5 || cg.b > hi + 0.5) return;
          var d0 = g.d0 + (g.item.rev ? hi - cg.b : cg.a - lo);
          var ends = [pointAt(tt, cg.a), pointAt(tt, cg.b)];
          if (g.item.rev) ends.reverse();
          autoGaps.push({ kind: 'track', trackId: cg.trackId, a: cg.a, b: cg.b, d: cg.len, d0: d0, d1: d0 + cg.len, from: ends[0], to: ends[1], itemIdx: g.idx });
        });
      }
    });
    autoGaps.sort(function (p, q) { return p.d0 - q.d0; });
    return { items: items, pts: all, cum: cum, len: all.length ? cum[cum.length - 1] : 0, gaps: gaps, autoGaps: autoGaps };
  }

  // Дупка между части, отворена пак с "Отвори пак" (route.openGaps: [[lat,lon,lat,lon]]).
  function isReopened(route, e, s) {
    return (route.openGaps || []).some(function (o) {
      return U.hav(o[0], o[1], e[0], e[1]) <= 5 && U.hav(o[2], o[3], s[0], s[1]) <= 5;
    });
  }

  /* Махане на дубликат [a,b] от частите на маршрута: частите от същия трак губят
     застъпената отсечка (по-късите от JOIN_MIN парчета отпадат). */
  function trimItems(items, trackId, a, b) {
    var out = [];
    items.forEach(function (it) {
      if (it.type !== 'part' || it.trackId !== trackId) { out.push(it); return; }
      var lo = Math.min(it.a, it.b), hi = Math.max(it.a, it.b);
      if (overlap(lo, hi, a, b) <= 1) { out.push(it); return; }
      var ps = [];
      if (a - lo >= JOIN_MIN) ps.push([lo, a]);
      if (hi - b >= JOIN_MIN) ps.push([b, hi]);
      if (it.rev) ps.reverse();
      ps.forEach(function (p) {
        var o = JSON.parse(JSON.stringify(it));
        o.a = p[0]; o.b = p[1];
        out.push(o);
      });
    });
    return out;
  }

  var PROBE = 80; // на толкова метра след точката се сравнява накъде тръгва маршрутът

  // Точка по сглобения маршрут на разстояние d.
  function routeAt(geo, d) {
    var c = geo.cum, pts = geo.pts;
    if (!pts.length) return null;
    if (d <= 0) return pts[0];
    if (d >= geo.len) return pts[pts.length - 1];
    var lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (c[mid] <= d) lo = mid; else hi = mid; }
    var f = (d - c[lo]) / ((c[hi] - c[lo]) || 1), p = pts[lo], q = pts[hi];
    return [p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1])];
  }
  // Точка по клона, малко след точката на прекъсване.
  function branchProbe(br, tracksById) {
    var t = tracksById[br.trackId];
    if (!t) return null;
    var k = Math.min(PROBE, (br.b - br.a) / 2);
    return pointAt(t, br.from === 'a' ? br.a + k : br.b - k);
  }
  function nearestBranch(j, probe, tracksById, jt) {
    if (!probe) return -1;
    var bi = -1, bd = jt;
    j.branches.forEach(function (br, i) {
      var q = branchProbe(br, tracksById);
      var d = q ? U.hav(q[0], q[1], probe[0], probe[1]) : Infinity;
      if (d <= bd) { bd = d; bi = i; }
    });
    return bi;
  }

  /* Точките на прекъсване, през които минава маршрутът: на границата между две
     съседни части (или в края му). За всяка: след кой елемент от route.items е
     (head), по кой клон продължава (chosen) и от кой идва (incoming). */
  function routeForks(geo, junctions, tol, tracksById) {
    var jt = Math.max(ROUTE_GAP, 1.5 * (tol || 20)), out = [];
    var real = geo.items.filter(function (g) { return !g.shared && !g.auto && g.pts.length && g.end >= g.start; });
    (junctions || []).forEach(function (j) {
      var hit = null;
      for (var k = 0; k < real.length && !hit; k++) {
        var P = real[k], N = real[k + 1], e = geo.pts[P.end];
        if (U.hav(j.lat, j.lon, e[0], e[1]) <= jt) hit = { head: P.idx, d: geo.cum[P.end], atEnd: !N };
        else if (N) {
          var s = geo.pts[N.start];
          if (U.hav(j.lat, j.lon, s[0], s[1]) <= jt) hit = { head: P.idx, d: geo.cum[N.start], atEnd: false };
        }
      }
      if (!hit && real.length) {
        var s0 = geo.pts[real[0].start];
        if (U.hav(j.lat, j.lon, s0[0], s0[1]) <= jt) hit = { head: -1, d: 0, atEnd: false, atStart: true };
      }
      if (!hit) return;
      hit.j = j;
      hit.probeAfter = hit.atEnd ? null : routeAt(geo, hit.d + PROBE);
      hit.chosen = nearestBranch(j, hit.probeAfter, tracksById, jt);
      hit.incoming = hit.atStart ? -1 : nearestBranch(j, routeAt(geo, hit.d - PROBE), tracksById, jt);
      if (hit.chosen === hit.incoming) hit.chosen = -1;
      out.push(hit);
    });
    return out;
  }

  /* Смяна на посоката: след точката маршрутът продължава по клона br. Досегашното
     продължение се пази в route.forks, за да се върне при нов избор на стария клон. */
  function switchFork(route, fork, br, tracksById, tol) {
    var jt = Math.max(ROUTE_GAP, 1.5 * (tol || 20)), j = fork.j;
    route.forks = route.forks || [];
    var entry = route.forks.filter(function (e) { return U.hav(e.at[0], e.at[1], j.lat, j.lon) <= jt; })[0];
    if (!entry) route.forks.push(entry = { at: [j.lat, j.lon], alts: [] });
    function near(a, q) { return a && q && U.hav(a[0], a[1], q[0], q[1]) <= jt; }
    var tail = route.items.slice(fork.head + 1);
    if (tail.length && fork.probeAfter) {
      entry.alts = entry.alts.filter(function (a) { return !near(a.probe, fork.probeAfter); });
      entry.alts.push({ probe: [fork.probeAfter[0], fork.probeAfter[1]], items: JSON.parse(JSON.stringify(tail)) });
    }
    var bp = branchProbe(br, tracksById);
    var alt = entry.alts.filter(function (a) { return near(a.probe, bp); })[0];
    var next = alt ? JSON.parse(JSON.stringify(alt.items))
      : [{ type: 'part', trackId: br.trackId, a: br.a, b: br.b, rev: br.from === 'b' }];
    route.items = route.items.slice(0, fork.head + 1).concat(next);
    entry.chosen = bp ? [bp[0], bp[1]] : null;
    return route;
  }

  function trackBounds(tracks) {
    return U.boundsOf(tracks.map(function (t) { return t.pts; }));
  }

  window.Core = {
    prep: prep, analyze: analyze, slice: slice, pointAt: pointAt, nearestOn: nearestOn,
    nearestOnTrack: nearestOnTrack, invalidShare: invalidShare, routeGeometry: routeGeometry,
    trackBounds: trackBounds, overlap: overlap, ROUTE_GAP: ROUTE_GAP,
    routeForks: routeForks, switchFork: switchFork, branchProbe: branchProbe,
    mergeIv: mergeIv, trimItems: trimItems,
    joinTol: function (tol) { return Math.max(ROUTE_GAP, 1.5 * (tol || 20)); }
  };
})();
