/* GPX конструктор - следене по GPS: чете положението от устройството, записва
   изминатия път (ширина, дължина, височина, час, точност) и намира мястото по маршрута. */
(function () {
  'use strict';

  var U = window.U, Core = window.Core;
  var OFF_LIMIT = 30; // над толкова метра встрани - предупреждение
  var RETRY_MS = 8000; // след връщане на екрана: още един опит, ако дотогава няма положение

  function Follower(cb) {
    this.cb = cb;
    this.watch = null;
    this.rec = [];
    this.t0 = 0;
    this.lastD = null;
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
        this.cb.error('Този браузър не дава местоположение. Следенето не може да тръгне.');
        return false;
      }
      if (window.isSecureContext === false) {
        this.cb.error('Следенето иска защитена връзка (https). Отвори приложението от адреса в GitHub Pages.');
        return false;
      }
      this.rec = [];
      this.t0 = Date.now();
      this.lastD = null;
      try {
        this.listen();
      } catch (e) {
        this.cb.error('Местоположението не е налично: ' + e.message);
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
        // След пауза новата точка просто се свързва с последната - права линия, която влиза в дължината.
        var last = self.rec[self.rec.length - 1];
        if (!last || U.hav(last[0], last[1], p[0], p[1]) > Math.max(5, Math.min(c.accuracy || 0, 25) / 2)) self.rec.push(p);
        self.cb.position({ lat: c.latitude, lon: c.longitude, acc: c.accuracy, heading: c.heading, speed: c.speed, t: pos.timestamp });
      }, function (err) {
        if (gen !== self.gen) return;
        // Докато страницата е скрита или чакаме сигнал след връщане, грешката не спира следенето:
        // при връщане на екрана GPS-ът се пуска наново.
        if (document.visibilityState === 'hidden' || (self.waiting && err.code !== 1)) return;
        var msg = err.code === 1
          ? 'Нямаш разрешение за местоположение. Разреши го от настройките на браузъра за този сайт и натисни "Следене" пак.'
          : err.code === 3 ? 'GPS не отговаря. Излез на открито и изчакай малко.'
            : 'Местоположението не е налично в момента.';
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
  window.Follower.RETRY_MS = RETRY_MS;
})();
