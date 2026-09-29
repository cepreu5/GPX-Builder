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
// А се дели на две части там, където Б се отделя от него (точка на прекъсване).
assert.deepStrictEqual(r.byTrack.A.map(function (s) { return s.kind; }), ['part', 'part']);
var bEnd = Core.pointAt(B, r.byTrack.B[0].b);
assert.ok(r.junctions.some(function (j) { return U.hav(j.lat, j.lon, bEnd[0], bEnd[1]) < 30 && j.branches.length === 3; }), 'точка на прекъсване там, където Б се отделя от А');
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
// Точки на прекъсване: там, където Y се събира с X, и там, където се дели (край на X, начало на Z).
var J1 = Core.pointAt(Y, yDup.a), J2 = Core.pointAt(Y, yDup.b);
function jAt(res, q) { return res.junctions.filter(function (j) { return U.hav(j.lat, j.lon, q[0], q[1]) < 30; })[0]; }
var j1 = jAt(rs, J1), j2 = jAt(rs, J2);
console.log('junctions', rs.junctions.map(function (j) { return j.key + ' ' + j.branches.map(function (b) { return b.trackId + b.from; }).join(','); }));
assert.ok(j1 && j2, 'пръстен на двете места');
assert.deepStrictEqual(j1.branches.map(function (b) { return b.trackId + b.from; }).sort(), ['Xa', 'Xb', 'Yb'], 'при събирането: X на запад, X на изток, Y отгоре');
assert.deepStrictEqual(j2.branches.map(function (b) { return b.trackId + b.from; }).sort(), ['Ya', 'Za', 'Xb'].sort(), 'при деленето: X, Y нататък, Z');
assert.strictEqual(rs.byTrack.X.filter(function (s) { return s.kind === 'part'; }).length, 2, 'X е разделен при събирането');
// Кръстовище без обща отсечка: два трака само се пресичат.
var H = { id: 'H', pts: line(42.8, 24.70, 42.8, 24.72, 80) }, V = { id: 'V', pts: line(42.79, 24.71, 42.81, 24.71, 80) };
var rx = Core.analyze([H, V], 20);
console.log('cross', rx.junctions.map(function (j) { return j.key + ' ' + j.branches.length; }));
assert.strictEqual(rx.junctions.length, 1, 'едно кръстовище');
assert.ok(U.hav(rx.junctions[0].lat, rx.junctions[0].lon, 42.8, 24.71) < 5, 'кръстовището е в пресечната точка');
assert.strictEqual(rx.junctions[0].branches.length, 4, 'четири клона');
assert.strictEqual(rx.parts.length, 4, 'всеки трак се дели на две части');
assert.strictEqual(rx.dups.length, 0);
checkShared('един трак', [P(y1), P(y2)], 'Y');
checkShared('един трак, обратно', [P(y2, true), P(y1, true)], 'Y');
checkShared('два трака', [P(y1), P(zp)], 'Y');
checkShared('два трака, обратно', [P(zp, true), P(y1, true)], 'Y');
console.log('OK', U.num(1180), U.km(17040), U.pct(8.44));
// Смяна на посоката в точката на деленето: маршрутът Y1 -> Z минава през общата отсечка;
// изборът на Y нататък сменя геометрията след точката, а новият избор на Z връща старото.
var zAll = rs.parts.filter(function (s) { return s.trackId === 'Z'; })[0];
var route = { items: [P(y1), P(zAll)] };
function geoOf() { return Core.routeGeometry(route, byS, rs); }
function forkAt(geo, q) { return Core.routeForks(geo, rs.junctions, 20, byS).filter(function (f) { return U.hav(f.j.lat, f.j.lon, q[0], q[1]) < 30; })[0]; }
var g0 = geoOf(), f2 = forkAt(g0, J2), f1 = forkAt(g0, J1);
assert.ok(f1 && f2, 'маршрутът минава през двете точки');
assert.strictEqual(f2.j.branches[f2.chosen].trackId, 'Z', 'при деленето: продължава по Z');
assert.strictEqual(f1.j.branches[f1.chosen].trackId, 'X', 'при събирането: продължава по общата отсечка (X на изток)');
assert.strictEqual(f1.j.branches[f1.incoming].trackId, 'Y', 'при събирането: идва от Y');
var yBr = f2.j.branches.filter(function (b) { return b.trackId === 'Y'; })[0];
Core.switchFork(route, f2, yBr, byS, 20);
var g1 = geoOf(), end1 = g1.pts[g1.pts.length - 1];
console.log('switch -> Y', route.items.map(function (i) { return i.trackId + Math.round(i.a); }), Math.round(g1.len), 'forks', JSON.stringify(route.forks).length);
assert.deepStrictEqual(route.items.map(function (i) { return i.trackId; }), ['Y', 'Y']);
assert.ok(U.hav(end1[0], end1[1], Y.pts[Y.pts.length - 1][0], Y.pts[Y.pts.length - 1][1]) < 5, 'след смяната маршрутът свършва в края на Y');
assert.strictEqual(g1.gaps.length, 0);
assert.strictEqual(forkAt(g1, J2).j.branches[forkAt(g1, J2).chosen].trackId, 'Y', 'изборът при деленето вече е Y');
var zBr = f2.j.branches.filter(function (b) { return b.trackId === 'Z'; })[0];
Core.switchFork(route, forkAt(g1, J2), zBr, byS, 20);
assert.deepStrictEqual(route.items.map(function (i) { return i.trackId; }), ['Y', 'Z'], 'обратно на Z');
assert.strictEqual(route.forks.length, 1);
assert.strictEqual(route.forks[0].alts.length, 2, 'пазят се и двете продължения');
// Смяна при събирането: на запад по X.
var xw = f1.j.branches.filter(function (b) { return b.trackId === 'X' && b.from === 'b'; })[0];
Core.switchFork(route, forkAt(geoOf(), J1), xw, byS, 20);
var g2 = geoOf(), e2 = g2.pts[g2.pts.length - 1];
assert.deepStrictEqual(route.items.map(function (i) { return i.trackId + (i.rev ? '<' : '>'); }), ['Y>', 'X<']);
assert.ok(U.hav(e2[0], e2[1], X.pts[0][0], X.pts[0][1]) < 5 && g2.gaps.length === 0 && !g2.items.some(function (x) { return x.shared; }), 'на запад: без обща отсечка, до началото на X');
console.log('forks OK');
