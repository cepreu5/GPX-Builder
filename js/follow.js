/* GPX конструктор - следене по GPS: чете положението от устройството, записва
   изминатия път и намира мястото по маршрута. */
(function () {
  'use strict';

  var U = window.U, Core = window.Core;
  var OFF_LIMIT = 30; // над толкова метра встрани - предупреждение

  function Follower(cb) {
    this.cb = cb;
    this.watch = null;
    this.rec = [];
    this.t0 = 0;
    this.lastD = null;
    this.wake = null;
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
        this.watch = navigator.geolocation.watchPosition(function (pos) {
          var c = pos.coords;
          var p = [Math.round(c.latitude * 1e6) / 1e6, Math.round(c.longitude * 1e6) / 1e6,
            c.altitude != null ? Math.round(c.altitude) : null, pos.timestamp || Date.now()];
          // Записваме само при движение над 5 м или точност, която има смисъл.
          var last = self.rec[self.rec.length - 1];
          if (!last || U.hav(last[0], last[1], p[0], p[1]) > Math.max(5, Math.min(c.accuracy || 0, 25) / 2)) self.rec.push(p);
          self.cb.position({ lat: c.latitude, lon: c.longitude, acc: c.accuracy, heading: c.heading, t: pos.timestamp });
        }, function (err) {
          var msg = err.code === 1
            ? 'Нямаш разрешение за местоположение. Разреши го от настройките на браузъра за този сайт и натисни "Следене" пак.'
            : err.code === 3 ? 'GPS не отговаря. Излез на открито и изчакай малко.'
              : 'Местоположението не е налично в момента.';
          self.cb.error(msg, err.code);
        }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
      } catch (e) {
        this.cb.error('Местоположението не е налично: ' + e.message);
        return false;
      }
      this.keepAwake();
      return true;
    },
    keepAwake: function () {
      var self = this;
      try {
        if (navigator.wakeLock && navigator.wakeLock.request) {
          navigator.wakeLock.request('screen').then(function (w) { self.wake = w; }).catch(function () { /* не е задължително */ });
        }
      } catch (e) { /* не е задължително */ }
    },
    stop: function () {
      if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
      this.watch = null;
      if (this.wake) { try { this.wake.release(); } catch (e) { /* няма значение */ } this.wake = null; }
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
})();
