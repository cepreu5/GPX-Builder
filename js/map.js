/* GPX конструктор - собствена карта: плочки в Web Mercator, местене, приближаване,
   приближаване с два пръста, чертане върху платно. Без външни библиотеки. */
(function () {
  'use strict';

  var TILE = 256;
  var MIN_Z = 2, MAX_Z = 19;
  var CACHE_MAX = 600;

  function lon2x(lon) { return (lon + 180) / 360; }
  function lat2y(lat) {
    var s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  }
  function x2lon(x) { return x * 360 - 180; }
  function y2lat(y) {
    var n = Math.PI - 2 * Math.PI * y;
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  function TileMap(el, opts) {
    var self = this;
    opts = opts || {};
    this.el = el;
    this.opts = opts;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';
    this.canvas.setAttribute('tabindex', '0');
    this.canvas.setAttribute('aria-label', 'Карта');
    el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.cx = lon2x(24.7036);
    this.cy = lat2y(42.5006);
    this.zoom = 13;
    this.layers = [];
    this.cache = new Map();
    this.drawers = [];
    this.listeners = {};
    this.dirty = true;
    this.w = 0; this.h = 0; this.dpr = 1;
    this.tileErrors = 0;
    this.resize();
    if (window.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(el);
    else window.addEventListener('resize', function () { self.resize(); });
    this._bindInput();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  TileMap.prototype = {
    on: function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    emit: function (ev, a) {
      var l = this.listeners[ev] || [];
      for (var i = 0; i < l.length; i++) {
        try { l[i](a); } catch (e) { console.error(e); }
      }
    },
    addDrawer: function (fn) { this.drawers.push(fn); this.redraw(); },
    redraw: function () { this.dirty = true; },

    resize: function () {
      var r = this.el.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 3);
      this.w = Math.max(1, Math.round(r.width));
      this.h = Math.max(1, Math.round(r.height));
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
      this.canvas.style.width = this.w + 'px';
      this.canvas.style.height = this.h + 'px';
      this.redraw();
    },

    // Размер на света в пиксели при текущото приближаване.
    scale: function () { return TILE * Math.pow(2, this.zoom); },
    project: function (lat, lon) {
      var s = this.scale();
      return { x: (lon2x(lon) - this.cx) * s + this.w / 2, y: (lat2y(lat) - this.cy) * s + this.h / 2 };
    },
    unproject: function (x, y) {
      var s = this.scale();
      return { lat: y2lat(this.cy + (y - this.h / 2) / s), lon: x2lon(this.cx + (x - this.w / 2) / s) };
    },
    // Бърза проекция за много точки: връща функция.
    projector: function () {
      var s = this.scale(), cx = this.cx, cy = this.cy, hw = this.w / 2, hh = this.h / 2;
      return function (lat, lon) { return [(lon2x(lon) - cx) * s + hw, (lat2y(lat) - cy) * s + hh]; };
    },
    getView: function () {
      return { lat: y2lat(this.cy), lon: x2lon(this.cx), zoom: this.zoom };
    },
    setView: function (lat, lon, zoom) {
      this.cx = lon2x(lon); this.cy = lat2y(lat);
      if (zoom != null) this.zoom = clampZ(zoom);
      this._changed();
    },
    metersPerPixel: function () {
      var lat = y2lat(this.cy);
      return 40075016.686 * Math.cos(lat * Math.PI / 180) / this.scale();
    },
    fitBounds: function (b, pad) {
      if (!b) return;
      pad = pad || {};
      var pt = pad.top || 30, pb = pad.bottom || 30, pl = pad.left || 30, pr = pad.right || 30;
      var x0 = lon2x(b.w), x1 = lon2x(b.e), y0 = lat2y(b.n), y1 = lat2y(b.s);
      var aw = Math.max(40, this.w - pl - pr), ah = Math.max(40, this.h - pt - pb);
      var dx = Math.max(x1 - x0, 1e-9), dy = Math.max(y1 - y0, 1e-9);
      var z = Math.log(Math.min(aw / (dx * TILE), ah / (dy * TILE))) / Math.LN2;
      this.zoom = clampZ(Math.min(z, 17));
      var s = this.scale();
      this.cx = (x0 + x1) / 2 + ((pr - pl) / 2) / s;
      this.cy = (y0 + y1) / 2 + ((pb - pt) / 2) / s;
      this._changed();
    },
    zoomAround: function (nz, x, y) {
      nz = clampZ(nz);
      if (x == null) { x = this.w / 2; y = this.h / 2; }
      var before = this.unproject(x, y);
      this.zoom = nz;
      var s = this.scale();
      this.cx = lon2x(before.lon) - (x - this.w / 2) / s;
      this.cy = lat2y(before.lat) - (y - this.h / 2) / s;
      this._changed();
    },
    panBy: function (dx, dy) {
      var s = this.scale();
      this.cx -= dx / s; this.cy -= dy / s;
      this.cy = Math.max(0, Math.min(1, this.cy));
      this._changed();
    },
    _changed: function () {
      this.redraw();
      var self = this;
      clearTimeout(this._vt);
      this._vt = setTimeout(function () { self.emit('viewchange', self.getView()); }, 250);
    },

    setLayers: function (layers) { this.layers = layers; this.redraw(); },

    // Плочка от кеша в паметта; тегли се само при нужда.
    tile: function (layer, z, x, y, want) {
      var n = 1 << z;
      var xx = ((x % n) + n) % n;
      var key = layer.id + '/' + z + '/' + xx + '/' + y;
      var t = this.cache.get(key);
      if (t) { t.used = this._frame; return t; }
      if (!want) return null;
      var self = this;
      t = { img: new Image(), ok: false, failed: false, used: this._frame };
      t.img.crossOrigin = 'anonymous';
      t.img.decoding = 'async';
      t.img.onload = function () { t.ok = true; self.redraw(); };
      t.img.onerror = function () { t.failed = true; self.tileErrors++; self.emit('tileerror', layer); };
      t.img.src = layer.url(z, xx, y);
      this.cache.set(key, t);
      if (this.cache.size > CACHE_MAX) this._prune();
      return t;
    },
    _prune: function () {
      var arr = [];
      this.cache.forEach(function (t, k) { arr.push([t.used, k]); });
      arr.sort(function (a, b) { return a[0] - b[0]; });
      for (var i = 0; i < arr.length - CACHE_MAX * 0.8; i++) {
        var t = this.cache.get(arr[i][1]);
        if (t && !t.ok) t.img.src = '';
        this.cache.delete(arr[i][1]);
      }
    },

    _drawLayer: function (ctx, layer) {
      var tz = Math.max(0, Math.min(layer.maxZoom || 19, Math.round(this.zoom)));
      var n = 1 << tz;
      var ts = TILE * Math.pow(2, this.zoom - tz); // размер на плочката на екрана
      var ox = this.cx * n * ts - this.w / 2; // светови пиксели на левия ръб
      var oy = this.cy * n * ts - this.h / 2;
      var x0 = Math.floor(ox / ts), y0 = Math.floor(oy / ts);
      var x1 = Math.floor((ox + this.w) / ts), y1 = Math.floor((oy + this.h) / ts);
      ctx.globalAlpha = layer.opacity == null ? 1 : layer.opacity;
      for (var ty = y0; ty <= y1; ty++) {
        if (ty < 0 || ty >= n) continue;
        for (var tx = x0; tx <= x1; tx++) {
          var sx = Math.round(tx * ts - ox), sy = Math.round(ty * ts - oy);
          var sw = Math.round((tx + 1) * ts - ox) - sx, sh = Math.round((ty + 1) * ts - oy) - sy;
          var t = this.tile(layer, tz, tx, ty, true);
          if (t && t.ok) { ctx.drawImage(t.img, sx, sy, sw, sh); continue; }
          if (layer.noFallback) continue;
          // Докато плочката дойде, рисуваме по-едра от кеша, за да не чака местенето.
          for (var up = 1; up <= 5 && tz - up >= 0; up++) {
            var pz = tz - up, f = 1 << up;
            var px = Math.floor(tx / f), py = Math.floor(ty / f);
            var p = this.tile(layer, pz, px, py, false);
            if (p && p.ok) {
              var sub = TILE / f;
              ctx.drawImage(p.img, (tx - px * f) * sub, (ty - py * f) * sub, sub, sub, sx, sy, sw, sh);
              break;
            }
          }
        }
      }
      ctx.globalAlpha = 1;
    },

    _loop: function () {
      requestAnimationFrame(this._loop);
      if (!this.dirty) return;
      this.dirty = false;
      this._frame = (this._frame || 0) + 1;
      var ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = this.opts.background ? this.opts.background() : '#ddd';
      ctx.fillRect(0, 0, this.w, this.h);
      for (var i = 0; i < this.layers.length; i++) {
        if (this.layers[i].visible !== false) this._drawLayer(ctx, this.layers[i]);
      }
      for (var j = 0; j < this.drawers.length; j++) {
        ctx.save();
        try { this.drawers[j](ctx, this); } catch (e) { console.error(e); }
        ctx.restore();
      }
    },

    _bindInput: function () {
      var self = this, c = this.canvas;
      var pointers = new Map();
      var drag = null;     // {handler} или {pan:true}
      var start = null;    // първо натискане
      var pinch = null;
      var longT = null;
      var lastTap = 0;

      function pos(e) {
        var r = c.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      }
      function geo(p) { var g = self.unproject(p.x, p.y); p.lat = g.lat; p.lon = g.lon; return p; }

      c.addEventListener('pointerdown', function (e) {
        if (e.button > 0) return;
        c.focus({ preventScroll: true });
        try { c.setPointerCapture(e.pointerId); } catch (er) { /* няма значение */ }
        var p = pos(e);
        pointers.set(e.pointerId, p);
        if (pointers.size === 2) {
          clearTimeout(longT);
          if (drag && drag.handler && drag.handler.cancel) drag.handler.cancel();
          var a = Array.from(pointers.values());
          pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), z: self.zoom, mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2 };
          drag = null; start = null;
          return;
        }
        if (pointers.size > 2) return;
        start = { x: p.x, y: p.y, t: Date.now(), moved: false, type: e.pointerType };
        var h = self.opts.onPress ? self.opts.onPress(geo({ x: p.x, y: p.y }), e) : null;
        drag = h ? { handler: h } : { pan: true, lx: p.x, ly: p.y };
        clearTimeout(longT);
        if (!h && self.opts.onLongPress) {
          longT = setTimeout(function () {
            if (!start || start.moved || pointers.size !== 1) return;
            var lh = self.opts.onLongPress(geo({ x: start.x, y: start.y }));
            if (lh) { drag = { handler: lh }; start.long = true; }
          }, 480);
        }
      });
      c.addEventListener('pointermove', function (e) {
        var p = pos(e);
        if (!pointers.has(e.pointerId)) {
          if (self.opts.onHover && e.pointerType === 'mouse') self.opts.onHover(geo(p));
          return;
        }
        pointers.set(e.pointerId, p);
        if (pinch && pointers.size === 2) {
          var a = Array.from(pointers.values());
          var d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
          var mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
          self.panBy(mx - pinch.mx, my - pinch.my);
          pinch.mx = mx; pinch.my = my;
          self.zoomAround(pinch.z + Math.log(d / pinch.d) / Math.LN2, mx, my);
          self.emit('usermove');
          return;
        }
        if (!start || !drag) return;
        if (!start.moved && Math.hypot(p.x - start.x, p.y - start.y) > (start.type === 'mouse' ? 4 : 9)) {
          start.moved = true;
          clearTimeout(longT);
        }
        if (!start.moved) return;
        if (drag.handler) { drag.handler.move(geo(p)); self.redraw(); }
        else if (drag.pan) {
          self.panBy(p.x - drag.lx, p.y - drag.ly);
          drag.lx = p.x; drag.ly = p.y;
          self.emit('usermove');
          c.classList.add('panning');
        }
      });
      function end(e) {
        var had = pointers.has(e.pointerId);
        pointers.delete(e.pointerId);
        clearTimeout(longT);
        c.classList.remove('panning');
        if (pinch) {
          if (pointers.size < 2) pinch = null;
          if (pointers.size === 0) { drag = null; start = null; }
          return;
        }
        if (!had || !start) return;
        var p = pos(e);
        if (drag && drag.handler) {
          if (start.moved || start.long) { if (drag.handler.end) drag.handler.end(geo(p)); }
          else if (drag.handler.tap) drag.handler.tap(geo(p));
          else if (self.opts.onClick) self.opts.onClick(geo(p), e);
        } else if (!start.moved && e.type === 'pointerup') {
          var now = Date.now();
          if (now - lastTap < 300 && start.type !== 'mouse') {
            self.zoomAround(Math.round(self.zoom) + 1, p.x, p.y);
            lastTap = 0;
          } else {
            lastTap = now;
            if (self.opts.onClick) self.opts.onClick(geo(p), e);
          }
        }
        drag = null; start = null;
        self.redraw();
      }
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', end);
      c.addEventListener('pointerleave', function (e) {
        if (!pointers.has(e.pointerId) && self.opts.onHover) self.opts.onHover(null);
      });
      c.addEventListener('dblclick', function (e) {
        if (self.opts.dblZoom && !self.opts.dblZoom()) return;
        var p = pos(e);
        self.zoomAround(Math.round(self.zoom) + (e.shiftKey ? -1 : 1), p.x, p.y);
      });
      c.addEventListener('wheel', function (e) {
        e.preventDefault();
        var p = pos(e);
        var dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
        var k = e.ctrlKey ? 0.012 : 0.0025;
        self.zoomAround(self.zoom - Math.max(-1, Math.min(1, dy * k)), p.x, p.y);
        self.emit('usermove');
      }, { passive: false });
      c.addEventListener('keydown', function (e) {
        var step = 80;
        if (e.key === '+' || e.key === '=') self.zoomAround(Math.round(self.zoom) + 1);
        else if (e.key === '-') self.zoomAround(Math.round(self.zoom) - 1);
        else if (e.key === 'ArrowLeft') self.panBy(step, 0);
        else if (e.key === 'ArrowRight') self.panBy(-step, 0);
        else if (e.key === 'ArrowUp') self.panBy(0, step);
        else if (e.key === 'ArrowDown') self.panBy(0, -step);
        else return;
        e.preventDefault();
      });
    }
  };

  function clampZ(z) { return Math.max(MIN_Z, Math.min(MAX_Z, z)); }

  TileMap.merc = { lon2x: lon2x, lat2y: lat2y, x2lon: x2lon, y2lat: y2lat, TILE: TILE };
  window.TileMap = TileMap;
})();
