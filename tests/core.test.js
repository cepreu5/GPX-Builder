// Проверка на ядрото без браузър: node tests/core.test.js
global.window = global;
require('../js/util.js'); require('../js/core.js');
var assert = require('assert');
function line(lat0, lon0, lat1, lon1, n, jitter) {
  var p = [];
  for (var i = 0; i <= n; i++) {
    var f = i / n, j = jitter ? (Math.sin(i * 7.3) * jitter) : 0;
    p.push([lat0 + f * (lat1 - lat0) + j, lon0 + f * (lon1 - lon0), 500 + i]);
  }
  return p;
}
// Трак А: 0..0.05 по дължина (около 4 км) на изток.
var A = { id: 'A', pts: line(42.5, 24.70, 42.5, 24.75, 200) };
// Трак Б: върви 1 км успоредно на А на 10 м (дубликат), после се отделя на север.
var B = { id: 'B', pts: line(42.50009, 24.71, 42.50009, 24.73, 80).concat(line(42.50009, 24.7302, 42.53, 24.73, 120)) };
// Трак В: същото като Б, но на 35 м и в обратна посока.
var C = { id: 'C', pts: line(42.50031, 24.735, 42.50031, 24.745, 40) .reverse() };
var r = Core.analyze([A, B, C], 20, []);
function kinds(id) { return r.byTrack[id].filter(function (s) { return s.kind !== 'gap'; }).map(function (s) { return s.kind + ':' + Math.round(s.a) + '-' + Math.round(s.b) + (s.withId ? '@' + s.withId + '/' + s.dir : ''); }); }
console.log('A', kinds('A')); console.log('B', kinds('B')); console.log('C', kinds('C'));
assert.deepStrictEqual(r.byTrack.A.map(function (s) { return s.kind; }), ['part']);
assert.strictEqual(r.byTrack.B[0].kind, 'dup'); assert.strictEqual(r.byTrack.B[0].withId, 'A');
assert.strictEqual(r.byTrack.B[1].kind, 'part');
assert.ok(r.byTrack.C.every(function (s) { return s.kind === 'part'; }), 'при 20 м В е различен');
var r40 = Core.analyze([A, B, C], 40, []);
console.log('C@40', r40.byTrack.C.map(function (s) { return s.kind + '/' + s.dir; }));
assert.strictEqual(r40.byTrack.C[0].kind, 'dup'); assert.strictEqual(r40.byTrack.C[0].dir, 'обратна');
// Решение с клик: приет дубликат става част.
var d = r.byTrack.B[0];
var r2 = Core.analyze([A, B, C], 20, [{ trackId: 'B', a: d.a, b: d.b }]);
assert.ok(r2.byTrack.B[0].kept);
// Изрязване.
A.cuts = [{ a: 0, b: 1000 }];
var r3 = Core.analyze([A, B, C], 20, []);
console.log('A cut', kinds('A').length, r3.byTrack.A.map(function (s) { return s.kind + ':' + Math.round(s.a); }));
assert.strictEqual(r3.byTrack.A[0].kind, 'cut'); assert.strictEqual(Math.round(r3.byTrack.A[1].a), 1000);
// Връщане по същия път в същия трак.
var out = line(42.6, 24.7, 42.6, 24.72, 80), back = line(42.60005, 24.72, 42.60005, 24.70, 80);
var S = { id: 'S', pts: out.concat(back) };
var r4 = Core.analyze([S], 20, []);
console.log('S', r4.byTrack.S.map(function (s) { return s.kind + ':' + Math.round(s.a) + '-' + Math.round(s.b) + (s.withId ? '@' + s.withId : ''); }));
assert.strictEqual(r4.byTrack.S[r4.byTrack.S.length - 1].kind, 'dup');
// Геометрия на маршрут и дупка.
var byId = { A: A, B: B, C: C };
var g = Core.routeGeometry({ items: [{ type: 'part', trackId: 'A', a: 1000, b: 2000 }, { type: 'part', trackId: 'B', a: 2000, b: 3000 }] }, byId);
console.log('route len', Math.round(g.len), 'gaps', g.gaps.map(function (x) { return Math.round(x.d); }));
assert.strictEqual(g.gaps.length, 1);
console.log('OK', U.num(1180), U.km(17040), U.pct(8.44));
