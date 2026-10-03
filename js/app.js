/* CX Tracks (по-рано GPX конструктор) - приложението: състояние, карта, решения с клик, списъци под картата,
   износ, картина за офлайн и следене. */
(function () {
  'use strict';

  var U = window.U, Core = window.Core, Elev = window.Elev, GPX = window.GPX;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var TE = function (k, p) { return U.esc(T(k, p)); }; // надпис от речника, готов за HTML

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
    get satLabels() { return '© Esri, Maxar, Earthstar Geographics · ' + T('attr.labels') + ': Esri Reference'; },
    get topo() { return '© OpenTopoMap (CC-BY-SA), ' + T('attr.data') + ' © OpenStreetMap'; }
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
      r = S.routes[0] || newRoute(T('route.new'));
      S.curId = r.id;
    }
    return r;
  }
  function newRoute(name) {
    var r = { id: U.uid(), name: name || T('route.new'), created: Date.now(), modified: Date.now(), items: [], walks: [] };
    S.routes.unshift(r);
    return r;
  }
  function trackColor(t) { return C['track-' + ((t.color || 0) % 8 + 1)] || C.muted; }
  function trackLabel(t) { return t ? t.name : T('track.missing'); }
  function kmRange(a, b) { return T('km.range', { a: U.kmShort(Math.min(a, b)), b: U.kmShort(Math.max(a, b)) }); }
  // Имената по подразбиране (на всеки от езиците на речника) - не са писани от потребителя.
  var DEF_NAMES = ['route.new', 'routes.empty', 'route.def'];
  function defaultName(n) {
    return DEF_NAMES.some(function (k) { var e = I18N.all[k]; return e && (n === e[0] || n === e[1] || n === T(k)); });
  }

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
      toast(T('msg.saveFail'), true);
    });
  }
  function adopt(data, merge) {
    if (!data || !Array.isArray(data.tracks)) throw new Error(T('err.notColl'));
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
      forks: cur().forks || [], openGaps: cur().openGaps || [], smooth: cur().smooth || null
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
    if (r) {
      r.items = s.items; r.forks = s.forks || []; r.openGaps = s.openGaps || []; S.curId = r.id;
      if (s.smooth) r.smooth = s.smooth; else delete r.smooth;
    }
    s.cuts.forEach(function (c) { var t = track(c[0]); if (t) t.cuts = c[1]; });
    (s.skips || []).forEach(function (c) { var t = track(c[0]); if (t) { t.skips = c[1]; t.openGaps = c[2]; } });
    ui.cut = null; ui.sel = null; ui.drawTarget = null;
    hidePointMenu();
    analyzeNow();
    toast(T('msg.undone'));
  }

  // ---- Преизчисляване ----
  function visibleTracks() { return S.tracks.filter(function (t) { return t.visible !== false; }); }
  function analyzeNow() {
    try {
      A = Core.analyze(visibleTracks(), S.tol);
    } catch (e) {
      console.error(e);
      A = { byTrack: {}, dups: [], pend: [], parts: [], gaps: [], closedGaps: [] };
      toast(T('msg.dupErr', { e: e.message }), true);
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
    $('#elevNote').textContent = T('elev.asking');
    Elev.fill(samples, function (f) {
      if (token === elevToken) $('#elevNote').textContent = T('elev.askingP', { p: Math.round(f * 100) });
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
        note = fromFile ? T('elev.fromFiles') : T('elev.none');
      } else note = T('elev.ok', { src: res.source === 'кеш' ? T('elev.cache') : res.source, step: Math.round(step) });
      flattenAutoGaps(samples, G.autoGaps);
      prof = Elev.profile(samples);
      if (prof) { r.up = prof.up; r.down = prof.down; r.maxGrade = prof.maxUp; }
      $('#elevNote').textContent = note;
      renderStats(); drawProfile(); renderRoutes();
      saveSoon();
    }).catch(function (e) {
      if (token !== elevToken) return;
      $('#elevNote').textContent = T('elev.err', { e: e.message });
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
    attrib();
  }
  function attrib() { $('#attrib').textContent = ui.base === 'topo' ? ATTR.topo : ui.labels ? ATTR.satLabels : ATTR.sat; }

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
        var dl = T('map.dupX'), w = ctx.measureText(dl).width;
        mapLabel(ctx, o.x - w / 2, o.y + MARK_R + 10, dl, C.dup);
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
  /* "Свързано направо": празна връзка (draw без точки) между две части - маршрутът минава направо
     от края на едната до началото на другата. [{from, to, item}] за чертане - на картата и в "Картина". */
  function bridgeLines() {
    var out = [];
    if (!G) return out;
    G.items.forEach(function (g, gi) {
      if (g.item.type !== 'draw' || g.pts.length) return;
      var a = null, b = null, i;
      for (i = gi - 1; i >= 0 && !a; i--) if (G.items[i].pts.length) a = G.items[i].pts[G.items[i].pts.length - 1];
      for (i = gi + 1; i < G.items.length && !b; i++) if (G.items[i].pts.length) b = G.items[i].pts[0];
      if (a && b && U.hav(a[0], a[1], b[0], b[1]) > 0.5) out.push({ from: a, to: b, item: g.item });
    });
    return out;
  }
  // Надписът "свързано направо" гасне BRIDGE_MS след "Свържи направо" (последните BRIDGE_FADE - плавно).
  var BRIDGE_MS = 4000, BRIDGE_FADE = 700;
  function bridgeLabelAlpha(item) {
    var b = ui.bridgeLbl;
    if (!b || b.item !== item) return 0;
    return Math.max(0, Math.min(1, (b.until - Date.now()) / BRIDGE_FADE));
  }
  function bridgeLabel(item) {
    var b = ui.bridgeLbl = { item: item, until: Date.now() + BRIDGE_MS };
    clearTimeout(ui.bridgeTimer);
    ui.bridgeTimer = setTimeout(function fade() {
      if (ui.bridgeLbl !== b) return;
      map.redraw();
      if (Date.now() < b.until) requestAnimationFrame(fade); else { ui.bridgeLbl = null; map.redraw(); }
    }, BRIDGE_MS - BRIDGE_FADE);
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
      // "Свързано направо": кехлибарено на пунктир, като попълнената дупка в GPS; надписът гасне.
      ui.bridges = [];
      if (!following) bridgeLines().forEach(function (bl) {
        var a = pr(bl.from[0], bl.from[1]), b = pr(bl.to[0], bl.to[1]), al = bridgeLabelAlpha(bl.item);
        path(ctx, pr, [bl.from, bl.to]); stroke(ctx, C.casing, 7); stroke(ctx, C['walk-gap'], 5, [9, 7]);
        ui.bridges.push({ from: bl.from, to: bl.to, label: al > 0 ? T('map.bridged') : '', alpha: al });
        if (al > 0) { ctx.globalAlpha = al; mapLabel(ctx, (a[0] + b[0]) / 2 + 10, (a[1] + b[1]) / 2, T('map.bridged'), C['walk-gap']); ctx.globalAlpha = 1; }
      });
      // Начало и край.
      var s0 = pr(G.pts[0][0], G.pts[0][1]), e0 = pr(G.pts[G.pts.length - 1][0], G.pts[G.pts.length - 1][1]);
      var loop = Math.hypot(s0[0] - e0[0], s0[1] - e0[1]) < 12;
      endMarker(ctx, e0, C.danger, loop ? null : T('map.end'));
      endMarker(ctx, s0, C.ok, loop ? T('map.startEnd') : T('map.start'));
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
        mapLabel(ctx, (a[0] + b[0]) / 2 + 8, (a[1] + b[1]) / 2, T('map.gap', { d: U.dist(gp.d) }), C.gap);
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
          mapLabel(ctx, q[0] + 13, q[1], T('km.at', { d: U.kmShort(d) }));
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
      // Точките от копчето "Точка" - ромбче с името (по подразбиране "Точка N").
      ui.follower.wpts.forEach(function (w) {
        var q = pr(w.lat, w.lon);
        ctx.beginPath(); ctx.moveTo(q[0], q[1] - 7); ctx.lineTo(q[0] + 7, q[1]); ctx.lineTo(q[0], q[1] + 7); ctx.lineTo(q[0] - 7, q[1]); ctx.closePath();
        ctx.fillStyle = C.casing; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = C.walked; ctx.stroke();
        if (w.name) mapLabel(ctx, q[0] + 10, q[1], w.name);
      });
    }
    if (ui.pos) {
      var pq = pr(ui.pos.lat, ui.pos.lon);
      if (ui.prog && ui.prog.isOff) {
        var nq = pr(ui.prog.lat, ui.prog.lon);
        ctx.beginPath(); ctx.moveTo(pq[0], pq[1]); ctx.lineTo(nq[0], nq[1]);
        stroke(ctx, C.casing, 5); stroke(ctx, C.warn, 3, [4, 4]);
        mapLabel(ctx, pq[0] + 14, pq[1] - 14, T('map.off', { d: U.meters(ui.prog.off) }), C.warn);
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
        (inR ? U.esc(T('tip.inRoute')) : fk ? U.esc(T('tip.fork')) : U.esc(T('tip.addAs', { n: G.count + 1 })));
    }
    if (h.kind === 'item') {
      if (h.g.link) return U.esc(T('tip.link')) + ' · <b>' + U.dist(h.g.len) + '</b><br>' + U.esc(T('tip.clickRemove'));
      return U.esc(T('tip.part', { n: h.g.no })) + ' · <b>' + U.km(h.g.len) + '</b><br>' + U.esc(h.g.bad ? T('tip.invalid', { why: h.g.badWhy }) : T('tip.clickRemove'));
    }
    if (h.kind === 'gap') return U.esc(T('tip.gap')) + ' <b>' + U.dist(h.gap.d) + '</b><br>' + U.esc(T('tip.gapClick'));
    if (h.kind === 'fork') {
      var f = forkOf(h.j);
      return U.esc(T('tip.junction')) + ' · ' + U.esc(T.n('n.branches', h.j.branches.length)) + '<br>' +
        U.esc(f && f.chosen >= 0 ? T('tip.forkSwitch') : T('tip.forkAdd'));
    }
    if (h.kind === 'vertex') return U.esc(T('tip.vertex'));
    if (h.kind === 'cut') return U.esc(T('tip.cut'));
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
      toast(T('msg.partRemoved', { n: no }));
    } else {
      var t = track(sec.trackId), rev = false, e = lastEnd();
      if (t && e) {
        var s0 = Core.pointAt(t, sec.a), s1 = Core.pointAt(t, sec.b);
        rev = U.hav(e[0], e[1], s1[0], s1[1]) < U.hav(e[0], e[1], s0[0], s0[1]);
      }
      cur().items.push({ type: 'part', trackId: sec.trackId, a: sec.a, b: sec.b, rev: rev });
      ui.drawTarget = null;
      toast(T('msg.partAdded', { n: (G ? G.count : 0) + 1, len: U.km(sec.len) }));
    }
    routeChanged();
  }
  function removeItem(idx) {
    var g = G.items.filter(function (x) { return x.idx === idx; })[0];
    pushUndo();
    cur().items.splice(idx, 1);
    if (ui.drawTarget != null && ui.drawTarget >= idx) ui.drawTarget = ui.drawTarget === idx ? null : ui.drawTarget - 1;
    toast(g && g.no ? T('msg.partRemoved', { n: g.no }) : T('msg.stretchRemoved'));
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
    toast(T('msg.forkSwitched', { name: trackLabel(track(fk.br.trackId)) }));
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
    toast(T('msg.dupRemoved', { len: U.km(sec.len) }));
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
    toast(T('msg.gapOpened'));
  }
  function closeGap(gp) {
    pushUndo();
    cur().items.splice(gp.beforeIdx, 0, { type: 'draw', pts: [], link: true });
    ui.drawTarget = gp.beforeIdx;
    setMode('add');
    toast(T('msg.drawLink'));
    routeChanged();
  }
  function bridgeGap(gp) {
    pushUndo();
    var it = { type: 'draw', pts: [], bridge: true, link: true };
    cur().items.splice(gp.beforeIdx, 0, it);
    routeChanged();
    bridgeLabel(it);
    map.redraw();
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
    toast(T('msg.drag'));
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
      else if (!v) toast(ui.mode === 'remove' ? T('msg.clickRemove') : T('msg.grabPoint'));
      return;
    }
    var h = hitTest(p);
    if (!h) { toggleBar(); return; }
    if (h.kind === 'none') return;
    if (h.kind === 'marker') { skipDup(h.sec); return; }
    if (h.kind === 'fork') { toast(T('msg.forkClick')); return; }
    var fk = h.kind === 'part' && findItemFor(h.sec) < 0 ? forkFor(h.sec) : null;
    if (fk) switchFork(fk);
    else if (h.kind === 'part') addPart(h.sec);
    else if (h.kind === 'item') removeItem(h.idx);
    else if (h.kind === 'gap') closeGap(h.gap);
    else if (h.kind === 'vertex') showPointMenu(h);
    else if (h.kind === 'cut') toast(T('msg.isCut'));
  }
  function toggleBar() { setBar(!document.body.classList.contains('bar-hidden')); }
  // Скрива/връща горната лента. Кръглата "Лента" горе вляво стои винаги: стрелкичката сочи нагоре при отворена
  // лента (натискаш - скрива я) и надолу при скрита (натискаш - връща я).
  function setBar(hide) {
    document.body.classList.toggle('bar-hidden', hide);
    barHandle();
    if (hide && !U.LS.get('barHint', false)) {
      U.LS.set('barHint', true);
      toast(T('msg.barHidden'), false, 6000);
    }
  }
  function barHandle() {
    var hide = document.body.classList.contains('bar-hidden');
    var h = $('#barHandle'), t = hide ? T('bar.show') : T('bar.hide');
    h.dataset.dir = hide ? 'down' : 'up';
    h.setAttribute('aria-expanded', String(!hide));
    h.setAttribute('aria-label', t); h.title = t;
    h.querySelector('.bt-arr').setAttribute('d', hide ? 'M12 13v6.4M8.8 16.2 12 19.4l3.2-3.2' : 'M12 19.4V13M8.8 16.2 12 13l3.2 3.2');
  }

  // ---- Изрязване с две точки по трака ----
  function cutClick(p) {
    var nt = nearestTrack(p, 18);
    if (!nt) { toast(T('msg.cutCloser')); return; }
    var n = Core.nearestOnTrack(nt.t, p.lat, p.lon);
    var d = snapEnd(nt.t, n.d);
    if (!ui.cut || ui.cut.b != null) {
      ui.cut = { trackId: nt.t.id, a: d, b: null };
    } else {
      if (nt.t.id !== ui.cut.trackId) { toast(T('msg.cutSame'), true); return; }
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
      $('#cutText').textContent = T('cut.start');
      $('#cutSub').textContent = '';
      ok.disabled = true;
      return;
    }
    var t = track(ui.cut.trackId);
    if (ui.cut.b == null) {
      $('#cutText').textContent = T('cut.from', { d: U.kmShort(ui.cut.a) });
      $('#cutSub').textContent = trackLabel(t);
      ok.disabled = true;
    } else {
      $('#cutText').textContent = T('cut.range', { r: kmRange(ui.cut.a, ui.cut.b) });
      $('#cutSub').textContent = T('cut.sub', { len: U.km(Math.abs(ui.cut.b - ui.cut.a)) });
      ok.disabled = Math.abs(ui.cut.b - ui.cut.a) < 5;
    }
    map.redraw();
  }
  function cutConfirm() {
    if (!ui.cut || ui.cut.b == null) return;
    var t = track(ui.cut.trackId);
    pushUndo();
    t.cuts = (t.cuts || []).concat([{ a: Math.min(ui.cut.a, ui.cut.b), b: Math.max(ui.cut.a, ui.cut.b) }]);
    toast(T('msg.cutDone', { len: U.km(Math.abs(ui.cut.b - ui.cut.a)), name: t.name }));
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
    if (m === 'cut') toast(T('msg.cutMode'));
    else if (m === 'add') toast(ui.drawTarget != null ? T('msg.addLink') : G && G.count >= 2 ? T('msg.addBetween') : T('msg.addEnd'));
    map.redraw();
  }

  // Части, които вече са дубликат или изрязани, се маркират с предупреждение.
  function markBad() {
    G.items.forEach(function (g) {
      g.bad = false;
      if (g.item.type !== 'part') return;
      if (g.missing) { g.bad = true; g.badWhy = T('bad.deleted'); return; }
      var t = track(g.item.trackId);
      if (t && t.visible === false) return;
      var v = Core.invalidShare(g.item, A);
      if (v.bad) { g.bad = true; g.badWhy = v.why === 'изрязана' ? T('bad.cut') : T('bad.dup'); }
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
    document.title = cur().name + ' · CX Tracks';
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
        html.push('<li class="shared"><span class="i"></span><span class="t muted">' + TE('parts.shared') + ' <small>· ' + U.km(g.len) + '</small> · ' + TE('parts.sharedOnce') + '</span></li>');
        return;
      }
      if (g.link && g.pts.length) {
        html.push('<li data-idx="' + g.idx + '" class="link"><span class="i"></span><span class="t muted">' + TE('parts.link') + ' <small>· ' + U.dist(g.len) + '</small> · ' + TE('parts.between') + '</span>' +
          '<span class="v"><button class="btn sm" data-part="del" title="' + TE('parts.delLink') + '">×</button></span></li>');
        return;
      }
      if (it.type === 'draw' && !g.pts.length) {
        html.push('<li data-idx="' + g.idx + '" class="bridge"><span class="i"></span><span class="t muted">' +
          TE(ui.drawTarget === g.idx ? 'parts.linkDraw' : 'map.bridged') + '</span><span class="v">' +
          '<button class="btn sm" data-part="del" title="' + TE('parts.delLink') + '">×</button></span></li>');
        return;
      }
      var title = it.type === 'draw' ? TE('parts.drawn') + ' <small>' + TE('parts.ptsShort', { n: g.pts.length }) + '</small>'
        : U.esc(trackLabel(t)) + ' <small>· ' + kmRange(it.a, it.b) + (it.rev ? ' · ' + TE('parts.rev') : '') + '</small>';
      if (g.bad) title += '<br><span class="small" style="color:var(--app-warn)">' + TE('parts.invalid', { why: g.badWhy }) + '</span>';
      html.push('<li data-idx="' + g.idx + '" draggable="true" class="' + (g.bad ? 'bad' : '') + '">' +
        '<span class="badge" style="background:' + (g.bad ? C.dup : itemColor(g.no)) + '">' + (g.bad ? '!' : g.no) + '</span>' +
        '<span class="t">' + title + '</span>' +
        '<span class="v">' + U.km(g.len) +
        ' <button class="btn sm" data-part="up" title="' + TE('parts.up') + '" ' + (g.idx === 0 ? 'disabled' : '') + '>↑</button>' +
        '<button class="btn sm" data-part="down" title="' + TE('parts.down') + '" ' + (g.idx === cur().items.length - 1 ? 'disabled' : '') + '>↓</button>' +
        (it.type === 'part' ? '<button class="btn sm" data-part="rev" title="' + TE('parts.revBtn') + '">⇄</button>' : '') +
        '<button class="btn sm" data-part="del" title="' + TE('parts.del') + '">×</button></span></li>');
    });
    ol.innerHTML = html.join('');
    $('#partsCount').textContent = '(' + G.count + ')';
    $('#partsEmpty').hidden = G.items.length > 0;
    $('#clearPartsBtn').disabled = !cur().items.length;
    var gh = G.gaps.map(function (gp) {
      var a = G.items.filter(function (x) { return x.idx === gp.afterIdx; })[0], b = G.items.filter(function (x) { return x.idx === gp.beforeIdx; })[0];
      return '<div class="gap-note" data-gap="' + gp.beforeIdx + '">' + TE('gap.between', { d: U.dist(gp.d), a: a ? a.no : '?', b: b ? b.no : '?' }) +
        ' <button class="btn sm" data-gapact="draw">' + TE('gap.draw') + '</button><button class="btn sm" data-gapact="bridge">' + TE('gap.bridge') + '</button></div>';
    });
    (G.autoGaps || []).forEach(function (gp, i) {
      gh.push('<div class="gap-note closed" data-autogap="' + i + '">' + TE('gap.closed') + ' · <span class="num">' + U.dist(gp.d) + '</span>' +
        ' <button class="btn sm link" data-gapact="reopen">' + TE('gap.reopen') + '</button></div>');
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
  /* Точките от копчето "Точка": на текущото следене ('live') и на изминатите тракове, които са
     част от текущия маршрут или са негови изминати. Махат се и се преименуват от списъка "Точки". */
  function walkPoints() {
    var out = [], seen = {}, r = cur();
    if (ui.follower) ui.follower.wpts.forEach(function (w, i) { out.push({ src: 'live', i: i, w: w }); });
    r.items.map(function (it) { return it.trackId; }).concat(r.walks || []).forEach(function (id) {
      var t = id && !seen[id] ? track(id) : null;
      if (!t || !t.walk) return;
      seen[id] = 1;
      (t.wpts || []).forEach(function (w, i) { out.push({ src: t.id, i: i, w: w }); });
    });
    return out;
  }
  function walkPointList(src) {
    if (src === 'live') return ui.follower ? ui.follower.wpts : null;
    var t = track(src);
    return t ? t.wpts : null;
  }
  function walkPointChanged(src) {
    if (src === 'live') { ui.liveDirty = true; if (ui.follower) liveWrite(ui.follower); } else saveSoon();
    map.redraw(); drawPicOverlay();
  }
  function renderPoints() {
    var vs = allVertices(), ws = walkPoints();
    // "Точки" горе вдясно се вижда само докато има чертани точки; отметката си пази състоянието и скрита.
    $('#vtxChk').hidden = !vs.length;
    $('#ptsCount').textContent = '(' + (vs.length + ws.length) + ')';
    $('#pointsList').innerHTML = vs.map(function (v, n) {
      var e = Elev.cache.get(Elev.cacheKey(v.p.lat, v.p.lon));
      if (e == null && prof && G) {
        var nn = Core.nearestOn(G.pts, G.cum, v.p.lat, v.p.lon);
        if (nn) e = Elev.eleAt(prof, nn.d);
      }
      return '<li data-idx="' + v.idx + '" data-pi="' + v.pi + '"><span class="i">' + (n + 1) + '</span>' +
        '<input class="pname" type="text" value="' + U.esc(v.p.name || '') + '" placeholder="' + TE('pt.noname') + '" aria-label="' + TE('pt.aria', { n: n + 1 }) + '">' +
        '<span class="v">' + (e != null ? U.meters(e) : '') + ' <button class="btn sm" data-pt="del" title="' + TE('pt.del') + '">×</button></span></li>';
    }).join('') + ws.map(function (x, n) {
      return '<li class="wpt-row" data-wsrc="' + U.esc(x.src) + '" data-wi="' + x.i + '"><span class="i wpt-i" title="' + TE('pt.walk') + '">' + (n + 1) + '</span>' +
        '<input class="pname" type="text" value="' + U.esc(x.w.name || '') + '" placeholder="' + TE('pt.noname') + '" aria-label="' + TE('pt.walkAria', { n: n + 1 }) + '">' +
        '<span class="v">' + (x.w.ele != null ? U.meters(x.w.ele) : '') + ' <button class="btn sm" data-pt="del" title="' + TE('pt.del') + '">×</button></span></li>';
    }).join('');
  }

  function renderTracks() {
    $('#tracksCount').textContent = '(' + S.tracks.length + ')';
    $('#clearTracksBtn').disabled = !S.tracks.length && !cur().items.length;
    $('#tracksList').innerHTML = S.tracks.map(function (t) {
      Core.prep(t);
      var cutL = (t.cuts || []).reduce(function (s, c) { return s + (c.b - c.a); }, 0);
      return '<li data-track="' + t.id + '" class="' + (t.visible === false ? 'off' : '') + '">' +
        '<span class="sw" style="background:' + trackColor(t) + '"></span>' +
        '<span class="t" title="' + U.esc(t.title || t.name) + '">' + U.esc(t.name) + (t.walk ? ' <small>' + TE('tr.walk') + '</small>' : '') +
        (cutL ? ' <small>· ' + TE('tr.cut', { len: U.km(cutL) }) + '</small>' : '') + '</span>' +
        '<span class="v">' + U.km(t.len) +
        ' <label class="chk" title="' + TE('tr.vis') + '"><input type="checkbox" data-tr="vis" ' + (t.visible === false ? '' : 'checked') + '></label>' +
        '<button class="btn sm" data-tr="fit" title="' + TE('tr.fit.title') + '">' + TE('tr.fit') + '</button>' +
        '<button class="btn sm" data-tr="gpx" title="' + TE('tr.gpx') + '">.gpx</button>' +
        '<button class="btn sm" data-tr="del" title="' + TE('tr.del') + '">×</button></span></li>';
    }).join('');
  }

  // Маркерите са на картата; тук е само колко са и колко километра още се броят.
  function renderDups() {
    var L = 0, P = 0;
    A.dups.forEach(function (d) { L += d.len; });
    A.pend.forEach(function (d) { P += d.len; });
    var n = A.dups.length, np = A.pend.length;
    $('#dupsPending').textContent = T.n('dups.pend', np, { len: U.km(P) });
    $('#dupsPending').hidden = !np;
    $('#dupsPendingNote').hidden = !np;
    $('#dupsSkipped').textContent = T.n('dups.skipped', n, { len: U.km(L) });
    $('#dupsSkipped').hidden = !!np && !n;
    var cnt = [];
    if (np) cnt.push(T('dups.toDecide', { n: np }));
    if (n) cnt.push(T.n('dups.skippedN', n));
    $('#dupsCount').textContent = cnt.length ? cnt.join(' · ') : '(0)';
  }

  function renderCuts() {
    var rows = [];
    S.tracks.forEach(function (t) {
      (t.cuts || []).forEach(function (c, ci) {
        rows.push('<li data-track="' + t.id + '" data-ci="' + ci + '"><span class="i">×</span><span class="t">' + U.esc(t.name) +
          ' <small>· ' + kmRange(c.a, c.b) + '</small></span><span class="v">' + U.km(c.b - c.a) +
          ' <button class="btn sm" data-cut="back">' + TE('cut.restore') + '</button></span></li>');
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
        '<td><button class="btn sm" data-rt="open">' + TE('rt.open') + '</button><button class="btn sm" data-rt="gpx">GPX</button>' +
        '<button class="btn sm danger" data-rt="del">' + TE('rt.del') + '</button></td></tr>';
    }).join('') || '<tr><td colspan="5" class="muted">' + TE('rt.none') + '</td></tr>';
  }

  function renderPicCard() {
    var r = cur();
    var has = !!(r.snap && r.snap.meta);
    $('#picOpenBtn').disabled = !has;
    $('#picInfo').textContent = has
      ? T('pic.info', { date: U.date(r.snap.date), w: U.num(r.snap.meta.w), h: U.num(r.snap.meta.h), base: T(r.snap.base === 'topo' ? 'pic.topo' : 'pic.sat') })
      : T('pic.none');
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
      ctx.fillText(G && G.pts.length > 1 ? T('prof.waitEle') : T('prof.waitPart'), W / 2, H / 2);
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
      ctx.fillText(k * stepKm + (k === 0 ? ' ' + T('unit.km') : ''), x, H - B + 4);
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
      var txt = T('km.at', { d: U.num(ui.profD / 1000, 1) }) + ' · ' + U.meters(he) + (g ? ' · ' + U.pct(g.g) : '');
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
      r.onerror = function () { reject(new Error(T('err.read'))); };
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
      out.push('<div class="err">' + TE('imp.tooMany', { n: files.length, max: MAX_FILES }) + '</div>');
      files = files.slice(0, MAX_FILES);
    }
    var added = [], anyErr = false, loadedCollection = false;
    var chain = Promise.resolve();
    files.forEach(function (f, i) {
      chain = chain.then(function () {
        msg.innerHTML = out.join('') + '<div class="muted">' + TE('imp.reading', { i: i + 1, n: files.length, name: f.name }) + '</div>';
        return readFile(f).then(function (text) {
          var trimmed = text.replace(/^﻿/, '').trim();
          if (/\.json$/i.test(f.name) || trimmed.charAt(0) === '{') {
            var data;
            try { data = JSON.parse(trimmed); } catch (e) { throw new Error(T('err.badJson')); }
            return importCollection(data).then(function (n) {
              loadedCollection = true;
              out.push('<div class="ok">' + U.esc(f.name) + ' - ' + TE('imp.coll', { t: T.n('n.tracks', n.tracks), r: T.n('n.routes', n.routes) }) + '</div>');
            });
          }
          var res = GPX.parse(trimmed, f.name);
          res.tracks.forEach(function (t) {
            var tr = { id: U.uid(), name: t.name, title: t.title, color: nextColor(), pts: t.pts, breaks: t.breaks, wpts: t.wpts, cuts: [], visible: true, created: Date.now() };
            Core.prep(tr);
            S.tracks.push(tr);
            added.push(tr);
            out.push('<div class="ok">' + U.esc(tr.name) + ' - ' + U.km(tr.len) + ', ' + TE('n.points' + (tr.pts.length === 1 ? '.1' : '.n'), { n: U.num(tr.pts.length) }) + (t.wpts.length ? ', ' + U.esc(T.n('n.stops', t.wpts.length)) : '') + '</div>');
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
        toast(added.length ? T.n('imp.added', added.length) + (nd ? T('imp.addedDups', { n: nd }) : '') : T('imp.collLoaded'));
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
    if (!geo) { if (!quiet) toast(T('msg.routeEmpty'), true); return false; }
    var xml = routeExport(r, geo, r.id === S.curId ? prof : null);
    fname = fname || U.slug(r.name) + '.gpx';
    U.download(new Blob([xml], { type: 'application/gpx+xml' }), fname);
    if (!quiet) toast(T('msg.exported', { f: fname, len: U.km(geo.len) }));
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
      toast(T('msg.collExported', { t: T.n('n.tracks', S.tracks.length), r: T.n('n.routes', S.routes.length) }));
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
    if (!s.bounds) { $('#picEst').textContent = T('picd.nothing'); return; }
    var p = Snapshot.plan(s.bounds, s.area === 'view' ? 0 : 0.1, s.base === 'topo' ? 17 : 18, null, picBox(s, picParts()));
    $('#picEst').textContent = T('picd.est', { w: U.num(p.w), h: U.num(p.h), mb: U.num(p.w * p.h * 0.45 / 1048576, 1) });
  }
  // Частите за картината (линия и легенда).
  function picParts() {
    var parts = [];
    if (G && G.pts.length > 1) {
      G.items.forEach(function (g, gi) {
        if (!g.pts.length) return;
        // Общата отсечка продължава частта преди нея - без свой номер и ред в легендата.
        if ((g.shared || g.auto || g.link) && parts.length) { parts[parts.length - 1].pts = parts[parts.length - 1].pts.concat(g.pts); return; }
        var t = track(g.item.trackId);
        parts.push({ pts: routeSpan(g, gi), drawn: g.item.type === 'draw', no: g.no, label: g.item.type === 'draw' ? T('pic.partDrawn', { n: g.no }) : T('pic.partTrack', { n: g.no, name: trackLabel(t).replace(/\.gpx$/i, '') }) });
      });
    } else {
      visibleTracks().forEach(function (t, i) { parts.push({ pts: t.pts, no: i + 1, label: t.name }); });
    }
    return parts;
  }
  /* Панелът с числата е горе вляво; при "около маршрута" маршрутът се събира под него и се центрира
     там (Snapshot.plan с box). "Видимото на картата" пази точно кадъра, който се вижда. */
  function picBox(s, parts) {
    if (s.area === 'view' || !s.info) return null;
    return { legend: parts.filter(function (x) { return !x.drawn && x.pts.length > 1; }).length };
  }
  function makePicture(withGpx) {
    var s = picSource(), r = cur(), msg = $('#picMsg');
    if (!s.bounds) { msg.innerHTML = '<div class="err">' + TE('picd.nothing2') + '</div>'; return; }
    var parts = picParts();
    var wpts = [];
    r.items.forEach(function (it) { if (it.type === 'draw') it.pts.forEach(function (p) { if (p.name) wpts.push(p); }); });
    walkPoints().forEach(function (x) { if (x.w.name) wpts.push(x.w); });
    var baseDef = s.base === 'topo'
      ? { name: 'OpenTopoMap', layers: [LAYERS.topo], attribution: ATTR.topo }
      : { name: 'Esri', layers: [LAYERS.sat], attribution: s.labels ? ATTR.satLabels : ATTR.sat };
    var btns = $$('#dlgPic [data-act^="pic-make"]');
    btns.forEach(function (b) { b.disabled = true; });
    msg.innerHTML = '<div class="muted">' + TE('picd.tiles') + '</div>';
    Snapshot.make({
      bounds: s.bounds, margin: s.area === 'view' ? 0 : 0.1, base: baseDef, box: picBox(s, parts),
      labels: s.base === 'topo' || !s.labels ? [] : [LAYERS.places, LAYERS.roads],
      info: s.info, date: Date.now(),
      route: { name: r.name, parts: parts, gaps: G && G.pts.length > 1 ? routeGapLines() : [], bridges: G && G.pts.length > 1 ? bridgeLines().map(function (b) { return [b.from, b.to]; }) : [], len: G ? G.len : 0, up: prof ? prof.up : null, maxGrade: prof ? prof.maxUp : null, wpts: wpts },
      colors: { a: C['route-a'], b: C['route-b'], casing: C.casing, gap: C['walk-gap'] }
    }, function (done, total) {
      msg.innerHTML = '<div class="muted">' + TE('picd.tilesN', { done: Math.min(done, total), total: total }) + '</div>';
    }).then(function (res) {
      var name = 'marshrut-' + U.slug(r.name) + '-' + U.dateDots(Date.now()) + '.png';
      U.download(res.blob, name);
      if (withGpx) exportGpx(r);
      r.snap = { meta: res.meta, date: Date.now(), base: s.base };
      return U.DB.set('snap:' + r.id, res.blob).then(function () {
        saveNow(); loadPic(); renderPicCard();
        msg.innerHTML = '<div class="ok">' + TE('picd.done', { name: name, w: U.num(res.meta.w), h: U.num(res.meta.h) }) +
          ' ' + TE('picd.kept') + (res.warn ? '<br>' + U.esc(res.warn) : '') + '</div>';
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
      toast(T('msg.noPic'), true);
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
    // Точките от следене - ромбче с името.
    walkPoints().forEach(function (x) {
      var q = Snapshot.toPic(m, x.w.lat, x.w.lon), r = 8 * s;
      out.push('<path class="wpt" d="M' + q[0] + ' ' + (q[1] - r) + 'L' + (q[0] + r) + ' ' + q[1] + 'L' + q[0] + ' ' + (q[1] + r) + 'L' + (q[0] - r) + ' ' + q[1] + 'Z" fill="' + C.casing + '" stroke="' + C.walked + '" stroke-width="' + 3 * s + '"/>');
      if (x.w.name) out.push('<text x="' + (q[0] + 12 * s) + '" y="' + (q[1] + 5 * s) + '" font-size="' + 14 * s + '" font-weight="700" fill="#1f1d1a" stroke="' + C.casing + '" stroke-width="' + 4 * s + '" paint-order="stroke" font-family="sans-serif">' + U.esc(x.w.name) + '</text>');
    });
    if (ui.pos) {
      var q = Snapshot.toPic(m, ui.pos.lat, ui.pos.lon);
      var inside = q[0] >= 0 && q[1] >= 0 && q[0] <= m.w && q[1] <= m.h;
      out.push('<circle cx="' + q[0] + '" cy="' + q[1] + '" r="' + 11 * s + '" fill="' + C.pos + '" stroke="' + C.casing + '" stroke-width="' + 4 * s + '"/>');
      var label = inside ? T('pic.here') + (ui.prog ? ' · ' + T('pic.of', { a: U.km(ui.prog.d), b: U.km(ui.prog.total) }) : '') : T('pic.outside');
      out.push('<text x="' + (q[0] + 16 * s) + '" y="' + (q[1] - 12 * s) + '" font-size="' + 15 * s + '" font-weight="700" fill="' + '#1f1d1a' + '" stroke="' + C.casing + '" stroke-width="' + 4 * s + '" paint-order="stroke" font-family="sans-serif">' + U.esc(label) + '</text>');
    }
    svg.innerHTML = out.join('');
  }

  // ---- Следене ----
  /* Едно копче "Следене / Стоп" - върху картата горе вляво (винаги, лентата го няма) и под профила:
     "Следене", докато не следиш, и "Стоп" (червено), докато следиш. */
  function followBtns() {
    var on = !!ui.follower;
    $$('[data-act="follow"]').forEach(function (b) {
      b.textContent = on ? T('follow.stop') : T('follow.start');
      b.classList.toggle('danger', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? T('follow.stop.aria') : T('follow.start.aria'));
      b.title = on ? T('follow.stop.title') : T('follow.start.title');
    });
  }
  function startFollow() {
    if (ui.follower) return;
    if (!G || G.pts.length < 2) toast(T('msg.followEmpty'), false, 4500);
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
        pointBtn();
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
      waiting: function () { renderFollow(); pointBtn(); },
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
    $('#fDone').textContent = '0'; $('#fTime').textContent = U.duration(0); $('#fLeft').textContent = '-'; $('#fOff').textContent = '-';
    document.body.classList.add('following');
    $('#followBar').hidden = false;
    $('#tools').hidden = true;
    $('#followPanel').hidden = false;
    $('#followTitle').textContent = T('follow.title', { name: cur().name });
    $('#fMsg').textContent = T('follow.waiting'); $('#fMsg').className = 'follow-msg';
    $('#walkDone').hidden = true;
    $('#walkGpxBtn').setAttribute('aria-disabled', 'true');
    pointBtn();
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
    if (ui.follower.waiting) { $('#fMsg').textContent = T('follow.waiting'); $('#fMsg').className = 'follow-msg'; return; }
    var p = ui.prog;
    if (!p) {
      if (ui.pos) { $('#fDone').textContent = U.km(U.lengthOf(ui.follower.rec)); $('#fLeft').textContent = '-'; }
      return;
    }
    $('#fDone').textContent = T('pic.of', { a: U.num(p.d / 1000, 1), b: U.km(p.total) });
    $('#fLeft').textContent = U.km(Math.max(0, p.total - p.d));
    $('#fOff').textContent = U.meters(p.off);
    var el = $('#fMsg');
    if (p.isOff) {
      el.textContent = T('follow.off', { d: U.meters(p.off), dir: U.dirName(p.bearing) });
      el.className = 'follow-msg warn';
    } else {
      el.textContent = T('follow.on', { acc: U.meters(ui.pos.acc || 0) });
      el.className = 'follow-msg';
    }
  }
  function stopFollow(silent) {
    var f = ui.follower;
    if (!f) return;
    var rec = f.stop(), wpts = f.wpts.slice();
    if ($('#dlgPoint').open) $('#dlgPoint').close();
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
        pts: rec, wpts: wpts, name: ui.followName, routeId: cur().id, t: Date.now(), head: 'walk.headStop',
        stats: { time: $('#fTime').textContent, left: $('#fLeft').textContent, off: $('#fOff').textContent }
      });
      if (!silent) askWalk();
    } else if (!silent) toast(T('msg.followNoPath'));
    renderPoints();
    // Картата остава в последната посока; копчето "Север" я изправя, а после "Посока" я връща (ui.heading се пази).
    ui.pos = null;
    map.redraw();
  }

  /* Режим "Екранът да не заспива" при следене: копчето в реда на следенето, изборът се помни.
     Панелът казва с текст дали екранът се държи буден - и когато браузърът не може или откаже. */
  var AWAKE_MSG = { on: 'awake.on', off: 'awake.off', none: 'awake.none', denied: 'awake.denied' };
  function setAwake(on) {
    ui.awake = !!on;
    U.LS.set('awake', ui.awake);
    $('#awakeBtn').setAttribute('aria-pressed', ui.awake ? 'true' : 'false');
    if (ui.follower) ui.follower.setAwake(ui.awake);
  }
  function showAwake(state) {
    var el = $('#fAwake');
    ui.awakeState = state;
    el.textContent = AWAKE_MSG[state] ? T(AWAKE_MSG[state]) : '';
    el.className = 'follow-msg' + (state === 'none' || state === 'denied' ? ' warn' : ' muted');
    el.hidden = !ui.follower || !el.textContent;
  }

  /* Копчето "Точка" при следене: слага точка на последното положение от GPS и пита за име веднага
     (празно - "Точка N"). Без положение копчето е бледо и казва "няма сигнал" вместо да сложи
     точка на сляпо. Следенето не спира, докато прозорецът е отворен. */
  function pointBtn() {
    var b = $('#walkPtBtn'), f = ui.follower, ok = !!(f && ui.pos && !f.waiting);
    b.setAttribute('aria-disabled', ok ? 'false' : 'true');
    b.title = ok ? T('wpt.btn.ok') : T('wpt.btn.no');
  }
  function askPoint() {
    var f = ui.follower;
    if (!f) return;
    if (!ui.pos || f.waiting) { toast(T('msg.wptNoGps'), true); return; }
    ui.ptPos = { lat: ui.pos.lat, lon: ui.pos.lon, alt: ui.pos.alt, t: ui.pos.t || Date.now() };
    var d = $('#dlgPoint'), inp = $('#walkPtName');
    inp.value = '';
    inp.placeholder = T('wpt.def', { n: f.wpts.length + 1 });
    $('#walkPtWhere').textContent = T('wpt.where', { lat: U.num(ui.ptPos.lat, 5), lon: U.num(ui.ptPos.lon, 5) }) +
      (ui.pos.acc != null ? ' · ' + T('wpt.acc', { d: U.meters(ui.pos.acc) }) : '') + (ui.prog ? ' · ' + T('wpt.km', { d: U.kmShort(ui.prog.d) }) : '');
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
    inp.focus();
  }
  function pointDone() {
    var f = ui.follower, pos = ui.ptPos;
    ui.ptPos = null;
    if ($('#dlgPoint').open) $('#dlgPoint').close();
    if (!f || !pos) return;
    var w = f.addPoint(pos, $('#walkPtName').value);
    ui.liveDirty = true;
    liveWrite(f);
    renderPoints();
    map.redraw();
    drawPicOverlay();
    toast(T('msg.wptPlaced', { name: w.name, cnt: T.n('n.points', f.wpts.length) }));
  }

  /* Изминатото като нормален трак: нов трак "изминат <дата>" в изминатите на следения
     маршрут и отделен запис в "Записани маршрути" (една част - целият трак). Текущ остава
     отвореният маршрут. Същият път за "Стоп" и за възстановено незавършено следене. */
  function saveWalk(w) {
    var rec = w.pts, when = w.t || Date.now();
    var wpts = (w.wpts || []).map(function (x) { return { lat: x.lat, lon: x.lon, ele: x.ele, time: x.time, name: x.name }; });
    var t = { id: U.uid(), name: T('walk.trackName', { d: U.dateShort(when) }), title: T('walk.trackName', { d: U.date(when) }), color: nextColor(), pts: rec, breaks: [], wpts: wpts, cuts: [], visible: true, created: Date.now(), walk: true };
    Core.prep(t);
    S.tracks.push(t);
    S.routes.forEach(function (r) { if (r.id === w.routeId) r.walks = (r.walks || []).concat([t.id]); });
    var wr = newRoute(t.name);
    wr.items = [{ type: 'part', trackId: t.id, a: 0, b: t.len, rev: false }];
    wr.len = t.len;
    var st = w.stats || {};
    ui.lastWalk = {
      pts: rec, wpts: wpts, name: w.name, title: t.title, wname: wr.name, trackId: t.id, routeId: wr.id, bar: true,
      msgK: { head: w.head, name: wr.name },
      stats: { done: U.km(t.len), time: st.time || '-', left: st.left || '-', off: st.off || '-' }
    };
    U.DB.set('lastWalk', ui.lastWalk);
    showWalk();
    toast(T('msg.walkSaved', { name: wr.name, len: U.km(t.len) }), false, 6000);
    analyzeNow();
    saveNow();
    return ui.lastWalk;
  }

  /* Прозорецът "Запис на изминатото" след "Стоп". Записът вече е направен суров (нищо не се губи);
     тук се дава име и по желание се изглажда (Core.smoothWalk, праг 5 м, две отметки - изключени).
     Суровата следа се пази, докато прозорецът е отворен: "Запази" записва избраното (и пак, и пак),
     "Свали .gpx" сваля избраното, "Отказ" оставя записа суров. */
  function askWalk() {
    var lw = ui.lastWalk, t = lw && track(lw.trackId);
    if (!t) return;
    var r = S.routes.filter(function (x) { return x.id === lw.routeId; })[0];
    ui.walkJob = { trackId: t.id, routeId: lw.routeId, raw: t.pts.slice(), rawLen: t.len };
    $('#walkName').value = r ? r.name : t.name;
    $('#smSide').checked = false;
    $('#smDense').checked = false;
    walkPreview();
    var d = $('#dlgWalk');
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  }
  function walkChosen() {
    var job = ui.walkJob;
    return job ? Core.smoothWalk(job.raw, { side: $('#smSide').checked, dense: $('#smDense').checked }) : [];
  }
  function walkPreview() {
    var job = ui.walkJob; if (!job) return;
    var pts = walkChosen(), n = job.raw.length, len = U.lengthOf(pts);
    $('#smPts').textContent = T('sm.count', { a: U.num(pts.length), n: U.num(n), x: U.num(n - pts.length) });
    $('#smLen').textContent = U.km(job.rawLen) + ' → ' + U.km(len);
  }
  function walkApply() {
    var job = ui.walkJob; if (!job) return;
    var t = track(job.trackId), r = S.routes.filter(function (x) { return x.id === job.routeId; })[0];
    if (!t) return;
    var pts = walkChosen(), name = $('#walkName').value.trim();
    t.pts = pts;
    delete t._cum; delete t._gaps;
    Core.prep(t);
    if (r) {
      if (name) r.name = name;
      r.items.forEach(function (it) { if (it.trackId === t.id) { it.a = 0; it.b = t.len; } });
      r.len = t.len;
      r.modified = Date.now();
    }
    var lw = ui.lastWalk;
    if (lw && lw.trackId === t.id) {
      lw.pts = pts;
      if (r) lw.wname = r.name;
      if (lw.stats) lw.stats.done = U.km(t.len);
      lw.msgK = { head: 'walk.headStop', name: r ? r.name : t.name };
      U.DB.set('lastWalk', lw);
      showWalk();
    }
    analyzeNow();
    saveNow();
    var cut = job.raw.length - pts.length;
    toast(T('msg.walkRec', { name: r ? r.name : t.name, len: U.km(t.len), pts: T.n('n.points', pts.length, { n: U.num(pts.length) }) }) + (cut ? ' ' + T('msg.smoothed', { x: U.num(cut) }) : ''), false, 5000);
  }
  function walkDownload() {
    var job = ui.walkJob; if (!job) return;
    var t = track(job.trackId), pts = walkChosen(), name = $('#walkName').value.trim() || (t ? t.title : T('walk.def'));
    var fname = plainName(name) + '.gpx';
    var xml = GPX.build({ name: name, pts: pts, wpts: t ? (t.wpts || []).filter(function (w) { return w.name; }) : [] });
    U.download(new Blob([xml], { type: 'application/gpx+xml' }), fname);
    toast(T('msg.exportedPts', { f: fname, len: U.km(U.lengthOf(pts)), pts: T.n('n.points', pts.length, { n: U.num(pts.length) }) }), false, 4500);
  }

  /* Начален екран: само при първото пускане на устройството (помни се в браузъра). Изчезва
     с натискане някъде или сам след SPLASH_MS. Снимката е в приложението - вижда се и без връзка. */
  var SPLASH_MS = 3000;
  function splash() {
    var el = $('#splash');
    if (!el || document.documentElement.classList.contains('splash-seen')) { if (el) el.remove(); return; }
    U.LS.set('splash', true);
    var gone = false, timer;
    function hide() {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      el.classList.add('out');
      document.removeEventListener('keydown', hide, true);
      setTimeout(function () { el.remove(); }, 400);
    }
    el.addEventListener('pointerdown', hide);
    el.addEventListener('click', hide);
    document.addEventListener('keydown', hide, true);
    timer = setTimeout(hide, SPLASH_MS);
    try { el.focus({ preventScroll: true }); } catch (e) { /* няма значение */ }
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
    if (f && (f.rec.length !== ui.liveN || ui.liveDirty)) liveWrite(f);
  }
  function liveWrite(f) {
    ui.liveN = f.rec.length;
    ui.liveDirty = false;
    U.DB.set('liveWalk', { pts: f.rec.slice(), wpts: f.wpts.slice(), name: ui.followName, routeId: cur().id, t0: f.t0, saved: Date.now() }).then(function (kept) {
      if (kept || ui.liveWarned || !ui.follower) return;
      ui.liveWarned = true;
      toast(T('msg.noLive'), true, 9000);
    });
  }
  function liveAsk(lw) {
    var d = $('#dlgLive'), pts = lw.pts, t0 = lw.t0 || pts[0][3] || lw.saved;
    ui.live = lw;
    $('#liveKm').textContent = U.km(U.lengthOf(pts));
    $('#livePts').textContent = T.n('n.points', pts.length, { n: U.num(pts.length) });
    var dt = new Date(t0), hm = dt.getHours() + ':' + (dt.getMinutes() < 10 ? '0' : '') + dt.getMinutes();
    var named = lw.name && !defaultName(lw.name);
    $('#liveWhen').textContent = T('live.when', { d: U.dateShort(t0), hm: hm }) + (named ? ' · ' + T('live.on', { name: lw.name }) : '');
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  }
  function liveDone(act) {
    var lw = ui.live;
    ui.live = null;
    if ($('#dlgLive').open) $('#dlgLive').close();
    if (!lw) return;
    U.DB.del('liveWalk');
    if (act === 'drop') { toast(T('msg.liveDropped')); return; }
    var pts = lw.pts, t0 = lw.t0 || pts[0][3] || lw.saved, t1 = pts[pts.length - 1][3];
    var w = saveWalk({
      pts: pts, wpts: lw.wpts, name: lw.name || T('walk.def'), routeId: lw.routeId, t: t0, head: 'walk.headRestored',
      stats: { time: t1 && t0 ? U.duration(t1 - t0) : '-' }
    });
    if (act === 'gpx') walkGpx(w.pts, w.name, w.title, w.wpts);
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
    $('#northLbl').textContent = offer === 'heading' ? T('orient.heading') : T('orient.north');
    b.setAttribute('aria-label', offer === 'heading' ? T('compass.heading.aria') : T('compass.north.aria'));
    b.title = offer === 'heading' ? T('compass.heading.title') : T('compass.north.title');
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
    if (!('geolocation' in navigator)) { toast(T('msg.noGps'), true); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      ui.lastPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (!ui.follower) map.setView(ui.lastPos.lat, ui.lastPos.lon, Math.max(map.zoom, 15));
    }, function () { toast(T('msg.noGps'), true); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
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
    $('#walkBarName').textContent = w.wname || w.title || T('walk.def');
    $('#followPanel').hidden = false;
    $('#followTitle').textContent = T('follow.title', { name: w.name });
    if (w.stats) { $('#fDone').textContent = w.stats.done; $('#fTime').textContent = w.stats.time; $('#fLeft').textContent = w.stats.left; $('#fOff').textContent = w.stats.off; }
    $('#fMsg').textContent = w.msgK ? T(w.msgK.head) + ' ' + T('walk.savedAs', { name: w.msgK.name }) : w.msg || ''; $('#fMsg').className = 'follow-msg';
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
    $('#nameOk').textContent = job.kind === 'save' ? T('act.save') : T('act.download');
    $('#nameTitle').textContent = job.kind === 'save' ? T('name.saveTitle') : T('name.file');
    $('#saveSmooth').hidden = job.kind !== 'save';
    if (job.kind === 'save') {
      $('#rsSide').checked = !!(job.smooth && job.smooth.side);
      $('#rsDense').checked = !!(job.smooth && job.smooth.dense);
      savePreview();
    }
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
  function walkGpx(pts, routeName, title, wpts) {
    if (!pts || pts.length < 2) return;
    askName({ kind: 'walk', pts: pts.slice(), wpts: (wpts || []).slice(), title: title || T('walk.trackName', { d: U.date(Date.now()) }), def: 'izminat-' + U.slug(routeName) + '-' + U.dateDots(Date.now()) });
  }
  // Маршрутът като .gpx: пита за име (предложено - името на маршрута); празен маршрут не пита.
  function askRouteGpx(r) {
    r = r || cur();
    if (!routeGeo(r)) { toast(T('msg.routeEmpty'), true); return; }
    askName({ kind: 'route', routeId: r.id, def: plainName(r.name) });
  }
  /* "Запази": прозорецът "Запис на маршрута" - над полето за име двете отметки за изглаждане (праг 5 м,
     като при "Запис на изминатото") и обобщение преди запис. Изглаждането е на маршрута (route.smooth,
     Core.routeGeometry изглажда частите от тракове): чертежът на картата, записът и .gpx съвпадат, а
     "Отмени" връща неизгладения. Отметките показват сегашното изглаждане на маршрута. */
  function askSave() { askName({ kind: 'save', routeId: cur().id, def: plainName(cur().name), smooth: cur().smooth || null }); }
  function saveChosen() {
    var o = { side: $('#rsSide').checked, dense: $('#rsDense').checked };
    return o.side || o.dense ? o : null;
  }
  // Обобщение: неизгладеният маршрут срещу избраното (не сегашния чертеж, който може вече да е изгладен).
  function smoothedGeo(sm) {
    var r = Object.assign({}, cur(), { smooth: sm });
    var geo = Core.routeGeometry(r, byId(), A);
    return geo.pts.length >= 2 ? geo : null;
  }
  function savePreview() {
    var raw = smoothedGeo(null), sm = saveChosen();
    if (!raw) { $('#rsPts').textContent = '-'; $('#rsLen').textContent = '-'; return; }
    var geo = sm ? smoothedGeo(sm) : raw, n = raw.pts.length;
    $('#rsPts').textContent = T('rs.count', { a: U.num(n), b: U.num(geo.pts.length), x: U.num(n - geo.pts.length) });
    $('#rsLen').textContent = U.km(raw.len) + ' → ' + U.km(geo.len);
  }
  function nameDone() {
    var job = ui.nameJob; if (!job) return;
    ui.nameJob = null;
    var name = fileNameOf(job);
    if (job.kind === 'route') {
      var r = S.routes.filter(function (x) { return x.id === job.routeId; })[0];
      if (r) exportGpx(r, name);
    } else if (job.kind === 'save') {
      if (job.routeId === cur().id) saveRoute(name, saveChosen());
    } else {
      var xml = GPX.build({ name: job.title, pts: job.pts, wpts: job.wpts || [] });
      U.download(new Blob([xml], { type: 'application/gpx+xml' }), name);
      toast(T('msg.exportedPts', { f: name, len: U.km(U.lengthOf(job.pts)), pts: T.n('n.points', job.pts.length, { n: U.num(job.pts.length) }) }), false, 4500);
    }
  }
  /* Сваля <име>.gpx и записва текущия маршрут в "Записани маршрути" под същото име. Текущият
     маршрут винаги е в списъка - преименува се той, втори запис не се прави. */
  function saveRoute(fname, smooth) {
    var r = cur(), name = fname.replace(/\.gpx$/i, '').trim() || r.name;
    // Друго изглаждане - стъпка в историята: "Отмени" връща предишния чертеж.
    if (JSON.stringify(smooth || null) !== JSON.stringify(r.smooth || null)) {
      pushUndo();
      if (smooth) r.smooth = smooth; else delete r.smooth;
      routeChanged();
    }
    if (name !== r.name) {
      r.name = name;
      $('#routeName').value = name;
      document.title = name + ' · CX Tracks';
    }
    r.modified = Date.now();
    var got = exportGpx(r, fname, true);
    saveNow().then(function () {
      renderRoutes();
      if (got) toast(T('msg.savedDl', { f: fname, name: name }) + (smooth ? ' ' + T('msg.savedSmooth') : ''), false, 5000);
      else toast(T('msg.savedEmpty', { name: name }), true);
    });
  }

  // ---- Търсене на адрес (Nominatim) ----
  function search(q) {
    var box = $('#searchResults');
    box.hidden = false;
    box.innerHTML = '<div class="msg">' + TE('search.busy') + '</div>';
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=' + I18N.lang + '&q=' + encodeURIComponent(q);
    fetch(url, { headers: { 'Accept': 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (list) {
      if (!list.length) { box.innerHTML = '<div class="msg">' + TE('search.none', { q: q }) + '</div>'; return; }
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
      box.innerHTML = '<div class="msg">' + TE('search.fail') + '</div>';
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
    if (!r || !confirm(T('confirm.delRoute', { name: r.name }))) return;
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
    toast(T('msg.tracksCleared'));
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
    toast(T('msg.partsCleared'));
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

  function showVersion() {
    var d = new Date(GPXK_DATE + 'T12:00:00'), mf = U.list('months.full', 12);
    $('#appVersion').textContent = GPXK_VERSION;
    $('#appDate').textContent = isNaN(d) ? '' : ' · ' + d.getDate() + ' ' + mf[d.getMonth()] + ' ' + d.getFullYear();
  }

  // ---- Тема ----
  function setTheme(m) {
    document.documentElement.setAttribute('data-app-mode', m);
    U.LS.set('mode', m);
    $('#themeBtn').textContent = m === 'dark' ? T('theme.light') : T('theme.dark');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', U.cssVar('--app-bg'));
    refreshColors();
    renderPanel();
  }

  // ---- Език ----
  /* Копчето с глобуса в лентата казва езика ("БГ" / "EN", при автоматичен превод - кода му) и отваря
     прозореца "Език". Смяната е на място: I18N пренаписва надписите от index.html, а relang - всичко,
     което кодът е сложил сам. Имената на маршрути, тракове, спирки и файлове не се пипат. */
  function langName(code) {
    if (code === 'bg' || code === 'en') return T('lang.name.' + code);
    try { return new Intl.DisplayNames([I18N.lang], { type: 'language' }).of(code) || code; } catch (e) { return code; }
  }
  function langCode() { $('#langCode').textContent = I18N.tr ? I18N.tr.toUpperCase() : T('lang.code'); }
  var langBusy = false;
  function openLang() {
    var d = $('#dlgLang');
    langDialog();
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
    trOptions();
  }
  function langDialog() {
    var p = I18N.pref, b = I18N.browser(), base = b.slice(0, 2);
    $$('#langForm input[name="lang"]').forEach(function (r) { r.checked = r.value === p; r.disabled = langBusy; });
    $('#langAutoSub').textContent = base === 'en' || base === 'bg' ? T('lang.auto.sub', { lang: langName(base) }) : T('lang.auto.other', { code: b || '?' });
  }
  // Автоматичният превод: в менюто са само езиците, които браузърът казва, че дава; без преводач - бледо и защо.
  function trOptions() {
    var sel = $('#langTrSel'), msg = $('#langTrMsg');
    if (langBusy) return;
    msg.className = 'small lang-tr-msg muted';
    msg.textContent = T('lang.tr.checking');
    I18N.trLangs().then(function (list) {
      if (langBusy) return;
      $('#langTr').classList.toggle('off', !list.length);
      sel.disabled = !list.length;
      sel.innerHTML = '<option value="">' + TE('lang.tr.pick') + '</option>' + list.map(function (x) {
        return '<option value="' + x.code + '">' + U.esc(langName(x.code)) + '</option>';
      }).join('');
      sel.value = I18N.tr || '';
      if (!list.length) {
        msg.className = 'small lang-tr-msg warn';
        msg.innerHTML = '<b>' + TE('lang.tr.no') + '</b><br>' + TE('lang.tr.noWhy');
      } else trStatus();
    });
  }
  function trStatus() {
    var msg = $('#langTrMsg');
    msg.className = 'small lang-tr-msg muted';
    msg.textContent = I18N.tr ? T('lang.tr.on', { lang: langName(I18N.tr) }) : '';
  }
  // Избран език за превод: изчаква изтеглянето и превода и чак тогава сменя надписите. Цял провал - обратно към речника.
  function useTr(code) {
    var sel = $('#langTrSel'), msg = $('#langTrMsg');
    if (!code || code === I18N.tr || langBusy) return;
    langBusy = true;
    sel.disabled = true;
    langDialog();
    var pct = function (f) { return Math.round(Math.max(0, Math.min(1, f || 0)) * 100) + ' %'; };
    msg.className = 'small lang-tr-msg muted busy';
    msg.textContent = T('lang.tr.doing', { p: '' });
    var done = function () { langBusy = false; sel.disabled = false; sel.value = I18N.tr || ''; langDialog(); };
    I18N.useTranslation(code, function (pr) {
      msg.textContent = T(pr.stage === 'download' ? 'lang.tr.dl' : 'lang.tr.doing', { p: pct(pr.f) });
    }).then(function () { done(); trStatus(); }, function () {
      if (I18N.tr) I18N.setPref('auto');
      done();
      msg.className = 'small lang-tr-msg warn';
      msg.textContent = T('lang.tr.fail');
      toast(T('lang.tr.fail'), true);
    });
  }
  function relang() {
    langCode();
    barHandle();
    followBtns();
    showCompass();
    attrib();
    showVersion();
    $('#themeBtn').textContent = document.documentElement.getAttribute('data-app-mode') === 'dark' ? T('theme.light') : T('theme.dark');
    $$('.tolVal').forEach(function (b) { b.textContent = S.tol + ' ' + T('unit.m'); });
    $('#searchResults').hidden = true;
    $('#tip').hidden = true;
    lastElevKey = null;
    routeChanged(true);
    drawProfile();
    updateCutBox();
    if (ui.follower) {
      $('#followTitle').textContent = T('follow.title', { name: cur().name });
      pointBtn(); renderFollow(); showAwake(ui.awakeState);
    } else showWalk();
    if (!$('#picView').hidden) drawPicOverlay();
    if ($('#dlgLang').open) { langDialog(); trOptions(); }
  }

  // ---- Връзки с интерфейса ----
  function setTol(v) {
    S.tol = v;
    $$('.tolInput').forEach(function (r) { if (r.value !== String(v)) r.value = v; });
    $$('.tolVal').forEach(function (b) { b.textContent = v + ' ' + T('unit.m'); });
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
      case 'walk-gpx': if (ui.follower) walkGpx(ui.follower.rec, ui.followName, T('walk.trackName', { d: U.date(Date.now()) }), ui.follower.wpts); break;
      case 'walk-gpx-done': if (ui.lastWalk) { var lt = track(ui.lastWalk.trackId); walkGpx(ui.lastWalk.pts, ui.lastWalk.name, ui.lastWalk.title, lt ? lt.wpts : ui.lastWalk.wpts); } break;
      case 'walk-point': askPoint(); break;
      case 'center': centerMe(); break;
      case 'north': northUp(); break;
      case 'walkbar-close': if (ui.lastWalk) { ui.lastWalk.bar = false; U.DB.set('lastWalk', ui.lastWalk); } showWalk(); break;
      case 'walk-forget': forgetWalk(); $('#followPanel').hidden = true; break;
      case 'live-save': liveDone('save'); break;
      case 'live-gpx': liveDone('gpx'); break;
      case 'live-drop': liveDone('drop'); break;
      case 'to-panel': $('#panel').scrollIntoView({ behavior: 'smooth' }); break;
      case 'to-top': window.scrollTo({ top: 0, behavior: 'smooth' }); break;
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
      case 'new-route': newRoute(T('route.new')); openRoute(S.routes[0].id); setMode('select'); window.scrollTo({ top: 0, behavior: 'smooth' }); toast(T('msg.newRoute')); break;
      case 'new-empty': newRoute(T('routes.empty')); openRoute(S.routes[0].id); setMode('add'); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'toggle-bar': toggleBar(); break;
      case 'lang': openLang(); break;
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
    $('#rsSide').addEventListener('change', savePreview);
    $('#rsDense').addEventListener('change', savePreview);
    // × затваря прозореца "Незавършено следене" - записът остава до следващото отваряне.
    $('#dlgLive').addEventListener('close', function () { ui.live = null; });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') liveSave(); });
    window.addEventListener('pagehide', function () { liveSave(); });
    $('#nameCancel').addEventListener('click', function () { $('#dlgName').close(); });
    // "Точка" при следене.
    $('#pointForm').addEventListener('submit', function (e) { e.preventDefault(); pointDone(); });
    $('#walkPtCancel').addEventListener('click', function () { $('#dlgPoint').close(); });
    $('#dlgPoint').addEventListener('close', function () { ui.ptPos = null; });
    // "Запис на изминатото".
    $('#walkForm').addEventListener('submit', function (e) { e.preventDefault(); walkApply(); $('#dlgWalk').close(); });
    $('#smSide').addEventListener('change', walkPreview);
    $('#smDense').addEventListener('change', walkPreview);
    $('#walkDl').addEventListener('click', walkDownload);
    $('#walkCancel').addEventListener('click', function () { $('#dlgWalk').close(); });
    $('#dlgWalk').addEventListener('close', function () { ui.walkJob = null; });
    $$('#followBar [data-view]').forEach(function (b) { b.addEventListener('click', function () { showPic(b.dataset.view === 'pic'); followBearing(); }); });
    $$('#followBar [data-orient]').forEach(function (b) { b.addEventListener('click', function () { setOrient(b.dataset.orient); }); });

    $('#routeName').addEventListener('input', function (e) {
      cur().name = e.target.value.trim() || T('route.def');
      cur().modified = Date.now();
      document.title = cur().name + ' · CX Tracks';
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
      var li = e.target.closest('li');
      if (li.dataset.wsrc) {
        var wl = walkPointList(li.dataset.wsrc), w = wl && wl[+li.dataset.wi];
        if (w) { w.name = e.target.value; walkPointChanged(li.dataset.wsrc); }
        return;
      }
      var it = cur().items[+li.dataset.idx];
      if (it && it.pts[+li.dataset.pi]) { it.pts[+li.dataset.pi].name = e.target.value; map.redraw(); saveSoon(); }
    });
    pl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pt="del"]'); if (!b) return;
      var li = b.closest('li');
      if (li.dataset.wsrc) {
        var wl = walkPointList(li.dataset.wsrc);
        if (wl && wl[+li.dataset.wi]) { wl.splice(+li.dataset.wi, 1); walkPointChanged(li.dataset.wsrc); renderPoints(); }
        return;
      }
      removeVertex(+li.dataset.idx, +li.dataset.pi);
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
        if (!confirm(T('confirm.delTrack', { name: t.name }) + (usedIn ? ' ' + T('confirm.usedIn', { n: usedIn }) : ''))) return;
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
      toast(T('msg.cutRestored'));
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

  /* Групата горе вляво ("↓", "Лента", текстовото "Следене / Стоп") е в редица, когато се събира вляво от
     реда горе вдясно (с 8 px запас), иначе в стълбичка. Мери се винаги в редица (класът е махнат), за да
     не трепти, с истинската ширина на копчетата. Карта до 320 px - винаги стълбичка. */
  var TL_NARROW = 320;
  function layoutTopLeft() {
    var b = document.body, tl = $('.maptl'), tr = $('.mapctl.tr');
    b.classList.remove('maptl-stack');
    var r = tl.getBoundingClientRect(), room = tr.getBoundingClientRect().left - r.left - 8;
    if (r.width > room || $('#mapwrap').clientWidth <= TL_NARROW) b.classList.add('maptl-stack');
  }
  function fitTopLeft() {
    var queued = false, again = function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; layoutTopLeft(); });
    };
    layoutTopLeft();
    window.addEventListener('resize', again);
    window.addEventListener('orientationchange', again);
    // Лентата скрита/показана и следене (класове на body); "Точки" и "Север" разширяват реда вдясно,
    // а надписът "Следене / Стоп" - групата. Наблюдават се само размери, които не зависят от подредбата.
    var state = function () { var c = document.body.classList; return c.contains('bar-hidden') + ',' + c.contains('following'); }, was = state();
    new MutationObserver(function () {
      var now = state();
      if (now !== was) { was = now; again(); }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(again).observe($('.mapctl.tr'), { attributes: true, subtree: true, attributeFilter: ['hidden'] });
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(again);
      ro.observe($('.mapctl.tr')); ro.observe($('#followMapBtn'));
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(again);
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
    fitTopLeft();
    var tileErrs = 0, warned = false;
    map.on('tileerror', function () {
      tileErrs++;
      if (tileErrs >= 8 && !warned) {
        warned = true;
        toast(T('msg.tilesFail'), true, 8000);
      }
    });
    applyLayers();
    $('#themeBtn').textContent = document.documentElement.getAttribute('data-app-mode') === 'dark' ? T('theme.light') : T('theme.dark');
    bind();
    langCode();
    barHandle();
    followBtns();
    I18N.onChange(relang);
    $$('#langForm input[name="lang"]').forEach(function (r) { r.addEventListener('change', function () { if (r.checked) I18N.setPref(r.value); }); });
    $('#langTrSel').addEventListener('change', function (e) { useTr(e.target.value); });
    splash();
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
      $$('.tolVal').forEach(function (b) { b.textContent = S.tol + ' ' + T('unit.m'); });
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
    try { toast(T('msg.oops', { e: e.message || T('msg.unknownErr') }), true); } catch (er) { /* */ }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
