/* CX Tracks - четене и писане на GPX. */
(function () {
  'use strict';

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function childText(el, name) {
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.localName === name) return c.textContent.trim();
    }
    return null;
  }
  function byLocal(root, name) {
    return Array.prototype.slice.call(root.getElementsByTagNameNS('*', name));
  }
  function readPt(el) {
    var lat = num(el.getAttribute('lat')), lon = num(el.getAttribute('lon'));
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    var ele = num(childText(el, 'ele'));
    var t = childText(el, 'time');
    var tm = t ? Date.parse(t) : NaN;
    var p = [round(lat), round(lon), ele == null ? null : Math.round(ele * 10) / 10];
    if (isFinite(tm)) p.push(tm);
    return p;
  }
  function round(v) { return Math.round(v * 1e6) / 1e6; }

  // Връща {tracks:[{name, pts, breaks, wpts}]} или хвърля Error с ясно съобщение.
  function parse(text, fileName) {
    var bad = new Error(T('gpx.bad'));
    if (typeof text !== 'string' || text.indexOf('<') < 0) throw bad;
    var doc;
    try { doc = new DOMParser().parseFromString(text, 'application/xml'); } catch (e) { throw bad; }
    if (!doc || doc.getElementsByTagName('parsererror').length || !doc.documentElement ||
      doc.documentElement.localName !== 'gpx') throw bad;
    var root = doc.documentElement;
    var base = String(fileName || T('gpx.track')).replace(/\.gpx$/i, '');
    var metaName = null;
    var md = byLocal(root, 'metadata')[0];
    if (md) metaName = childText(md, 'name');

    var wpts = byLocal(root, 'wpt').map(function (w) {
      var p = readPt(w);
      if (!p) return null;
      return { lat: p[0], lon: p[1], ele: p[2], name: childText(w, 'name') || '' };
    }).filter(Boolean);

    var out = [];
    byLocal(root, 'trk').forEach(function (trk) {
      var pts = [], breaks = [];
      byLocal(trk, 'trkseg').forEach(function (seg) {
        var segPts = byLocal(seg, 'trkpt').map(readPt).filter(Boolean);
        if (!segPts.length) return;
        if (pts.length) breaks.push(pts.length);
        Array.prototype.push.apply(pts, segPts);
      });
      if (pts.length >= 2) out.push({ name: childText(trk, 'name'), pts: pts, breaks: breaks });
    });
    byLocal(root, 'rte').forEach(function (rte) {
      var pts = byLocal(rte, 'rtept').map(readPt).filter(Boolean);
      if (pts.length >= 2) out.push({ name: childText(rte, 'name'), pts: pts, breaks: [] });
    });
    if (!out.length) {
      if (wpts.length) throw new Error(T('gpx.onlyWpts'));
      throw bad;
    }
    out.forEach(function (t, i) {
      t.name = out.length > 1 ? base + '.gpx · ' + (t.name || (i + 1)) : base + '.gpx';
      t.title = t.name;
      t.wpts = i === 0 ? wpts : [];
    });
    if (metaName && out.length === 1) out[0].title = metaName;
    return { tracks: out };
  }

  function x(s) {
    return String(s).replace(/[<>&"']/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }
  function f6(v) { return (Math.round(v * 1e6) / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, ''); }

  // Един трак с една непрекъсната линия плюс точки с име като waypoints.
  function build(opts) {
    var name = opts.name || T('route.def');
    var now = new Date().toISOString();
    var lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<gpx version="1.1" creator="CX Tracks" xmlns="http://www.topografix.com/GPX/1/1" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">');
    lines.push('  <metadata><name>' + x(name) + '</name><time>' + now + '</time></metadata>');
    (opts.wpts || []).forEach(function (w) {
      lines.push('  <wpt lat="' + f6(w.lat) + '" lon="' + f6(w.lon) + '">' +
        (w.ele != null ? '<ele>' + Math.round(w.ele) + '</ele>' : '') +
        '<name>' + x(w.name) + '</name></wpt>');
    });
    lines.push('  <trk><name>' + x(name) + '</name><trkseg>');
    (opts.pts || []).forEach(function (p) {
      var s = '    <trkpt lat="' + f6(p[0]) + '" lon="' + f6(p[1]) + '">';
      if (p[2] != null && isFinite(p[2])) s += '<ele>' + (Math.round(p[2] * 10) / 10) + '</ele>';
      if (p[3]) s += '<time>' + new Date(p[3]).toISOString() + '</time>';
      lines.push(s + '</trkpt>');
    });
    lines.push('  </trkseg></trk>');
    lines.push('</gpx>');
    return lines.join('\n') + '\n';
  }

  window.GPX = { parse: parse, build: build };
})();
