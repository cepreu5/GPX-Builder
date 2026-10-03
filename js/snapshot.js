/* CX Tracks - картина за офлайн: сглобява плочките в <canvas>, рисува маршрута,
   числата, скалата, датата и легендата и връща .png заедно с географския обхват. */
(function () {
  'use strict';

  var U = window.U, M = window.TileMap.merc;
  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
  var MONO = 'ui-monospace, Menlo, Consolas, monospace';

  /* Размер и приближаване, при които обхватът се събира в около 2400 точки.
     box: {legend: брой редове в легендата} - картината е с панел с числата горе вляво (изборът
     "около маршрута"): маршрутът се събира в свободното място ПОД панела и над скалата и се центрира
     там. Картината се удължава надолу с височината на панела; ако излезе твърде голяма, приближаването
     пада (маршрутът се смалява), колкото е нужно. Без box - кадърът е точно обхватът. */
  function plan(bounds, margin, maxZoom, target, box) {
    target = target || 2400;
    if (box) return planBox(bounds, margin, maxZoom, target, box);
    var x0 = M.lon2x(bounds.w), x1 = M.lon2x(bounds.e), y0 = M.lat2y(bounds.n), y1 = M.lat2y(bounds.s);
    var dx = Math.max(x1 - x0, 1e-7), dy = Math.max(y1 - y0, 1e-7);
    x0 -= dx * margin; x1 += dx * margin; y0 -= dy * margin; y1 += dy * margin;
    dx = x1 - x0; dy = y1 - y0;
    var z = Math.floor(Math.log(target / (Math.max(dx, dy) * 256)) / Math.LN2);
    z = Math.max(3, Math.min(maxZoom, z));
    while (z > 3 && Math.max(dx, dy) * 256 * Math.pow(2, z) > 4096) z--;
    var s = 256 * Math.pow(2, z);
    var w = Math.round(dx * s), h = Math.round(dy * s);
    // Твърде тясна картина - разширяваме до поне 3:4, за да има място за легендата.
    var minW = Math.round(h * 0.75), minH = Math.round(w * 0.6);
    var ox = x0 * s, oy = y0 * s;
    if (w < minW) { ox -= (minW - w) / 2; w = minW; }
    if (h < minH) { oy -= (minH - h) / 2; h = minH; }
    w = Math.max(w, 600); h = Math.max(h, 450);
    return { z: z, x0: Math.round(ox), y0: Math.round(oy), w: w, h: h };
  }

  // Мащабът на надписите и панела: от по-голямата страна на картината.
  function scaleOf(w, h) { return Math.max(1, Math.max(w, h) / 1600); }
  function legendRows(n) { return Math.min(n, 7) + (n > 7 ? 1 : 0) + 1; }
  // Панелът с числата и легендата: горе вляво; ширината се мери при чертане, тук - височината.
  function panelRect(p, n) {
    var s = scaleOf(p.w, p.h);
    return { x: 14 * s, y: 14 * s, h: 14 * s + 3 * 19 * s + 8 * s + legendRows(n) * 17 * s + 6 * s, s: s };
  }
  // Свободното място за маршрута: под панела (с отстъп) и над скалата долу вляво.
  function freeArea(p, n) {
    var b = panelRect(p, n), s = b.s;
    return { x: 0, y: b.y + b.h + 10 * s, w: p.w, h: p.h - (b.y + b.h + 10 * s) - 52 * s };
  }
  function planBox(bounds, margin, maxZoom, target, box) {
    var n = box.legend || 0;
    var X0 = M.lon2x(bounds.w), X1 = M.lon2x(bounds.e), Y0 = M.lat2y(bounds.n), Y1 = M.lat2y(bounds.s);
    var dx = Math.max(X1 - X0, 1e-7), dy = Math.max(Y1 - Y0, 1e-7);
    X0 -= dx * margin; X1 += dx * margin; Y0 -= dy * margin; Y1 += dy * margin;
    dx = X1 - X0; dy = Y1 - Y0;
    var z = Math.floor(Math.log(target / (Math.max(dx, dy) * 256)) / Math.LN2);
    z = Math.max(3, Math.min(maxZoom, z));
    for (;;) {
      var S = 256 * Math.pow(2, z), rw = dx * S, rh = dy * S;
      // Височината на панела зависи от мащаба, а той - от размера: няколко кръга стигат.
      var w = Math.max(rw, 600), h = rh, k, top = 0, bot = 0;
      for (k = 0; k < 4; k++) {
        var s = scaleOf(w, h);
        top = 14 * s + (14 * s + 3 * 19 * s + 8 * s + legendRows(n) * 17 * s + 6 * s) + 10 * s; bot = 52 * s;
        h = Math.max(rh + top + bot, 450);
        w = Math.max(rw, 600, Math.round(h * 0.75));
      }
      if (z <= 3 || Math.max(w, h) <= 4096) {
        w = Math.round(w); h = Math.round(h);
        var fh = h - top - bot;
        return { z: z, x0: Math.round(X0 * S - (w - rw) / 2), y0: Math.round(Y0 * S - top - (fh - rh) / 2), w: w, h: h, box: true };
      }
      z--;
    }
  }

  function loadImg(url, ms) {
    return new Promise(function (resolve) {
      var img = new Image(), done = false;
      img.crossOrigin = 'anonymous';
      var t = setTimeout(function () { if (!done) { done = true; img.src = ''; resolve(null); } }, ms || 20000);
      img.onload = function () { if (!done) { done = true; clearTimeout(t); resolve(img); } };
      img.onerror = function () { if (!done) { done = true; clearTimeout(t); resolve(null); } };
      img.src = url;
    });
  }

  function drawLayer(ctx, layer, p, onTile) {
    var z = Math.min(p.z, layer.maxZoom || 19);
    var f = Math.pow(2, p.z - z); // надценяване, ако слоят няма толкова близко приближаване
    var ts = 256 * f;
    var tx0 = Math.floor(p.x0 / ts), ty0 = Math.floor(p.y0 / ts);
    var tx1 = Math.floor((p.x0 + p.w - 1) / ts), ty1 = Math.floor((p.y0 + p.h - 1) / ts);
    var n = 1 << z, jobs = [];
    for (var ty = ty0; ty <= ty1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (var tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
    }
    var failed = 0, i = 0;
    function worker() {
      if (i >= jobs.length) return Promise.resolve();
      var j = jobs[i++];
      var xx = ((j[0] % n) + n) % n;
      return loadImg(layer.url(z, xx, j[1])).then(function (img) {
        if (img) ctx.drawImage(img, Math.round(j[0] * ts - p.x0), Math.round(j[1] * ts - p.y0), Math.ceil(ts), Math.ceil(ts));
        else failed++;
        if (onTile) onTile();
        return worker();
      });
    }
    var ws = [];
    for (var k = 0; k < 8; k++) ws.push(worker());
    return Promise.all(ws).then(function () { return { failed: failed, total: jobs.length }; });
  }

  function niceScale(mpp, px) {
    var m = mpp * px, p = Math.pow(10, Math.floor(Math.log(m) / Math.LN10));
    var steps = [1, 2, 5, 10], best = p;
    steps.forEach(function (s) { if (s * p <= m) best = s * p; });
    return best;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  /* opts: {bounds, margin, base:{layers:[...], name, attribution}, labels:[layers], info, route:{name, parts:[{pts,label}], len, up, maxGrade, wpts}, colors} */
  function make(opts, onProgress) {
    var maxZ = Math.min.apply(null, opts.base.layers.map(function (l) { return l.maxZoom || 19; })) + 1;
    var p = plan(opts.bounds, opts.margin == null ? 0.1 : opts.margin, Math.min(18, maxZ), null, opts.box);
    var cv = document.createElement('canvas');
    cv.width = p.w; cv.height = p.h;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#e8e4da';
    ctx.fillRect(0, 0, p.w, p.h);
    var layers = opts.base.layers.concat(opts.labels || []);
    var totalTiles = 0, doneTiles = 0;
    var report = { base: null, labels: [] };
    var chain = Promise.resolve();
    layers.forEach(function (l, li) {
      chain = chain.then(function () {
        return drawLayer(ctx, l, p, function () { doneTiles++; if (onProgress) onProgress(doneTiles, totalTiles); })
          .then(function (r) {
            totalTiles += 0;
            if (li < opts.base.layers.length) report.base = r; else report.labels.push(r);
          });
      });
    });
    // Грубо предварително броене за прогреса.
    var per = (Math.ceil(p.w / 256) + 1) * (Math.ceil(p.h / 256) + 1);
    totalTiles = per * layers.length;

    return chain.then(function () {
      var b = report.base;
      if (!b || b.total === 0 || b.failed / b.total > 0.3) {
        throw new Error(T('snap.refused', { name: opts.base.name, n: b ? T('pic.of', { a: b.failed, b: b.total }) : T('snap.all') }));
      }
      drawRoute(ctx, p, opts);
      var warn = null;
      if (b.failed) warn = T('snap.missing', { n: b.failed });
      report.labels.forEach(function (r) { if (r.failed / (r.total || 1) > 0.3) warn = T('snap.noLabels'); });
      return new Promise(function (resolve, reject) {
        try {
          cv.toBlob(function (blob) {
            if (!blob) return reject(new Error(T('snap.blob')));
            resolve({ blob: blob, meta: { z: p.z, x0: p.x0, y0: p.y0, w: p.w, h: p.h }, warn: warn });
          }, 'image/png');
        } catch (e) {
          reject(new Error(T('snap.cors')));
        }
      });
    });
  }

  function drawRoute(ctx, p, opts) {
    var s = scaleOf(p.w, p.h);
    var W = 256 * Math.pow(2, p.z);
    function pr(lat, lon) { return [M.lon2x(lon) * W - p.x0, M.lat2y(lat) * W - p.y0]; }
    var col = opts.colors;
    var route = opts.route;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // Линията: бял кант отдолу, после частите с редуващи се цветове.
    route.parts.forEach(function (part) {
      if (part.pts.length < 2) return;
      ctx.beginPath();
      part.pts.forEach(function (pt, i) { var q = pr(pt[0], pt[1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.strokeStyle = col.casing; ctx.lineWidth = 9 * s; ctx.stroke();
    });
    route.parts.forEach(function (part, i) {
      if (part.pts.length < 2) return;
      ctx.beginPath();
      part.pts.forEach(function (pt, k) { var q = pr(pt[0], pt[1]); if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.strokeStyle = i % 2 ? col.b : col.a; ctx.lineWidth = 5 * s;
      if (part.drawn) ctx.setLineDash([10 * s, 7 * s]);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    // Попълненото при дупка в GPS (в изминат трак): кехлибарено, на пунктир.
    (route.gaps || []).forEach(function (pts) {
      if (pts.length < 2) return;
      ctx.beginPath();
      pts.forEach(function (pt, k) { var q = pr(pt[0], pt[1]); if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.strokeStyle = col.casing; ctx.lineWidth = 7 * s; ctx.stroke();
      ctx.strokeStyle = col.gap || '#e09a00'; ctx.lineWidth = 5 * s; ctx.setLineDash([10 * s, 7 * s]);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // "Свързано направо" между две части: същото кехлибарено на пунктир, без надпис.
    (route.bridges || []).forEach(function (pts) {
      var a = pr(pts[0][0], pts[0][1]), b = pr(pts[1][0], pts[1][1]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      ctx.strokeStyle = col.casing; ctx.lineWidth = 7 * s; ctx.stroke();
      ctx.strokeStyle = col.gap || '#e09a00'; ctx.lineWidth = 5 * s; ctx.setLineDash([10 * s, 7 * s]);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Посока: стрелки през равни отстояния по цялата линия.
    var all = [];
    route.parts.forEach(function (part) { part.pts.forEach(function (pt) { all.push(pr(pt[0], pt[1])); }); });
    var every = 170 * s, acc = every / 2;
    for (var i = 1; i < all.length; i++) {
      var a = all[i - 1], b = all[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (acc <= L && L > 0) {
        var f = acc / L, x = a[0] + f * (b[0] - a[0]), y = a[1] + f * (b[1] - a[1]);
        var ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(-5 * s, -5 * s); ctx.lineTo(3 * s, 0); ctx.lineTo(-5 * s, 5 * s);
        ctx.strokeStyle = col.casing; ctx.lineWidth = 2.4 * s; ctx.stroke();
        ctx.restore();
        acc += every;
      }
      acc -= L;
    }

    // Номера на частите.
    if (route.parts.length > 1) {
      route.parts.forEach(function (part, k) {
        if (part.pts.length < 2 || part.drawn) return;
        var m = part.pts[Math.floor(part.pts.length / 2)], q = pr(m[0], m[1]);
        ctx.beginPath(); ctx.arc(q[0], q[1], 11 * s, 0, Math.PI * 2);
        ctx.fillStyle = k % 2 ? col.b : col.a; ctx.fill();
        ctx.strokeStyle = col.casing; ctx.lineWidth = 2.5 * s; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = '700 ' + Math.round(12 * s) + 'px ' + MONO;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(part.no || k + 1), q[0], q[1] + 0.5 * s);
      });
    }

    // Спирки с име.
    (route.wpts || []).forEach(function (w) {
      var q = pr(w.lat, w.lon);
      ctx.beginPath(); ctx.arc(q[0], q[1], 5 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#1f1d1a'; ctx.lineWidth = 2 * s; ctx.stroke();
      label(ctx, w.name, q[0] + 9 * s, q[1], s);
    });

    // Начало и край.
    if (all.length > 1) {
      var st = all[0], en = all[all.length - 1];
      var same = Math.hypot(st[0] - en[0], st[1] - en[1]) < 14 * s;
      marker(ctx, en, s, '#b3372b', same ? null : T('map.end'));
      marker(ctx, st, s, '#1f8a4c', same ? T('map.startEnd') : T('map.start'));
    }

    var mpp = 40075016.686 * Math.cos(M.y2lat((p.y0 + p.h / 2) / W) * Math.PI / 180) / W;
    // Скала.
    var sm = niceScale(mpp, 160 * s), spx = sm / mpp;
    var sx = 18 * s, sy = p.h - 22 * s;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    roundRect(ctx, sx - 8 * s, sy - 26 * s, spx + 16 * s + 40 * s, 36 * s, 4 * s); ctx.fill();
    ctx.fillStyle = '#1f1d1a';
    ctx.fillRect(sx, sy - 4 * s, spx, 4 * s);
    ctx.fillRect(sx, sy - 10 * s, 2 * s, 10 * s); ctx.fillRect(sx + spx - 2 * s, sy - 10 * s, 2 * s, 10 * s);
    ctx.font = '600 ' + Math.round(12 * s) + 'px ' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('0', sx, sy - 13 * s);
    ctx.textAlign = 'right';
    ctx.fillText(sm >= 1000 ? U.num(sm / 1000) + ' ' + T('unit.km') : U.num(sm) + ' ' + T('unit.m'), sx + spx + 36 * s, sy - 1 * s);

    // Източник на плочките.
    ctx.font = Math.round(10 * s) + 'px ' + FONT; ctx.textAlign = 'right';
    var at = opts.base.attribution, aw = ctx.measureText(at).width;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(p.w - aw - 12 * s, p.h - 16 * s, aw + 12 * s, 16 * s);
    ctx.fillStyle = '#333'; ctx.fillText(at, p.w - 6 * s, p.h - 4 * s);

    if (!opts.info) return;
    // Числа и легенда.
    var lines = [
      { t: route.name, f: '700 ' + Math.round(15 * s) + 'px ' + FONT },
      { t: U.km(route.len) + (route.up != null ? ' · ' + T('snap.up', { m: U.num(Math.round(route.up)) }) : ''), f: '600 ' + Math.round(13 * s) + 'px ' + MONO },
      { t: (route.maxGrade != null ? T('snap.grade', { p: U.pct(route.maxGrade) }) + ' · ' : '') + U.date(opts.date || Date.now()), f: Math.round(12.5 * s) + 'px ' + MONO }
    ];
    var legend = route.parts.filter(function (x) { return !x.drawn && x.pts.length > 1; });
    var shown = legend.slice(0, 7);
    var bw = 0;
    lines.forEach(function (l) { ctx.font = l.f; bw = Math.max(bw, ctx.measureText(l.t).width); });
    ctx.font = Math.round(12 * s) + 'px ' + FONT;
    shown.forEach(function (x) { bw = Math.max(bw, ctx.measureText(x.label).width + 30 * s); });
    bw = Math.min(bw + 24 * s, p.w * 0.6);
    var lh = 19 * s;
    var pb = panelRect(p, legend.length), bh = pb.h, bx = pb.x, by = pb.y;
    ctx.fillStyle = 'rgba(255,253,248,0.93)';
    roundRect(ctx, bx, by, bw, bh, 6 * s); ctx.fill();
    ctx.strokeStyle = 'rgba(31,29,26,0.25)'; ctx.lineWidth = 1 * s; ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    var y = by + 10 * s;
    lines.forEach(function (l) { y += lh; ctx.font = l.f; ctx.fillStyle = '#1f1d1a'; ctx.fillText(l.t, bx + 12 * s, y - 4 * s, bw - 24 * s); });
    y += 6 * s;
    ctx.font = Math.round(12 * s) + 'px ' + FONT;
    shown.forEach(function (x, k) {
      y += 17 * s;
      ctx.fillStyle = col.casing; ctx.fillRect(bx + 11 * s, y - 9 * s, 22 * s, 8 * s);
      ctx.fillStyle = k % 2 ? col.b : col.a; ctx.fillRect(bx + 12 * s, y - 8 * s, 20 * s, 6 * s);
      ctx.fillStyle = '#1f1d1a'; ctx.fillText(x.label, bx + 40 * s, y - 1 * s, bw - 52 * s);
    });
    if (legend.length > shown.length) { y += 17 * s; ctx.fillStyle = '#6b665e'; ctx.fillText(T('snap.more', { n: legend.length - shown.length }), bx + 40 * s, y - 1 * s); }
    y += 17 * s;
    ctx.beginPath(); ctx.arc(bx + 17 * s, y - 5 * s, 5 * s, 0, Math.PI * 2); ctx.fillStyle = '#1f8a4c'; ctx.fill();
    ctx.beginPath(); ctx.arc(bx + 29 * s, y - 5 * s, 5 * s, 0, Math.PI * 2); ctx.fillStyle = '#b3372b'; ctx.fill();
    ctx.fillStyle = '#1f1d1a'; ctx.fillText(T('snap.startEnd'), bx + 40 * s, y - 1 * s);
  }

  function marker(ctx, q, s, color, text) {
    ctx.beginPath(); ctx.arc(q[0], q[1], 9 * s, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * s; ctx.stroke();
    if (text) label(ctx, text, q[0] + 13 * s, q[1], s);
  }
  function label(ctx, text, x, y, s) {
    if (!text) return;
    ctx.font = '600 ' + Math.round(12.5 * s) + 'px ' + FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4 * s; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = '#1f1d1a'; ctx.fillText(text, x, y);
  }

  // Географско място -> пиксел върху запазената картина.
  function toPic(meta, lat, lon) {
    var W = 256 * Math.pow(2, meta.z);
    return [M.lon2x(lon) * W - meta.x0, M.lat2y(lat) * W - meta.y0];
  }

  window.Snapshot = { make: make, plan: plan, toPic: toPic, panelRect: panelRect, freeArea: freeArea };
})();
