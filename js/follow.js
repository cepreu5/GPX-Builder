/* CX Tracks - следене по GPS: чете положението от устройството, записва
   изминатия път (ширина, дължина, височина, час, точност), точките от копчето "Точка"
   и намира мястото по маршрута. */
(function () {
  'use strict';

  var U = window.U, Core = window.Core;
  var OFF_LIMIT = 30; // над толкова метра встрани - предупреждение
  var ON_LIMIT = 20;  // до толкова метра от линията точката е "върху трака" (за следата през дупка)
  var RETRY_MS = 8000; // след връщане на екрана: още един опит, ако дотогава няма положение

  function Follower(cb) {
    this.cb = cb;
    this.watch = null;
    this.rec = [];
    this.wpts = [];      // точките от копчето "Точка": {lat, lon, ele, time, name}
    this.t0 = 0;
    this.lastD = null;
    this.lastOn = null;  // мястото по маршрута на последната записана точка, ако е върху трака
    this.wake = null;
    this.gen = 0;        // всяко пускане на GPS - ново поколение; старите отговори се пренебрегват
    this.fixAt = 0;      // кога е дошло последното положение
    this.hiddenAt = 0;   // кога страницата е излязла от екрана
    this.waiting = false; // след връщане на екрана - чака първото ново положение
    this.retry = null;
    this.awakeOn = true; // режим "Екранът да не заспива"
    this.onVis = this.visible.bind(this);
  }

  Follower.prototype = {
    start: function () {
      var self = this;
      if (!('geolocation' in navigator)) {
        this.cb.error(T('geo.none'));
        return false;
      }
      if (window.isSecureContext === false) {
        this.cb.error(T('geo.https'));
        return false;
      }
      this.rec = [];
      this.wpts = [];
      this.t0 = Date.now();
      this.lastD = null;
      this.lastOn = null;
      try {
        this.listen();
      } catch (e) {
        this.cb.error(T('geo.errMsg', { e: e.message }));
        return false;
      }
      document.addEventListener('visibilitychange', this.onVis);
      if (this.awakeOn) this.keepAwake(); else this.tellAwake('off');
      return true;
    },
    // Пуска GPS (или го пуска наново): същият запис, същият часовник - само нов watchPosition.
    listen: function () {
      var self = this, gen = ++this.gen;
      if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
      this.watch = navigator.geolocation.watchPosition(function (pos) {
        if (gen !== self.gen) return;
        var c = pos.coords;
        var p = [Math.round(c.latitude * 1e6) / 1e6, Math.round(c.longitude * 1e6) / 1e6,
          c.altitude != null ? Math.round(c.altitude) : null, pos.timestamp || Date.now(),
          c.accuracy != null ? Math.round(c.accuracy) : null];
        self.fixAt = Date.now();
        self.waiting = false;
        clearTimeout(self.retry);
        // Записваме само при движение над 5 м или точност, която има смисъл.
        // Ако и последната точка, и новата са върху трака, между тях влизат завоите на маршрута
        // (след заспал екран, тунел, изгубен сигнал); иначе остава права линия.
        var last = self.rec[self.rec.length - 1];
        if (!last || U.hav(last[0], last[1], p[0], p[1]) > Math.max(5, Math.min(c.accuracy || 0, 25) / 2)) {
          self.bridge(last, p).forEach(function (q) { self.rec.push(q); });
          self.rec.push(p);
        }
        self.cb.position({ lat: c.latitude, lon: c.longitude, alt: c.altitude, acc: c.accuracy, heading: c.heading, speed: c.speed, t: pos.timestamp });
      }, function (err) {
        if (gen !== self.gen) return;
        // Докато страницата е скрита или чакаме сигнал след връщане, грешката не спира следенето:
        // при връщане на екрана GPS-ът се пуска наново.
        if (document.visibilityState === 'hidden' || (self.waiting && err.code !== 1)) return;
        var msg = err.code === 1
          ? T('geo.denied')
          : err.code === 3 ? T('geo.timeout')
            : T('geo.unavail');
        self.cb.error(msg, err.code);
      }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
    },
    /* Скриване и връщане на страницата. iPhone/Safari спира местоположението, щом страницата
       излезе от екрана, и не го пуска сам; затова при връщане без ново положение GPS-ът се пуска
       наново, а ако до RETRY_MS пак няма положение - още веднъж. При режим "Екранът да не заспива"
       ключалката за екрана се иска наново; ако все пак заспи, следенето продължава при събуждане. */
    visible: function () {
      var self = this;
      if (document.visibilityState === 'hidden') { this.hiddenAt = Date.now(); return; }
      if (this.watch == null) return;
      // Браузърът сам пуска ключалката при скриване - при включен режим я искаме наново.
      if (this.awakeOn) this.keepAwake();
      if (this.fixAt > this.hiddenAt && Date.now() - this.fixAt < RETRY_MS) return; // GPS-ът е дал положение и докато беше скрито
      this.waiting = true;
      if (this.cb.waiting) this.cb.waiting();
      try { this.listen(); } catch (e) { /* пак при следващото връщане */ }
      clearTimeout(this.retry);
      this.retry = setTimeout(function () {
        if (self.waiting && self.watch != null && document.visibilityState !== 'hidden') {
          try { self.listen(); } catch (e) { /* няма значение */ }
        }
      }, Follower.RETRY_MS);
    },
    /* Режим "Екранът да не заспива": ключалката (Screen Wake Lock) се иска при тръгване и при
       всяко връщане на страницата. cb.awake(състояние) казва на панела какво става:
       'on' - държи се, 'off' - режимът е изключен, 'none' - браузърът не може, 'denied' - отказа. */
    keepAwake: function () {
      var self = this;
      if (!this.awakeOn || this.watch == null) return;
      if (this.wake && !this.wake.released) { this.tellAwake('on'); return; }
      if (!navigator.wakeLock || !navigator.wakeLock.request) { this.tellAwake('none'); return; }
      if (document.visibilityState === 'hidden' || this.asking) return;
      this.asking = true;
      var gen = this.gen;
      try {
        navigator.wakeLock.request('screen').then(function (w) {
          self.asking = false;
          // Междувременно режимът е изключен или следенето е спряно.
          if (!self.awakeOn || self.watch == null) { w.release().catch(function () {}); return; }
          self.wake = w;
          w.addEventListener('release', function () { if (self.wake === w) self.wake = null; });
          self.tellAwake('on');
        }).catch(function () { self.asking = false; if (self.awakeOn && self.watch != null && gen <= self.gen) self.tellAwake('denied'); });
      } catch (e) { this.asking = false; this.tellAwake('denied'); }
    },
    setAwake: function (on) {
      this.awakeOn = !!on;
      if (this.awakeOn) this.keepAwake();
      else { this.releaseAwake(); this.tellAwake('off'); }
    },
    releaseAwake: function () {
      var w = this.wake;
      this.wake = null;
      if (w) { try { w.release().catch(function () {}); } catch (e) { /* няма значение */ } }
    },
    tellAwake: function (state) {
      this.awake = state;
      if (this.cb.awake) this.cb.awake(state);
    },
    stop: function () {
      if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
      this.watch = null;
      this.gen++;
      this.waiting = false;
      clearTimeout(this.retry);
      document.removeEventListener('visibilitychange', this.onVis);
      this.releaseAwake();
      return this.rec.slice();
    },
    elapsed: function () { return Date.now() - this.t0; },
    // Точка на мястото pos (последното положение от GPS); празно име - "Точка N".
    addPoint: function (pos, name) {
      if (!pos) return null;
      var w = { lat: Math.round(pos.lat * 1e6) / 1e6, lon: Math.round(pos.lon * 1e6) / 1e6,
        ele: pos.alt != null && isFinite(pos.alt) ? Math.round(pos.alt) : null, time: pos.t || Date.now(),
        name: String(name || '').trim() || T('wpt.def', { n: this.wpts.length + 1 }) };
      this.wpts.push(w);
      return w;
    },

    /* Следата между последната записана точка и новата: точките на маршрута помежду им, ако и двете
       са до ON_LIMIT м от линията му. Напред по посоката на маршрута (при затворен кръг - през края
       му към началото), назад само по отворен маршрут. Час - разпределен по разстояние между часовете
       на двете точки; височина - от профила на маршрута на мястото на точката по него (cb.ele), без профил -
       от самия трак, а без нито едно - по права между двете измерени, ако ги има; точност - празна. */
    bridge: function (last, p) {
      var geo = this.cb.route ? this.cb.route() : null;
      var pts = geo && geo.pts, cum = geo && geo.cum;
      if (!pts || pts.length < 2) { this.lastOn = null; return []; }
      var n = pts.length - 1, len = cum[n];
      var loop = U.hav(pts[0][0], pts[0][1], pts[n][0], pts[n][1]) <= ON_LIMIT;
      var a = last && this.lastOn && this.lastOn.geo === geo ? this.lastOn : null, b = null, dir = 1;
      if (last && !a) {
        var na = Core.nearestOn(pts, cum, last[0], last[1]);
        if (na && na.dist <= ON_LIMIT) a = { d: na.d };
      }
      if (a) {
        b = Core.alongOn(pts, cum, a.d, p[0], p[1], ON_LIMIT, 1, loop);
        if (!b && !loop) { b = Core.alongOn(pts, cum, a.d, p[0], p[1], ON_LIMIT, -1, false); dir = -1; }
      } else {
        b = Core.nearestOn(pts, cum, p[0], p[1]);
        if (b && b.dist > ON_LIMIT) b = null;
      }
      this.lastOn = b ? { geo: geo, d: b.d } : null;
      if (!a || !b) return [];
      var idx = [], i;
      if (dir < 0) { for (i = n; i >= 0; i--) if (cum[i] < a.d && cum[i] > b.d) idx.push(i); }
      else if (b.d >= a.d) { for (i = 0; i <= n; i++) if (cum[i] > a.d && cum[i] < b.d) idx.push(i); }
      else {
        // Кръгът минава през края си: до края, после от началото (началото е същото място като края).
        for (i = 0; i <= n; i++) if (cum[i] > a.d && cum[i] <= len) idx.push(i);
        var same = U.hav(pts[0][0], pts[0][1], pts[n][0], pts[n][1]) < 1;
        for (i = same ? 1 : 0; i <= n; i++) if (cum[i] < b.d) idx.push(i);
      }
      if (!idx.length) return [];
      var way = [last].concat(idx.map(function (j) { return pts[j]; }), [p]), s = [0];
      for (i = 1; i < way.length; i++) s.push(s[i - 1] + U.hav(way[i - 1][0], way[i - 1][1], way[i][0], way[i][1]));
      var S = s[s.length - 1] || 1, out = [];
      var cb = this.cb;
      for (i = 1; i < way.length - 1; i++) {
        var f = s[i] / S, j = idx[i - 1];
        var e = cb.ele ? cb.ele(geo, cum[j]) : null;
        if (e == null) e = pts[j][2];
        e = e != null && isFinite(e) ? Math.round(e * 10) / 10 :
          last[2] != null && p[2] != null ? Math.round(last[2] + f * (p[2] - last[2])) : null;
        out.push([Math.round(way[i][0] * 1e6) / 1e6, Math.round(way[i][1] * 1e6) / 1e6, e,
          Math.round(last[3] + f * (p[3] - last[3])), null]);
      }
      return out;
    },

    // Мястото по маршрута: предпочита близо до предишното, за да не скача при връщане по същия път.
    progress: function (geo, lat, lon) {
      if (!geo || geo.pts.length < 2) return null;
      var best = Core.nearestOn(geo.pts, geo.cum, lat, lon);
      if (this.lastD != null && best) {
        var lo = this.lastD - 400, hi = this.lastD + 2500;
        var i0 = 0, i1 = geo.pts.length - 1;
        while (i0 < i1 && geo.cum[i0 + 1] < lo) i0++;
        while (i1 > i0 + 1 && geo.cum[i1 - 1] > hi) i1--;
        if (i1 > i0) {
          var sub = Core.nearestOn(geo.pts.slice(i0, i1 + 1), geo.cum.slice(i0, i1 + 1), lat, lon);
          if (sub && sub.dist < best.dist + 25) best = sub;
        }
      }
      if (!best) return null;
      this.lastD = best.d;
      var br = U.bearing(lat, lon, best.lat, best.lon);
      return { d: best.d, off: best.dist, lat: best.lat, lon: best.lon, bearing: br, isOff: best.dist > OFF_LIMIT, total: geo.len };
    }
  };

  window.Follower = Follower;
  window.Follower.OFF_LIMIT = OFF_LIMIT;
  window.Follower.ON_LIMIT = ON_LIMIT;
  window.Follower.RETRY_MS = RETRY_MS;
})();
