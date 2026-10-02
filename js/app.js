/* GPX конструктор - приложението: състояние, карта, решения с клик, списъци под картата,
   износ, картина за офлайн и следене. */
(function () {
  'use strict';

  var U = window.U, Core = window.Core, Elev = window.Elev, GPX = window.GPX;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var HOME = { lat: 42.5006, lon: 24.7036, zoom: 13 }; // Хисаря
  var MAX_FILES = 10;

  var LAYERS = {
    sat: { id: 'sat', maxZoom: 18, url: function (z, x, y) { return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x; } },
    places: { id: 'places', maxZoom: 18, noFallback: false, url: function (z, x, y) { return 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/' + z + '/' + y + '/' + x; } },
    roads: { id: 'roads', maxZoom: 18, url: function (z, x, y) { return 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/' + z + '/' + y + '/' + x; } },
    topo: { id: 'topo', maxZoom: 17, url: function (z, x, y) { return 'https://' + 'abc'[(x + y) % 3] + '.tile.opentopomap.org/' + z + '/' + x + '/' + y + '.png'; } }
  };
  var ATTR = {
    sat: '© Esri, Maxar, Earthstar Geographics',
    satLabels: '© Esri, Maxar, Earthstar Geographics · надписи: Esri Reference',
    topo: '© OpenTopoMap (CC-BY-SA), данни © OpenStreetMap'
  };

  // Състоянието, което се пази в браузъра.
  var S = { tracks: [], routes: [], tol: 20, curId: null };
  var A = { byTrack: {}, dups: [], pend: [], parts: [], gaps: [], closedGaps: [] }; // анализ на колекцията
  var G = null;     // геометрия на текущия маршрут
  var prof = null;  // профил на текущия маршрут
  var ui = {
    mode: 'select', hover: null, hl: null, cut: null, drawTarget: null, sel: null,
    undo: [], base: U.LS.get('base', 'sat'), labels: U.LS.get('labels', true), vtxShow: U.LS.get('vtxShow', true),
    grade: U.LS.get('grade', true), fold: U.LS.get('fold', {}), follower: null, pos: null, prog: null, followView: 'map',
    autoCenter: true, pin: null, profHover: null, picUrl: null, picMeta: null,
    orient: U.LS.get('orient', 'heading') === 'north' ? 'north' : 'heading', heading: null, lastWalk: null, lastPos: null, rot: 0, nameJob: null,
    awake: U.LS.get('awake', true) !== false
  };
  var map;

  function byId() { var o = {}; S.tracks.forEach(function (t) { o[t.id] = t; }); return o; }
  function track(id) { for (var i = 0; i < S.tracks.length; i++) if (S.tracks[i].id === id) return S.tracks[i]; return null; }
  function cur() {
    var r = S.routes.filter(function (x) { return x.id === S.curId; })[0];
    if (!r) {
      r = S.routes[0] || newRoute('Нов маршрут');
      S.curId = r.id;
    }
    return r;
  }
  function newRoute(name) {
    var r = { id: U.uid(), name: name || 'Нов маршрут', created: Date.now(), modified: Date.now(), items: [], walks: [] };
    S.routes.unshift(r);
    return r;
  }
  function trackColor(t) { return C['track-' + ((t.color || 0) % 8 + 1)] || C.muted; }
  function trackLabel(t) { return t ? t.name : 'липсващ трак'; }
  function kmRange(a, b) { return 'км ' + U.kmShort(Math.min(a, b)) + ' - ' + U.kmShort(Math.max(a, b)); }

  // ---- Съобщения ----
  var toastT;
  function toast(msg, err, ms) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (err ? ' err' : '');
    el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.hidden = true; }, ms || (err ? 6000 : 3200));
  }

  // ---- Съхранение ----
  function plainTrack(t) {
    return {
      id: t.id, name: t.name, title: t.title, color: t.color, pts: t.pts, breaks: t.breaks || [],
      wpts: t.wpts || [], cuts: t.cuts || [], skips: t.skips || [], openGaps: t.openGaps || [], visible: t.visible !== false, created: t.created, walk: !!t.walk
    };
  }
  function snapshotState() {
    return {
      format: 'gpx-konstruktor-kolekciya', version: 1,
      tracks: S.tracks.map(plainTrack),
      routes: S.routes.map(function (r) { return JSON.parse(JSON.stringify(r)); }),
      tol: S.tol, curId: S.curId
    };
  }
  var saveSoon = U.debounce(saveNow, 500);
  function saveNow() {
    return U.DB.set('collection', snapshotState()).catch(function () {
      toast('Браузърът не позволи записа. Изнеси колекцията, за да не се загуби.', true);
    });
  }
  function adopt(data, merge) {
    if (!data || !Array.isArray(data.tracks)) throw new Error('Файлът не е колекция от GPX конструктор.');
    var tracks = data.tracks.filter(function (t) { return t && t.id && Array.isArray(t.pts) && t.pts.length > 1; });
    var routes = (data.routes || []).filter(function (r) { return r && r.id && Array.isArray(r.items); });
    if (!merge) {
      // Старите колекции може да носят поле overrides (върнати дубликати) - то се пренебрегва.
      S.tracks = tracks; S.routes = routes;
      S.tol = data.tol != null && isFinite(+data.tol) ? +data.tol : 20; S.curId = data.curId || null;
    } else {
      tracks.forEach(function (t) {
        var i = S.tracks.findIndex(function (x) { return x.id === t.id; });
        if (i >= 0) S.tracks[i] = t; else S.tracks.push(t);
      });
      routes.forEach(function (r) {
        var i = S.routes.findIndex(function (x) { return x.id === r.id; });
        if (i >= 0) S.routes[i] = r; else S.routes.push(r);
      });
      if (data.curId && routes.some(function (r) { return r.id === data.curId; })) S.curId = data.curId;
    }
    S.tracks.forEach(function (t) { delete t._cum; });
    S.routes.forEach(function (r) { r.walks = r.walks || []; r.items = r.items || []; r.forks = r.forks || []; r.openGaps = r.openGaps || []; });
    // Записите на изминатото до 1.0.6 носеха края на частта като брой точки, а не като метри по трака.
    S.routes.forEach(function (r) {
      var it = r.items.length === 1 && r.items[0], t = it && it.type === 'part' && it.a === 0 && track(it.trackId);
      if (t && t.walk && r.name === t.name && it.b === t.pts.length - 1) { Core.prep(t); if (t.len > it.b) it.b = t.len; }
    });
  }

  // ---- Отмяна ----
  // full: пълен отпечатък (траковете и целия текущ маршрут) - за "Нов", който маха и траковете.
  function pushUndo(full) {
    if (full) {
      ui.undo.push(JSON.stringify({ full: true, rid: S.curId, tracks: S.tracks.map(plainTrack), route: cur() }));
      if (ui.undo.length > 100) ui.undo.shift();
      $('#undoBtn').disabled = false;
      return;
    }
    ui.undo.push(JSON.stringify({
      rid: S.curId, items: cur().items,
      cuts: S.tracks.map(function (t) { return [t.id, t.cuts || []]; }),
      skips: S.tracks.map(function (t) { return [t.id, t.skips || [], t.openGaps || []]; }),
      forks: cur().forks || [], openGaps: cur().openGaps || []
    }));
    if (ui.undo.length > 100) ui.undo.shift();
    $('#undoBtn').disabled = false;
  }
  function undo() {
    var s = ui.undo.pop();
    $('#undoBtn').disabled = !ui.undo.length;
    if (!s) return;
    s = JSON.parse(s);
    var r = S.routes.filter(function (x) { return x.id === s.rid; })[0];
    if (s.full) {
      S.tracks = s.tracks;
      if (r) S.routes[S.routes.indexOf(r)] = s.route; else S.routes.unshift(s.route);
      S.curId = s.rid;
      s.cuts = []; r = null;
    }
    if (r) { r.items = s.items; r.forks = s.forks || []; r.openGaps = s.openGaps || []; S.curId = r.id; }
    s.cuts.forEach(function (c) { var t = track(c[0]); if (t) t.cuts = c[1]; });
    (s.skips || []).forEach(function (c) { var t = track(c[0]); if (t) { t.skips = c[1]; t.openGaps = c[2]; } });
    ui.cut = null; ui.sel = null; ui.drawTarget = null;
    hidePointMenu();
    analyzeNow();
    toast('Отменено');
  }

  // ---- Преизчисляване ----
  function visibleTracks() { return S.tracks.filter(function (t) { return t.visible !== false; }); }
  function analyzeNow() {
    try {
      A = Core.analyze(visibleTracks(), S.tol);
    } catch (e) {
      console.error(e);
      A = { byTrack: {}, dups: [], pend: [], parts: [], gaps: [], closedGaps: [] };
      toast('Грешка при търсенето на дубликати: ' + e.message, true);
    }
    routeChanged(true);
  }
  var analyzeSoon = U.debounce(analyzeNow, 150);

  function routeChanged(noTouch) {
    var r = cur();
    if (!noTouch) r.modified = Date.now();
    try { G = Core.routeGeometry(r, byId(), A); } catch (e) { console.error(e); G = { items: [], pts: [], cum: [], len: 0, gaps: [], autoGaps: [] }; }
    numberItems();
    markBad();
    r.len = G.len;
    r.nPts = G.pts.length;
    renderPanel();
    elevSoon();
    saveSoon();
    map.redraw();
    $('#empty').hidden = !(S.tracks.length === 0 && r.items.length === 0);
  }

  // Височините се питат с пауза, за да не се пита услугата при всяко движение.
  var elevToken = 0, lastElevKey = null;
  var elevSoon = U.debounce(fetchElevation, 700);
  function fetchElevation() {
    var r = cur();
    if (!G || G.pts.length < 2) { prof = null; lastElevKey = null; renderStats(); drawProfile(); $('#elevNote').textContent = ''; return; }
    var key = G.pts.length + ':' + Math.round(G.len) + ':' + G.pts[0].join(',') + ':' + G.pts[G.pts.length - 1].join(',') +
      ':' + (G.autoGaps || []).map(function (gp) { return Math.round(gp.d0); }).join(',');
    if (key === lastElevKey && prof) return;
    lastElevKey = key;
    var token = ++elevToken;
    var step = Math.max(Elev.STEP, G.len / 3000);
    var samples = Elev.resample(G.pts, G.cum, step);
    $('#elevNote').textContent = 'Питам за височините...';
    Elev.fill(samples, function (f) {
      if (token === elevToken) $('#elevNote').textContent = 'Питам за височините... ' + Math.round(f * 100) + ' %';
    }).then(function (res) {
      if (token !== elevToken) return;
      var note = '';
      if (!res.ok) {
        // Резерва: височините от самите файлове, ако ги има.
        var fromFile = 0;
        samples.forEach(function (s) {
          if (s.ele != null) return;
          var n = Core.nearestOn(G.pts, G.cum, s.lat, s.lon);
          var p = n ? G.pts[n.i] : null;
          if (p && p[2] != null) { s.ele = p[2]; fromFile++; }
        });
        note = fromFile ? 'Услугата за височини не отговаря - височините са от файловете.' : 'Височините не са налични: услугата не отговаря.';
      } else note = 'Височини: ' + res.source + ', през ' + Math.round(step) + ' м, изгладени.';
      flattenAutoGaps(samples, G.autoGaps);
      prof = Elev.profile(samples);
      if (prof) { r.up = prof.up; r.down = prof.down; r.maxGrade = prof.maxUp; }
      $('#elevNote').textContent = note;
      renderStats(); drawProfile(); renderRoutes();
      saveSoon();
    }).catch(function (e) {
      if (token !== elevToken) return;
      $('#elevNote').textContent = 'Височините не са налични: ' + e.message;
    });
  }

  // В затворената сама дупка височината се тегли по права линия между двата края.
  function flattenAutoGaps(samples, gaps) {
    (gaps || []).forEach(function (gp) {
      var lo = null, hi = null;
      samples.forEach(function (s) {
        if (s.ele == null) return;
        if (s.d <= gp.d0 + 0.5) lo = s;
        else if (!hi && s.d >= gp.d1 - 0.5) hi = s;
      });
      if (!lo || !hi || hi.d <= lo.d) return;
      samples.forEach(function (s) {
        if (s.d > lo.d && s.d < hi.d) s.ele = lo.ele + (s.d - lo.d) / (hi.d - lo.d) * (hi.ele - lo.ele);
      });
    });
  }

  // ---- Карта: основа и слоеве ----
  function applyLayers() {
    var L = ui.base === 'topo' ? [LAYERS.topo] : ui.labels ? [LAYERS.sat, LAYERS.places, LAYERS.roads] : [LAYERS.sat];
    map.setLayers(L);
    $$('.mapctl .seg.base button').forEach(function (b) { b.classList.toggle('on', b.dataset.base === ui.base); });
    $('#labelsToggle').checked = ui.labels;
    $('#labelsChk').hidden = ui.base === 'topo';
    $('#attrib').textContent = ui.base === 'topo' ? ATTR.topo : ui.labels ? ATTR.satLabels : ATTR.sat;
  }

  var C = {};
  function refreshColors() {
    ['route-a', 'route-b', 'casing', 'dup', 'junction', 'gap', 'cut', 'pos', 'walked', 'walk-gap', 'accent', 'map-bg', 'ink', 'surface', 'ok', 'warn', 'danger', 'muted', 'line', 'accent-soft', 'track-1', 'track-2', 'track-3', 'track-4', 'track-5', 'track-6', 'track-7', 'track-8'].forEach(function (k) {
      C[k] = U.cssVar('--app-' + k);
    });
    if (map) map.redraw();
  }
  function itemColor(no) { return no % 2 === 0 ? C['route-b'] : C['route-a']; }

  // Номерата на частите: само участъците, които имат точки.
  function numberItems() {
    var n = 0;
    G.items.forEach(function (g, gi) {
      // Общата отсечка не е част: без номер, рисува се в цвета на частта преди нея.
      // Връзката между две части (начертана или сама) също не е част и не се брои.
      if (g.shared || g.auto || g.link) {
        g.no = 0; g.colorNo = n;
        if (g.link && g.pts.length) g.len = U.lengthOf(routeSpan(g, gi));
        return;
      }
      g.no = g.pts.length ? ++n : 0;
      g.colorNo = g.no;
      if (g.item.type === 'draw' && g.pts.length) g.len = U.lengthOf(routeSpan(g, gi));
    });
    G.count = n;
    G.forks = Core.routeForks(G, A.junctions, S.tol, byId());
  }

  function path(ctx, pr, pts) {
    ctx.beginPath();
    var lx = null, ly = null;
    for (var i = 0; i < pts.length; i++) {
      var q = pr(pts[i][0], pts[i][1]);
      if (i && i < pts.length - 1 && Math.abs(q[0] - lx) < 1 && Math.abs(q[1] - ly) < 1) continue;
      if (lx === null) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
      lx = q[0]; ly = q[1];
    }
  }
  function stroke(ctx, color, width, dash) {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function casedLine(ctx, pr, pts, color, w, dash) {
    path(ctx, pr, pts);
    stroke(ctx, C.casing, w + 3);
    stroke(ctx, color, w, dash);
  }
  function badge(ctx, x, y, text, fill, r) {
    r = r || 10;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.casing; ctx.stroke();
    ctx.fillStyle = C.casing;
    ctx.font = '700 11px ' + U.cssVar('--app-mono');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }
  function mapLabel(ctx, x, y, text, color) {
    ctx.font = '600 12px ' + U.cssVar('--app-font');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = color || '#1f1d1a'; ctx.fillText(text, x, y);
  }

  // Точките на трака без махнатите дубликати - по една поредица за всеки видим отрязък.
  function shownRanges(t, secs) {
    var dups = secs.filter(function (s) { return s.kind === 'dup'; });
    Core.prep(t);
    ui.drawn[t.id] = [];
    if (!dups.length) { ui.drawn[t.id].push([0, t.len]); return [t.pts]; }
    var out = [], pos = 0;
    dups.forEach(function (d) {
      if (d.a > pos) { out.push(Core.slice(t, pos, d.a)); ui.drawn[t.id].push([pos, d.a]); }
      pos = Math.max(pos, d.b);
    });
    if (pos < t.len) { out.push(Core.slice(t, pos, t.len)); ui.drawn[t.id].push([pos, t.len]); }
    return out;
  }

  /* Маркерите на непотвърдените дубликати: кръг с × по средата на участъка. Застъпени
     маркери се раздалечават, за да се натискат поотделно. */
  var MARK_R = 13;
  function placeMarkers(pr) {
    var tb = byId(), out = [];
    var offs = [[0, 0], [0, -32], [32, 0], [0, 32], [-32, 0], [28, -28], [-28, 28], [28, 28], [-28, -28], [0, -64], [64, 0]];
    (A.pend || []).forEach(function (s) {
      var t = tb[s.trackId]; if (!t) return;
      var p = Core.pointAt(t, (s.a + s.b) / 2), q = pr(p[0], p[1]);
      for (var k = 0; k < offs.length; k++) {
        var x = q[0] + offs[k][0], y = q[1] + offs[k][1];
        if (k === offs.length - 1 || !out.some(function (o) { return Math.hypot(o.x - x, o.y - y) < 2 * MARK_R + 4; })) {
          out.push({ x: x, y: y, ax: q[0], ay: q[1], sec: s, key: s.key });
          break;
        }
      }
    });
    return out;
  }
  function drawMarkers(ctx, m, pr, hv) {
    var ms = placeMarkers(pr);
    ms.forEach(function (o) {
      if (o.x < -30 || o.y < -30 || o.x > m.w + 30 || o.y > m.h + 30) return;
      var hot = hv && hv.kind === 'marker' && hv.sec.key === o.key;
      if (o.x !== o.ax || o.y !== o.ay) {
        ctx.beginPath(); ctx.moveTo(o.ax, o.ay); ctx.lineTo(o.x, o.y); stroke(ctx, C.dup, 1.5, [2, 3]);
      }
      // При посочване кръгът се свива и под него пише какво прави кликът.
      var r = hot ? MARK_R - 3 : MARK_R, k = r * 0.38;
      ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
      ctx.fillStyle = C.dup; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = C.casing; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(o.x - k, o.y - k); ctx.lineTo(o.x + k, o.y + k); ctx.moveTo(o.x + k, o.y - k); ctx.lineTo(o.x - k, o.y + k);
      stroke(ctx, C.casing, 2.4);
      if (hot) {
        ctx.font = '600 12px ' + U.cssVar('--app-font');
        var w = ctx.measureText('махни дубликата').width;
        mapLabel(ctx, o.x - w / 2, o.y + MARK_R + 10, 'махни дубликата', C.dup);
      }
    });
    ui.markers = ms;
  }
  function hitMarker(p) {
    var best = null;
    (ui.markers || []).forEach(function (o) {
      var d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d <= MARK_R + 5 && (!best || d < best.d)) best = { kind: 'marker', sec: o.sec, d: d };
    });
    return best;
  }

  // Първите метри от клона след точката на прекъсване.
  function branchStub(t, br) {
    var L = Math.min(300, br.b - br.a);
    return br.from === 'a' ? Core.slice(t, br.a, br.a + L) : Core.slice(t, br.b - L, br.b);
  }
  function forkOf(j) { return (G && G.forks || []).filter(function (f) { return f.j === j; })[0]; }
  // Къде стои пръстенът: върху точката на трака, който остава след махането на дубликата
  // (ядрото я дава в j.ring), така че не виси отстрани и след махането.
  function ringAt(j) { return j.ring || [j.lat, j.lon]; }
  function drawForks(ctx, m, pr, tb, hv) {
    var drawn = [];
    // Клоновете: избраният се подчертава, другите се приглушават; при посочване светват всички.
    (A.junctions || []).forEach(function (j) {
      var f = forkOf(j), hot = hv && hv.kind === 'fork' && hv.j === j;
      if (!hot && !(f && f.chosen >= 0)) return;
      j.branches.forEach(function (br, bi) {
        var t = tb[br.trackId]; if (!t || f && bi === f.incoming) return;
        path(ctx, pr, branchStub(t, br));
        if (hot || bi === f.chosen) { ctx.globalAlpha = 0.4; stroke(ctx, C.junction, 12); ctx.globalAlpha = 1; }
        else { ctx.globalAlpha = 0.7; stroke(ctx, C.casing, 6); ctx.globalAlpha = 1; stroke(ctx, C.muted, 2.5, [4, 5]); }
      });
    });
    (A.junctions || []).forEach(function (j) {
      var at = ringAt(j), q = pr(at[0], at[1]);
      if (q[0] < -20 || q[1] < -20 || q[0] > m.w + 20 || q[1] > m.h + 20) return;
      var f = forkOf(j), sel = !!(f && f.chosen >= 0), hot = hv && hv.kind === 'fork' && hv.j === j;
      var r = sel ? 10 : 7;
      if (hot) r += 2;
      ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, Math.PI * 2);
      ctx.fillStyle = sel ? C.junction : C.casing; ctx.fill();
      ctx.lineWidth = sel ? 2.5 : 3; ctx.strokeStyle = sel ? C.casing : C.junction; ctx.stroke();
      if (sel) {
        ctx.beginPath(); ctx.moveTo(q[0] - 4, q[1] - 2); ctx.lineTo(q[0], q[1] + 3); ctx.lineTo(q[0] + 4, q[1] - 2);
        stroke(ctx, C.casing, 2);
      }
      drawn.push({ key: j.key, x: q[0], y: q[1], selected: sel });
    });
    ui.rings = drawn;
  }

  /* Попълненото при дупка в GPS в изминат трак (Core.walkGaps): отрязъци [от, до] в метри по трака.
     Чертае се кехлибарено на пунктир - на картата, в "Картина" и върху запазената картина. */
  function walkGapIv(t) {
    if (!t || !t.walk) return [];
    Core.prep(t);
    if (!t._gaps || t._gapsN !== t.pts.length) {
      t._gaps = Core.walkGaps(t.pts).map(function (g) { return [t._cum[g[0]], t._cum[g[1]]]; });
      t._gapsN = t.pts.length;
    }
    return t._gaps;
  }
  // Линиите на дупките, които попадат в дадените отрязъци [от, до] от трака.
  function walkGapLines(t, ivs) {
    var out = [];
    walkGapIv(t).forEach(function (g) {
      ivs.forEach(function (iv) {
        var a = Math.max(g[0], Math.min(iv[0], iv[1])), b = Math.min(g[1], Math.max(iv[0], iv[1]));
        if (b - a > 0.5) out.push(Core.slice(t, a, b));
      });
    });
    return out;
  }
  // Дупките в части на маршрута, взети от изминат трак.
  function routeGapLines() {
    var out = [];
    if (!G) return out;
    G.items.forEach(function (g) {
      if (g.item.type !== 'part' || !g.pts.length) return;
      out = out.concat(walkGapLines(track(g.item.trackId), [[g.item.a, g.item.b]]));
    });
    return out;
  }
  // Дупките в записа на текущото следене.
  function recGapLines(rec) {
    return Core.walkGaps(rec).map(function (g) { return rec.slice(g[0], g[1] + 1); });
  }

  function drawMap(ctx, m) {
    var pr = m.projector();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    var tb = byId();
    var following = !!ui.follower;

    // 1. Тракове-източници - тънко, в собствен цвят.
    ui.drawn = {};
    visibleTracks().forEach(function (t) {
      var col = trackColor(t);
      var secs = A.byTrack[t.id] || [];
      var hlT = ui.hl && ui.hl.track === t.id;
      // Махнатият дубликат не се чертае: линията на трака се прекъсва там.
      shownRanges(t, secs).forEach(function (pts) {
        path(ctx, pr, pts);
        if (hlT) stroke(ctx, C.accent, 10);
        stroke(ctx, C.casing, 4.5);
        stroke(ctx, col, 2.2);
      });
      secs.forEach(function (s) {
        if (s.kind === 'part' || s.kind === 'dup') return;
        var pts = Core.slice(t, s.a, s.b);
        path(ctx, pr, pts);
        if (s.kind === 'cut') { stroke(ctx, C.casing, 7); stroke(ctx, C.cut, 5, [2, 5]); }
        else if (s.kind === 'gap') { stroke(ctx, C.gap, 2, [3, 5]); }
      });
      walkGapLines(t, ui.drawn[t.id] || []).forEach(function (pts) {
        path(ctx, pr, pts); stroke(ctx, C.casing, 4.5); stroke(ctx, C['walk-gap'], 2.2, [6, 5]);
      });
    });

    // Посочен ред от списъка или сегмент под курсора.
    var hv = ui.hover;
    if (hv && hv.kind === 'part') {
      var ht = tb[hv.sec.trackId];
      if (ht) { path(ctx, pr, Core.slice(ht, hv.sec.a, hv.sec.b)); stroke(ctx, C.accent, 9); stroke(ctx, C.casing, 4); stroke(ctx, trackColor(ht), 2.5); }
    }
    if (ui.hl && ui.hl.sec) {
      var hs = ui.hl.sec, htt = tb[hs.trackId];
      if (htt) { path(ctx, pr, Core.slice(htt, hs.a, hs.b)); ctx.globalAlpha = 0.45; stroke(ctx, C.accent, 12); ctx.globalAlpha = 1; }
    }

    // 2. Сглобеният маршрут - дебело, частите се редуват по цвят.
    if (G && G.pts.length > 1) {
      if (following && ui.prog) {
        path(ctx, pr, G.pts); stroke(ctx, C.casing, 8);
        var done = [], rest = [];
        G.pts.forEach(function (p, i) { if (G.cum[i] <= ui.prog.d) done.push(p); if (G.cum[i] >= ui.prog.d) rest.push(p); });
        var mid = [ui.prog.lat, ui.prog.lon];
        done.push(mid); rest.unshift(mid);
        path(ctx, pr, rest); stroke(ctx, C['route-a'], 4.5, [9, 7]);
        path(ctx, pr, done); stroke(ctx, C['route-a'], 5.5);
      } else {
        G.items.forEach(function (g, gi) {
          if (!g.pts.length || g.auto) return;
          var full = routeSpan(g, gi);
          path(ctx, pr, full); stroke(ctx, C.casing, 9);
        });
        G.items.forEach(function (g, gi) {
          if (!g.pts.length || g.auto) return;
          var full = routeSpan(g, gi);
          var hl = ui.hl && ui.hl.item === g.idx || hv && hv.kind === 'item' && hv.idx === g.idx;
          if (hl) { path(ctx, pr, full); ctx.globalAlpha = 0.5; stroke(ctx, C.accent, 14); ctx.globalAlpha = 1; }
          path(ctx, pr, full);
          if (g.link) stroke(ctx, itemColor(g.colorNo), 3, [6, 5]);
          else stroke(ctx, itemColor(g.colorNo), 5.5, g.item.type === 'draw' ? [10, 6] : null);
          if (g.bad) { path(ctx, pr, g.pts); stroke(ctx, C.dup, 2.5, [4, 4]); }
        });
        // Затворените сами дупки: тънка прекъсната линия - поправено, не записано.
        (G.autoGaps || []).forEach(function (gp) {
          var gi = G.items.filter(function (x) { return x.gap === gp || x.idx === gp.itemIdx && gp.kind === 'track'; })[0];
          path(ctx, pr, [gp.from, gp.to]);
          stroke(ctx, C.casing, 6);
          stroke(ctx, itemColor(gi ? gi.colorNo : 1), 2.5, [5, 4]);
        });
      }
      routeGapLines().forEach(function (pts) {
        path(ctx, pr, pts); stroke(ctx, C.casing, 7); stroke(ctx, C['walk-gap'], 5, [9, 7]);
      });
      // Начало и край.
      var s0 = pr(G.pts[0][0], G.pts[0][1]), e0 = pr(G.pts[G.pts.length - 1][0], G.pts[G.pts.length - 1][1]);
      var loop = Math.hypot(s0[0] - e0[0], s0[1] - e0[1]) < 12;
      endMarker(ctx, e0, C.danger, loop ? null : 'Край');
      endMarker(ctx, s0, C.ok, loop ? 'Старт / край' : 'Старт');
      // Номера на частите.
      if (!following && G.count > 0) {
        G.items.forEach(function (g) {
          if (!g.pts.length || g.shared || g.auto || g.link || g.item.type === 'draw' && g.pts.length < 2) return;
          var mp = g.pts[Math.floor(g.pts.length / 2)], q = pr(mp[0], mp[1]);
          badge(ctx, q[0], q[1], g.bad ? '!' : String(g.no), g.bad ? C.dup : itemColor(g.no));
        });
      }
    }

    // Точки на прекъсване: пръстен на всяко място, където се събират или пресичат приети участъци.
    if (!following) drawForks(ctx, m, pr, tb, hv);

    // 3. Дупки между частите.
    if (G && !following) {
      G.gaps.forEach(function (gp) {
        var a = pr(gp.from[0], gp.from[1]), b = pr(gp.to[0], gp.to[1]);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        stroke(ctx, C.casing, 5); stroke(ctx, C.gap, 3, [5, 5]);
        mapLabel(ctx, (a[0] + b[0]) / 2 + 8, (a[1] + b[1]) / 2, 'дупка ' + U.dist(gp.d), C.gap);
      });
    }

    // 5. Чертаните точки.
    // Ключът „Точки“ ги скрива всичките, освен избраната; хващат се и скрити.
    ui.vtx = [];
    if (G && !following) {
      var vn = 0;
      G.items.forEach(function (g) {
        if (g.item.type !== 'draw') return;
        g.item.pts.forEach(function (p, pi) {
          vn++;
          var q = pr(p.lat, p.lon);
          var sel = ui.sel && ui.sel.idx === g.idx && ui.sel.pi === pi;
          if (!ui.vtxShow && !sel) return;
          ui.vtx.push({ x: q[0], y: q[1], sel: !!sel, label: p.name || (m.zoom >= 15 ? String(vn) : '') });
          ctx.beginPath(); ctx.arc(q[0], q[1], sel ? 8 : 5.5, 0, Math.PI * 2);
          ctx.fillStyle = sel ? C.accent : C.casing; ctx.fill();
          ctx.lineWidth = 2.5; ctx.strokeStyle = itemColor(g.link ? g.colorNo : g.no); ctx.stroke();
          if (p.name) mapLabel(ctx, q[0] + 10, q[1], p.name);
          else if (m.zoom >= 15) mapLabel(ctx, q[0] + 9, q[1] - 9, String(vn), C.muted);
        });
      });
    }

    // Маркерите на дубликатите - над всичко от маршрута.
    if (!following) drawMarkers(ctx, m, pr, hv); else ui.markers = [];

    // Спирки от файловете.
    if (m.zoom >= 12) {
      visibleTracks().forEach(function (t) {
        (t.wpts || []).forEach(function (w) {
          var q = pr(w.lat, w.lon);
          ctx.beginPath(); ctx.moveTo(q[0], q[1] - 6); ctx.lineTo(q[0] + 6, q[1]); ctx.lineTo(q[0], q[1] + 6); ctx.lineTo(q[0] - 6, q[1]); ctx.closePath();
          ctx.fillStyle = C.casing; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = trackColor(t); ctx.stroke();
          if (w.name) mapLabel(ctx, q[0] + 9, q[1], w.name);
        });
      });
    }

    // 6. Изрязване, което чака потвърждение: щриховано, с две точки за влачене.
    if (ui.cut) {
      var ct = tb[ui.cut.trackId];
      if (ct) {
        if (ui.cut.b != null) {
          path(ctx, pr, Core.slice(ct, ui.cut.a, ui.cut.b));
          stroke(ctx, C.casing, 11); stroke(ctx, C.cut, 9); stroke(ctx, C.casing, 9, [2, 6]);
        }
        [ui.cut.a, ui.cut.b].forEach(function (d, k) {
          if (d == null) return;
          var p = Core.pointAt(ct, d), q = pr(p[0], p[1]);
          ctx.beginPath(); ctx.arc(q[0], q[1], 9, 0, Math.PI * 2);
          ctx.fillStyle = C.casing; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.cut; ctx.stroke();
          mapLabel(ctx, q[0] + 13, q[1], 'км ' + U.kmShort(d) + (k === 0 && ui.cut.b != null ? '' : ''));
        });
      }
    }

    // 7. Следене: изминатото, положението, отклонението.
    if (ui.follower) {
      var rec = ui.follower.rec;
      if (rec.length > 1) {
        path(ctx, pr, rec); stroke(ctx, C.casing, 6); stroke(ctx, C.walked, 3.5);
        recGapLines(rec).forEach(function (pts) { path(ctx, pr, pts); stroke(ctx, C.casing, 4); stroke(ctx, C['walk-gap'], 3.5, [8, 6]); });
      }
    }
    if (ui.pos) {
      var pq = pr(ui.pos.lat, ui.pos.lon);
      if (ui.prog && ui.prog.isOff) {
        var nq = pr(ui.prog.lat, ui.prog.lon);
        ctx.beginPath(); ctx.moveTo(pq[0], pq[1]); ctx.lineTo(nq[0], nq[1]);
        stroke(ctx, C.casing, 5); stroke(ctx, C.warn, 3, [4, 4]);
        mapLabel(ctx, pq[0] + 14, pq[1] - 14, U.meters(ui.prog.off) + ' встрани', C.warn);
      }
      var accPx = (ui.pos.acc || 0) / m.metersPerPixel();
      if (accPx > 12) {
        ctx.beginPath(); ctx.arc(pq[0], pq[1], accPx, 0, Math.PI * 2);
        ctx.globalAlpha = 0.15; ctx.fillStyle = C.pos; ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.arc(pq[0], pq[1], 8, 0, Math.PI * 2);
      ctx.fillStyle = C.pos; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.casing; ctx.stroke();
    }

    // Намереното място и посоченото място от профила.
    if (ui.pin) {
      var pp = pr(ui.pin.lat, ui.pin.lon);
      ctx.beginPath(); ctx.arc(pp[0], pp[1] - 14, 7, Math.PI * 0.15, Math.PI * 0.85, true); ctx.lineTo(pp[0], pp[1]); ctx.closePath();
      ctx.fillStyle = C.accent; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.casing; ctx.stroke();
      if (ui.pin.name) mapLabel(ctx, pp[0] + 10, pp[1] - 14, ui.pin.name);
    }
    if (ui.profHover) {
      var ph = pr(ui.profHover.lat, ui.profHover.lon);
      ctx.beginPath(); ctx.arc(ph[0], ph[1], 7, 0, Math.PI * 2);
      ctx.fillStyle = C.accent; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.casing; ctx.stroke();
    }
  }
  function endMarker(ctx, q, color, text) {
    ctx.beginPath(); ctx.arc(q[0], q[1], 8, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.casing; ctx.stroke();
    if (text) mapLabel(ctx, q[0] + 12, q[1], text);
  }
  // Чертаният участък се рисува заедно със свързващите отсечки към съседите.
  function routeSpan(g, gi) {
    if (g.item.type !== 'draw') return g.pts;
    var out = g.pts.slice();
    for (var i = gi - 1; i >= 0; i--) if (G.items[i].pts.length) { out.unshift(G.items[i].pts[G.items[i].pts.length - 1]); break; }
    for (var j = gi + 1; j < G.items.length; j++) if (G.items[j].pts.length) { out.push(G.items[j].pts[0]); break; }
    return out;
  }

  // ---- Попадения върху картата ----
  function screenDist(pr, pts, x, y) {
    var best = Infinity, bi = -1;
    var prev = null;
    for (var i = 0; i < pts.length; i++) {
      var q = pr(pts[i][0], pts[i][1]);
      if (prev) {
        var r = U.projectSeg(x, y, prev[0], prev[1], q[0], q[1]);
        if (r.d2 < best) { best = r.d2; bi = i - 1; }
      }
      prev = q;
    }
    return { d: Math.sqrt(best), i: bi };
  }
  function hitVertex(p, r) {
    if (!G) return null;
    var pr = map.projector(), best = null;
    G.items.forEach(function (g) {
      if (g.item.type !== 'draw') return;
      g.item.pts.forEach(function (v, pi) {
        var q = pr(v.lat, v.lon), d = Math.hypot(q[0] - p.x, q[1] - p.y);
        if (d <= (r || 12) && (!best || d < best.d)) best = { kind: 'vertex', idx: g.idx, pi: pi, d: d };
      });
    });
    return best;
  }
  function hitCutHandle(p) {
    if (!ui.cut) return null;
    var t = track(ui.cut.trackId); if (!t) return null;
    var pr = map.projector(), best = null;
    ['a', 'b'].forEach(function (k) {
      if (ui.cut[k] == null) return;
      var pt = Core.pointAt(t, ui.cut[k]), q = pr(pt[0], pt[1]);
      var d = Math.hypot(q[0] - p.x, q[1] - p.y);
      if (d < 16 && (!best || d < best.d)) best = { k: k, d: d };
    });
    return best;
  }
  function nearestTrack(p, maxPx) {
    var pr = map.projector(), best = null;
    visibleTracks().forEach(function (t) {
      var r = screenDist(pr, t.pts, p.x, p.y);
      if (r.d <= maxPx && (!best || r.d < best.d)) best = { t: t, d: r.d };
    });
    return best;
  }
  function hitTest(p) {
    var pr = map.projector();
    if (ui.follower) return null;
    var v = hitVertex(p);
    if (v) return v;
    var mk = hitMarker(p);
    if (mk) return mk;
    var best = null;
    (A.junctions || []).forEach(function (j) {
      var at = ringAt(j), q = pr(at[0], at[1]), d = Math.hypot(q[0] - p.x, q[1] - p.y);
      if (d <= 11 && (!best || d < best.d)) best = { kind: 'fork', j: j, d: d };
    });
    if (best) return best;
    if (G) {
      G.gaps.forEach(function (gp) {
        var r = screenDist(pr, [gp.from, gp.to], p.x, p.y);
        if (r.d <= 8 && (!best || r.d < best.d)) best = { kind: 'gap', gap: gp, d: r.d };
      });
      G.items.forEach(function (g, gi) {
        if (!g.pts.length || g.shared || g.auto) return;
        var r = screenDist(pr, g.item.type === 'draw' ? routeSpan(g, gi) : g.pts, p.x, p.y);
        if (r.d <= 9 && (!best || r.d < best.d - 2)) best = { kind: 'item', idx: g.idx, g: g, d: r.d };
      });
    }
    var nt = nearestTrack(p, 9);
    if (nt && (!best || nt.d < best.d - 3)) {
      var n = Core.nearestOnTrack(nt.t, p.lat, p.lon);
      var secs = A.byTrack[nt.t.id] || [];
      var sec = secs.filter(function (s) { return s.kind !== 'gap' && n.d >= s.a && n.d <= s.b; })[0];
      // Махнат дубликат не се хваща: кликът върху него не прави нищо.
      if (sec && sec.kind === 'dup') best = { kind: 'none', d: nt.d };
      else if (sec) {
        if (sec.kind === 'cut') best = { kind: 'cut', sec: sec, d: nt.d };
        else best = { kind: 'part', sec: sec, d: nt.d };
      }
    }
    return best;
  }

  function tipText(h) {
    var tb = byId();
    if (h.kind === 'part') {
      var t = tb[h.sec.trackId];
      var inR = findItemFor(h.sec) >= 0;
      var fk = inR ? null : forkFor(h.sec);
      return U.esc(trackLabel(t)) + ' · ' + kmRange(h.sec.a, h.sec.b) + ' · <b>' + U.km(h.sec.len) + '</b><br>' +
        (inR ? 'Вече е в маршрута. Клик я маха' : fk ? 'Клик: от точката на прекъсване маршрутът продължава по този клон' : 'Клик я слага в маршрута като част ' + (G.count + 1));
    }
    if (h.kind === 'item') {
      if (h.g.link) return 'Връзка между частите · <b>' + U.dist(h.g.len) + '</b><br>Клик я маха от маршрута';
      return 'Част ' + h.g.no + ' · <b>' + U.km(h.g.len) + '</b>' + (h.g.bad ? '<br>Вече не е валидна (' + h.g.badWhy + '). Клик я маха' : '<br>Клик я маха от маршрута');
    }
    if (h.kind === 'gap') return 'дупка <b>' + U.dist(h.gap.d) + '</b><br>Клик: затвори с чертаене';
    if (h.kind === 'fork') {
      var f = forkOf(h.j);
      return 'Точка на прекъсване · ' + h.j.branches.length + ' клона<br>' +
        (f && f.chosen >= 0 ? 'Клик върху клона, по който да продължи, сменя посоката' : 'Клик върху клон го слага в маршрута');
    }
    if (h.kind === 'vertex') return 'Точка · клик за име или махане';
    if (h.kind === 'cut') return 'Изрязано · върни го от списъка под картата';
    return '';
  }
  var hoverRaf = null, hoverP = null;
  function onHover(p) {
    hoverP = p;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(function () {
      hoverRaf = null;
      var p2 = hoverP, tip = $('#tip');
      var h = p2 && (ui.mode === 'select' || ui.mode === 'remove' || ui.mode === 'move') ? hitTest(p2) : null;
      if (h && ui.mode !== 'select' && h.kind !== 'vertex') h = null;
      if (p2 && ui.mode === 'cut') {
        var nt = nearestTrack(p2, 16);
        h = nt ? { kind: 'cuthint' } : null;
      }
      var changed = JSON.stringify(h && [h.kind, h.idx, h.pi, h.sec && h.sec.key, h.j && h.j.key]) !== JSON.stringify(ui.hover && [ui.hover.kind, ui.hover.idx, ui.hover.pi, ui.hover.sec && ui.hover.sec.key, ui.hover.j && ui.hover.j.key]);
      ui.hover = h;
      map.canvas.classList.toggle('hot', !!h && h.kind !== 'none');
      if (h && h.kind !== 'cuthint' && h.kind !== 'none' && h.kind !== 'marker') {
        tip.innerHTML = tipText(h);
        tip.hidden = false;
        var x = Math.min(p2.x + 14, map.w - 290), y = p2.y + 16;
        if (y > map.h - 60) y = p2.y - 50;
        tip.style.left = x + 'px'; tip.style.top = y + 'px';
      } else tip.hidden = true;
      if (changed) { map.redraw(); highlightRows(); }
    });
  }

  // ---- Действия върху картата ----
  function findItemFor(sec) {
    var items = cur().items;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.type !== 'part' || it.trackId !== sec.trackId) continue;
      var a = Math.min(it.a, it.b), b = Math.max(it.a, it.b);
      if (Core.overlap(a, b, sec.a, sec.b) > 0.5 * Math.min(b - a, sec.len)) return i;
    }
    return -1;
  }
  function lastEnd() {
    if (!G) return null;
    for (var i = G.items.length - 1; i >= 0; i--) if (G.items[i].pts.length) return G.items[i].pts[G.items[i].pts.length - 1];
    return null;
  }
  function addPart(sec) {
    var existing = findItemFor(sec);
    pushUndo();
    if (existing >= 0) {
      var gx = G.items.filter(function (x) { return x.idx === existing; })[0];
      var no = gx ? gx.no : existing + 1;
      cur().items.splice(existing, 1);
      toast('Част ' + no + ' е махната от маршрута. "Отмени" я връща.');
    } else {
      var t = track(sec.trackId), rev = false, e = lastEnd();
      if (t && e) {
        var s0 = Core.pointAt(t, sec.a), s1 = Core.pointAt(t, sec.b);
        rev = U.hav(e[0], e[1], s1[0], s1[1]) < U.hav(e[0], e[1], s0[0], s0[1]);
      }
      cur().items.push({ type: 'part', trackId: sec.trackId, a: sec.a, b: sec.b, rev: rev });
      ui.drawTarget = null;
      toast('Част ' + ((G ? G.count : 0) + 1) + ' в маршрута · ' + U.km(sec.len));
    }
    routeChanged();
  }
  function removeItem(idx) {
    var g = G.items.filter(function (x) { return x.idx === idx; })[0];
    pushUndo();
    cur().items.splice(idx, 1);
    if (ui.drawTarget != null && ui.drawTarget >= idx) ui.drawTarget = ui.drawTarget === idx ? null : ui.drawTarget - 1;
    toast((g && g.no ? 'Част ' + g.no : 'Участъкът') + ' е махнат от маршрута. "Отмени" го връща.');
    routeChanged();
  }
  // Клон на точка на прекъсване, през която маршрутът вече продължава по друг клон.
  function forkFor(sec) {
    var res = null;
    (G && G.forks || []).forEach(function (f) {
      if (res || f.atEnd || f.atStart) return;
      f.j.branches.forEach(function (br, bi) {
        if (!res && br.key === sec.key && bi !== f.chosen && bi !== f.incoming) res = { fork: f, br: br };
      });
    });
    return res;
  }
  function switchFork(fk) {
    pushUndo();
    Core.switchFork(cur(), fk.fork, fk.br, byId(), S.tol);
    ui.drawTarget = null;
    toast('Посоката е сменена: оттук по ' + trackLabel(track(fk.br.trackId)) + '. "Отмени" връща старата.');
    routeChanged();
  }
  // Клик върху маркера: точно този дубликат излиза от маршрута и изчезва от картата.
  function skipDup(sec) {
    var t = track(sec.trackId); if (!t) return;
    pushUndo();
    t.skips = Core.mergeIv((t.skips || []).concat([{ a: sec.a, b: sec.b }]));
    var r = cur();
    r.items = Core.trimItems(r.items, sec.trackId, sec.a, sec.b);
    r.modified = Date.now();
    ui.drawTarget = null;
    analyzeNow();
    // Границата на дубликата може да се е преместила към точката на прекъсване: краищата на
    // изрязаните части я следват, за да стигнат до свръзката.
    var moved = false;
    r.items.forEach(function (it) {
      if (it.type !== 'part' || it.trackId !== sec.trackId) return;
      (A.byTrack[sec.trackId] || []).forEach(function (s) {
        if (s.kind !== 'part' || s.pend) return;
        if (Math.abs(Math.min(it.a, it.b) - sec.b) < 1 && s.a < sec.b && s.b > sec.b) { if (it.a < it.b) it.a = s.a; else it.b = s.a; moved = true; }
        if (Math.abs(Math.max(it.a, it.b) - sec.a) < 1 && s.b > sec.a && s.a < sec.a) { if (it.a < it.b) it.b = s.b; else it.a = s.b; moved = true; }
      });
    });
    if (moved) routeChanged();
    toast('Дубликатът е махнат · ' + U.km(sec.len) + '. "Отмени" го връща.');
  }
  // "Отвори пак": затворената сама дупка става обикновена дупка с двата бутона.
  function reopenGap(gp) {
    pushUndo();
    if (gp.kind === 'track') {
      var t = track(gp.trackId);
      if (t) t.openGaps = (t.openGaps || []).concat([Math.round(gp.a * 10) / 10]);
    } else {
      var r = cur();
      r.openGaps = (r.openGaps || []).concat([[gp.from[0], gp.from[1], gp.to[0], gp.to[1]]]);
    }
    analyzeNow();
    toast('Дупката е отворена. "Отмени" я затваря пак.');
  }
  function closeGap(gp) {
    pushUndo();
    cur().items.splice(gp.beforeIdx, 0, { type: 'draw', pts: [], link: true });
    ui.drawTarget = gp.beforeIdx;
    setMode('add');
    toast('Цъкни по картата точките, през които да мине връзката');
    routeChanged();
  }
  function bridgeGap(gp) {
    pushUndo();
    cur().items.splice(gp.beforeIdx, 0, { type: 'draw', pts: [], bridge: true, link: true });
    routeChanged();
  }
  /* Къде отива връзка, начертана без избрана дупка: между двете съседни части, до чийто
     скок е най-близо кликът (предимство имат местата със скок). Никога в края на маршрута -
     стартът и краят остават върху трак. -1: частите са по-малко от две. */
  function linkSlot(p) {
    var items = cur().items, best = -1, bs = Infinity;
    var real = G.items.filter(function (g) { return g.idx != null && g.item.type === 'part' && g.pts.length; });
    if (real.length < 2) return -1;
    var pr = map.projector(), q = pr(p.lat, p.lon);
    for (var k = 1; k < real.length; k++) {
      var P = real[k - 1], N = real[k];
      if (N.idx !== P.idx + 1) continue;
      var e = P.pts[P.pts.length - 1], s = N.pts[0];
      var d = screenDist(pr, [e, s], q[0], q[1]).d;
      if (U.hav(e[0], e[1], s[0], s[1]) <= Core.LINK_MIN) d += 1e6;
      if (d < bs) { bs = d; best = N.idx; }
    }
    return best >= 0 && best <= items.length ? best : -1;
  }
  function addVertex(p) {
    var items = cur().items;
    pushUndo();
    var t = ui.drawTarget;
    if (t == null || !items[t] || items[t].type !== 'draw') {
      var slot = linkSlot(p);
      if (slot >= 0) { items.splice(slot, 0, { type: 'draw', pts: [], link: true }); t = slot; }
      else if (items.length && items[items.length - 1].type === 'draw' && !items[items.length - 1].bridge) t = items.length - 1;
      else { items.push({ type: 'draw', pts: [] }); t = items.length - 1; }
      ui.drawTarget = t;
    }
    items[t].bridge = false;
    items[t].pts.push({ lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6, name: '' });
    routeChanged();
  }
  function removeVertex(idx, pi) {
    var it = cur().items[idx];
    if (!it || it.type !== 'draw') return;
    pushUndo();
    it.pts.splice(pi, 1);
    if (!it.pts.length && !it.bridge) {
      cur().items.splice(idx, 1);
      if (ui.drawTarget === idx) ui.drawTarget = null;
    }
    ui.sel = null;
    hidePointMenu();
    routeChanged();
  }

  function vertexDrag(v) {
    var it = cur().items[v.idx], started = false;
    return {
      move: function (p) {
        if (!started) { pushUndo(); started = true; hidePointMenu(); }
        it.pts[v.pi].lat = Math.round(p.lat * 1e6) / 1e6;
        it.pts[v.pi].lon = Math.round(p.lon * 1e6) / 1e6;
        G = Core.routeGeometry(cur(), byId(), A); numberItems(); markBad();
      },
      end: function () { routeChanged(); },
      tap: function (p) {
        if (ui.mode === 'remove') removeVertex(v.idx, v.pi);
        else showPointMenu(v);
      }
    };
  }
  function cutDrag(hk) {
    var t = track(ui.cut.trackId);
    return {
      move: function (p) {
        var n = Core.nearestOnTrack(t, p.lat, p.lon);
        ui.cut[hk.k] = snapEnd(t, n.d);
        updateCutBox();
      },
      end: function () {
        if (ui.cut.b != null && ui.cut.a > ui.cut.b) { var x = ui.cut.a; ui.cut.a = ui.cut.b; ui.cut.b = x; }
        updateCutBox();
      }
    };
  }
  function snapEnd(t, d) {
    Core.prep(t);
    if (d < 40) return 0;
    if (t.len - d < 40) return t.len;
    return d;
  }

  function onPress(p, e) {
    var hk = hitCutHandle(p);
    if (hk) return cutDrag(hk);
    if (ui.follower) return null;
    var v = hitVertex(p);
    if (v) {
      var touch = e && e.pointerType !== 'mouse';
      if (ui.mode === 'move' || ui.mode === 'remove' || ui.mode === 'add' || (ui.mode === 'select' && !touch)) return vertexDrag(v);
      var h = vertexDrag(v);
      return { move: function () { /* на телефон точка се мести със задържане */ }, tap: h.tap, cancel: function () {} };
    }
    return null;
  }
  function onLongPress(p) {
    var v = hitVertex(p, 18);
    if (!v) return null;
    if (navigator.vibrate) try { navigator.vibrate(20); } catch (e) { /* няма значение */ }
    toast('Влачи точката');
    return vertexDrag(v);
  }

  function onClick(p) {
    hidePointMenu();
    $('#searchResults').hidden = true;
    if (ui.follower) { toggleBar(); return; }
    if (ui.mode === 'add') { addVertex(p); return; }
    if (ui.mode === 'cut') { cutClick(p); return; }
    if (ui.mode === 'move' || ui.mode === 'remove') {
      var v = hitVertex(p);
      if (v && ui.mode === 'remove') removeVertex(v.idx, v.pi);
      else if (!v) toast(ui.mode === 'remove' ? 'Цъкни върху чертана точка, за да я махнеш' : 'Хвани чертана точка и я влачи');
      return;
    }
    var h = hitTest(p);
    if (!h) { toggleBar(); return; }
    if (h.kind === 'none') return;
    if (h.kind === 'marker') { skipDup(h.sec); return; }
    if (h.kind === 'fork') { toast('Цъкни върху клона, по който маршрутът да продължи оттук'); return; }
    var fk = h.kind === 'part' && findItemFor(h.sec) < 0 ? forkFor(h.sec) : null;
    if (fk) switchFork(fk);
    else if (h.kind === 'part') addPart(h.sec);
    else if (h.kind === 'item') removeItem(h.idx);
    else if (h.kind === 'gap') closeGap(h.gap);
    else if (h.kind === 'vertex') showPointMenu(h);
    else if (h.kind === 'cut') toast('Тази част е изрязана. Върни я от списъка "Изрязано от тракове" под картата.');
  }
  function toggleBar() { setBar(!document.body.classList.contains('bar-hidden')); }
  // Скрива/връща горната лента; бутонът "Лента" горе вляво се вижда само докато лентата е скрита.
  function setBar(hide) {
    document.body.classList.toggle('bar-hidden', hide);
    $('#barHandle').hidden = !hide;
    if (hide && !U.LS.get('barHint', false)) {
      U.LS.set('barHint', true);
      toast('Лентата се скри - цъкни бутона „Лента“ горе вляво или празно място на картата, за да я върнеш.', false, 6000);
    }
  }

  // ---- Изрязване с две точки по трака ----
  function cutClick(p) {
    var nt = nearestTrack(p, 18);
    if (!nt) { toast('Цъкни по-близо до линията на трака'); return; }
    var n = Core.nearestOnTrack(nt.t, p.lat, p.lon);
    var d = snapEnd(nt.t, n.d);
    if (!ui.cut || ui.cut.b != null) {
      ui.cut = { trackId: nt.t.id, a: d, b: null };
    } else {
      if (nt.t.id !== ui.cut.trackId) { toast('Второто място трябва да е на същия трак', true); return; }
      ui.cut.b = d;
      if (ui.cut.a > ui.cut.b) { var x = ui.cut.a; ui.cut.a = ui.cut.b; ui.cut.b = x; }
    }
    updateCutBox();
    map.redraw();
  }
  function updateCutBox() {
    var box = $('#cutBox'), ok = $('[data-act="cut-ok"]');
    box.hidden = ui.mode !== 'cut' && !ui.cut;
    if (!ui.cut) {
      $('#cutText').textContent = 'Изрязване: цъкни началото по линията на трака';
      $('#cutSub').textContent = '';
      ok.disabled = true;
      return;
    }
    var t = track(ui.cut.trackId);
    if (ui.cut.b == null) {
      $('#cutText').textContent = 'Начало: км ' + U.kmShort(ui.cut.a) + ' - цъкни края';
      $('#cutSub').textContent = trackLabel(t);
      ok.disabled = true;
    } else {
      $('#cutText').textContent = 'Изрязване: ' + kmRange(ui.cut.a, ui.cut.b);
      $('#cutSub').textContent = U.km(Math.abs(ui.cut.b - ui.cut.a)) + ' отпадат от трака - не влизат. Двете точки се влачат.';
      ok.disabled = Math.abs(ui.cut.b - ui.cut.a) < 5;
    }
    map.redraw();
  }
  function cutConfirm() {
    if (!ui.cut || ui.cut.b == null) return;
    var t = track(ui.cut.trackId);
    pushUndo();
    t.cuts = (t.cuts || []).concat([{ a: Math.min(ui.cut.a, ui.cut.b), b: Math.max(ui.cut.a, ui.cut.b) }]);
    toast('Изрязано ' + U.km(Math.abs(ui.cut.b - ui.cut.a)) + ' от ' + t.name);
    ui.cut = null;
    updateCutBox();
    analyzeNow();
  }
  function cutBack() {
    ui.cut = null;
    updateCutBox();
    if (ui.mode === 'cut') setMode('select');
  }

  // ---- Меню на точка ----
  function showPointMenu(v) {
    var it = cur().items[v.idx];
    if (!it || !it.pts[v.pi]) return;
    ui.sel = { idx: v.idx, pi: v.pi };
    var pt = it.pts[v.pi], q = map.project(pt.lat, pt.lon), m = $('#pointMenu');
    m.hidden = false;
    var w = m.offsetWidth || 320;
    m.style.left = Math.max(6, Math.min(map.w - w - 6, q.x - w / 2)) + 'px';
    m.style.top = Math.max(100, Math.min(map.h - 60, q.y + 16)) + 'px';
    var inp = $('#pointName');
    inp.value = pt.name || '';
    if (window.matchMedia('(pointer: fine)').matches) inp.focus();
    map.redraw();
  }
  function hidePointMenu() {
    $('#pointMenu').hidden = true;
    if (ui.sel) { ui.sel = null; if (map) map.redraw(); }
  }

  function setMode(m) {
    ui.mode = m;
    $$('#tools [data-mode]').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === m); });
    document.body.className = document.body.className.replace(/\bmode-\w+/g, '').trim() + ' mode-' + m;
    if (m !== 'cut' && ui.cut && ui.cut.b == null) ui.cut = null;
    if (m !== 'add') ui.drawTarget = m === 'select' ? null : ui.drawTarget;
    updateCutBox();
    hidePointMenu();
    $('#tip').hidden = true;
    if (m === 'cut') toast('Цъкни два пъти по линията на трака: първо началото, после края на изрязваното');
    else if (m === 'add') toast(ui.drawTarget != null ? 'Цъкни точките на връзката' : G && G.count >= 2 ? 'Клик на картата слага връзка между двете най-близки части' : 'Клик на картата слага точка в края на маршрута');
    map.redraw();
  }

  // Части, които вече са дубликат или изрязани, се маркират с предупреждение.
  function markBad() {
    G.items.forEach(function (g) {
      g.bad = false;
      if (g.item.type !== 'part') return;
      if (g.missing) { g.bad = true; g.badWhy = 'тракът е изтрит'; return; }
      var t = track(g.item.trackId);
      if (t && t.visible === false) return;
      var v = Core.invalidShare(g.item, A);
      if (v.bad) { g.bad = true; g.badWhy = v.why === 'изрязана' ? 'изрязана е' : 'вече е дубликат'; }
    });
  }

  // ---- Панелът под картата ----
  function renderPanel() {
    renderStats();
    renderParts();
    renderPoints();
    renderTracks();
    renderDups();
    renderCuts();
    renderRoutes();
    renderPicCard();
    drawProfile();
    $('#routeName').value = cur().name;
    document.title = cur().name + ' · GPX конструктор';
  }

  function renderStats() {
    var r = cur();
    $('#sLen').textContent = U.km(G ? G.len : 0);
    $('#sUp').textContent = prof ? U.meters(prof.up) : '-';
    $('#sDown').textContent = prof ? U.meters(prof.down) : '-';
    $('#sGrade').textContent = prof ? U.pct(prof.maxUp) : '-';
    $('#sParts').textContent = G ? G.count : 0;
    $('#sPts').textContent = U.num(G ? G.pts.length : 0);
    var skip = 0;
    A.dups.forEach(function (d) { skip += d.len; });
    $('#sSkip').textContent = U.km(skip);
    r.skip = skip;
  }

  function renderParts() {
    var ol = $('#partsList'), tb = byId(), html = [];
    G.items.forEach(function (g, gi) {
      var it = g.item, t = tb[it.trackId];
      if (g.auto) return;
      if (g.shared) {
        html.push('<li class="shared"><span class="i"></span><span class="t muted">обща отсечка <small>· ' + U.km(g.len) + '</small> · минава се веднъж</span></li>');
        return;
      }
      if (g.link && g.pts.length) {
        html.push('<li data-idx="' + g.idx + '" class="link"><span class="i"></span><span class="t muted">връзка <small>· ' + U.dist(g.len) + '</small> · между частите</span>' +
          '<span class="v"><button class="btn sm" data-part="del" title="Махни връзката">×</button></span></li>');
        return;
      }
      if (it.type === 'draw' && !g.pts.length) {
        html.push('<li data-idx="' + g.idx + '" class="bridge"><span class="i"></span><span class="t muted">' +
          (ui.drawTarget === g.idx ? 'връзка - цъкни точки на картата' : 'свързано направо') + '</span><span class="v">' +
          '<button class="btn sm" data-part="del" title="Махни връзката">×</button></span></li>');
        return;
      }
      var title = it.type === 'draw' ? 'чертан участък <small>' + g.pts.length + ' т.</small>'
        : U.esc(trackLabel(t)) + ' <small>· ' + kmRange(it.a, it.b) + (it.rev ? ' · обърната' : '') + '</small>';
      if (g.bad) title += '<br><span class="small" style="color:var(--app-warn)">Вече не е валидна: ' + g.badWhy + '. Клик на картата я маха.</span>';
      html.push('<li data-idx="' + g.idx + '" draggable="true" class="' + (g.bad ? 'bad' : '') + '">' +
        '<span class="badge" style="background:' + (g.bad ? C.dup : itemColor(g.no)) + '">' + (g.bad ? '!' : g.no) + '</span>' +
        '<span class="t">' + title + '</span>' +
        '<span class="v">' + U.km(g.len) +
        ' <button class="btn sm" data-part="up" title="Нагоре" ' + (g.idx === 0 ? 'disabled' : '') + '>↑</button>' +
        '<button class="btn sm" data-part="down" title="Надолу" ' + (g.idx === cur().items.length - 1 ? 'disabled' : '') + '>↓</button>' +
        (it.type === 'part' ? '<button class="btn sm" data-part="rev" title="Обърни посоката">⇄</button>' : '') +
        '<button class="btn sm" data-part="del" title="Махни от маршрута">×</button></span></li>');
    });
    ol.innerHTML = html.join('');
    $('#partsCount').textContent = '(' + G.count + ')';
    $('#partsEmpty').hidden = G.items.length > 0;
    $('#clearPartsBtn').disabled = !cur().items.length;
    var gh = G.gaps.map(function (gp) {
      var a = G.items.filter(function (x) { return x.idx === gp.afterIdx; })[0], b = G.items.filter(function (x) { return x.idx === gp.beforeIdx; })[0];
      return '<div class="gap-note" data-gap="' + gp.beforeIdx + '">дупка ' + U.dist(gp.d) + ' между част ' + (a ? a.no : '?') + ' и част ' + (b ? b.no : '?') +
        ' <button class="btn sm" data-gapact="draw">Затвори с чертаене</button><button class="btn sm" data-gapact="bridge">Свържи направо</button></div>';
    });
    (G.autoGaps || []).forEach(function (gp, i) {
      gh.push('<div class="gap-note closed" data-autogap="' + i + '">Затворена дупка · <span class="num">' + U.dist(gp.d) + '</span>' +
        ' <button class="btn sm link" data-gapact="reopen">Отвори пак</button></div>');
    });
    $('#gapsList').innerHTML = gh.join('');
  }

  function allVertices() {
    var out = [];
    cur().items.forEach(function (it, idx) {
      if (it.type === 'draw') it.pts.forEach(function (p, pi) { out.push({ idx: idx, pi: pi, p: p }); });
    });
    return out;
  }
  function renderPoints() {
    var vs = allVertices();
    $('#ptsCount').textContent = '(' + vs.length + ')';
    $('#pointsList').innerHTML = vs.map(function (v, n) {
      var e = Elev.cache.get(Elev.cacheKey(v.p.lat, v.p.lon));
      if (e == null && prof && G) {
        var nn = Core.nearestOn(G.pts, G.cum, v.p.lat, v.p.lon);
        if (nn) e = Elev.eleAt(prof, nn.d);
      }
      return '<li data-idx="' + v.idx + '" data-pi="' + v.pi + '"><span class="i">' + (n + 1) + '</span>' +
        '<input class="pname" type="text" value="' + U.esc(v.p.name || '') + '" placeholder="без име" aria-label="Име на точка ' + (n + 1) + '">' +
        '<span class="v">' + (e != null ? U.meters(e) : '') + ' <button class="btn sm" data-pt="del" title="Махни точката">×</button></span></li>';
    }).join('') || '';
  }

  function renderTracks() {
    $('#tracksCount').textContent = '(' + S.tracks.length + ')';
    $('#clearTracksBtn').disabled = !S.tracks.length && !cur().items.length;
    $('#tracksList').innerHTML = S.tracks.map(function (t) {
      Core.prep(t);
      var cutL = (t.cuts || []).reduce(function (s, c) { return s + (c.b - c.a); }, 0);
      return '<li data-track="' + t.id + '" class="' + (t.visible === false ? 'off' : '') + '">' +
        '<span class="sw" style="background:' + trackColor(t) + '"></span>' +
        '<span class="t" title="' + U.esc(t.title || t.name) + '">' + U.esc(t.name) + (t.walk ? ' <small>изминат</small>' : '') +
        (cutL ? ' <small>· изрязани ' + U.km(cutL) + '</small>' : '') + '</span>' +
        '<span class="v">' + U.km(t.len) +
        ' <label class="chk" title="Видим и участва в търсенето"><input type="checkbox" data-tr="vis" ' + (t.visible === false ? '' : 'checked') + '></label>' +
        '<button class="btn sm" data-tr="fit" title="Покажи целия трак">Покажи</button>' +
        '<button class="btn sm" data-tr="gpx" title="Свали като .gpx">.gpx</button>' +
        '<button class="btn sm" data-tr="del" title="Махни трака">×</button></span></li>';
    }).join('');
  }

  // Маркерите са на картата; тук е само колко са и колко километра още се броят.
  function renderDups() {
    var L = 0, P = 0;
    A.dups.forEach(function (d) { L += d.len; });
    A.pend.forEach(function (d) { P += d.len; });
    var n = A.dups.length, np = A.pend.length;
    $('#dupsPending').textContent = 'Дубликати по картата: ' + np + ' ' + (np === 1 ? 'маркер' : 'маркера') + ' · ' + U.km(P);
    $('#dupsPending').hidden = !np;
    $('#dupsPendingNote').hidden = !np;
    $('#dupsSkipped').textContent = 'Пропуснати дубликати: ' + n + ' ' + (n === 1 ? 'участък' : 'участъка') + ' · ' + U.km(L);
    $('#dupsSkipped').hidden = !!np && !n;
    var cnt = [];
    if (np) cnt.push(np + ' за решение');
    if (n) cnt.push(n + ' ' + (n === 1 ? 'пропуснат' : 'пропуснати'));
    $('#dupsCount').textContent = cnt.length ? cnt.join(' · ') : '(0)';
  }

  function renderCuts() {
    var rows = [];
    S.tracks.forEach(function (t) {
      (t.cuts || []).forEach(function (c, ci) {
        rows.push('<li data-track="' + t.id + '" data-ci="' + ci + '"><span class="i">×</span><span class="t">' + U.esc(t.name) +
          ' <small>· ' + kmRange(c.a, c.b) + '</small></span><span class="v">' + U.km(c.b - c.a) +
          ' <button class="btn sm" data-cut="back">Върни</button></span></li>');
      });
    });
    $('#cutsList').innerHTML = rows.join('');
    $('#cutsCount').textContent = '(' + rows.length + ')';
  }

  function renderRoutes() {
    var f = ($('#routeFilter').value || '').trim().toLowerCase();
    var list = S.routes.slice().sort(function (a, b) { return (b.modified || 0) - (a.modified || 0); })
      .filter(function (r) { return !f || r.name.toLowerCase().indexOf(f) >= 0; });
    $('#routesCount').textContent = '(' + S.routes.length + ')';
    $('#routesBody').innerHTML = list.map(function (r) {
      return '<tr data-route="' + r.id + '" class="' + (r.id === S.curId ? 'cur' : '') + '">' +
        '<td>' + U.esc(r.name) + '</td><td class="r num">' + U.km(r.len || 0) + '</td>' +
        '<td class="r num">' + (r.up != null ? U.meters(r.up) : '-') + '</td>' +
        '<td class="num">' + U.date(r.modified || r.created) + '</td>' +
        '<td><button class="btn sm" data-rt="open">Отвори</button><button class="btn sm" data-rt="gpx">GPX</button>' +
        '<button class="btn sm danger" data-rt="del">Изтрий</button></td></tr>';
    }).join('') || '<tr><td colspan="5" class="muted">Няма маршрути с това име.</td></tr>';
  }

  function renderPicCard() {
    var r = cur();
    var has = !!(r.snap && r.snap.meta);
    $('#picOpenBtn').disabled = !has;
    $('#picInfo').textContent = has
      ? 'Картина от ' + U.date(r.snap.date) + ' · ' + U.num(r.snap.meta.w) + ' на ' + U.num(r.snap.meta.h) + ' точки · ' + (r.snap.base === 'topo' ? 'топо' : 'сателит') + '. Пази се с обхвата си, затова положението от GPS ляга върху нея и без връзка.'
      : 'Още няма картина за този маршрут. Копчето "Картина" я прави и я пази заедно с обхвата ѝ.';
  }

  function highlightRows() {
    var h = ui.hover;
    $$('#partsList li').forEach(function (li) { li.classList.toggle('hl', !!h && h.kind === 'item' && +li.dataset.idx === h.idx); });
  }

  // ---- Профил ----
  function drawProfile() {
    var cv = $('#profile');
    var box = cv.parentNode.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var W = Math.max(100, box.width), H = Math.max(60, box.height);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var mono = '11px ' + U.cssVar('--app-mono');
    ctx.font = mono;
    if (!prof) {
      ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(G && G.pts.length > 1 ? 'Профилът се появява, щом дойдат височините' : 'Профилът се появява, щом в маршрута има част', W / 2, H / 2);
      return;
    }
    var L = 52, Rr = 10, T = ui.grade ? 20 : 10, B = ui.grade ? 34 : 20;
    var min = prof.min, max = prof.max;
    if (max - min < 20) { max += 10; min -= 10; }
    var total = prof.total || 1;
    function X(d) { return L + d / total * (W - L - Rr); }
    function Y(e) { return T + (1 - (e - min) / (max - min)) * (H - T - B); }
    prof._X = X; prof._L = L; prof._R = Rr; prof._W = W;
    // Мрежа и надписи.
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.fillStyle = C.muted;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    [min, (min + max) / 2, max].forEach(function (e) {
      var y = Math.round(Y(e)) + 0.5;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - Rr, y); ctx.stroke();
      ctx.fillText(U.meters(e), L - 6, y);
    });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var stepKm = [1, 2, 5, 10, 20, 50, 100].filter(function (s) { return total / 1000 / s <= 8; })[0] || 200;
    for (var k = 0; k * stepKm * 1000 <= total; k++) {
      var x = X(k * stepKm * 1000);
      ctx.fillText(k * stepKm + (k === 0 ? ' км' : ''), x, H - B + 4);
    }
    // Площта под профила.
    ctx.beginPath(); ctx.moveTo(X(0), H - B);
    prof.d.forEach(function (d, i) { ctx.lineTo(X(d), Y(prof.ele[i])); });
    ctx.lineTo(X(total), H - B); ctx.closePath();
    ctx.fillStyle = C['accent-soft']; ctx.fill();
    ctx.beginPath();
    prof.d.forEach(function (d, i) { if (i) ctx.lineTo(X(d), Y(prof.ele[i])); else ctx.moveTo(X(d), Y(prof.ele[i])); });
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.8; ctx.stroke();
    // Наклон: ленти отдолу по стръмност и надписи за няколко участъка.
    if (ui.grade) {
      prof.grades.forEach(function (g) {
        var a = Math.abs(g.g);
        ctx.fillStyle = a < 5 ? C.ok : a < 10 ? C.warn : C.danger;
        ctx.globalAlpha = g.g < 0 ? 0.45 : 0.9;
        ctx.fillRect(X(g.d0), H - B + 17, Math.max(1, X(g.d1) - X(g.d0) - 0.5), 6);
      });
      ctx.globalAlpha = 1;
      var parts = Math.max(1, Math.min(6, Math.round(total / 1500)));
      ctx.fillStyle = C.ink; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      for (var pi = 0; pi < parts; pi++) {
        var d0 = total * pi / parts, d1 = total * (pi + 1) / parts;
        var e0 = Elev.eleAt(prof, d0), e1 = Elev.eleAt(prof, d1);
        var gpct = (e1 - e0) / (d1 - d0) * 100;
        ctx.fillText(U.pct(gpct), X((d0 + d1) / 2), 3);
        if (pi) { ctx.strokeStyle = C.line; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(d0), T); ctx.lineTo(X(d0), H - B); ctx.stroke(); ctx.setLineDash([]); }
      }
    }
    // Посочено място.
    if (ui.profD != null) {
      var hx = X(ui.profD), he = Elev.eleAt(prof, ui.profD);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, T); ctx.lineTo(hx, H - B); ctx.stroke();
      var g = prof.grades.filter(function (x) { return ui.profD >= x.d0 && ui.profD <= x.d1; })[0];
      var txt = 'км ' + U.num(ui.profD / 1000, 1) + ' · ' + U.meters(he) + (g ? ' · ' + U.pct(g.g) : '');
      ctx.font = mono; var tw = ctx.measureText(txt).width + 10;
      var tx = Math.min(Math.max(L, hx - tw / 2), W - Rr - tw);
      ctx.fillStyle = C.surface; ctx.fillRect(tx, T, tw, 16);
      ctx.strokeStyle = C.line; ctx.strokeRect(tx + 0.5, T + 0.5, tw - 1, 15);
      ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, tx + 5, T + 8);
    }
  }
  function profileHover(e) {
    if (!prof || !prof._X || !G || G.pts.length < 2) return;
    var r = e.currentTarget.getBoundingClientRect();
    var x = e.clientX - r.left;
    var d = (x - prof._L) / (prof._W - prof._L - prof._R) * prof.total;
    if (d < 0 || d > prof.total) { profileLeave(); return; }
    ui.profD = d;
    var i = 0;
    while (i < G.cum.length - 2 && G.cum[i + 1] < d) i++;
    var f = (d - G.cum[i]) / ((G.cum[i + 1] - G.cum[i]) || 1), p = G.pts[i], q = G.pts[i + 1] || p;
    ui.profHover = { lat: p[0] + f * (q[0] - p[0]), lon: p[1] + f * (q[1] - p[1]) };
    drawProfile(); map.redraw();
  }
  function profileLeave() { ui.profD = null; ui.profHover = null; drawProfile(); map.redraw(); }

  // ---- Изглед ----
  function barPad() {
    var bar = $('#bar');
    var top = document.body.classList.contains('bar-hidden') ? 20 : bar.offsetHeight + 20;
    return { top: top, bottom: 40, left: 30, right: 60 };
  }
  function fitTo(ptsList) {
    var b = U.boundsOf(ptsList.filter(function (p) { return p && p.length; }));
    if (b) map.fitBounds(b, barPad());
  }
  function fitRoute() {
    if (G && G.pts.length > 1) fitTo([G.pts]);
    else if (visibleTracks().length) fitTo(visibleTracks().map(function (t) { return t.pts; }));
    else map.setView(HOME.lat, HOME.lon, HOME.zoom);
  }

  // ---- Внасяне ----
  function readFile(f) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(new Error('Файлът не може да се прочете.')); };
      r.readAsText(f);
    });
  }
  function nextColor() {
    var used = S.tracks.map(function (t) { return t.color || 0; });
    for (var c = 0; c < 8; c++) if (used.indexOf(c) < 0) return c;
    return S.tracks.length % 8;
  }
  function handleFiles(files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return;
    var msg = $('#importMsg');
    var out = [];
    if (files.length > MAX_FILES) {
      out.push('<div class="err">Избрани са ' + files.length + ' файла - влизат първите ' + MAX_FILES + '. Добави останалите на втори път.</div>');
      files = files.slice(0, MAX_FILES);
    }
    var added = [], anyErr = false, loadedCollection = false;
    var chain = Promise.resolve();
    files.forEach(function (f, i) {
      chain = chain.then(function () {
        msg.innerHTML = out.join('') + '<div class="muted">Чета файл ' + (i + 1) + ' от ' + files.length + ': ' + U.esc(f.name) + '...</div>';
        return readFile(f).then(function (text) {
          var trimmed = text.replace(/^﻿/, '').trim();
          if (/\.json$/i.test(f.name) || trimmed.charAt(0) === '{') {
            var data;
            try { data = JSON.parse(trimmed); } catch (e) { throw new Error('Файлът не е колекция от GPX конструктор (лош JSON).'); }
            return importCollection(data).then(function (n) {
              loadedCollection = true;
              out.push('<div class="ok">' + U.esc(f.name) + ' - колекция: ' + n.tracks + ' трака, ' + n.routes + ' маршрута</div>');
            });
          }
          var res = GPX.parse(trimmed, f.name);
          res.tracks.forEach(function (t) {
            var tr = { id: U.uid(), name: t.name, title: t.title, color: nextColor(), pts: t.pts, breaks: t.breaks, wpts: t.wpts, cuts: [], visible: true, created: Date.now() };
            Core.prep(tr);
            S.tracks.push(tr);
            added.push(tr);
            out.push('<div class="ok">' + U.esc(tr.name) + ' - ' + U.km(tr.len) + ', ' + U.num(tr.pts.length) + ' точки' + (t.wpts.length ? ', ' + t.wpts.length + ' спирки' : '') + '</div>');
          });
        }).catch(function (e) {
          anyErr = true;
          out.push('<div class="err"><b>' + U.esc(f.name) + '</b><br>' + U.esc(e.message) + '</div>');
        });
      });
    });
    return chain.then(function () {
      msg.innerHTML = out.join('');
      if (added.length || loadedCollection) {
        analyzeNow();
        // След зареждане картата показва целия трак (или всички нови).
        if (added.length) fitTo(added.map(function (t) { return t.pts; })); else fitRoute();
        saveNow();
      }
      if (!anyErr && (added.length || loadedCollection)) {
        var dlg = $('#dlgImport');
        if (dlg.open) dlg.close();
        var nd = A.pend.length;
        toast(added.length ? 'Добавени ' + added.length + ' трака' + (nd ? ' · дубликати по картата: ' + nd + ' (клик върху маркер маха дубликата)' : '') : 'Колекцията е заредена');
      } else if (anyErr && !$('#dlgImport').open) {
        openImport();
      }
    });
  }
  function importCollection(data) {
    adopt(data, true);
    var snaps = data.snaps || {};
    var jobs = Object.keys(snaps).map(function (rid) {
      return fetch(snaps[rid]).then(function (r) { return r.blob(); }).then(function (b) { return U.DB.set('snap:' + rid, b); }).catch(function () { /* без картина */ });
    });
    return Promise.all(jobs).then(function () {
      ui.undo = []; $('#undoBtn').disabled = true;
      loadPic();
      return { tracks: data.tracks.length, routes: (data.routes || []).length };
    });
  }
  function openImport() {
    $('#importMsg').innerHTML = '';
    var d = $('#dlgImport');
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  }

  // ---- Изнасяне ----
  function routeExport(r, geo, profile) {
    var pts = geo.pts.map(function (p, i) {
      var e = profile ? Elev.eleAt(profile, geo.cum[i]) : p[2];
      return [p[0], p[1], e == null ? null : Math.round(e * 10) / 10];
    });
    var wpts = [];
    r.items.forEach(function (it) {
      if (it.type === 'draw') it.pts.forEach(function (p) { if (p.name) wpts.push({ lat: p.lat, lon: p.lon, name: p.name }); });
    });
    // Спирките от файловете, които лежат до маршрута.
    var used = {};
    r.items.forEach(function (it) { if (it.type === 'part') used[it.trackId] = 1; });
    S.tracks.forEach(function (t) {
      if (!used[t.id]) return;
      (t.wpts || []).forEach(function (w) {
        if (!w.name) return;
        var n = Core.nearestOn(geo.pts, geo.cum, w.lat, w.lon);
        if (n && n.dist < 60) wpts.push({ lat: w.lat, lon: w.lon, name: w.name, ele: w.ele });
      });
    });
    wpts.forEach(function (w) {
      if (w.ele == null && profile) { var n = Core.nearestOn(geo.pts, geo.cum, w.lat, w.lon); if (n) w.ele = Elev.eleAt(profile, n.d); }
    });
    return GPX.build({ name: r.name, pts: pts, wpts: wpts });
  }
  function routeGeo(r) {
    var geo = r.id === S.curId ? G : Core.routeGeometry(r, byId(), A);
    return geo && geo.pts.length >= 2 ? geo : null;
  }
  // Сваля маршрута като .gpx (fname - от прозореца за име; без него - от името на маршрута).
  function exportGpx(r, fname, quiet) {
    r = r || cur();
    var geo = routeGeo(r);
    if (!geo) { if (!quiet) toast('Маршрутът е празен - клик върху трак го слага в маршрута.', true); return false; }
    var xml = routeExport(r, geo, r.id === S.curId ? prof : null);
    fname = fname || U.slug(r.name) + '.gpx';
    U.download(new Blob([xml], { type: 'application/gpx+xml' }), fname);
    if (!quiet) toast('Изнесен ' + fname + ' · ' + U.km(geo.len) + ', една линия');
    return true;
  }
  function exportTrack(t) {
    var xml = GPX.build({ name: t.title || t.name, pts: t.pts, wpts: (t.wpts || []).filter(function (w) { return w.name; }) });
    U.download(new Blob([xml], { type: 'application/gpx+xml' }), U.slug(t.name.replace(/\.gpx.*$/i, '')) + '.gpx');
  }
  function exportCollection() {
    var data = snapshotState();
    data.exported = new Date().toISOString();
    data.snaps = {};
    var jobs = S.routes.filter(function (r) { return r.snap; }).map(function (r) {
      return U.DB.get('snap:' + r.id).then(function (b) {
        if (!b) return;
        return new Promise(function (res) {
          var fr = new FileReader();
          fr.onload = function () { data.snaps[r.id] = fr.result; res(); };
          fr.onerror = function () { res(); };
          fr.readAsDataURL(b);
        });
      });
    });
    Promise.all(jobs).then(function () {
      U.download(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'gpx-kolekciya-' + U.dateDots(Date.now()) + '.json');
      toast('Колекцията е изнесена: ' + S.tracks.length + ' трака, ' + S.routes.length + ' маршрута');
    });
  }

  // ---- Картина за офлайн ----
  function picSource() {
    var f = $('#picForm');
    var base = f.pbase.value, area = f.parea.value;
    var b;
    if (area === 'view') {
      b = map.viewBounds(barPad().top - 20);
    } else {
      b = G && G.pts.length > 1 ? U.boundsOf([G.pts]) : U.boundsOf(visibleTracks().map(function (t) { return t.pts; }));
    }
    return { base: base, area: area, bounds: b, info: f.pinfo.checked, labels: f.plabels.checked };
  }
  function openPicture() {
    var d = $('#dlgPic'), f = $('#picForm');
    f.pbase.value = ui.base === 'topo' ? 'topo' : 'sat';
    $('#picMsg').innerHTML = '';
    updatePicEst();
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  }
  function updatePicEst() {
    var s = picSource(), f = $('#picForm');
    f.plabels.disabled = s.base === 'topo';
    $('#picFile').textContent = 'marshrut-' + U.slug(cur().name) + '-' + U.dateDots(Date.now()) + '.png';
    if (!s.bounds) { $('#picEst').textContent = 'Няма какво да се снима - добави трак или част.'; return; }
    var p = Snapshot.plan(s.bounds, s.area === 'view' ? 0 : 0.1, s.base === 'topo' ? 17 : 18);
    $('#picEst').textContent = 'Картината излиза ' + U.num(p.w) + ' на ' + U.num(p.h) + ' точки, около ' + U.num(p.w * p.h * 0.45 / 1048576, 1) + ' МБ. Сглобява се в браузъра от плочките и не качва маршрута никъде.';
  }
  function makePicture(withGpx) {
    var s = picSource(), r = cur(), msg = $('#picMsg');
    if (!s.bounds) { msg.innerHTML = '<div class="err">Няма какво да се снима - добави трак или част в маршрута.</div>'; return; }
    var parts = [];
    if (G && G.pts.length > 1) {
      G.items.forEach(function (g, gi) {
        if (!g.pts.length) return;
        // Общата отсечка продължава частта преди нея - без свой номер и ред в легендата.
        if ((g.shared || g.auto || g.link) && parts.length) { parts[parts.length - 1].pts = parts[parts.length - 1].pts.concat(g.pts); return; }
        var t = track(g.item.trackId);
        parts.push({ pts: routeSpan(g, gi), drawn: g.item.type === 'draw', no: g.no, label: g.item.type === 'draw' ? 'част ' + g.no + ' (чертан участък)' : 'част ' + g.no + ' (' + trackLabel(t).replace(/\.gpx$/i, '') + ')' });
      });
    } else {
      visibleTracks().forEach(function (t, i) { parts.push({ pts: t.pts, no: i + 1, label: t.name }); });
    }
    var wpts = [];
    r.items.forEach(function (it) { if (it.type === 'draw') it.pts.forEach(function (p) { if (p.name) wpts.push(p); }); });
    var baseDef = s.base === 'topo'
      ? { name: 'OpenTopoMap', layers: [LAYERS.topo], attribution: ATTR.topo }
      : { name: 'Esri', layers: [LAYERS.sat], attribution: s.labels ? ATTR.satLabels : ATTR.sat };
    var btns = $$('#dlgPic [data-act^="pic-make"]');
    btns.forEach(function (b) { b.disabled = true; });
    msg.innerHTML = '<div class="muted">Сглобявам плочките...</div>';
    Snapshot.make({
      bounds: s.bounds, margin: s.area === 'view' ? 0 : 0.1, base: baseDef,
      labels: s.base === 'topo' || !s.labels ? [] : [LAYERS.places, LAYERS.roads],
      info: s.info, date: Date.now(),
      route: { name: r.name, parts: parts, gaps: G && G.pts.length > 1 ? routeGapLines() : [], len: G ? G.len : 0, up: prof ? prof.up : null, maxGrade: prof ? prof.maxUp : null, wpts: wpts },
      colors: { a: C['route-a'], b: C['route-b'], casing: C.casing, gap: C['walk-gap'] }
    }, function (done, total) {
      msg.innerHTML = '<div class="muted">Сглобявам плочките: ' + Math.min(done, total) + ' от около ' + total + '...</div>';
    }).then(function (res) {
      var name = 'marshrut-' + U.slug(r.name) + '-' + U.dateDots(Date.now()) + '.png';
      U.download(res.blob, name);
      if (withGpx) exportGpx(r);
      r.snap = { meta: res.meta, date: Date.now(), base: s.base };
      return U.DB.set('snap:' + r.id, res.blob).then(function () {
        saveNow(); loadPic(); renderPicCard();
        msg.innerHTML = '<div class="ok">Свалена: ' + U.esc(name) + ' (' + U.num(res.meta.w) + ' на ' + U.num(res.meta.h) + ').' +
          ' Пази се и тук, заедно с обхвата си, за следене без връзка.' + (res.warn ? '<br>' + U.esc(res.warn) : '') + '</div>';
      });
    }).catch(function (e) {
      msg.innerHTML = '<div class="err">' + U.esc(e.message || String(e)) + '</div>';
    }).then(function () { btns.forEach(function (b) { b.disabled = false; }); });
  }

  // Запазената картина на текущия маршрут - в паметта като адрес за <img>.
  function loadPic() {
    var r = cur();
    if (ui.picUrl) { URL.revokeObjectURL(ui.picUrl); ui.picUrl = null; }
    ui.picMeta = null;
    if (!r.snap) return Promise.resolve();
    return U.DB.get('snap:' + r.id).then(function (b) {
      if (!b || r.id !== S.curId) return;
      ui.picUrl = URL.createObjectURL(b);
      ui.picMeta = r.snap.meta;
      $('#picImg').src = ui.picUrl;
    });
  }
  var picScale = null;
  function showPic(show) {
    var v = $('#picView');
    if (show && !ui.picUrl) {
      toast('Още няма запазена картина за този маршрут - направи я с "Картина", докато има връзка.', true);
      show = false;
    }
    v.hidden = !show;
    ui.followView = show ? 'pic' : 'map';
    $$('#followBar [data-view]').forEach(function (b) { b.classList.toggle('on', b.dataset.view === ui.followView); });
    if (show) { picFit(); drawPicOverlay(); }
  }
  function picFit(one) {
    var m = ui.picMeta; if (!m) return;
    var sc = $('#picScroll');
    var avW = sc.clientWidth, avH = sc.clientHeight - parseFloat(getComputedStyle(sc).paddingTop);
    picScale = one ? 1 : Math.min(avW / m.w, avH / m.h);
    var inner = $('#picInner');
    inner.style.width = Math.round(m.w * picScale) + 'px';
    inner.style.height = Math.round(m.h * picScale) + 'px';
    $('#picSvg').setAttribute('viewBox', '0 0 ' + m.w + ' ' + m.h);
    if (one && ui.pos) {
      var q = Snapshot.toPic(m, ui.pos.lat, ui.pos.lon);
      sc.scrollLeft = q[0] - avW / 2; sc.scrollTop = q[1] - avH / 2;
    }
  }
  function drawPicOverlay() {
    var m = ui.picMeta, svg = $('#picSvg');
    if (!m || $('#picView').hidden) return;
    var s = Math.max(1, Math.max(m.w, m.h) / 1600);
    var out = [];
    function line(pts, color, w, dash, noCasing) {
      if (pts.length < 2) return;
      var d = pts.map(function (p, i) { var q = Snapshot.toPic(m, p[0], p[1]); return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join('');
      if (!noCasing) out.push('<path d="' + d + '" fill="none" stroke="' + C.casing + '" stroke-width="' + (w + 3) * s + '" stroke-linecap="round" stroke-linejoin="round"/>');
      out.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + w * s + '" stroke-linecap="round" stroke-linejoin="round"' + (dash ? ' stroke-dasharray="' + dash * s + ' ' + dash * s + '"' : '') + '/>');
    }
    // Изминатите пътища от предишни излизания - планът и изминатото един до друг.
    (cur().walks || []).forEach(function (id) {
      var t = track(id); if (!t) return;
      line(t.pts, C.walked, 3, 0);
      walkGapLines(t, [[0, t.len]]).forEach(function (pts) { line(pts, C.casing, 3, 0, true); line(pts, C['walk-gap'], 3, 4, true); });
    });
    if (ui.follower) {
      line(ui.follower.rec, C.walked, 4, 0);
      recGapLines(ui.follower.rec).forEach(function (pts) { line(pts, C.casing, 4, 0, true); line(pts, C['walk-gap'], 4, 5, true); });
    }
    if (ui.pos) {
      var q = Snapshot.toPic(m, ui.pos.lat, ui.pos.lon);
      var inside = q[0] >= 0 && q[1] >= 0 && q[0] <= m.w && q[1] <= m.h;
      out.push('<circle cx="' + q[0] + '" cy="' + q[1] + '" r="' + 11 * s + '" fill="' + C.pos + '" stroke="' + C.casing + '" stroke-width="' + 4 * s + '"/>');
      var label = inside ? 'ти си тук' + (ui.prog ? ' · ' + U.km(ui.prog.d) + ' от ' + U.km(ui.prog.total) : '') : 'извън картината';
      out.push('<text x="' + (q[0] + 16 * s) + '" y="' + (q[1] - 12 * s) + '" font-size="' + 15 * s + '" font-weight="700" fill="' + '#1f1d1a' + '" stroke="' + C.casing + '" stroke-width="' + 4 * s + '" paint-order="stroke" font-family="sans-serif">' + U.esc(label) + '</text>');
    }
    svg.innerHTML = out.join('');
  }

  // ---- Следене ----
  /* Едно копче "Следене / Стоп" - в лентата, под профила и върху картата при скрита лента:
     "Следене", докато не следиш, и "Стоп" (червено), докато следиш. */
  function followBtns() {
    var on = !!ui.follower;
    $$('[data-act="follow"]').forEach(function (b) {
      b.textContent = on ? 'Стоп' : 'Следене';
      b.classList.toggle('danger', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? 'Стоп - спри следенето' : 'Следене - пусни следенето по GPS');
      b.title = on ? 'Спри следенето и запиши изминатото' : 'Пусни следенето по GPS';
    });
  }
  function startFollow() {
    if (ui.follower) return;
    if (!G || G.pts.length < 2) toast('Маршрутът е празен - ще се записва само изминатото.', false, 4500);
    var f = new window.Follower({
      position: function (pos) {
        ui.pos = pos;
        ui.lastPos = { lat: pos.lat, lon: pos.lon };
        ui.prog = f.progress(G, pos.lat, pos.lon);
        var hd = moveHeading(pos, f.rec);
        if (hd != null) { ui.heading = hd; showCompass(); }
        if (ui.autoCenter) map.setView(pos.lat, pos.lon, Math.max(map.zoom, 15));
        followBearing();
        renderFollow();
        $('#walkGpxBtn').setAttribute('aria-disabled', f.rec.length < 2 ? 'true' : 'false');
        map.redraw();
        drawPicOverlay();
      },
      error: function (msg, code) {
        var el = $('#fMsg');
        el.textContent = msg; el.className = 'follow-msg err';
        // Кратко прекъсване на сигнала при вече намерено положение не спира следенето.
        if (ui.pos && code !== 1) return;
        toast(msg, true, 8000);
        stopFollow(true);
      },
      // Връщане на екрана без положение: същото следене, панелът чака новия сигнал.
      waiting: function () { renderFollow(); },
      // Следеният маршрут - по него минава следата през дупка в GPS.
      route: function () { return G; },
      // Височината на вмъкната точка - от профила на маршрута (числата в панела), само ако профилът е за същия маршрут.
      ele: function (geo, d) { return prof && geo === G && Math.abs(prof.total - geo.len) < 1 ? Elev.eleAt(prof, d) : null; },
      awake: showAwake
    });
    f.awakeOn = ui.awake;
    ui.follower = f;
    ui.followName = cur().name;
    followBtns();
    forgetWalk();
    ui.autoCenter = true;
    ui.heading = null;
    showCompass();
    $('#fDone').textContent = '0'; $('#fTime').textContent = '0:00 ч'; $('#fLeft').textContent = '-'; $('#fOff').textContent = '-';
    document.body.classList.add('following');
    $('#followBar').hidden = false;
    $('#tools').hidden = true;
    $('#followPanel').hidden = false;
    $('#followTitle').textContent = 'Следене: ' + cur().name;
    $('#fMsg').textContent = 'Чакам сигнал от GPS...'; $('#fMsg').className = 'follow-msg';
    $('#walkDone').hidden = true;
    $('#walkGpxBtn').setAttribute('aria-disabled', 'true');
    setOrient(ui.orient);
    setAwake(ui.awake);
    setMode('select');
    if (!f.start()) { return; }
    ui.followTimer = setInterval(renderFollow, 15000);
    liveStart();
  }
  function renderFollow() {
    if (!ui.follower) return;
    $('#fTime').textContent = U.duration(ui.follower.elapsed());
    if (ui.follower.waiting) { $('#fMsg').textContent = 'Чакам сигнал от GPS...'; $('#fMsg').className = 'follow-msg'; return; }
    var p = ui.prog;
    if (!p) {
      if (ui.pos) { $('#fDone').textContent = U.km(U.lengthOf(ui.follower.rec)); $('#fLeft').textContent = '-'; }
      return;
    }
    $('#fDone').textContent = U.num(p.d / 1000, 1) + ' от ' + U.km(p.total);
    $('#fLeft').textContent = U.km(Math.max(0, p.total - p.d));
    $('#fOff').textContent = U.meters(p.off);
    var el = $('#fMsg');
    if (p.isOff) {
      el.textContent = 'Отклонил си се на ' + U.meters(p.off) + ' от линията - върни се към пунктира. Линията е на ' + U.dirName(p.bearing) + '.';
      el.className = 'follow-msg warn';
    } else {
      el.textContent = 'По линията си. Точност на GPS: ' + U.meters(ui.pos.acc || 0) + '.';
      el.className = 'follow-msg';
    }
  }
  function stopFollow(silent) {
    var f = ui.follower;
    if (!f) return;
    var rec = f.stop();
    clearInterval(ui.followTimer);
    clearInterval(ui.liveTimer);
    U.DB.del('liveWalk');
    ui.follower = null; ui.prog = null;
    followBtns();
    document.body.classList.remove('following');
    $('#followBar').hidden = true;
    $('#tools').hidden = false;
    $('#fAwake').hidden = true;
    $('#followPanel').hidden = !silent && rec.length < 2;
    showPic(false);
    if (rec.length >= 2) {
      saveWalk({
        pts: rec, name: ui.followName, routeId: cur().id, t: Date.now(), head: 'Следенето спря.',
        stats: { time: $('#fTime').textContent, left: $('#fLeft').textContent, off: $('#fOff').textContent }
      });
    } else if (!silent) toast('Следенето спря. Няма записан път.');
    // Картата остава в последната посока; копчето "Север" я изправя, а после "Посока" я връща (ui.heading се пази).
    ui.pos = null;
    map.redraw();
  }

  /* Режим "Екранът да не заспива" при следене: копчето в реда на следенето, изборът се помни.
     Панелът казва с текст дали екранът се държи буден - и когато браузърът не може или откаже. */
  var AWAKE_MSG = {
    on: 'Екранът няма да заспива, докато следиш.',
    off: 'Екранът може да заспи - следенето продължава при събуждане.',
    none: 'Този браузър не може да държи екрана буден. Екранът може да заспи - следенето продължава при събуждане.',
    denied: 'Браузърът не позволи екранът да стои буден (например при пестене на батерия). Екранът може да заспи - следенето продължава при събуждане.'
  };
  function setAwake(on) {
    ui.awake = !!on;
    U.LS.set('awake', ui.awake);
    $('#awakeBtn').setAttribute('aria-pressed', ui.awake ? 'true' : 'false');
    if (ui.follower) ui.follower.setAwake(ui.awake);
  }
  function showAwake(state) {
    var el = $('#fAwake');
    el.textContent = AWAKE_MSG[state] || '';
    el.className = 'follow-msg' + (state === 'none' || state === 'denied' ? ' warn' : ' muted');
    el.hidden = !ui.follower || !el.textContent;
  }

  /* Изминатото като нормален трак: нов трак "изминат <дата>" в изминатите на следения
     маршрут и отделен запис в "Записани маршрути" (една част - целият трак). Текущ остава
     отвореният маршрут. Същият път за "Стоп" и за възстановено незавършено следене. */
  function saveWalk(w) {
    var rec = w.pts, when = w.t || Date.now();
    var t = { id: U.uid(), name: 'изминат ' + U.dateShort(when), title: 'изминат ' + U.date(when), color: nextColor(), pts: rec, breaks: [], wpts: [], cuts: [], visible: true, created: Date.now(), walk: true };
    Core.prep(t);
    S.tracks.push(t);
    S.routes.forEach(function (r) { if (r.id === w.routeId) r.walks = (r.walks || []).concat([t.id]); });
    var wr = newRoute(t.name);
    wr.items = [{ type: 'part', trackId: t.id, a: 0, b: t.len, rev: false }];
    wr.len = t.len;
    var st = w.stats || {};
    ui.lastWalk = {
      pts: rec, name: w.name, title: t.title, wname: wr.name, bar: true,
      msg: w.head + ' Изминатият път е записан като отделен маршрут "' + wr.name + '".',
      stats: { done: U.km(t.len), time: st.time || '-', left: st.left || '-', off: st.off || '-' }
    };
    U.DB.set('lastWalk', ui.lastWalk);
    showWalk();
    toast('Изминатият път е записан като отделен маршрут "' + wr.name + '" · ' + U.km(t.len), false, 6000);
    analyzeNow();
    saveNow();
    return ui.lastWalk;
  }

  /* Незавършено следене: докато следиш, изминатото се пише в браузъра на всеки 10 с и при
     скриване или затваряне на страницата. Пази се само едно - ново следене го заменя; чисти се
     при "Стоп" и щом бъде запазено, свалено или изхвърлено от прозореца при отваряне. */
  var LIVE_MS = 10000;
  function liveStart() {
    var f = ui.follower;
    if (!f) return;
    ui.liveN = 0;
    liveWrite(f);
    ui.liveTimer = setInterval(liveSave, LIVE_MS);
  }
  function liveSave() {
    var f = ui.follower;
    if (f && f.rec.length !== ui.liveN) liveWrite(f);
  }
  function liveWrite(f) {
    ui.liveN = f.rec.length;
    U.DB.set('liveWalk', { pts: f.rec.slice(), name: ui.followName, routeId: cur().id, t0: f.t0, saved: Date.now() }).then(function (kept) {
      if (kept || ui.liveWarned || !ui.follower) return;
      ui.liveWarned = true;
      toast('Следенето не се пази в браузъра (частен режим или забранен запис). Ако страницата се затвори, изминатото ще се загуби.', true, 9000);
    });
  }
  function liveAsk(lw) {
    var d = $('#dlgLive'), pts = lw.pts, t0 = lw.t0 || pts[0][3] || lw.saved;
    ui.live = lw;
    $('#liveKm').textContent = U.km(U.lengthOf(pts));
    $('#livePts').textContent = U.num(pts.length) + ' точки';
    var dt = new Date(t0), hm = dt.getHours() + ':' + (dt.getMinutes() < 10 ? '0' : '') + dt.getMinutes();
    var named = lw.name && lw.name !== 'Нов маршрут';
    $('#liveWhen').textContent = 'Тръгнал ' + U.dateShort(t0) + ', ' + hm + (named ? ' · следене по „' + lw.name + '“' : '');
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  }
  function liveDone(act) {
    var lw = ui.live;
    ui.live = null;
    if ($('#dlgLive').open) $('#dlgLive').close();
    if (!lw) return;
    U.DB.del('liveWalk');
    if (act === 'drop') { toast('Незавършеното следене е изхвърлено.'); return; }
    var pts = lw.pts, t0 = lw.t0 || pts[0][3] || lw.saved, t1 = pts[pts.length - 1][3];
    var w = saveWalk({
      pts: pts, name: lw.name || 'изминат', routeId: lw.routeId, t: t0, head: 'Възстановено незавършено следене.',
      stats: { time: t1 && t0 ? U.duration(t1 - t0) : '-' }
    });
    if (act === 'gpx') walkGpx(w.pts, w.name, w.title);
  }

  /* Посоката на движение: от GPS, ако я дава при движение; иначе от последните две
     записани точки (те са поне на 5 м една от друга). При стоене остава последната. */
  function moveHeading(pos, rec) {
    if (pos.heading != null && isFinite(pos.heading) && !(pos.speed != null && pos.speed < 0.5)) return pos.heading;
    var n = rec.length;
    if (n < 2) return null;
    return U.bearing(rec[n - 2][0], rec[n - 2][1], rec[n - 1][0], rec[n - 1][1]);
  }
  // При следене в изглед "Карта" посоката сочи нагоре - докато картата не е дръпната встрани.
  function followBearing() {
    if (ui.follower && ui.followView === 'map' && ui.autoCenter && ui.orient === 'heading' && ui.heading != null) map.setBearing(ui.heading);
  }
  function setOrient(o) {
    ui.orient = o === 'north' ? 'north' : 'heading';
    U.LS.set('orient', ui.orient);
    $$('#followBar [data-orient]').forEach(function (b) { b.classList.toggle('on', b.dataset.orient === ui.orient); });
    // И извън следене: "Север" изправя картата, "Посока" я връща към последната известна посока.
    if (ui.orient === 'north') map.setBearing(0);
    else if (ui.heading != null && (!ui.follower || ui.followView === 'map')) {
      if (ui.follower) ui.autoCenter = true;
      map.setBearing(ui.heading);
    }
    showCompass();
  }
  /* Стрелката "С" и двурежимното копче върху картата: "Север", докато картата е завъртяна;
     "Посока", докато е север-нагоре, а посоката на движение е известна (и след "Стоп").
     Без известна посока - само "Север", и то само при завъртяна карта. */
  function showCompass(rot) {
    if (rot != null) ui.rot = rot;
    var b = $('#northBtn'), r = ui.rot || 0;
    var offer = r ? 'north' : ui.heading != null ? 'heading' : '';
    b.hidden = !offer;
    b.dataset.offer = offer;
    $('#northLbl').textContent = offer === 'heading' ? 'Посока' : 'Север';
    b.setAttribute('aria-label', offer === 'heading' ? 'Посока - завърти картата по посоката на движение' : 'Север - върни север нагоре');
    b.title = offer === 'heading' ? 'Завърти картата по посоката на движение' : 'Върни север нагоре';
    b.style.setProperty('--rose', (-r).toFixed(1) + 'deg');
  }
  function northUp() {
    setOrient($('#northBtn').dataset.offer === 'heading' ? 'heading' : 'north');
  }
  /* "Центрирай" (долу вдясно, при "+" и "−"): върху положението от GPS. При следене връща и
     автоматичното центриране и посоката; извън следене - последното известно положение,
     а без него пита браузъра веднъж. */
  function centerMe() {
    if (ui.follower) {
      ui.autoCenter = true;
      if (ui.pos) map.setView(ui.pos.lat, ui.pos.lon, Math.max(map.zoom, 15));
      followBearing();
      return;
    }
    if (ui.lastPos) { map.setView(ui.lastPos.lat, ui.lastPos.lon, Math.max(map.zoom, 15)); return; }
    if (!('geolocation' in navigator)) { toast('Няма сигнал от GPS', true); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      ui.lastPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (!ui.follower) map.setView(ui.lastPos.lat, ui.lastPos.lon, Math.max(map.zoom, 15));
    }, function () { toast('Няма сигнал от GPS', true); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }

  /* Последното изминато: панелът "Следене" и редът върху картата с копчето за сваляне.
     Пази се в браузъра - остава след презареждане и при отваряне на друг маршрут. */
  function showWalk() {
    var w = ui.lastWalk;
    var bar = !!(w && w.bar && !ui.follower);
    $('#walkBar').hidden = !bar;
    document.body.classList.toggle('walkbar-on', bar);
    $('#walkForget').hidden = !w || !!ui.follower;
    if (!w || ui.follower) return;
    $('#walkBarName').textContent = w.wname || w.title || 'изминат';
    $('#followPanel').hidden = false;
    $('#followTitle').textContent = 'Следене: ' + w.name;
    if (w.stats) { $('#fDone').textContent = w.stats.done; $('#fTime').textContent = w.stats.time; $('#fLeft').textContent = w.stats.left; $('#fOff').textContent = w.stats.off; }
    $('#fMsg').textContent = w.msg || ''; $('#fMsg').className = 'follow-msg';
    $('#walkDone').hidden = false;
  }
  function forgetWalk() {
    ui.lastWalk = null;
    U.DB.del('lastWalk');
    showWalk();
  }

  /* Прозорецът "Име на файла". ui.nameJob.kind казва каква е работата: 'walk' - изминатото,
     'route' - маршрутът ("Изнеси .gpx", "GPX" в реда на записан маршрут), 'save' - "Запази".
     job.def е предложеното име без .gpx. */
  function askName(job) {
    var d = $('#dlgName'), inp = $('#fileName');
    ui.nameJob = job;
    inp.value = job.def;
    $('#nameOk').textContent = job.kind === 'save' ? 'Запази' : 'Свали';
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
    inp.focus(); inp.select();
  }
  // Празно поле или само ".gpx" - предложеното име; липсващото разширение се добавя.
  function fileNameOf(job) {
    var name = $('#fileName').value.trim().replace(/[\\/:*?"<>|]+/g, '-');
    if (!name || /^\.gpx$/i.test(name)) name = job.def;
    if (!/\.gpx$/i.test(name)) name += '.gpx';
    return name;
  }
  function plainName(n) { return String(n || '').trim().replace(/[\\/:*?"<>|]+/g, '-') || 'marshrut'; }
  // Изминатото като .gpx: пита за име на файла, после сваля. Следенето не спира.
  function walkGpx(pts, routeName, title) {
    if (!pts || pts.length < 2) return;
    askName({ kind: 'walk', pts: pts.slice(), title: title || 'изминат ' + U.date(Date.now()), def: 'izminat-' + U.slug(routeName) + '-' + U.dateDots(Date.now()) });
  }
  // Маршрутът като .gpx: пита за име (предложено - името на маршрута); празен маршрут не пита.
  function askRouteGpx(r) {
    r = r || cur();
    if (!routeGeo(r)) { toast('Маршрутът е празен - клик върху трак го слага в маршрута.', true); return; }
    askName({ kind: 'route', routeId: r.id, def: plainName(r.name) });
  }
  // "Запази": същият прозорец, попълнен с името на маршрута.
  function askSave() { askName({ kind: 'save', routeId: cur().id, def: plainName(cur().name) }); }
  function nameDone() {
    var job = ui.nameJob; if (!job) return;
    ui.nameJob = null;
    var name = fileNameOf(job);
    if (job.kind === 'route') {
      var r = S.routes.filter(function (x) { return x.id === job.routeId; })[0];
      if (r) exportGpx(r, name);
    } else if (job.kind === 'save') {
      if (job.routeId === cur().id) saveRoute(name);
    } else {
      var xml = GPX.build({ name: job.title, pts: job.pts, wpts: [] });
      U.download(new Blob([xml], { type: 'application/gpx+xml' }), name);
      toast('Изнесен ' + name + ' · ' + U.km(U.lengthOf(job.pts)) + ', ' + U.num(job.pts.length) + ' точки', false, 4500);
    }
  }
  /* Сваля <име>.gpx и записва текущия маршрут в "Записани маршрути" под същото име. Текущият
     маршрут винаги е в списъка - преименува се той, втори запис не се прави. */
  function saveRoute(fname) {
    var r = cur(), name = fname.replace(/\.gpx$/i, '').trim() || r.name;
    if (name !== r.name) {
      r.name = name;
      $('#routeName').value = name;
      document.title = name + ' · GPX конструктор';
    }
    r.modified = Date.now();
    var got = exportGpx(r, fname, true);
    saveNow().then(function () {
      renderRoutes();
      if (got) toast('Свален ' + fname + ' · записан в „Записани маршрути“ като „' + name + '“', false, 5000);
      else toast('Записан в „Записани маршрути“ като „' + name + '“. Маршрутът е празен - .gpx не е свален.', true);
    });
  }

  // ---- Търсене на адрес (Nominatim) ----
  function search(q) {
    var box = $('#searchResults');
    box.hidden = false;
    box.innerHTML = '<div class="msg">Търся...</div>';
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=bg&q=' + encodeURIComponent(q);
    fetch(url, { headers: { 'Accept': 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (list) {
      if (!list.length) { box.innerHTML = '<div class="msg">Нищо не е намерено за "' + U.esc(q) + '".</div>'; return; }
      box.innerHTML = list.map(function (x, i) { return '<button type="button" data-i="' + i + '">' + U.esc(x.display_name) + '</button>'; }).join('');
      $$('button', box).forEach(function (b) {
        b.addEventListener('click', function () {
          var x = list[+b.dataset.i];
          box.hidden = true;
          ui.pin = { lat: +x.lat, lon: +x.lon, name: String(x.display_name).split(',')[0] };
          if (x.boundingbox) {
            var bb = x.boundingbox.map(Number);
            map.fitBounds({ s: bb[0], n: bb[1], w: bb[2], e: bb[3] }, barPad());
            if (map.zoom > 16) map.setView(+x.lat, +x.lon, 16);
          } else map.setView(+x.lat, +x.lon, 15);
        });
      });
    }).catch(function () {
      box.innerHTML = '<div class="msg">Търсенето не отговаря в момента. Опитай пак след малко.</div>';
    });
  }

  // ---- Маршрути ----
  function openRoute(id) {
    if (ui.follower) stopFollow();
    if (!ui.lastWalk) $('#followPanel').hidden = true;
    S.curId = id;
    ui.undo = []; $('#undoBtn').disabled = true;
    ui.drawTarget = null; ui.cut = null; prof = null; lastElevKey = null;
    analyzeNow();
    loadPic();
    fitRoute();
  }
  function deleteRoute(id) {
    var r = S.routes.filter(function (x) { return x.id === id; })[0];
    if (!r || !confirm('Да изтрия ли маршрута "' + r.name + '"? Траковете-източници остават.')) return;
    S.routes = S.routes.filter(function (x) { return x.id !== id; });
    U.DB.del('snap:' + id);
    if (S.curId === id) { S.curId = null; openRoute(cur().id); }
    else { renderRoutes(); saveSoon(); }
  }

  // ---- Изчистване ----
  // "Нов": маха всички тракове и с тях частите на текущия маршрут (част без трак не може).
  // Записаните маршрути остават; "Отмени" връща всичко от пълния отпечатък.
  function clearTracks() {
    var r = cur();
    if (!S.tracks.length && !r.items.length) return;
    pushUndo(true);
    S.tracks = [];
    r.items = []; r.forks = []; r.openGaps = [];
    ui.cut = null; ui.sel = null; ui.drawTarget = null; ui.hl = null;
    hidePointMenu();
    r.modified = Date.now();
    analyzeNow(); saveNow();
    toast('Траковете и маршрутът са махнати. "Отмени" ги връща.');
  }
  // "Изтрий": маха всички части на маршрута, траковете остават.
  function clearParts() {
    var r = cur();
    if (!r.items.length) return;
    pushUndo();
    r.items = []; r.forks = []; r.openGaps = [];
    ui.sel = null; ui.drawTarget = null;
    hidePointMenu();
    routeChanged();
    toast('Частите са махнати. "Отмени" ги връща.');
  }

  // ---- Свиващи се панели ----
  // "Точки", "Дубликати" и "Изрязано от тракове" са свити, докато не се отворят; помни се в браузъра.
  function applyFolds() {
    $$('[data-fold]').forEach(function (c) {
      var open = ui.fold[c.dataset.fold] === true;
      c.classList.toggle('open', open);
      $('.fold-t', c).setAttribute('aria-expanded', open ? 'true' : 'false');
      $('.fold-b', c).hidden = !open;
    });
  }
  function toggleFold(key) {
    ui.fold[key] = ui.fold[key] !== true;
    U.LS.set('fold', ui.fold);
    applyFolds();
  }

  var MONTHS_FULL = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
  function showVersion() {
    var d = new Date(GPXK_DATE + 'T12:00:00');
    $('#appVersion').textContent = GPXK_VERSION;
    $('#appDate').textContent = isNaN(d) ? '' : ' · ' + d.getDate() + ' ' + MONTHS_FULL[d.getMonth()] + ' ' + d.getFullYear();
  }

  // ---- Тема ----
  function setTheme(m) {
    document.documentElement.setAttribute('data-app-mode', m);
    U.LS.set('mode', m);
    $('#themeBtn').textContent = m === 'dark' ? 'Светла тема' : 'Тъмна тема';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', U.cssVar('--app-bg'));
    refreshColors();
    renderPanel();
  }

  // ---- Връзки с интерфейса ----
  function setTol(v) {
    S.tol = v;
    $$('.tolInput').forEach(function (r) { if (r.value !== String(v)) r.value = v; });
    $$('.tolVal').forEach(function (b) { b.textContent = v + ' м'; });
    analyzeNow();
  }
  function onAction(act, el) {
    switch (act) {
      case 'add-tracks': openImport(); break;
      case 'load-collection': openImport(); break;
      case 'picture': openPicture(); break;
      case 'export-gpx': askRouteGpx(); break;
      case 'export-collection': exportCollection(); break;
      case 'save': askSave(); break;
      case 'follow': if (ui.follower) stopFollow(); else startFollow(); break;
      case 'follow-stop': stopFollow(); break;
      case 'awake': setAwake(!ui.awake); break;
      case 'walk-gpx': if (ui.follower) walkGpx(ui.follower.rec, ui.followName, 'изминат ' + U.date(Date.now())); break;
      case 'walk-gpx-done': if (ui.lastWalk) walkGpx(ui.lastWalk.pts, ui.lastWalk.name, ui.lastWalk.title); break;
      case 'center': centerMe(); break;
      case 'north': northUp(); break;
      case 'walkbar-close': if (ui.lastWalk) { ui.lastWalk.bar = false; U.DB.set('lastWalk', ui.lastWalk); } showWalk(); break;
      case 'walk-forget': forgetWalk(); $('#followPanel').hidden = true; break;
      case 'live-save': liveDone('save'); break;
      case 'live-gpx': liveDone('gpx'); break;
      case 'live-drop': liveDone('drop'); break;
      case 'to-panel': $('#panel').scrollIntoView({ behavior: 'smooth' }); break;
      case 'undo': undo(); break;
      case 'clear-tracks': clearTracks(); break;
      case 'clear-parts': clearParts(); break;
      case 'zoom-in': map.zoomAround(Math.round(map.zoom) + 1); break;
      case 'zoom-out': map.zoomAround(Math.round(map.zoom) - 1); break;
      case 'fit': fitRoute(); break;
      case 'cut-ok': cutConfirm(); break;
      case 'cut-back': cutBack(); break;
      case 'point-remove': if (ui.sel) removeVertex(ui.sel.idx, ui.sel.pi); break;
      case 'point-close': hidePointMenu(); break;
      case 'pic-make': makePicture(false); break;
      case 'pic-make-both': makePicture(true); break;
      case 'pic-open': showPic(true); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'pic-close': showPic(false); break;
      case 'pic-fit': picFit(false); break;
      case 'pic-1': picFit(true); break;
      case 'new-route': newRoute('Нов маршрут'); openRoute(S.routes[0].id); setMode('select'); window.scrollTo({ top: 0, behavior: 'smooth' }); toast('Нов маршрут: клик върху трак на картата го слага като първа част'); break;
      case 'new-empty': newRoute('Празен маршрут'); openRoute(S.routes[0].id); setMode('add'); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'show-bar': setBar(false); break;
      case 'hide-bar': setBar(true); break;
      case 'theme': setTheme(document.documentElement.getAttribute('data-app-mode') === 'dark' ? 'light' : 'dark'); break;
    }
  }

  function bind() {
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (b && !b.disabled) { e.preventDefault(); onAction(b.dataset.act, b); }
    });
    $$('[data-fold]').forEach(function (c) {
      $('.fold-t', c).addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleFold(c.dataset.fold); });
    });
    $$('#tools [data-mode]').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.mode); }); });
    $$('.mapctl .seg.base button').forEach(function (b) {
      b.addEventListener('click', function () { ui.base = b.dataset.base; U.LS.set('base', ui.base); applyLayers(); });
    });
    $('#labelsToggle').addEventListener('change', function (e) { ui.labels = e.target.checked; U.LS.set('labels', ui.labels); applyLayers(); });
    $('#vtxToggle').checked = ui.vtxShow;
    $('#vtxToggle').addEventListener('change', function (e) { ui.vtxShow = e.target.checked; U.LS.set('vtxShow', ui.vtxShow); map.redraw(); });
    $('#gradeToggle').checked = ui.grade;
    $('#gradeToggle').addEventListener('change', function (e) { ui.grade = e.target.checked; U.LS.set('grade', ui.grade); drawProfile(); });
    // Отклонение: до 3 цифри (0-999 м); прилага се с Enter или при излизане от полето.
    $$('.tolInput').forEach(function (r) {
      r.addEventListener('input', function () { var c = r.value.replace(/\D/g, '').slice(0, 3); if (c !== r.value) r.value = c; });
      function apply() {
        var v = parseInt(r.value, 10);
        if (isNaN(v)) { r.value = S.tol; return; }
        v = Math.max(0, Math.min(999, v));
        if (v !== S.tol) setTol(v); else r.value = v;
      }
      r.addEventListener('change', apply);
      r.addEventListener('blur', apply);
      r.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    });
    $('#nameForm').addEventListener('submit', function (e) {
      e.preventDefault();
      nameDone();
      $('#dlgName').close();
    });
    $('#dlgName').addEventListener('close', function () { ui.nameJob = null; });
    // × затваря прозореца "Незавършено следене" - записът остава до следващото отваряне.
    $('#dlgLive').addEventListener('close', function () { ui.live = null; });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') liveSave(); });
    window.addEventListener('pagehide', function () { liveSave(); });
    $('#nameCancel').addEventListener('click', function () { $('#dlgName').close(); });
    $$('#followBar [data-view]').forEach(function (b) { b.addEventListener('click', function () { showPic(b.dataset.view === 'pic'); followBearing(); }); });
    $$('#followBar [data-orient]').forEach(function (b) { b.addEventListener('click', function () { setOrient(b.dataset.orient); }); });

    $('#routeName').addEventListener('input', function (e) {
      cur().name = e.target.value.trim() || 'Маршрут';
      cur().modified = Date.now();
      document.title = cur().name + ' · GPX конструктор';
      saveSoon();
    });
    $('#routeName').addEventListener('change', function () { renderRoutes(); });
    $('#routeFilter').addEventListener('input', renderRoutes);

    $('#searchForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('#searchInput').value.trim();
      if (q) search(q);
    });
    $('#searchInput').addEventListener('keydown', function (e) { if (e.key === 'Escape') $('#searchResults').hidden = true; });

    // Точка: име и махане.
    $('#pointName').addEventListener('input', function (e) {
      if (!ui.sel) return;
      var it = cur().items[ui.sel.idx];
      if (it && it.pts[ui.sel.pi]) { it.pts[ui.sel.pi].name = e.target.value; map.redraw(); saveSoon(); }
    });
    $('#pointName').addEventListener('change', function () { renderPoints(); });
    $('#pointName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); hidePointMenu(); renderPoints(); } });

    // Части в маршрута.
    var ol = $('#partsList');
    ol.addEventListener('click', function (e) {
      var b = e.target.closest('[data-part]'); if (!b) return;
      var idx = +b.closest('li').dataset.idx, items = cur().items, act = b.dataset.part;
      if (act === 'del') { removeItem(idx); return; }
      pushUndo();
      if (act === 'up' && idx > 0) { var x = items.splice(idx, 1)[0]; items.splice(idx - 1, 0, x); }
      if (act === 'down' && idx < items.length - 1) { var y = items.splice(idx, 1)[0]; items.splice(idx + 1, 0, y); }
      if (act === 'rev') items[idx].rev = !items[idx].rev;
      ui.drawTarget = null;
      routeChanged();
    });
    ol.addEventListener('mouseover', function (e) {
      var li = e.target.closest('li[data-idx]'); var idx = li ? +li.dataset.idx : null;
      if ((ui.hl && ui.hl.item) !== idx) { ui.hl = li ? { item: idx } : null; map.redraw(); }
    });
    ol.addEventListener('mouseleave', function () { ui.hl = null; map.redraw(); });
    var dragFrom = null;
    ol.addEventListener('dragstart', function (e) { var li = e.target.closest('li'); if (li) { dragFrom = +li.dataset.idx; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(dragFrom)); } catch (er) { /* */ } } });
    ol.addEventListener('dragover', function (e) { if (dragFrom != null) e.preventDefault(); });
    ol.addEventListener('drop', function (e) {
      e.preventDefault();
      var li = e.target.closest('li[data-idx]'); if (!li || dragFrom == null) return;
      var to = +li.dataset.idx;
      if (to !== dragFrom) { pushUndo(); var items = cur().items, x = items.splice(dragFrom, 1)[0]; items.splice(to, 0, x); ui.drawTarget = null; routeChanged(); }
      dragFrom = null;
    });
    $('#gapsList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-gapact]'); if (!b) return;
      if (b.dataset.gapact === 'reopen') {
        var ag = (G.autoGaps || [])[+b.closest('[data-autogap]').dataset.autogap];
        if (ag) reopenGap(ag);
        return;
      }
      var before = +b.closest('[data-gap]').dataset.gap;
      var gp = G.gaps.filter(function (g) { return g.beforeIdx === before; })[0];
      if (!gp) return;
      if (b.dataset.gapact === 'draw') { closeGap(gp); window.scrollTo({ top: 0, behavior: 'smooth' }); } else bridgeGap(gp);
    });

    // Точки.
    var pl = $('#pointsList');
    pl.addEventListener('input', function (e) {
      if (!e.target.classList.contains('pname')) return;
      var li = e.target.closest('li'), it = cur().items[+li.dataset.idx];
      if (it && it.pts[+li.dataset.pi]) { it.pts[+li.dataset.pi].name = e.target.value; map.redraw(); saveSoon(); }
    });
    pl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pt="del"]'); if (!b) return;
      var li = b.closest('li'); removeVertex(+li.dataset.idx, +li.dataset.pi);
    });

    // Тракове.
    var tl = $('#tracksList');
    tl.addEventListener('click', function (e) {
      var li = e.target.closest('li'); if (!li) return;
      var t = track(li.dataset.track); if (!t) return;
      var b = e.target.closest('[data-tr]');
      var act = b ? b.dataset.tr : null;
      if (act === 'fit') { fitTo([t.pts]); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else if (act === 'gpx') exportTrack(t);
      else if (act === 'del') {
        var usedIn = S.routes.filter(function (r) { return r.items.some(function (it) { return it.trackId === t.id; }); }).length;
        if (!confirm('Да махна ли трака "' + t.name + '"?' + (usedIn ? ' Използва се в ' + usedIn + ' маршрута - частите му ще се маркират като липсващи.' : ''))) return;
        S.tracks = S.tracks.filter(function (x) { return x.id !== t.id; });
        analyzeNow(); saveNow();
      }
    });
    tl.addEventListener('change', function (e) {
      if (e.target.dataset.tr !== 'vis') return;
      var t = track(e.target.closest('li').dataset.track);
      t.visible = e.target.checked;
      analyzeNow();
    });
    tl.addEventListener('mouseover', function (e) {
      var li = e.target.closest('li'); var id = li ? li.dataset.track : null;
      if ((ui.hl && ui.hl.track) !== id) { ui.hl = id ? { track: id } : null; map.redraw(); }
    });
    tl.addEventListener('mouseleave', function () { ui.hl = null; map.redraw(); });

    // Изрязано.
    $('#cutsList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cut="back"]'); if (!b) return;
      var li = b.closest('li'), t = track(li.dataset.track);
      if (!t) return;
      pushUndo();
      t.cuts = t.cuts.filter(function (c, i) { return i !== +li.dataset.ci; });
      toast('Изрязаното е върнато');
      analyzeNow();
    });

    // Маршрути.
    $('#routesBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-rt]'); if (!b) return;
      var id = b.closest('tr').dataset.route, act = b.dataset.rt;
      if (act === 'open') { openRoute(id); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else if (act === 'gpx') askRouteGpx(S.routes.filter(function (r) { return r.id === id; })[0]);
      else if (act === 'del') deleteRoute(id);
    });

    // Профил.
    var pc = $('#profile');
    pc.addEventListener('pointermove', profileHover);
    pc.addEventListener('pointerdown', profileHover);
    pc.addEventListener('pointerleave', profileLeave);

    // Файлове: копче, пускане в полето, пускане навсякъде.
    $('#fileInput').addEventListener('change', function (e) { handleFiles(e.target.files).then(function () { e.target.value = ''; }); });
    var dz = $('#dropZone');
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function () { dz.classList.remove('over'); }); });
    window.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      handleFiles(e.dataTransfer.files);
    });
    $('#picForm').addEventListener('change', updatePicEst);

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); }
      if (e.key === 'Escape') { hidePointMenu(); if (ui.cut) cutBack(); }
    });
    window.addEventListener('resize', U.debounce(function () { drawProfile(); if (!$('#picView').hidden) picFit(); }, 150));
  }

  // ---- Старт ----
  function init() {
    refreshColors();
    map = new window.TileMap($('#map'), {
      onClick: onClick, onPress: onPress, onLongPress: onLongPress, onHover: onHover,
      background: function () { return C['map-bg']; },
      dblZoom: function () { return ui.mode === 'select' && !ui.hover; }
    });
    map.addDrawer(drawMap);
    map.on('viewchange', function (v) { U.LS.set('view', v); if (!$('#pointMenu').hidden) hidePointMenu(); });
    map.on('usermove', function () { if (ui.follower) ui.autoCenter = false; $('#tip').hidden = true; });
    map.on('rotate', showCompass);
    // Височината на горната лента - при следене контролите горе вдясно стоят под нея.
    var barEl = $('#bar'), barH = function () { document.documentElement.style.setProperty('--bar-h', Math.round(barEl.getBoundingClientRect().height) + 'px'); };
    if (window.ResizeObserver) new ResizeObserver(barH).observe(barEl); else window.addEventListener('resize', barH);
    barH();
    var tileErrs = 0, warned = false;
    map.on('tileerror', function () {
      tileErrs++;
      if (tileErrs >= 8 && !warned) {
        warned = true;
        toast('Плочките на картата не се зареждат - няма връзка или услугата отказва. Запазената картина работи и без връзка.', true, 8000);
      }
    });
    applyLayers();
    $('#themeBtn').textContent = document.documentElement.getAttribute('data-app-mode') === 'dark' ? 'Светла тема' : 'Тъмна тема';
    bind();
    applyFolds();
    showVersion();
    setMode('select');
    var view = U.LS.get('view', null);
    if (view && isFinite(view.lat) && isFinite(view.lon)) map.setView(view.lat, view.lon, view.zoom);
    else map.setView(HOME.lat, HOME.lon, HOME.zoom);

    U.DB.get('collection').then(function (data) {
      if (data && data.tracks) {
        try { adopt(data, false); } catch (e) { console.error(e); }
      }
    }).catch(function () { /* празна колекция */ }).then(function () {
      S.tracks.forEach(function (t) { if (t.color == null) t.color = nextColor(); });
      $$('.tolInput').forEach(function (r) { r.value = S.tol; });
      $$('.tolVal').forEach(function (b) { b.textContent = S.tol + ' м'; });
      cur();
      analyzeNow();
      loadPic();
      if (!view && S.tracks.length) fitRoute();
      return U.DB.get('lastWalk').then(function (w) {
        if (w && w.pts && w.pts.length >= 2 && !ui.follower) { ui.lastWalk = w; showWalk(); }
      }).catch(function () { /* без последно изминато */ }).then(function () {
        return U.DB.get('liveWalk');
      }).then(function (lw) {
        if (!lw || ui.follower) return;
        if (!Array.isArray(lw.pts) || lw.pts.length < 2) { U.DB.del('liveWalk'); return; }
        liveAsk(lw);
      }).catch(function () { /* без незавършено следене */ });
    }).then(function () {
      window.__gpxk = { S: S, get A() { return A; }, get G() { return G; }, get prof() { return prof; }, map: map, ui: ui, handleFiles: handleFiles, refresh: function () { routeChanged(); }, flattenAutoGaps: flattenAutoGaps, ready: true };
    });

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* без офлайн обвивка */ });
    }
  }

  window.addEventListener('error', function (e) {
    try { toast('Нещо се обърка: ' + (e.message || 'непозната грешка') + '. Данните са запазени.', true); } catch (er) { /* */ }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
