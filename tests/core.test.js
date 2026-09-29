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
// Дубликатът не се връща: няма поле kept, не е част, а стар трети аргумент (overrides) не пречи.
var d = r.byTrack.B[0];
var r2 = Core.analyze([A, B, C], 20, [{ trackId: 'B', a: d.a, b: d.b }]);
assert.strictEqual(Core.analyze.length, 2, 'analyze няма параметър overrides');
assert.ok(r2.dups.every(function (s) { return !('kept' in s); }), 'дубликатът няма поле kept');
assert.ok(r2.parts.every(function (s) { return s.kind === 'part'; }), 'дубликат не влиза в частите');
assert.strictEqual(r2.byTrack.B[0].kind, 'dup');
assert.ok(Core.invalidShare({ trackId: 'B', a: d.a, b: d.b }, r2).bad, 'част върху дубликат е невалидна');
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
var g = Core.routeGeometry({ items: [{ type: 'part', trackId: 'A', a: 1000, b: 2000 }, { type: 'part', trackId: 'B', a: 2000, b: 3000 }] }, byId, r3);
console.log('route len', Math.round(g.len), 'gaps', g.gaps.map(function (x) { return Math.round(x.d); }));
assert.strictEqual(g.gaps.length, 1, 'без обща отсечка дупката си остава');
assert.ok(!g.items.some(function (x) { return x.shared; }));

// Обща отсечка: X върви на изток; Z тръгва от края на X на юг; Y слиза от север до X,
// минава 800 м по X (дубликат) и се отделя на североизток.
var X = { id: 'X', pts: line(42.7, 24.70, 42.7, 24.72, 100) };
var Z = { id: 'Z', pts: line(42.7, 24.72, 42.69, 24.72, 60) };
var Y = { id: 'Y', pts: line(42.71, 24.71, 42.70009, 24.71, 60).concat(line(42.70009, 24.7101, 42.70009, 24.72, 60), line(42.7003, 24.7201, 42.71, 24.73, 60)) };
var rs = Core.analyze([X, Z, Y], 20);
var ys = rs.byTrack.Y.filter(function (s) { return s.kind !== 'gap'; });
console.log('Y', ys.map(function (s) { return s.kind + ':' + Math.round(s.a) + '-' + Math.round(s.b); }));
assert.deepStrictEqual(ys.map(function (s) { return s.kind; }), ['part', 'dup', 'part']);
var yDup = ys[1], y1 = ys[0], y2 = ys[2], zp = rs.byTrack.Z.filter(function (s) { return s.kind === 'part'; })[0];
var byS = { X: X, Y: Y, Z: Z };
function P(s, rev) { return { type: 'part', trackId: s.trackId, a: s.a, b: s.b, rev: !!rev }; }
function checkShared(name, items, trackId) {
  var route = { items: items };
  var gs = Core.routeGeometry(route, byS, rs);
  var sh = gs.items.filter(function (x) { return x.shared; });
  var parts = gs.items.filter(function (x) { return !x.shared; });
  var sum = parts.reduce(function (acc, x) { return acc + x.len; }, 0);
  console.log(name, 'len', Math.round(gs.len), 'parts', Math.round(sum), 'shared', sh.map(function (x) { return x.item.trackId + ' ' + Math.round(x.len); }), 'gaps', gs.gaps.length);
  assert.strictEqual(gs.gaps.length, 0, name + ': няма дупка');
  assert.strictEqual(sh.length, 1, name + ': една обща отсечка');
  assert.strictEqual(sh[0].item.trackId, trackId);
  assert.strictEqual(sh[0].idx, null, name + ': общата отсечка не е в route.items');
  assert.strictEqual(route.items.length, items.length, name + ': route.items не се пипа');
  assert.ok(Math.abs(sh[0].len - yDup.len) < 5, name + ': дължината на общата отсечка');
  assert.ok(Math.abs(gs.len - (sum + yDup.len)) < 60, name + ': дължината включва общата отсечка веднъж');
  // Непрекъснато: съседните точки са близо навсякъде.
  for (var i = 1; i < gs.pts.length; i++) assert.ok(U.hav(gs.pts[i - 1][0], gs.pts[i - 1][1], gs.pts[i][0], gs.pts[i][1]) <= 30, name + ': скок при точка ' + i);
  // Посоката: първата точка на общата отсечка е при края на предишната част.
  var prevPart = gs.items[gs.items.indexOf(sh[0]) - 1];
  var e = prevPart.pts[prevPart.pts.length - 1], f = sh[0].pts[0], l = sh[0].pts[sh[0].pts.length - 1];
  assert.ok(U.hav(e[0], e[1], f[0], f[1]) < U.hav(e[0], e[1], l[0], l[1]), name + ': посоката на общата отсечка');
}
checkShared('един трак', [P(y1), P(y2)], 'Y');
checkShared('един трак, обратно', [P(y2, true), P(y1, true)], 'Y');
checkShared('два трака', [P(y1), P(zp)], 'Y');
checkShared('два трака, обратно', [P(zp, true), P(y1, true)], 'Y');
console.log('OK', U.num(1180), U.km(17040), U.pct(8.44));
