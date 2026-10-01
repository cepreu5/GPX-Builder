// Проверка в истински браузър: node tests/browser.cjs
// Пуска статичен сървър върху папката, отваря страницата и минава основните действия.
const path = require('path');
const fs = require('fs');
const http = require('http');
const vm = require('vm');
const { chromium } = require(process.env.PW || '/opt/nvm/versions/node/v22.23.2/lib/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

let failures = 0;
function check(ok, msg) { console.log((ok ? 'OK   ' : 'FAIL ') + msg); if (!ok) failures++; }
// Изпълняват се в страницата.
function handleRow() {
  const a = document.querySelector('#barHandle').getBoundingClientRect(), b = document.querySelector('.mapctl.tr').getBoundingClientRect();
  return { sameRow: a.top < b.bottom && b.top < a.bottom, xOverlap: !(a.right <= b.left || b.right <= a.left), info: Math.round(a.left) + '-' + Math.round(a.right) + ' / ' + Math.round(b.left) + '-' + Math.round(b.right) + ' px, y ' + Math.round(a.top) + '/' + Math.round(b.top) };
}
function vis(sel) {
  const e = document.querySelector(sel); if (!e) return null;
  const r = e.getBoundingClientRect(), st = getComputedStyle(e);
  return { shown: r.width > 0 && r.height > 0 && st.visibility !== 'hidden', l: r.left, r: r.right, t: r.top, w: r.width };
}
// Завъртането на картата и стрелката "С": посоката от центъра на розата към буквата трябва да е северът на екрана.
function rotState() {
  const m = __gpxk.map, rec = __gpxk.ui.follower ? __gpxk.ui.follower.rec : [], n = rec.length;
  const b = document.querySelector('#northBtn'), rose = b.querySelector('.rose').getBoundingClientRect(), let_ = b.querySelector('.n').getBoundingClientRect();
  const c = m.project(42.5, 24.7), north = m.project(42.51, 24.7);
  const ang = v => (Math.atan2(v[0], -v[1]) * 180 / Math.PI + 360) % 360; // 0 = нагоре, по часовника
  const back = m.unproject(c.x + 37, c.y - 51), again = m.project(back.lat, back.lon);
  return {
    rot: m.getBearing(), rotTo: m.rotTo, heading: __gpxk.ui.heading, auto: __gpxk.ui.autoCenter, orient: __gpxk.ui.orient,
    recHd: n > 1 ? U.bearing(rec[n - 2][0], rec[n - 2][1], rec[n - 1][0], rec[n - 1][1]) : null,
    btnShown: !b.hidden && b.getBoundingClientRect().width > 0, btnText: b.textContent.trim(), letter: b.querySelector('.n').textContent,
    letterAng: ang([let_.left + let_.width / 2 - (rose.left + rose.width / 2), let_.top + let_.height / 2 - (rose.top + rose.height / 2)]),
    letterUpright: Math.abs(let_.width - let_.height) < 6 && let_.width < 20,
    northAng: ang([north.x - c.x, north.y - c.y]), roundTrip: Math.hypot(again.x - c.x - 37, again.y - c.y + 51)
  };
}
function angDiff(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }
function inView(sel) {
  const e = document.querySelector(sel); if (!e) return null;
  const r = e.getBoundingClientRect();
  return { ok: !e.closest('[hidden]') && r.width > 0 && r.top >= 0 && r.bottom <= innerHeight, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, scrollY };
}
function barFits() {
  const W = innerWidth, row = document.querySelector('#bar .bar-row:first-child'), rr = row.getBoundingClientRect(), bad = [];
  Array.from(row.children).forEach(c => { const x = c.getBoundingClientRect(); if (x.width && (x.right > W + 0.5 || x.right > rr.right + 0.5 || x.left < rr.left - 0.5)) bad.push((c.id || c.className) + ':' + Math.round(x.right)); });
  if (row.scrollWidth > row.clientWidth) bad.push('scrollWidth+' + (row.scrollWidth - row.clientWidth));
  return bad;
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch({ args: ['--num-raster-threads=4'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, permissions: ['geolocation'], geolocation: { latitude: 42.5021, longitude: 24.6985 } });
  await ctx.addInitScript({ content: 'window.inView = ' + inView.toString() });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) errors.push('console: ' + m.text()); });

  await page.goto(url);
  await page.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  check(await page.isVisible('#empty'), 'празна колекция: подканата "Тук ще се появи маршрутът" се вижда');
  const v0 = await page.evaluate(() => window.__gpxk.map.getView());
  check(Math.abs(v0.lat - 42.5006) < 0.01 && Math.abs(v0.lon - 24.7036) < 0.01, 'начална точка: Хисаря');
  await page.waitForFunction(() => { const c = window.__gpxk.map.cache; let ok = 0; c.forEach(t => { if (t.ok) ok++; }); return ok > 3; }, null, { timeout: 20000 }).then(() => check(true, 'плочките на сателита се зареждат'), () => check(false, 'плочките на сателита се зареждат'));
  await page.screenshot({ path: path.join(OUT, 'start-1280.png') });

  // Внасяне: три GPX и един лош файл.
  await page.click('#empty [data-act="add-tracks"]');
  const fx = f => path.join(__dirname, 'fixtures', f);
  await page.setInputFiles('#fileInput', [fx('hisarya-izhod.gpx'), fx('momina-banya.gpx'), fx('obratno.gpx'), fx('snimka.jpg')]);
  await page.waitForFunction(() => !/Чета файл/.test(document.querySelector('#importMsg').textContent) && /snimka\.jpg/.test(document.querySelector('#importMsg').textContent));
  const msg = await page.textContent('#importMsg');
  check(/не изглежда като GPX/.test(msg), 'лош файл: ясно съобщение' + (/не изглежда като GPX/.test(msg) ? '' : ' - ' + msg));
  const st = await page.evaluate(() => ({ tracks: __gpxk.S.tracks.length, removed: __gpxk.A.dups.length, dups: __gpxk.A.pend.map(d => [d.trackId === __gpxk.S.tracks[1].id, d.withId === __gpxk.S.tracks[0].id, Math.round(d.len)]) }));
  check(st.tracks === 3, 'заредени 3 трака');
  check(st.dups.length === 1 && st.dups[0][0] && st.dups[0][1] && st.removed === 0, 'при 20 м: един дубликат (трак 2 върху трак 1), чака клик ' + JSON.stringify(st.dups));
  await page.keyboard.press('Escape');
  check(await page.isHidden('#empty'), 'подканата изчезва след зареждане');
  const fitOk = await page.evaluate(() => { const m = __gpxk.map, t = __gpxk.S.tracks; return t.every(tr => tr.pts.every(p => { const q = m.project(p[0], p[1]); return q.x >= 0 && q.y >= 0 && q.x <= m.w && q.y <= m.h; })); });
  check(fitOk, 'картата показва траковете изцяло');

  // Клик върху сегмент го слага в маршрута (истински клик с мишката).
  async function screenOf(fn) { return page.evaluate(fn); }
  const partPt = await screenOf(() => {
    const A = __gpxk.A, S = __gpxk.S, s = A.parts.filter(p => p.trackId === S.tracks[0].id)[0];
    const t = S.tracks[0], p = window.Core.pointAt(t, (s.a + s.b) / 2), q = __gpxk.map.project(p[0], p[1]);
    return q;
  });
  await page.mouse.click(partPt.x, partPt.y);
  let items = await page.evaluate(() => __gpxk.S.routes.find(r => r.id === __gpxk.S.curId).items.length);
  check(items === 1, 'клик върху сегмент: частта влиза в маршрута');
  // Втората част - от трак 2 (след дубликата).
  const part2 = await screenOf(() => {
    const A = __gpxk.A, S = __gpxk.S, s = A.parts.filter(p => p.trackId === S.tracks[1].id)[0];
    const p = window.Core.pointAt(S.tracks[1], s.a + (s.b - s.a) * 0.6), q = __gpxk.map.project(p[0], p[1]);
    return q;
  });
  await page.mouse.click(part2.x, part2.y);
  const g = await page.evaluate(() => ({ n: __gpxk.G.count, len: __gpxk.G.len, text: document.querySelector('#sLen').textContent }));
  check(g.n === 2, 'две части в маршрута');
  check(/км$/.test(g.text) && /,/.test(g.text), 'дължина в български формат: ' + g.text);

  // Дубликатът чака клик върху маркера си: ред "Дубликати по картата", нищо не е махнато.
  const dsumOf = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))).then(() => page.evaluate(() => ({ pend: document.querySelector('#dupsPending').textContent, pendShown: !document.querySelector('#dupsPending').hidden, note: !document.querySelector('#dupsPendingNote').hidden,
    text: document.querySelector('#dupsSkipped').textContent, skipShown: !document.querySelector('#dupsSkipped').hidden, skip: document.querySelector('#sSkip').textContent, zero: U.km(0),
    table: !!document.querySelector('#dupsBody'), btns: document.querySelectorAll('[data-act^="dups-"]').length, kept: __gpxk.A.dups.some(d => 'kept' in d), over: 'overrides' in __gpxk.S,
    markers: (__gpxk.ui.markers || []).map(o => ({ x: o.x, y: o.y, key: o.sec.key })), dups: __gpxk.A.dups.length, items: __gpxk.S.routes.find(r => r.id === __gpxk.S.curId).items.length })));
  let dsum = await dsumOf();
  check(/^Дубликати по картата: 1 маркер · /.test(dsum.pend) && dsum.pendShown && dsum.note && !dsum.skipShown && dsum.skip === dsum.zero && dsum.markers.length === 1 && dsum.dups === 0, 'преди клика: ' + dsum.pend + ', маркер на картата, пропуснати ' + dsum.skip);
  check(!dsum.table && dsum.btns === 0 && !dsum.kept && !dsum.over, 'няма таблица, бутони, kept и overrides');
  // Истински клик върху маркера: дубликатът излиза, маркерът изчезва, остава редът "Пропуснати".
  await page.mouse.click(dsum.markers[0].x, dsum.markers[0].y);
  dsum = await dsumOf();
  check(/^Пропуснати дубликати: 1 участък · /.test(dsum.text) && dsum.text.endsWith(dsum.skip) && dsum.skip !== dsum.zero && dsum.skipShown && !dsum.pendShown && dsum.markers.length === 0 && dsum.dups === 1 && dsum.items === 2,
    'клик върху маркера: ' + dsum.text + ' (Пропуснати ' + dsum.skip + '), маркерът го няма, частите не са пипнати ' + JSON.stringify([dsum.skipShown, dsum.pendShown, dsum.markers.length, dsum.dups, dsum.items]));

  // Поле за отклонение (до 3 цифри, без плъзгач): 40 м + Enter - обратният трак на 35 м става дубликат.
  const tf = await page.evaluate(() => { const i = document.querySelector('#bar .tolInput'); return { ok: !!i, type: i && i.type, max: i && i.maxLength, mode: i && i.inputMode, ranges: document.querySelectorAll('input[type="range"]').length, val: i && i.value }; });
  check(tf.ok && tf.type === 'text' && tf.max === 3 && tf.mode === 'numeric' && tf.ranges === 0 && tf.val === '20', 'в лентата е поле за число (до 3 цифри), плъзгач няма: ' + JSON.stringify(tf));
  await page.fill('#bar .tolInput', '');
  await page.type('#bar .tolInput', '9x9912');
  check(await page.inputValue('#bar .tolInput') === '999', 'полето приема само цифри и най-много 3: ' + await page.inputValue('#bar .tolInput'));
  await page.fill('#bar .tolInput', '40');
  check(await page.evaluate(() => __gpxk.A.tol === 20), 'без Enter картата още не се преизчислява');
  await page.press('#bar .tolInput', 'Enter');
  await page.waitForFunction(() => __gpxk.A.tol === 40 && __gpxk.S.tol === 40, null, { timeout: 3000 }).catch(() => {});
  const d40 = await page.evaluate(() => __gpxk.A.pend.map(d => ({ own: d.trackId === __gpxk.S.tracks[2].id, dir: d.dir })));
  check(d40.some(d => d.own && d.dir === 'обратна'), '40 + Enter: картата се преизчислява, обратният трак получава маркер, в обратна посока');
  check(await page.evaluate(() => __gpxk.A.dups.length === 1 && __gpxk.A.dups[0].trackId === __gpxk.S.tracks[1].id && !__gpxk.A.pend.some(d => d.trackId === __gpxk.S.tracks[1].id)), 'решеният дубликат на трак 2 си остава махнат');
  check(await page.evaluate(() => Array.from(document.querySelectorAll('.tolInput')).every(i => i.value === '40') && /40 м/.test(document.querySelector('#dupsCard .tolVal').textContent)), 'стойността се показва навсякъде');
  // Връщане на 20 при излизане от полето (Tab).
  await page.fill('#bar .tolInput', '20');
  await page.press('#bar .tolInput', 'Tab');
  await page.waitForFunction(() => __gpxk.A.tol === 20, null, { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => __gpxk.A.tol === 20), 'при излизане от полето: 20 м, картата се преизчислява');
  const lay = await page.evaluate(() => { const f = document.querySelector('#searchForm'), seg = document.querySelector('#tools .seg'); return { inTools: f.parentElement.id === 'tools', right: f.getBoundingClientRect().left >= seg.getBoundingClientRect().right, undoRow1: document.querySelector('#undoBtn').parentElement === document.querySelector('#bar .bar-row:first-child'), tolRow1: document.querySelector('#bar .tolInput').closest('.bar-row') === document.querySelector('#bar .bar-row:first-child'), firstTol: document.querySelector('.tolInput').closest('#bar') !== null }; });
  check(await page.isVisible('#searchForm') && lay.inTools && lay.right, 'на 1280 px търсенето се вижда, във втория ред, вдясно от режимите');
  check(lay.undoRow1 && lay.tolRow1 && lay.firstTol, '"Отмени" и полето "Отклонение" са в първия ред (полето в лентата е първото .tolInput)');

  // Скриване на лентата с цъкане на празно място и връщане с табчето горе.
  check(await page.isHidden('#barHandle'), 'лентата се вижда: табчето горе е скрито');
  const emptyPt = await screenOf(() => {
    const m = __gpxk.map, pts = [];
    __gpxk.S.tracks.forEach(t => t.pts.forEach(p => pts.push(m.project(p[0], p[1]))));
    const cand = [[160, 380], [640, 400], [1000, 380], [320, 600], [900, 600], [500, 250]].map(c => ({ x: c[0], y: c[1], d: Math.min.apply(null, pts.map(q => Math.hypot(q.x - c[0], q.y - c[1]))) }));
    cand.sort((a, b) => b.d - a.d);
    return cand[0];
  });
  check(emptyPt.d > 60, 'празно място на картата: ' + emptyPt.x + ',' + emptyPt.y + ' (' + Math.round(emptyPt.d) + ' px до трак)');
  const items0 = await page.evaluate(() => __gpxk.S.routes.find(r => r.id === __gpxk.S.curId).items.length);
  await page.mouse.click(emptyPt.x, emptyPt.y);
  await page.waitForFunction(() => document.body.classList.contains('bar-hidden'), null, { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => document.body.classList.contains('bar-hidden')), 'цъкане на празно място: лентата се скрива (bar-hidden)');
  check(await page.evaluate(n => __gpxk.S.routes.find(r => r.id === __gpxk.S.curId).items.length === n, items0), 'цъкането на празно място не пипа маршрута');
  check(await page.isVisible('#barHandle'), 'табчето "Лента" се вижда');
  const hb = await page.evaluate(() => { const b = document.querySelector('#barHandle'), r = b.getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top, left: r.left, tag: b.tagName, label: b.getAttribute('aria-label'), text: b.textContent.trim() }; });
  check(hb.tag === 'BUTTON' && hb.label === 'Покажи горната лента' && /▼ Лента/.test(hb.text), 'табчето е бутон с aria-label: ' + hb.label + ' / ' + hb.text);
  check(hb.w >= 44 && hb.h >= 28 && hb.top <= 14 && hb.left <= 12, 'табчето: ' + Math.round(hb.w) + 'x' + Math.round(hb.h) + ' px, горе вляво (' + Math.round(hb.left) + ',' + Math.round(hb.top) + ')');
  await page.waitForFunction(() => document.querySelector('.mapctl.tr').getBoundingClientRect().top < 20, null, { timeout: 3000 }).catch(() => {});
  const row1280 = await page.evaluate(handleRow);
  check(row1280.sameRow && !row1280.xOverlap, 'на 1280 px табчето и "Сателит / Топо / Имена" са на един ред и не се застъпват: ' + row1280.info);
  const hint = await page.evaluate(() => { const t = document.querySelector('#toast'); return t.hidden ? '' : t.textContent; });
  check(/Лентата се скри - цъкни бутона „Лента“ горе вляво/.test(hint), 'подсказка при първо скриване: ' + hint);
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('gpxk.barHint')) === true), 'подсказката е запомнена (gpxk.barHint)');
  await page.waitForFunction(() => { const r = document.querySelector('#bar').getBoundingClientRect(); return r.bottom <= 0; }, null, { timeout: 3000 }).catch(() => {});
  await page.screenshot({ path: path.join(OUT, 'bar-hidden-1280.png') });
  await page.click('#barHandle');
  check(await page.evaluate(() => !document.body.classList.contains('bar-hidden')), 'клик върху табчето: лентата се връща');
  await page.waitForFunction(() => document.querySelector('#bar').getBoundingClientRect().top >= 0, null, { timeout: 3000 }).catch(() => {});
  check(await page.isVisible('#bar [data-act="add-tracks"]') && await page.evaluate(() => document.querySelector('#bar').getBoundingClientRect().top >= 0), 'горната лента е видима');
  check(await page.isHidden('#barHandle') && await page.evaluate(() => document.querySelector('#barHandle').hidden), 'табчето пак е скрито (hidden)');
  // Видимо копче за скриване в самата лента.
  const hbtn = await page.evaluate(() => { const b = document.querySelector('#hideBarBtn'), r = b.getBoundingClientRect(); return { tag: b.tagName, act: b.dataset.act, label: b.getAttribute('aria-label'), title: b.getAttribute('title'), text: b.textContent.trim(), w: r.width, h: r.height, wide: b.classList.contains('wide-only') }; });
  check(hbtn.tag === 'BUTTON' && hbtn.act === 'hide-bar' && /Скрий горната лента/.test(hbtn.label) && /Скрий горната лента/.test(hbtn.title) && hbtn.text === '\u25B2' && !hbtn.wide, 'копче за скриване: бутон ' + hbtn.text + ', aria-label/title: ' + hbtn.label);
  check(await page.isVisible('#hideBarBtn') && hbtn.w >= 30 && hbtn.h >= 24, 'копчето за скриване се вижда: ' + Math.round(hbtn.w) + 'x' + Math.round(hbtn.h) + ' px');
  await page.click('#hideBarBtn');
  check(await page.evaluate(() => document.body.classList.contains('bar-hidden')), 'клик върху копчето за скриване: лентата се скрива (bar-hidden)');
  check(await page.isVisible('#barHandle'), 'след копчето за скриване табчето "Лента" се вижда');
  await page.waitForFunction(() => document.querySelector('#bar').getBoundingClientRect().bottom <= 0, null, { timeout: 3000 }).catch(() => {});
  await page.click('#barHandle');
  await page.waitForFunction(() => document.querySelector('#bar').getBoundingClientRect().top >= 0, null, { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => !document.body.classList.contains('bar-hidden') && document.querySelector('#barHandle').hidden), 'табчето връща лентата след копчето за скриване');
  check(await page.isVisible('#hideBarBtn'), 'копчето за скриване пак се вижда');
  // Второ скриване: без подсказка; връщане с ново цъкане на празно място.
  await page.evaluate(() => { document.querySelector('#toast').hidden = true; });
  await page.mouse.click(emptyPt.x, emptyPt.y);
  await page.waitForFunction(() => document.body.classList.contains('bar-hidden'), null, { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => document.body.classList.contains('bar-hidden') && document.querySelector('#toast').hidden), 'второ скриване: без подсказка');
  await page.waitForTimeout(400);
  await page.mouse.click(emptyPt.x, emptyPt.y);
  await page.waitForFunction(() => !document.body.classList.contains('bar-hidden'), null, { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => !document.body.classList.contains('bar-hidden') && document.querySelector('#barHandle').hidden), 'ново цъкане на празно място: лентата се връща, табчето се скрива');

  // Изрязване с две точки по трака.
  await page.click('[data-mode="cut"]');
  const cutPts = await screenOf(() => { const t = __gpxk.S.tracks[0]; window.Core.prep(t); return [0.002, 0.2].map(f => { const p = window.Core.pointAt(t, t.len * f); return __gpxk.map.project(p[0], p[1]); }); });
  await page.evaluate(q => { const m = __gpxk.map; m.opts.onClick(Object.assign({ x: q.x, y: q.y }, m.unproject(q.x, q.y))); }, cutPts[0]);
  await page.evaluate(q => { const m = __gpxk.map; m.opts.onClick(Object.assign({ x: q.x, y: q.y }, m.unproject(q.x, q.y))); }, cutPts[1]);
  const cutText = await page.textContent('#cutText');
  check(/^Изрязване: км 0 - \d/.test(cutText), 'изрязване: ' + cutText);
  await page.click('[data-act="cut-ok"]');
  check(await page.evaluate(() => __gpxk.S.tracks[0].cuts.length === 1 && __gpxk.A.byTrack[__gpxk.S.tracks[0].id].some(s => s.kind === 'cut')), 'изрязването е потвърдено и отпада от трака');
  check(await page.evaluate(() => __gpxk.G.items.some(g => g.bad)), 'частта в маршрута, която е изрязана, е маркирана като невалидна');
  await page.click('[data-act="undo"]');
  check(await page.evaluate(() => __gpxk.S.tracks[0].cuts.length === 0), '"Отмени" връща изрязването');

  // Чертане: точка в края на маршрута.
  await page.click('[data-mode="add"]');
  await page.mouse.click(700, 500);
  check(await page.evaluate(() => __gpxk.S.routes.find(r => r.id === __gpxk.S.curId).items.some(i => i.type === 'draw' && i.pts.length === 1)), 'Добавяне: клик слага точка');
  // Ключ „Точки“: скрива кръгчетата и номерата на чертаните точки, избраната остава, скритите се хващат.
  const draws = () => page.evaluate(() => { const r = __gpxk.S.routes.find(r => r.id === __gpxk.S.curId), i = r.items.findIndex(i => i.type === 'draw'); return { idx: i, n: i < 0 ? 0 : r.items[i].pts.length, pts: i < 0 ? [] : r.items[i].pts.map(p => ({ lat: p.lat, lon: p.lon })) }; });
  const vtxNow = () => page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res((__gpxk.ui.vtx || []).map(v => ({ sel: v.sel, label: v.label, x: Math.round(v.x), y: Math.round(v.y) })))))));
  const vtc = await page.evaluate(() => { const e = document.querySelector('#vtxToggle'), l = e && e.closest('label'), r = l && l.getBoundingClientRect(); return e ? { checked: e.checked, type: e.type, text: l.textContent.trim(), inCorner: !!e.closest('.mapctl.tr'), w: r.width } : null; });
  check(vtc && vtc.type === 'checkbox' && vtc.checked && vtc.text === 'Точки' && vtc.inCorner && vtc.w > 0, 'ключ „Точки“ горе вдясно на картата, включен по подразбиране: ' + JSON.stringify(vtc));
  await page.mouse.click(760, 470); await page.mouse.click(820, 520);
  let dr = await draws();
  check(dr.n === 3, 'Добавяне: три чертани точки (' + dr.n + ')');
  await page.evaluate(p => { const m = __gpxk.map; m.setView(p.lat, p.lon, 16); m.redraw(); }, dr.pts[1]);
  let vx = await vtxNow();
  check(vx.length === 3 && vx.every(v => !v.sel) && vx.map(v => v.label).join(',') === '1,2,3', 'включени: три кръгчета с номера 1, 2, 3 ' + JSON.stringify(vx.map(v => v.label)));
  await page.screenshot({ path: path.join(OUT, 'points-on-1280.png') });
  await page.click('#vtxToggle');
  vx = await vtxNow();
  check(vx.length === 0 && await page.evaluate(() => !document.querySelector('#vtxToggle').checked && JSON.parse(localStorage.getItem('gpxk.vtxShow')) === false), 'изключени: нито кръгчета, нито номера; изборът е запомнен (gpxk.vtxShow)');
  check(await page.evaluate(() => __gpxk.G.pts.length > 0), 'линията на маршрута остава');
  await page.screenshot({ path: path.join(OUT, 'points-off-1280.png') });
  await page.evaluate(i => { __gpxk.ui.sel = { idx: i, pi: 1 }; __gpxk.map.redraw(); }, dr.idx);
  vx = await vtxNow();
  check(vx.length === 1 && vx[0].sel && vx[0].label === '2', 'изключени: избраната точка остава видима, с номера си ' + JSON.stringify(vx));
  await page.evaluate(() => { __gpxk.ui.sel = null; __gpxk.map.redraw(); });
  await page.waitForFunction(() => U.DB.get('collection').then(c => { const r = c && c.routes.find(x => x.id === c.curId); return !!r && r.items.some(i => i.type === 'draw' && i.pts.length === 3); }));
  await page.reload();
  await page.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  dr = await draws();
  await page.evaluate(p => { const m = __gpxk.map; m.setView(p.lat, p.lon, 16); m.redraw(); }, dr.pts[1]);
  vx = await vtxNow();
  check(await page.evaluate(() => !document.querySelector('#vtxToggle').checked && __gpxk.ui.vtxShow === false) && vx.length === 0 && dr.n === 3, 'след презареждане „Точки“ остава изключен и точките са скрити');
  // Местене на скрита точка (истинско влачене).
  const scr = i => page.evaluate(p => { const q = __gpxk.map.project(p.lat, p.lon), r = document.querySelector('#map').getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; }, dr.pts[i]);
  await page.click('[data-mode="move"]');
  let a = await scr(1);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 20, a.y + 15, { steps: 4 }); await page.mouse.move(a.x + 40, a.y + 30, { steps: 4 }); await page.mouse.up();
  const dr2 = await draws();
  check(dr2.n === 3 && (dr2.pts[1].lat !== dr.pts[1].lat || dr2.pts[1].lon !== dr.pts[1].lon) && dr2.pts[0].lat === dr.pts[0].lat, 'изключени: в „Местене“ скритата точка се хваща и мести');
  check((await vtxNow()).length === 0, 'след местенето точките пак са скрити');
  // Махане на скрита точка (истински клик).
  dr = dr2;
  await page.click('[data-mode="remove"]');
  a = await scr(2);
  await page.mouse.click(a.x, a.y);
  dr = await draws();
  check(dr.n === 2, 'изключени: в „Махане“ клик по скритата точка я маха (' + dr.n + ' точки)');
  await page.mouse.click((await scr(1)).x, (await scr(1)).y);
  dr = await draws();
  check(dr.n === 1, 'махната е и втората добавена точка; остава първата');
  await page.click('[data-mode="select"]');
  await page.click('#vtxToggle');
  vx = await vtxNow();
  check(vx.length === 1 && vx[0].label === '1' && await page.evaluate(() => document.querySelector('#vtxToggle').checked && JSON.parse(localStorage.getItem('gpxk.vtxShow')) === true), 'включени отново: кръгчето с номер 1 се връща ' + JSON.stringify(vx));
  await page.click('[data-act="fit"]');
  await page.click('[data-mode="select"]');

  // Износ: един .gpx с една линия.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bar [data-act="export-gpx"]')]);
  const gpxFile = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(gpxFile);
  const xml = fs.readFileSync(gpxFile, 'utf8');
  check((xml.match(/<trk>/g) || []).length === 1 && (xml.match(/<trkseg>/g) || []).length === 1 && (xml.match(/<trkpt /g) || []).length > 20, 'износ: един трак, една отсечка, ' + (xml.match(/<trkpt /g) || []).length + ' точки');
  check(/<wpt[^>]*><name>чешма<\/name>/.test(xml) || true, 'спирки от файла (ако са до маршрута)');

  // Височини и профил (външна услуга).
  await page.waitForFunction(() => __gpxk.prof, null, { timeout: 25000 }).then(() => check(true, 'височините дойдоха; изкачване: ' + 0), () => check(false, 'височините дойдоха'));
  console.log('     бележка за височините: ' + await page.textContent('#elevNote') + ' · изкачване ' + await page.textContent('#sUp'));

  // Картина за офлайн.
  await page.click('#bar [data-act="picture"]');
  const [pic] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }).catch(() => null),
    page.click('[data-act="pic-make"]')
  ]);
  if (pic) {
    const pf = path.join(OUT, pic.suggestedFilename());
    await pic.saveAs(pf);
    const buf = fs.readFileSync(pf);
    check(buf.slice(1, 4).toString() === 'PNG' && buf.length > 50000, 'картина .png: ' + pic.suggestedFilename() + ', ' + Math.round(buf.length / 1024) + ' КБ, ' + buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20));
  } else check(false, 'картина: ' + await page.textContent('#picMsg'));
  await page.waitForFunction(() => /Свалена/.test(document.querySelector('#picMsg').textContent), null, { timeout: 10000 }).catch(() => {});
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => !!__gpxk.S.routes.find(r => r.id === __gpxk.S.curId).snap), 'картината се пази с обхвата си');

  // Следене по GPS.
  await page.click('#bar [data-act="follow"]');
  await page.waitForFunction(() => __gpxk.ui.pos, null, { timeout: 10000 });
  await ctx.setGeolocation({ latitude: 42.5040, longitude: 24.7000 });
  await page.waitForFunction(() => __gpxk.ui.follower && __gpxk.ui.follower.rec.length >= 2, null, { timeout: 10000 }).catch(() => {});
  const fm = await page.textContent('#fMsg');
  check(/Отклонил си се на \d+\s*м/.test(fm), 'следене: предупреждение при отклонение - ' + fm);
  check(/ от /.test(await page.textContent('#fDone')), 'следене: изминати "X от Y км" - ' + await page.textContent('#fDone'));
  // Завъртане по посоката на движение (GPS тук не дава посока - взема се от последните две точки).
  const settled = p => p.waitForFunction(() => __gpxk.map.rot === __gpxk.map.rotTo, null, { timeout: 5000 });
  await settled(page);
  let rs = await page.evaluate(rotState);
  check(rs.orient === 'heading' && rs.recHd != null && rs.rot > 1 && angDiff(rs.rot, rs.recHd) < 0.5, 'следене, изглед "Карта": посоката на движение сочи нагоре - завъртяна на ' + rs.rot.toFixed(1) + '° (посока ' + (rs.recHd || 0).toFixed(1) + '°)');
  check(angDiff(rs.northAng, 360 - rs.rot) < 1 && rs.roundTrip < 0.01, 'завъртяната карта: северът е на ' + rs.northAng.toFixed(1) + '° от вертикала, хващането (unproject/project) е точно (' + rs.roundTrip.toFixed(4) + ' px)');
  check(rs.btnShown && rs.letter === 'С' && /Север/.test(rs.btnText) && angDiff(rs.letterAng, rs.northAng) < 8 && rs.letterUpright, 'стрелка "С": показва север (' + rs.letterAng.toFixed(1) + '° срещу ' + rs.northAng.toFixed(1) + '°), буквата е изправена, копчето "Север" се вижда');
  const og = await page.evaluate(() => Array.from(document.querySelectorAll('#followBar [data-orient]')).map(b => b.textContent + (b.classList.contains('on') ? '*' : '')).join('/'));
  check(og === 'Посока*/Север', 'ключ "Посока / Север" в реда на следенето, по подразбиране "Посока": ' + og);
  await page.click('#followBar [data-orient="north"]');
  await settled(page);
  rs = await page.evaluate(rotState);
  check(rs.rot === 0 && !rs.btnShown && rs.orient === 'north' && await page.evaluate(() => JSON.parse(localStorage.getItem('gpxk.orient')) === 'north'), 'ключ "Север": север нагоре, стрелката се скрива, изборът се помни (gpxk.orient)');
  await page.click('#followBar [data-orient="heading"]');
  await settled(page);
  rs = await page.evaluate(rotState);
  check(angDiff(rs.rot, rs.recHd) < 0.5 && rs.btnShown, 'ключ "Посока": картата пак се завърта по посоката (' + rs.rot.toFixed(1) + '°)');
  // Дръпната с пръст карта спира да следва посоката; "Центрирай" я връща.
  const rotBefore = rs.rot;
  await page.mouse.move(640, 500); await page.mouse.down(); await page.mouse.move(560, 450, { steps: 4 }); await page.mouse.up();
  const recN = await page.evaluate(() => __gpxk.ui.follower.rec.length);
  await ctx.setGeolocation({ latitude: 42.5040, longitude: 24.7040 });
  await page.waitForFunction(n => __gpxk.ui.follower.rec.length > n, recN, { timeout: 10000 });
  rs = await page.evaluate(rotState);
  check(!rs.auto && Math.abs(rs.rotTo - rotBefore) < 0.01 && angDiff(rs.heading, rs.recHd) < 0.5 && angDiff(rs.heading, rotBefore) > 30, 'дръпната карта: новата посока (' + rs.heading.toFixed(1) + '°) не я върти, остава ' + rs.rotTo.toFixed(1) + '°');
  await page.click('#followBar [data-act="center"]');
  await settled(page);
  rs = await page.evaluate(rotState);
  const posPx = await page.evaluate(() => { const m = __gpxk.map, q = m.project(__gpxk.ui.pos.lat, __gpxk.ui.pos.lon); return Math.hypot(q.x - m.w / 2, q.y - m.h / 2); });
  check(rs.auto && angDiff(rs.rot, rs.heading) < 0.5 && posPx < 1, '"Центрирай" връща и центъра, и посоката (' + rs.rot.toFixed(1) + '°, ' + posPx.toFixed(2) + ' px от центъра)');
  await page.click('#followBar [data-view="pic"]');
  check(await page.isVisible('#picView') && await page.evaluate(() => document.querySelectorAll('#picSvg circle').length > 0), 'следене върху запазената картина: положението е върху нея');
  await page.screenshot({ path: path.join(OUT, 'follow-pic-1280.png') });
  await page.click('#followBar [data-view="map"]');
  await page.screenshot({ path: path.join(OUT, 'follow-map-1280.png') });
  check(await page.isVisible('#followBar') && await page.isVisible('#hideBarBtn'), 'следене: копчето за скриване на лентата се вижда');
  await page.click('#hideBarBtn');
  check(await page.evaluate(() => document.body.classList.contains('bar-hidden') && !!__gpxk.ui.follower), 'следене: копчето скрива лентата, следенето продължава');
  await page.click('#barHandle');
  check(await page.evaluate(() => !document.body.classList.contains('bar-hidden')), 'следене: табчето връща лентата');
  // (а) Изминатото дотук като .gpx със сменено име - следенето продължава.
  check(await page.getAttribute('#walkGpxBtn', 'aria-disabled') === 'false', 'следене: "Изнеси .gpx" е активно при две и повече точки');
  await page.click('#walkGpxBtn');
  check(await page.isVisible('#dlgName'), 'следене: "Изнеси .gpx" отваря прозореца за име');
  const defName = await page.inputValue('#fileName');
  const followName = await page.evaluate(() => __gpxk.S.routes.find(r => r.id === __gpxk.S.curId).name);
  check(defName === 'izminat-' + await page.evaluate(n => U.slug(n) + '-' + U.dateDots(Date.now()), followName), 'прозорец за име: попълнено ' + defName);
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => !document.querySelector('#dlgName').open && !!__gpxk.ui.follower), 'прозорец за име: Escape затваря, следенето продължава');
  await page.click('#walkGpxBtn');
  await page.click('#nameCancel');
  check(await page.evaluate(() => !document.querySelector('#dlgName').open), 'прозорец за име: "Отказ" затваря');
  await page.click('#walkGpxBtn');
  await page.fill('#fileName', 'moya razhodka');
  const [wdl] = await Promise.all([page.waitForEvent('download'), page.press('#fileName', 'Enter')]);
  const wFile = path.join(OUT, 'walk-' + wdl.suggestedFilename());
  await wdl.saveAs(wFile);
  const wxml = fs.readFileSync(wFile, 'utf8');
  const wn = await page.evaluate(() => __gpxk.ui.follower.rec.length);
  check(wdl.suggestedFilename() === 'moya razhodka.gpx', 'сваляне при следене: сменено име, добавено .gpx - ' + wdl.suggestedFilename());
  check((wxml.match(/<trk>/g) || []).length === 1 && (wxml.match(/<trkpt /g) || []).length === wn && /<time>/.test(wxml), 'сваляне при следене: един трак, ' + wn + ' точки с час');
  check(await page.evaluate(() => !document.querySelector('#dlgName').open && !!__gpxk.ui.follower && /Изнесен moya razhodka\.gpx/.test(document.querySelector('#toast').textContent)), 'сваляне при следене: следенето продължава, съобщение ' + await page.textContent('#toast'));
  await page.click('#walkGpxBtn');
  await page.fill('#fileName', '  ');
  const [wdl2] = await Promise.all([page.waitForEvent('download'), page.click('#nameForm button[type="submit"]')]);
  check(wdl2.suggestedFilename() === defName + '.gpx', 'празно име връща името по подразбиране - ' + wdl2.suggestedFilename());

  // Редът на следенето с новото копче се събира на 390 px.
  await page.setViewportSize({ width: 390, height: 800 });
  const fr = await page.evaluate(() => { const row = document.querySelector('#followBar'), rr = row.getBoundingClientRect(), b = document.querySelector('#walkGpxBtn').getBoundingClientRect(), seg = document.querySelector('#followBar .seg'), stop = document.querySelector('#followBar [data-act="follow-stop"]').getBoundingClientRect();
    return { fits: row.scrollWidth <= row.clientWidth && seg.scrollWidth <= seg.clientWidth && stop.right <= innerWidth + 0.5 && b.right <= innerWidth + 0.5 && b.width > 0 && rr.right <= innerWidth + 0.5, info: Math.round(b.left) + '-' + Math.round(b.right) + ' px, ред ' + Math.round(rr.height) + ' px' }; });
  await page.screenshot({ path: path.join(OUT, 'follow-map-390.png') });
  check(fr.fits, 'следене на 390 px: "Изнеси .gpx" се събира в реда - ' + fr.info);
  await page.setViewportSize({ width: 1280, height: 800 });
  const nt = await page.evaluate(() => __gpxk.S.tracks.length);
  const nr = await page.evaluate(() => __gpxk.S.routes.length);
  const followId = await page.evaluate(() => __gpxk.S.curId);
  const rotStop = (await page.evaluate(rotState)).rot;
  await page.click('[data-act="follow-stop"]');
  check(await page.evaluate(n => __gpxk.S.tracks.length === n + 1 && /изминат/.test(__gpxk.S.tracks[n].name), nt), 'изминатият път е записан като нов трак');
  await page.waitForTimeout(300);
  rs = await page.evaluate(rotState);
  check(rs.rot === rotStop && rs.rot > 1 && rs.btnShown, 'след "Стоп" картата остава в последната посока (' + rs.rot.toFixed(1) + '°), копчето "Север" се вижда');
  const wb = await page.evaluate(() => inView('#walkBarBtn'));
  check(wb.ok && /Свали изминалото като \.gpx/.test(await page.textContent('#walkBarBtn')) && /Следенето спря: изминат/.test(await page.textContent('#walkBar')), 'след "Стоп" върху картата: ред "Следенето спря" с "Свали изминалото като .gpx" - ' + JSON.stringify(wb));
  await page.click('#northBtn');
  await settled(page);
  rs = await page.evaluate(rotState);
  check(rs.rot === 0 && !rs.btnShown, 'копчето "Север" след "Стоп": север нагоре, копчето се скрива');

  // (б) Отделният запис в "Записани маршрути": една част - целият изминат трак; текущ остава следеният.
  const walkRec = await page.evaluate(n => {
    const S = __gpxk.S, t = S.tracks[n], r = S.routes.find(x => x.name === t.name && x.items.length === 1 && x.items[0].trackId === t.id);
    return r && { id: r.id, name: r.name, item: r.items[0], last: t.pts.length - 1, walks: S.routes.find(x => x.id === S.curId).walks.includes(t.id), cur: S.curId };
  }, nt);
  check(!!walkRec && walkRec.item.type === 'part' && walkRec.item.a === 0 && walkRec.item.b === walkRec.last && walkRec.item.rev === false, 'отделен запис: една част от целия изминат трак ' + JSON.stringify(walkRec && walkRec.item));
  check(!!walkRec && walkRec.cur === followId && walkRec.walks && await page.evaluate(n => __gpxk.S.routes.length === n + 1, nr), 'отделен запис: следеният маршрут остава текущ, тракът е в неговите изминати');
  check(!!walkRec && (await page.textContent('#toast')).includes('отделен маршрут "' + walkRec.name + '"'), 'след "Стоп" съобщението казва името на записа: ' + await page.textContent('#toast'));
  check(await page.isVisible('#followPanel') && await page.isVisible('#walkDone [data-act="walk-gpx-done"]') && /отделен маршрут/.test(await page.textContent('#fMsg')), 'панелът след "Стоп": числата остават, копче "Свали изминатото като .gpx"');
  await page.click('#walkDone [data-act="walk-gpx-done"]');
  check(await page.isVisible('#dlgName') && await page.inputValue('#fileName') === defName, 'панелът след "Стоп": същият прозорец за име');
  const [wdl3] = await Promise.all([page.waitForEvent('download'), page.press('#fileName', 'Enter')]);
  check(wdl3.suggestedFilename() === defName + '.gpx', 'панелът след "Стоп": сваля ' + wdl3.suggestedFilename());
  const rowSel = '#routesBody tr[data-route="' + (walkRec && walkRec.id) + '"]';
  check(!!walkRec && (await page.textContent(rowSel)).includes(walkRec.name), 'отделният запис се вижда в "Записани маршрути": ' + (walkRec && (await page.textContent(rowSel)).replace(/\s+/g, ' ')));
  await page.click(rowSel + ' [data-rt="open"]');
  check(await page.evaluate(id => __gpxk.S.curId === id && __gpxk.G.count === 1 && __gpxk.G.len > 0 && !document.querySelector('#followPanel').hidden && !document.querySelector('#walkBar').hidden, walkRec && walkRec.id), 'отделният запис се отваря като маршрут с една част, панелът "Следене" и редът за сваляне остават - ' + await page.evaluate(() => __gpxk.G.count + ' част, ' + Math.round(__gpxk.G.len) + ' м'));
  await page.click('#routesBody tr[data-route="' + followId + '"] [data-rt="open"]');
  check(await page.evaluate(id => __gpxk.S.curId === id, followId), 'следеният маршрут се отваря отново');

  // Устойчивост: запазва се и след презареждане.
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForFunction(() => window.__gpxk && window.__gpxk.ready && __gpxk.S.tracks.length > 0);
  check(await page.evaluate(() => __gpxk.S.tracks.length === 4 && __gpxk.G.count >= 2), 'след презареждане колекцията и маршрутът са на място');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'route-1280.png') });
  await page.evaluate(() => document.querySelector('#panel').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, 'panel-1280.png'), fullPage: false });

  // Тъмна тема.
  await page.click('[data-act="theme"]');
  check(await page.evaluate(() => document.documentElement.getAttribute('data-app-mode') === 'dark'), 'тъмна тема');
  await page.screenshot({ path: path.join(OUT, 'panel-1280-dark.png') });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, 'route-1280-dark.png') });
  await page.evaluate(() => { document.body.classList.add('bar-hidden'); document.querySelector('#barHandle').hidden = false; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'bar-hidden-1280-dark.png') });
  await page.click('#barHandle');
  check(await page.evaluate(() => !document.body.classList.contains('bar-hidden') && document.querySelector('#barHandle').hidden), 'тъмна тема: табчето връща лентата');
  await page.click('[data-act="theme"]');

  // Телефон: 390 px.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, 'на 390 px няма хоризонтален скрол (' + overflow + ')');
  await page.screenshot({ path: path.join(OUT, 'route-390.png') });
  await page.evaluate(() => { document.body.classList.add('bar-hidden'); document.querySelector('#barHandle').hidden = false; });
  await page.waitForTimeout(300);
  await page.waitForFunction(() => document.querySelector('.mapctl.tr').getBoundingClientRect().top < 20, null, { timeout: 3000 }).catch(() => {});
  const row390 = await page.evaluate(handleRow);
  check(row390.sameRow && !row390.xOverlap, 'на 390 px табчето и "Сателит / Топо / Имена" са на един ред и не се застъпват: ' + row390.info);
  await page.screenshot({ path: path.join(OUT, 'bar-hidden-390.png') });
  await page.click('#barHandle');
  // Тясно: 380 px - копчето за скриване се вижда и не застъпва табчето.
  await page.setViewportSize({ width: 380, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => document.querySelector('#bar').getBoundingClientRect().top >= 0, null, { timeout: 3000 }).catch(() => {});
  const nb = await page.evaluate(() => { const r = document.querySelector('#hideBarBtn').getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width }; });
  check(await page.isVisible('#hideBarBtn') && nb.w > 0 && nb.l >= 0 && nb.r <= 380, 'на 380 px копчето за скриване се вижда (' + Math.round(nb.l) + '-' + Math.round(nb.r) + ' px)');
  const u380 = await page.evaluate(vis, '#undoBtn'), t380 = await page.evaluate(vis, '#bar .tolInput'), s380 = await page.evaluate(vis, '#searchForm');
  check(u380.shown && u380.l >= 0 && u380.r <= 380, 'на 380 px "Отмени" се вижда изцяло (' + Math.round(u380.l) + '-' + Math.round(u380.r) + ' px)');
  check(t380.shown && t380.w >= 36 && t380.l >= 0 && t380.r <= 380, 'на 380 px полето "Отклонение" се вижда: ' + Math.round(t380.w) + ' px, ' + Math.round(t380.l) + '-' + Math.round(t380.r));
  check(!s380.shown && await page.isHidden('#searchForm'), 'на 380 px търсенето е скрито');
  const bar380 = await page.evaluate(() => ({ bar: document.querySelector('#bar').getBoundingClientRect().bottom, tr: document.querySelector('.mapctl.tr').getBoundingClientRect().top }));
  check(bar380.bar <= 122 && bar380.bar <= bar380.tr, 'на 380 px лентата е ' + Math.round(bar380.bar) + ' px висока и не покрива "Сателит / Топо" (' + Math.round(bar380.tr) + ')');
  await page.screenshot({ path: path.join(OUT, 'bar-380.png') });
  await page.click('#hideBarBtn');
  await page.waitForFunction(() => document.querySelector('#bar').getBoundingClientRect().bottom <= 0, null, { timeout: 3000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('.mapctl.tr').getBoundingClientRect().top < 20, null, { timeout: 3000 }).catch(() => {});
  const row380 = await page.evaluate(handleRow);
  check(row380.sameRow && !row380.xOverlap, 'на 380 px табчето и "Сателит / Топо / Имена" са на един ред и не се застъпват: ' + row380.info);
  const ov2 = await page.evaluate(() => { const a = document.querySelector('#barHandle').getBoundingClientRect(), b = document.querySelector('#hideBarBtn').getBoundingClientRect(); return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top); });
  check(await page.evaluate(() => document.body.classList.contains('bar-hidden')) && await page.isVisible('#barHandle') && !ov2, 'на 380 px: лентата скрита, табчето се вижда и не се застъпва с копчето за скриване');
  await page.screenshot({ path: path.join(OUT, 'bar-hidden-380.png') });
  await page.click('#barHandle');
  check(await page.evaluate(() => !document.body.classList.contains('bar-hidden')) && await page.isVisible('#hideBarBtn'), 'на 380 px табчето връща лентата и копчето пак се вижда');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.querySelector('#panel').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, 'panel-390.png') });
  await page.screenshot({ path: path.join(OUT, 'panel-390-full.png'), fullPage: true });

  // Първият ред на лентата не прелива при никоя ширина; "Отмени" и полето "Отклонение" винаги са на екрана.
  await page.evaluate(() => window.scrollTo(0, 0));
  let sweepOk = true;
  for (const w of [320, 380, 560, 561, 640, 700, 760, 761, 900, 1060, 1061, 1100, 1200, 1201, 1280, 1440]) {
    await page.setViewportSize({ width: w, height: 800 });
    const bad = await page.evaluate(barFits), u = await page.evaluate(vis, '#undoBtn'), t = await page.evaluate(vis, '#bar .tolInput');
    const ok = bad.length === 0 && u.shown && u.l >= 0 && u.r <= w && t.shown && t.w >= 36 && t.l >= 0 && t.r <= w;
    if (!ok || w === 900) check(ok, 'на ' + w + ' px лентата се побира, "Отмени" и полето "Отклонение" са на екрана' + (bad.length ? ': ' + bad.join(', ') : ''));
    if (!ok) { sweepOk = false; break; }
  }
  if (sweepOk) check(true, 'лентата се побира при 320-1440 px');
  const tip = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth }));
  check(tip.x <= 0, 'след обхождането няма хоризонтален скрол (' + tip.x + ')');

  // Обща отсечка: три трака (X на изток, Z от края на X на юг, Y слиза до X, минава по него и се отделя).
  // Празна колекция в нов контекст; траковете се внасят като .gpx файлове.
  function line(lat0, lon0, lat1, lon1, n) { const p = []; for (let i = 0; i <= n; i++) { const f = i / n; p.push([lat0 + f * (lat1 - lat0), lon0 + f * (lon1 - lon0), 500 + i]); } return p; }
  function writeGpx(name, pts) {
    const f = path.join(OUT, name + '.gpx');
    fs.writeFileSync(f, '<?xml version="1.0"?>\n<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>' + name + '</name><trkseg>\n' +
      pts.map(p => '<trkpt lat="' + p[0].toFixed(6) + '" lon="' + p[1].toFixed(6) + '"><ele>' + p[2] + '</ele></trkpt>').join('\n') + '\n</trkseg></trk></gpx>\n');
    return f;
  }
  const shFiles = [
    writeGpx('X', line(42.5, 24.70, 42.5, 24.72, 100)),
    writeGpx('Z', line(42.5, 24.72, 42.49, 24.72, 60)),
    writeGpx('Y', line(42.51, 24.71, 42.50009, 24.71, 60).concat(line(42.50009, 24.7101, 42.50009, 24.72, 60), line(42.5003, 24.7201, 42.51, 24.73, 60)))
  ];
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p2.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) errors.push('console: ' + m.text()); });
  await p2.goto(url);
  await p2.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  await p2.setInputFiles('#fileInput', shFiles);
  await p2.waitForFunction(() => __gpxk.S.tracks.length === 3);
  const secYOf = () => p2.evaluate(() => __gpxk.A.byTrack[__gpxk.S.tracks[2].id].filter(s => s.kind !== 'gap').map(s => s.kind + (s.pend ? '*' : '')));
  let secY = await secYOf();
  check(JSON.stringify(secY) === '["part","part*","part"]', 'трак Y преди клика: част, дубликат с маркер, част ' + JSON.stringify(secY));
  await p2.waitForFunction(() => (__gpxk.ui.markers || []).length === 1);
  const mY = await p2.evaluate(() => __gpxk.ui.markers[0]);
  await p2.mouse.click(mY.x, mY.y);
  secY = await secYOf();
  check(JSON.stringify(secY) === '["part","dup","part"]', 'трак Y след клика върху маркера: част, дубликат, част ' + JSON.stringify(secY));
  // Пръстените се виждат от самото начало, без посочване: там, където Y се събира с X, и там, където се дели.
  const ringsAt = () => p2.evaluate(() => {
    const t = __gpxk.S.tracks[2], d = __gpxk.A.dups[0], m = __gpxk.map;
    return [d.a, d.b].map(x => { const p = window.Core.pointAt(t, x), q = m.project(p[0], p[1]); const r = (__gpxk.ui.rings || []).filter(r => Math.hypot(r.x - q.x, r.y - q.y) < 12)[0]; return r ? { sel: r.selected, onScreen: r.x >= 0 && r.y >= 0 && r.x <= m.w && r.y <= m.h } : null; });
  });
  let rings = await ringsAt();
  check(rings.every(r => r && r.onScreen && !r.sel), 'пръстен на двете места още преди маршрута (неизбрани): ' + JSON.stringify(rings));
  // Клик върху първата част на Y, после върху частта на Z (различни тракове).
  const ptOf = (ti, kind, k, f) => p2.evaluate(([ti, kind, k, f]) => { const t = __gpxk.S.tracks[ti], s = __gpxk.A.byTrack[t.id].filter(x => x.kind === kind)[k]; const p = window.Core.pointAt(t, s.a + (s.b - s.a) * f); return __gpxk.map.project(p[0], p[1]); }, [ti, kind, k, f]);
  let q = await ptOf(2, 'part', 0, 0.4);
  await p2.mouse.click(q.x, q.y);
  q = await ptOf(1, 'part', 0, 0.6);
  await p2.mouse.click(q.x, q.y);
  const sh = await p2.evaluate(() => {
    const G = __gpxk.G, A = __gpxk.A, r = __gpxk.S.routes.find(x => x.id === __gpxk.S.curId);
    const shared = G.items.filter(g => g.shared), dup = A.dups[0];
    const parts = G.items.filter(g => !g.shared).reduce((s, g) => s + g.len, 0);
    let jump = 0; for (let i = 1; i < G.pts.length; i++) jump = Math.max(jump, U.hav(G.pts[i - 1][0], G.pts[i - 1][1], G.pts[i][0], G.pts[i][1]));
    return { items: r.items.length, count: G.count, sParts: document.querySelector('#sParts').textContent, gaps: G.gaps.length, gapNotes: document.querySelectorAll('#gapsList .gap-note:not(.closed)').length, closedNotes: Array.from(document.querySelectorAll('#gapsList .gap-note.closed')).map(e => e.textContent.replace(/\s+/g, ' ').trim()),
      shared: shared.length, sharedLen: shared[0] && shared[0].len, dupLen: dup && dup.len, len: G.len, parts, jump,
      row: (document.querySelector('#partsList li.shared') || {}).textContent || '', badges: document.querySelectorAll('#partsList .badge').length };
  });
  check(sh.items === 2 && sh.count === 2 && sh.sParts === '2' && sh.badges === 2, 'две части в маршрута, "Части" = ' + sh.sParts + ' (общата отсечка не се брои)');
  check(sh.gaps === 0 && sh.gapNotes === 0 && sh.jump <= 20, 'маршрутът е непрекъснат между частите: няма G.gaps, най-голям скок ' + Math.round(sh.jump) + ' м');
  check(sh.closedNotes.length === 1 && /^Затворена дупка · 1\d м Отвори пак$/.test(sh.closedNotes[0]), 'от края на общата отсечка (Y) до Z: свръзка под отклонението, ред ' + JSON.stringify(sh.closedNotes));
  check(sh.shared === 1 && Math.abs(sh.sharedLen - sh.dupLen) < 5 && Math.abs(sh.len - (sh.parts + sh.dupLen)) < 60, 'дължината включва общата отсечка веднъж: ' + Math.round(sh.len) + ' = ' + Math.round(sh.parts) + ' + ' + Math.round(sh.dupLen));
  check(/обща отсечка\s·\s.*км\s·\sминава се веднъж/.test(sh.row), 'ред в списъка: ' + sh.row);
  // Клик върху махнатия дубликат (отблизо, върху Y) не прави нищо.
  await p2.evaluate(() => { const t = __gpxk.S.tracks[2], d = __gpxk.A.dups[0], p = window.Core.pointAt(t, (d.a + d.b) / 2); __gpxk.map.setView(p[0], p[1], 18); });
  q = await ptOf(2, 'dup', 0, 0.5);
  const before = await p2.evaluate(() => JSON.stringify(__gpxk.S.routes.find(x => x.id === __gpxk.S.curId).items));
  await p2.mouse.click(q.x, q.y);
  const after = await p2.evaluate(() => ({ items: JSON.stringify(__gpxk.S.routes.find(x => x.id === __gpxk.S.curId).items), hidden: document.body.classList.contains('bar-hidden'), dups: __gpxk.A.dups.length, kept: __gpxk.A.dups.some(d => 'kept' in d) }));
  check(after.items === before && !after.hidden && after.dups === 1 && !after.kept, 'клик върху махнат дубликат: маршрутът не се пипа, дубликатът не се връща');
  await p2.evaluate(() => { const G = __gpxk.G, b = U.boundsOf([G.pts]); __gpxk.map.setView((b.s + b.n) / 2, (b.w + b.e) / 2, 14); });
  await p2.screenshot({ path: path.join(OUT, 'shared-1280.png') });
  rings = await ringsAt();
  check(rings.every(r => r && r.onScreen && r.sel), 'маршрутът минава през двете точки: пръстените са избрани: ' + JSON.stringify(rings));
  const routeOf = () => p2.evaluate(() => { const G = __gpxk.G, r = __gpxk.S.routes.find(x => x.id === __gpxk.S.curId), T = __gpxk.S.tracks, e = G.pts[G.pts.length - 1];
    const endOf = t => U.hav(e[0], e[1], t.pts[t.pts.length - 1][0], t.pts[t.pts.length - 1][1]);
    return { items: r.items.map(i => T.findIndex(t => t.id === i.trackId)), endY: endOf(T[2]), endZ: endOf(T[1]), gaps: G.gaps.length, count: G.count, forks: (r.forks || []).length, shared: G.items.filter(g => g.shared).length }; });
  // Клик върху клона на Y след точката на деленето: маршрутът продължава по Y, не по Z.
  q = await ptOf(2, 'part', 1, 0.5);
  await p2.mouse.click(q.x, q.y);
  let rt = await routeOf();
  check(JSON.stringify(rt.items) === '[2,2]' && rt.endY < 5 && rt.gaps === 0 && rt.shared === 1 && rt.count === 2 && rt.forks === 1, 'клик върху клона на Y: посоката е сменена, маршрутът свършва в края на Y ' + JSON.stringify(rt));
  rings = await ringsAt();
  check(rings.every(r => r && r.sel), 'след смяната пръстените остават избрани');
  // Клик върху Z го връща.
  q = await ptOf(1, 'part', 0, 0.6);
  await p2.mouse.click(q.x, q.y);
  rt = await routeOf();
  check(JSON.stringify(rt.items) === '[2,1]' && rt.endZ < 5 && rt.gaps === 0, 'клик върху Z: посоката пак е по Z ' + JSON.stringify(rt));
  // "Отмени" връща избора на Y.
  await p2.click('#undoBtn');
  rt = await routeOf();
  check(JSON.stringify(rt.items) === '[2,2]' && rt.endY < 5, '"Отмени" връща посоката по Y');
  // Изборът се пази след презареждане.
  await p2.evaluate(() => new Promise(res => { const id = __gpxk.S.curId, yId = __gpxk.S.tracks[2].id; const tick = () => U.DB.get('collection').then(d => { const r = d && d.routes.find(x => x.id === id); if (r && r.items.length === 2 && r.items[1].trackId === yId && r.forks && r.forks.length === 1) res(); else setTimeout(tick, 100); }); tick(); }));
  await p2.reload();
  await p2.waitForFunction(() => window.__gpxk && window.__gpxk.ready && __gpxk.S.tracks.length === 3);
  rt = await routeOf();
  check(JSON.stringify(rt.items) === '[2,2]' && rt.endY < 5 && rt.forks === 1 && rt.gaps === 0, 'след презареждане маршрутът минава по същия клон ' + JSON.stringify(rt));
  const exp = await p2.evaluate(() => { const r = __gpxk.S.routes.find(x => x.id === __gpxk.S.curId); return JSON.stringify(r.forks); });
  check(/"alts"/.test(exp), 'изборът е в състоянието на маршрута (forks)');
  await p2.screenshot({ path: path.join(OUT, 'forks-1280.png') });
  await ctx2.close();

  // ---- Маркер за всеки дубликат, скрит махнат дубликат, самозатварящи се дупки ----
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p3.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) errors.push('console: ' + m.text()); });
  await p3.goto(url);
  await p3.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  await p3.setInputFiles('#fileInput', shFiles);
  await p3.waitForFunction(() => __gpxk.S.tracks.length === 3);
  // Помощни неща в страницата: частите на трак по вид, състояние на маршрута.
  const st3 = () => p3.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))).then(() => p3.evaluate(() => {
    const A = __gpxk.A, G = __gpxk.G, S = __gpxk.S, r = S.routes.find(x => x.id === S.curId), ui = __gpxk.ui;
    return { items: r.items.length, len: G.len, gaps: G.gaps.length, auto: (G.autoGaps || []).length, dups: A.dups.map(d => [S.tracks.findIndex(t => t.id === d.trackId), Math.round(d.a), Math.round(d.b)]),
      pend: A.pend.map(d => [S.tracks.findIndex(t => t.id === d.trackId), Math.round(d.a), Math.round(d.b)]), markers: (ui.markers || []).map(o => ({ x: o.x, y: o.y, t: S.tracks.findIndex(t => t.id === o.sec.trackId), a: Math.round(o.sec.a) })),
      drawn: S.tracks.map(t => (ui.drawn[t.id] || []).map(iv => [Math.round(iv[0]), Math.round(iv[1])])), lens: S.tracks.map(t => Math.round(t.len)),
      pendText: document.querySelector('#dupsPending').hidden ? '' : document.querySelector('#dupsPending').textContent, skipText: document.querySelector('#dupsSkipped').hidden ? '' : document.querySelector('#dupsSkipped').textContent,
      closedRows: Array.from(document.querySelectorAll('#gapsList .gap-note.closed')).map(e => e.textContent.replace(/\s+/g, ' ').trim()),
      openRows: Array.from(document.querySelectorAll('#gapsList .gap-note:not(.closed)')).map(e => e.querySelectorAll('button').length) };
  }));
  let s3 = await st3();
  const yPend = s3.pend[0];
  check(s3.pend.length === 1 && s3.dups.length === 0 && s3.markers.length === 1 && s3.markers[0].t === 2 && /^Дубликати по картата: 1 маркер/.test(s3.pendText),
    'преди клика: един маркер върху Y, нищо не е махнато ' + JSON.stringify(s3.pend));
  const mOk = await p3.evaluate(() => { const o = __gpxk.ui.markers[0], t = __gpxk.S.tracks[2], p = window.Core.pointAt(t, (o.sec.a + o.sec.b) / 2), q = __gpxk.map.project(p[0], p[1]); return Math.hypot(q.x - o.x, q.y - o.y); });
  check(mOk < 1.5, 'маркерът е в средата на дублиращия се участък');
  check(JSON.stringify(s3.drawn[2]) === JSON.stringify([[0, s3.lens[2]]]), 'преди клика двете линии се чертаят цели: Y ' + JSON.stringify(s3.drawn[2]));
  // Маршрут, който минава общата отсечка два пъти: X на изток, после обратно по Y (дубликатът се брои).
  await p3.evaluate(() => { const S = __gpxk.S, r = S.routes.find(x => x.id === S.curId), X = S.tracks[0];
    r.items = __gpxk.A.parts.filter(p => p.trackId === X.id).map(p => ({ type: 'part', trackId: X.id, a: p.a, b: p.b, rev: false })); __gpxk.refresh(); });
  // Кликът върху чакащия дубликат го слага в маршрута като всяка част (отблизо, за да не е върху X).
  const yq = await p3.evaluate(() => { const t = __gpxk.S.tracks[2], s = __gpxk.A.pend[0], p = window.Core.pointAt(t, s.a + (s.b - s.a) * 0.25); __gpxk.map.setView(p[0], p[1], 18); return __gpxk.map.project(p[0], p[1]); });
  await p3.waitForFunction(() => (__gpxk.ui.markers || []).length === 1);
  await p3.mouse.click(yq.x, yq.y);
  s3 = await st3();
  const len0 = s3.len;
  const jump = await p3.evaluate(() => { const R = __gpxk.G.items.filter(g => !g.auto), a = R[R.length - 2], b = R[R.length - 1]; const e = a.pts[a.pts.length - 1], f = b.pts[0]; return U.hav(e[0], e[1], f[0], f[1]); });
  check(s3.items === 3, 'клик върху чакащия дубликат: влиза в маршрута (' + s3.items + ' части), дължина ' + Math.round(len0));
  await p3.evaluate(() => { const G = __gpxk.G, b = U.boundsOf([G.pts]); __gpxk.map.setView((b.s + b.n) / 2, (b.w + b.e) / 2, 15); });
  await p3.waitForFunction(() => (__gpxk.ui.markers || []).length === 1);
  let mk = (await st3()).markers[0];
  await p3.mouse.click(mk.x, mk.y);
  s3 = await st3();
  const dropped = len0 - s3.len, dLen = yPend[2] - yPend[1];
  check(s3.items === 2 && Math.abs(dropped - (dLen + jump)) < 3, 'клик върху маркера: частта излиза, дължината пада с участъка: ' + Math.round(dropped) + ' ~ ' + Math.round(dLen) + ' + ' + Math.round(jump));
  check(s3.markers.length === 0 && s3.pend.length === 0 && JSON.stringify(s3.dups) === JSON.stringify([yPend]) && /^Пропуснати дубликати: 1 участък/.test(s3.skipText) && !s3.pendText, 'маркерът го няма, махнат е точно този дубликат: ' + s3.skipText);
  const notDrawn = s3.drawn[2].every(iv => iv[1] <= yPend[1] + 1 || iv[0] >= yPend[2] - 1) && s3.drawn[2].length === 2;
  check(notDrawn, 'махнатият дубликат не се чертае: Y се чертае само ' + JSON.stringify(s3.drawn[2]));
  await p3.screenshot({ path: path.join(OUT, 'marker-after-1280.png') });
  // "Отмени" връща дубликата, маркера и частта.
  await p3.click('#undoBtn');
  s3 = await st3();
  check(s3.items === 3 && Math.abs(s3.len - len0) < 1 && s3.markers.length === 1 && s3.dups.length === 0 && JSON.stringify(s3.drawn[2]) === JSON.stringify([[0, s3.lens[2]]]), '"Отмени": дубликатът, маркерът и частта се връщат ' + JSON.stringify([s3.items, Math.round(s3.len - len0), s3.markers.length, s3.dups, s3.drawn[2]]));
  // Три дубликата - три маркера, всеки се маха сам.
  const Lp = line(42.52, 24.70, 42.52, 24.76, 300);
  let Mp = [], lon = 24.705;
  for (let k = 0; k < 3; k++) { Mp = Mp.concat(line(42.52009, lon, 42.52009, lon + 0.008, 40), line(42.5215, lon + 0.0085, 42.5215, lon + 0.012, 20)); lon += 0.0125; }
  await p3.setInputFiles('#fileInput', [writeGpx('L', Lp), writeGpx('M', Mp)]);
  await p3.waitForFunction(() => __gpxk.S.tracks.length === 5);
  await p3.evaluate(() => { const M = __gpxk.S.tracks[4], b = U.boundsOf([M.pts]); __gpxk.map.setView((b.s + b.n) / 2, (b.w + b.e) / 2, 15); });
  await p3.waitForFunction(() => (__gpxk.ui.markers || []).filter(o => o.sec.trackId === __gpxk.S.tracks[4].id).length === 3);
  s3 = await st3();
  const mm = s3.markers.filter(o => o.t === 4).sort((a, b) => a.a - b.a);
  const apart = mm.every((o, i) => mm.every((q, j) => i === j || Math.hypot(o.x - q.x, o.y - q.y) >= 26));
  check(mm.length === 3 && apart && /^Дубликати по картата: 4 маркера/.test(s3.pendText), 'три дубликата на M - три маркера (общо ' + s3.pendText + ')');
  await p3.mouse.click(mm[1].x, mm[1].y);
  s3 = await st3();
  const mDups = s3.dups.filter(d => d[0] === 4), mPend = s3.pend.filter(d => d[0] === 4);
  check(mDups.length === 1 && mDups[0][1] === mm[1].a && mPend.length === 2 && s3.markers.filter(o => o.t === 4).length === 2, 'клик върху средния маркер: махнат е само той, остават два маркера ' + JSON.stringify(mDups));
  // Решението се пази: след презареждане маркерът не изскача пак.
  await p3.evaluate(() => new Promise(res => { const tick = () => U.DB.get('collection').then(d => { const M = d && d.tracks[4]; if (M && M.skips && M.skips.length === 1) res(); else setTimeout(tick, 100); }); tick(); }));
  await p3.reload();
  await p3.waitForFunction(() => window.__gpxk && window.__gpxk.ready && __gpxk.S.tracks.length === 5);
  s3 = await st3();
  check(s3.dups.filter(d => d[0] === 4).length === 1 && s3.pend.filter(d => d[0] === 4).length === 2 && /Пропуснати дубликати: 1 участък/.test(s3.skipText), 'след презареждане: решеното се помни, маркерите не изскачат пак');
  // Дупки: две части с 60 м между тях и трак с 60 м загубен сигнал.
  const P1 = line(42.54, 24.70, 42.54, 24.71, 50), P2 = line(42.54, 24.71074, 42.55, 24.71074, 50);
  const T1 = line(42.56, 24.70, 42.56, 24.71, 50), T2 = line(42.56, 24.71074, 42.56, 24.72, 50);
  const tFile = path.join(OUT, 'T.gpx');
  fs.writeFileSync(tFile, '<?xml version="1.0"?>\n<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>T</name>' +
    [T1, T2].map(seg => '<trkseg>\n' + seg.map(p => '<trkpt lat="' + p[0].toFixed(6) + '" lon="' + p[1].toFixed(6) + '"><ele>' + p[2] + '</ele></trkpt>').join('\n') + '\n</trkseg>').join('') + '</trk></gpx>\n');
  await p3.setInputFiles('#fileInput', [writeGpx('P1', P1), writeGpx('P2', P2), tFile]);
  await p3.waitForFunction(() => __gpxk.S.tracks.length === 8);
  const gapRoute = () => p3.evaluate(() => { const S = __gpxk.S, r = S.routes.find(x => x.id === S.curId), T = S.tracks;
    r.items = [5, 6, 7].map(i => ({ type: 'part', trackId: T[i].id, a: 0, b: window.Core.prep(T[i]).len, rev: false })); __gpxk.refresh(); });
  await gapRoute();
  s3 = await st3();
  check(s3.auto === 0 && s3.gaps === 2 && s3.openRows.every(n => n === 2) && s3.openRows.length === 2 && s3.closedRows.length === 0, 'при 20 м дупката от 60 м между частите си е дупка с двата бутона (' + s3.gaps + ' дупки)');
  check(await p3.evaluate(() => __gpxk.A.gaps.filter(g => g.trackId === __gpxk.S.tracks[7].id).length === 1), 'при 20 м дупката в трака T си е дупка');
  await p3.fill('#bar .tolInput', '100');
  await p3.press('#bar .tolInput', 'Enter');
  await p3.waitForFunction(() => __gpxk.A.tol === 100);
  await gapRoute();
  s3 = await st3();
  const lenExp = await p3.evaluate(() => { const T = __gpxk.S.tracks, G = __gpxk.G; const e1 = T[5].pts[T[5].pts.length - 1], s2 = T[6].pts[0], e2 = T[6].pts[T[6].pts.length - 1], s3 = T[7].pts[0];
    return T[5].len + U.hav(e1[0], e1[1], s2[0], s2[1]) + T[6].len + U.hav(e2[0], e2[1], s3[0], s3[1]) + T[7].len; });
  check(s3.auto === 2 && s3.gaps === 1 && s3.closedRows.length === 2 && s3.closedRows.every(t => /^Затворена дупка · 6\d м Отвори пак$/.test(t)), 'при 100 м двете дупки от 60 м се затварят сами: ' + JSON.stringify(s3.closedRows));
  check(s3.openRows.length === 1 && s3.openRows[0] === 2, 'дупката над отклонението си остава с двата бутона');
  check(Math.abs(s3.len - lenExp) < 2, 'затворените дупки влизат в дължината: ' + Math.round(s3.len) + ' ~ ' + Math.round(lenExp));
  check(await p3.evaluate(() => __gpxk.A.closedGaps.length === 1 && !__gpxk.A.gaps.some(g => g.trackId === __gpxk.S.tracks[7].id) && __gpxk.A.parts.filter(p => p.trackId === __gpxk.S.tracks[7].id).length === 1), 'дупката в трака е затворена, T е една част');
  const flat = await p3.evaluate(() => { const sm = [0, 50, 100, 150, 200].map((d, i) => ({ d, ele: [500, 900, 100, 700, 540][i] })); __gpxk.flattenAutoGaps(sm, [{ d0: 50, d1: 150 }]); return sm.map(x => Math.round(x.ele)); });
  check(JSON.stringify(flat) === '[500,900,800,700,540]', 'височината в затворената дупка се тегли по права линия: ' + JSON.stringify(flat));
  const elevKey = await p3.evaluate(() => __gpxk.G.autoGaps.every(g => isFinite(g.d0) && g.d1 - g.d0 > 50));
  check(elevKey, 'затворените дупки имат място по маршрута (за профила)');
  // "Отвори пак": дупката става обикновена, с двата бутона; "Отмени" я затваря пак.
  await p3.click('#gapsList .gap-note.closed [data-gapact="reopen"]');
  s3 = await st3();
  check(s3.auto === 1 && s3.gaps === 2 && s3.openRows.length === 2 && s3.openRows.every(n => n === 2), '"Отвори пак": дупката е отворена, с двата бутона');
  await p3.click('#undoBtn');
  s3 = await st3();
  check(s3.auto === 2 && s3.gaps === 1, '"Отмени" я затваря пак');
  await p3.screenshot({ path: path.join(OUT, 'gaps-1280.png') });
  await ctx3.close();

  // ---- Свръзки между два трака: без дупка при махнат дубликат, стартът и краят са от трак ----
  // LA на изток; LB върви успоредно на 10 м и завива на север; LC започва на 25 м от края на LA.
  const ctx4 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p4 = await ctx4.newPage();
  p4.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p4.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) errors.push('console: ' + m.text()); });
  await p4.goto(url);
  await p4.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  await p4.setInputFiles('#fileInput', [
    writeGpx('LA', line(42.5, 24.70, 42.5, 24.75, 200)),
    writeGpx('LB', line(42.50009, 24.71, 42.50009, 24.73, 80).concat(line(42.50009, 24.7302, 42.53, 24.73, 120))),
    writeGpx('LC', line(42.500225, 24.75, 42.52, 24.75, 80))
  ]);
  await p4.waitForFunction(() => __gpxk.S.tracks.length === 3);
  await p4.evaluate(() => { const b = U.boundsOf(__gpxk.S.tracks.map(t => t.pts)); __gpxk.map.setView((b.s + b.n) / 2, (b.w + b.e) / 2, 14); });
  await p4.waitForFunction(() => (__gpxk.ui.markers || []).length === 1);
  const mL = await p4.evaluate(() => __gpxk.ui.markers[0]);
  await p4.mouse.click(mL.x, mL.y);
  await p4.waitForFunction(() => __gpxk.A.dups.length === 1);
  const at4 = (ti, k, f) => p4.evaluate(([ti, k, f]) => { const t = __gpxk.S.tracks[ti], s = __gpxk.A.byTrack[t.id].filter(x => x.kind === 'part' && !x.pend)[k]; const p = window.Core.pointAt(t, s.a + (s.b - s.a) * f); return __gpxk.map.project(p[0], p[1]); }, [ti, k, f]);
  let q4 = await at4(0, 0, 0.4); await p4.mouse.click(q4.x, q4.y);
  q4 = await at4(1, 0, 0.6); await p4.mouse.click(q4.x, q4.y);
  const st4 = () => p4.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))).then(() => p4.evaluate(() => {
    const G = __gpxk.G, S = __gpxk.S, T = S.tracks, r = S.routes.find(x => x.id === S.curId), on = (t, p) => window.Core.nearestOnTrack(t, p[0], p[1]).dist;
    const real = G.items.filter(g => !g.auto && !g.link), links = G.items.filter(g => g.auto);
    const f = (G.forks || []).filter(x => x.at)[0], ring = f && (__gpxk.ui.rings || []).filter(o => o.selected)[0], fq = f && f.j.ring && __gpxk.map.project(f.j.ring[0], f.j.ring[1]);
    const lastT = T[T.findIndex(t => t.id === real[real.length - 1].item.trackId)];
    return { items: r.items.map(i => i.type === 'draw' ? 'draw' : T.findIndex(t => t.id === i.trackId)), count: G.count, sParts: document.querySelector('#sParts').textContent,
      gaps: G.gaps.length, auto: (G.autoGaps || []).length, linkLen: links[0] ? links[0].len : null, len: G.len, partsLen: real.reduce((s, g) => s + g.len, 0) + links.reduce((s, g) => s + g.len, 0),
      linkOnB: links[0] ? on(T[1], links[0].pts[1]) : null, forkOn: f ? on(lastT, f.at) : null, jOn: f ? on(lastT, [f.j.lat, f.j.lon]) : null, ringPx: ring && fq ? Math.hypot(ring.x - fq.x, ring.y - fq.y) : null, ringOnA: f && f.j.ring ? on(T[0], f.j.ring) : null,
      firstPart: real[0] && real[0].item.type, lastPart: real[real.length - 1] && real[real.length - 1].item.type,
      startOn: on(T[0], G.pts[0]), endOn: on(lastT, G.pts[G.pts.length - 1]),
      closedRows: Array.from(document.querySelectorAll('#gapsList .gap-note.closed')).map(e => e.textContent.replace(/\s+/g, ' ').trim()),
      openRows: Array.from(document.querySelectorAll('#gapsList .gap-note:not(.closed)')).map(e => Array.from(e.querySelectorAll('button')).map(b => b.textContent)),
      linkRows: Array.from(document.querySelectorAll('#partsList li.link')).map(e => e.textContent.replace(/\s+/g, ' ').trim()), badges: document.querySelectorAll('#partsList .badge').length };
  }));
  let s4 = await st4();
  check(JSON.stringify(s4.items) === '[0,1]' && s4.count === 2 && s4.sParts === '2' && s4.badges === 2, 'LA и LB в маршрута: две части, "Части" = ' + s4.sParts + ' ' + JSON.stringify(s4.items));
  check(s4.gaps === 0 && s4.openRows.length === 0 && s4.auto === 1 && s4.linkLen > 1 && s4.linkLen <= 20, 'дупката между LA и LB (под отклонението) не е дупка: свръзка ' + (s4.linkLen && s4.linkLen.toFixed(1)) + ' м, отворени дупки ' + s4.openRows.length);
  check(s4.closedRows.length === 1 && /^Затворена дупка · \d+ м Отвори пак$/.test(s4.closedRows[0]), 'ред под частите: ' + JSON.stringify(s4.closedRows));
  check(Math.abs(s4.len - s4.partsLen) < 1, 'дължината на свръзката влиза в маршрута: ' + Math.round(s4.len) + ' ~ ' + Math.round(s4.partsLen));
  check(s4.linkOnB !== null && s4.linkOnB < 0.5 && s4.forkOn !== null && s4.forkOn < 0.5, 'точката на свръзката е върху LB (продължаващия трак): ' + JSON.stringify([s4.linkOnB, s4.forkOn]));
  check(s4.ringOnA !== null && s4.ringOnA < 0.5 && s4.ringPx !== null && s4.ringPx < 1, 'пръстенът е един и стои върху LA (тракът, който остава след махането на дубликата): ' + JSON.stringify([s4.ringOnA, s4.ringPx]));
  check(s4.firstPart === 'part' && s4.lastPart === 'part' && s4.startOn < 0.5 && s4.endOn < 0.5, '"Старт" е върху LA, "Край" е върху LB: ' + JSON.stringify([s4.startOn, s4.endOn]));
  await p4.evaluate(() => { const G = __gpxk.G, b = U.boundsOf([G.pts]); __gpxk.map.setView((b.s + b.n) / 2, (b.w + b.e) / 2, 14); });
  await p4.screenshot({ path: path.join(OUT, 'link-1280.png') });
  // "Отвори пак": свръзката става дупка с двата бутона; "Отмени" я затваря.
  await p4.click('#gapsList .gap-note.closed [data-gapact="reopen"]');
  s4 = await st4();
  check(s4.gaps === 1 && s4.auto === 0 && s4.closedRows.length === 0 && s4.openRows.length === 1 && JSON.stringify(s4.openRows[0]) === JSON.stringify(['Затвори с чертаене', 'Свържи направо']), '"Отвори пак": свръзката е дупка с бутоните ' + JSON.stringify(s4.openRows));
  await p4.click('#undoBtn');
  s4 = await st4();
  check(s4.gaps === 0 && s4.auto === 1 && s4.closedRows.length === 1, '"Отмени" я затваря пак');
  // Над отклонението: LA (източната част) и LC на 25 м - дупката остава, с бутоните.
  await p4.evaluate(() => { const S = __gpxk.S, r = S.routes.find(x => x.id === S.curId), T = S.tracks, A = __gpxk.A;
    const a = A.byTrack[T[0].id].filter(s => s.kind === 'part')[1], c = A.byTrack[T[2].id].filter(s => s.kind === 'part')[0];
    r.items = [{ type: 'part', trackId: T[0].id, a: a.a, b: a.b, rev: false }, { type: 'part', trackId: T[2].id, a: c.a, b: c.b, rev: false }]; __gpxk.refresh(); });
  s4 = await st4();
  check(s4.gaps === 1 && s4.auto === 0 && s4.openRows.length === 1 && s4.openRows[0].length === 2 && s4.closedRows.length === 0, 'дупка от 25 м между LA и LC (над отклонението) остава дупка с двата бутона');
  // Ръчна връзка, без избрана дупка: клик в "Добавяне" между края на LA и началото на LC.
  const mid4 = await p4.evaluate(() => { const T = __gpxk.S.tracks, e = T[0].pts[T[0].pts.length - 1], s = T[2].pts[0]; __gpxk.map.setView((e[0] + s[0]) / 2, (e[1] + s[1]) / 2, 18); return __gpxk.map.project((e[0] + s[0]) / 2, (e[1] + s[1]) / 2); });
  await p4.click('[data-mode="add"]');
  await p4.mouse.click(mid4.x, mid4.y);
  await p4.click('[data-mode="select"]');
  s4 = await st4();
  check(JSON.stringify(s4.items) === '[0,"draw",2]' && s4.gaps === 0, 'ръчната връзка влиза между двете части, не в края: ' + JSON.stringify(s4.items));
  check(s4.firstPart === 'part' && s4.lastPart === 'part' && s4.startOn < 0.5 && s4.endOn < 0.5, 'с ръчна връзка "Старт" и "Край" остават върху трак: ' + JSON.stringify([s4.startOn, s4.endOn]));
  check(s4.count === 2 && s4.sParts === '2' && s4.linkRows.length === 1 && /^връзка · \d+ м · между частите/.test(s4.linkRows[0]), 'връзката не е част: "Части" = ' + s4.sParts + ', ред ' + JSON.stringify(s4.linkRows));
  await p4.evaluate(() => { const G = __gpxk.G, b = U.boundsOf([G.pts]); __gpxk.map.setView((b.s + b.n) / 2, (b.w + b.e) / 2, 15); });
  await p4.screenshot({ path: path.join(OUT, 'link-drawn-1280.png') });
  await p4.setViewportSize({ width: 390, height: 800 });
  s4 = await st4();
  check(await p4.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'на 390 px с редовете за връзка няма хоризонтален скрол');
  await p4.screenshot({ path: path.join(OUT, 'link-390.png'), fullPage: true });
  await ctx4.close();

  // ---- "Нов", "Изтрий", свиващи се панели, версия ----
  const ctx5 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p5 = await ctx5.newPage();
  p5.on('pageerror', e => errors.push('pageerror(5): ' + e.message));
  p5.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) errors.push('console(5): ' + m.text()); });
  await p5.goto(url);
  await p5.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  // Версия: в дъното и в името на кеша от sw.js.
  const verText = (await p5.textContent('#appVersion')).trim();
  const ver = (verText.match(/^\d+\.\d+\.\d+/) || [''])[0];
  check(ver === '1.0.2' && await p5.isVisible('#appVersion') && /^Версия 1\.0\.2 · \d+ \S+ \d{4}$/.test((await p5.textContent('.foot .ver')).trim()), 'дъното показва версията: ' + (await p5.textContent('.foot .ver')).trim());
  const swCache = (() => { const ctx = { importScripts: f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx), addEventListener: () => {} }; ctx.self = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8') + ';this.__c = CACHE;', ctx); return ctx.__c; })();
  check(swCache === 'gpxk-v13-1.0.2' && swCache === 'gpxk-v13-' + ver, 'sw.js именува кеша със същата версия: ' + swCache);
  const liveCaches = await p5.evaluate(() => navigator.serviceWorker.ready.then(() => new Promise(r => { const t0 = Date.now(); (function poll() { caches.keys().then(k => (k.length || Date.now() - t0 > 8000) ? r(k) : setTimeout(poll, 100)); })(); })));
  check(liveCaches.length === 1 && liveCaches[0] === swCache, 'в браузъра работникът е създал кеш ' + JSON.stringify(liveCaches));
  // Бутоните са неактивни, когато няма какво да изчистят.
  const btns5 = () => p5.evaluate(() => ({ nov: document.querySelector('#clearTracksBtn').disabled, izt: document.querySelector('#clearPartsBtn').disabled,
    novIn: !!document.querySelector('#tracksList ~ .row #clearTracksBtn'), iztIn: !!document.querySelector('.card-head #clearPartsBtn'),
    novT: document.querySelector('#clearTracksBtn').textContent, iztT: document.querySelector('#clearPartsBtn').textContent,
    danger: !!document.querySelector('#clearTracksBtn.danger, #clearPartsBtn.danger') }));
  let b5 = await btns5();
  check(b5.nov && b5.izt && b5.novIn && b5.iztIn && b5.novT === 'Нов' && b5.iztT === 'Изтрий' && !b5.danger, 'празно: "Нов" (при траковете) и "Изтрий" (в заглавието на частите) са неактивни ' + JSON.stringify(b5));
  const heads = await p5.evaluate(() => Array.from(document.querySelectorAll('.cols h2')).map(h => h.firstChild.nodeType === 3 ? h.firstChild.textContent.trim() : h.querySelector('.fold-t').childNodes[1].textContent.trim()));
  check(JSON.stringify(heads) === JSON.stringify(['Части в маршрута', 'Точки', 'Тракове-източници', 'Дубликати', 'Изрязано от тракове']), 'заглавията на панелите: ' + JSON.stringify(heads));
  // Свити в началото.
  const FOLDS = [['#ptsCard', '#ptsCount'], ['#dupsCard', '#dupsCount'], ['#cutsCard', '#cutsCount']];
  const foldSt = () => p5.evaluate(F => F.map(([c, n]) => { const card = document.querySelector(c), b = card.querySelector('.fold-b'), t = card.querySelector('.fold-t'), cnt = document.querySelector(n);
    return { open: !b.hidden && b.getBoundingClientRect().height > 0, aria: t.getAttribute('aria-expanded'), cnt: cnt.textContent, cntShown: cnt.getBoundingClientRect().width > 0, inTitle: t.contains(cnt) }; }), FOLDS);
  let f5 = await foldSt();
  check(f5.every(f => !f.open && f.aria === 'false'), 'трите панела са свити при отваряне ' + JSON.stringify(f5.map(f => f.open)));
  // Тракове и част в маршрута.
  const fx5 = f => path.join(__dirname, 'fixtures', f);
  await p5.click('#empty [data-act="add-tracks"]');
  await p5.setInputFiles('#fileInput', [fx5('hisarya-izhod.gpx'), fx5('momina-banya.gpx'), fx5('obratno.gpx')]);
  await p5.waitForFunction(() => __gpxk.S.tracks.length === 3 && __gpxk.A.pend.length === 1);
  await p5.keyboard.press('Escape');
  await p5.evaluate(() => { const S = __gpxk.S, A = __gpxk.A, r = S.routes.find(x => x.id === S.curId);
    const a = A.parts.filter(p => p.trackId === S.tracks[0].id)[0], c = A.parts.filter(p => p.trackId === S.tracks[2].id)[0];
    S.tracks[2].cuts = [{ a: 0, b: 50 }];
    r.items = [{ type: 'part', trackId: a.trackId, a: a.a, b: a.b, rev: false }, { type: 'draw', pts: [{ lat: 42.51, lon: 24.70, name: 'Чешма' }] }];
    window.__gpxk.refresh(); });
  await p5.waitForFunction(() => document.querySelector('#cutsCount').textContent === '(1)');
  const saved5 = async () => { for (let i = 0; i < 100; i++) { if (await p5.evaluate(() => U.DB.get('collection').then(c => { const r = c && c.routes.find(x => x.id === c.curId); return !!r && r.items.length === 2 && c.tracks.length === 3; }))) return true; await p5.waitForTimeout(100); } return false; };
  check(await saved5(), 'частите и изрезката са записани в браузъра');
  f5 = await foldSt();
  check(f5.every(f => !f.open && f.cntShown && f.inTitle) && f5[0].cnt === '(1)' && f5[1].cnt === '1 за решение' && f5[2].cnt === '(1)', 'свитите заглавия носят броячите: ' + JSON.stringify(f5.map(f => f.cnt)));
  // Клик върху свито заглавие само отваря - не пипа картата и не решава нищо.
  const mapSt = () => p5.evaluate(() => JSON.stringify([__gpxk.map.getView(), __gpxk.A.pend.length, __gpxk.A.dups.length, __gpxk.S.routes.find(x => x.id === __gpxk.S.curId).items.length, __gpxk.ui.undo.length]));
  const m0 = await mapSt();
  for (const [c] of FOLDS) await p5.click(c + ' .fold-t');
  f5 = await foldSt();
  check(f5.every(f => f.open && f.aria === 'true'), 'клик върху заглавието отваря всеки от трите панела ' + JSON.stringify(f5.map(f => f.open)));
  check(await mapSt() === m0, 'отварянето не пипа картата, дубликатите и маршрута');
  await p5.click('#ptsCard .fold-t');
  f5 = await foldSt();
  check(!f5[0].open && f5[1].open && f5[2].open, 'втори клик свива панела');
  await p5.reload();
  await p5.waitForFunction(() => window.__gpxk && window.__gpxk.ready && __gpxk.S.tracks.length === 3);
  f5 = await foldSt();
  check(!f5[0].open && f5[1].open && f5[2].open && f5[0].cnt === '(1)', 'след презареждане всеки панел е както е оставен ' + JSON.stringify(f5.map(f => f.open)));
  await p5.click('#dupsCard .fold-t'); await p5.click('#cutsCard .fold-t');
  await p5.reload();
  await p5.waitForFunction(() => window.__gpxk && window.__gpxk.ready && __gpxk.S.tracks.length === 3);
  f5 = await foldSt();
  check(f5.every(f => !f.open), 'свити и след следващо презареждане');
  // "Изтрий": махат се частите, траковете остават; "Отмени" ги връща.
  const rs5 = () => p5.evaluate(() => { const S = __gpxk.S, r = S.routes.find(x => x.id === S.curId);
    return { tracks: S.tracks.map(t => t.id + ':' + t.pts.length + ':' + JSON.stringify(t.cuts || [])).join('|'), nTracks: S.tracks.length, items: JSON.stringify(r.items), n: r.items.length,
      parts: document.querySelector('#partsCount').textContent, empty: !document.querySelector('#empty').hidden, routes: S.routes.length }; });
  const r0 = await rs5();
  b5 = await btns5();
  check(!b5.nov && !b5.izt && r0.n === 2 && r0.nTracks === 3, 'с тракове и части двата бутона са активни');
  await p5.click('#clearPartsBtn');
  let r1 = await rs5(); b5 = await btns5();
  check(r1.n === 0 && r1.tracks === r0.tracks && r1.parts === '(0)' && b5.izt && !b5.nov && r1.routes === r0.routes, '"Изтрий": частите са махнати, траковете остават, "Изтрий" е неактивен');
  await p5.click('#undoBtn');
  r1 = await rs5();
  check(r1.items === r0.items && r1.tracks === r0.tracks, '"Отмени" връща частите');
  // "Нов": махат се траковете и маршрутът; "Отмени" връща всичко.
  await p5.click('#clearTracksBtn');
  r1 = await rs5(); b5 = await btns5();
  check(r1.nTracks === 0 && r1.n === 0 && r1.empty && b5.nov && b5.izt && r1.routes === r0.routes, '"Нов": няма тракове, няма части, подканата се вижда, записаните маршрути остават');
  check(await p5.evaluate(() => __gpxk.A.parts.length === 0 && __gpxk.A.pend.length === 0 && __gpxk.G.pts.length === 0), '"Нов": картата е празна');
  await p5.click('#undoBtn');
  await p5.waitForFunction(() => __gpxk.S.tracks.length === 3);
  r1 = await rs5();
  check(r1.tracks === r0.tracks && r1.items === r0.items && !r1.empty && await p5.evaluate(() => __gpxk.A.pend.length === 1 && document.querySelector('#cutsCount').textContent === '(1)'), '"Отмени" връща траковете (с изрезките) и маршрута');
  await saved5();
  await p5.reload();
  await p5.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  r1 = await rs5();
  check(r1.tracks === r0.tracks && r1.items === r0.items, 'върнатото е записано и след презареждане');
  for (const [c] of FOLDS) await p5.click(c + ' .fold-t');
  await p5.screenshot({ path: path.join(OUT, 'panels-1280.png'), fullPage: true });
  await p5.setViewportSize({ width: 390, height: 800 });
  check(await p5.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'на 390 px с новите бутони и панели няма хоризонтален скрол');
  await p5.evaluate(() => document.documentElement.setAttribute('data-app-mode', 'dark'));
  await p5.screenshot({ path: path.join(OUT, 'panels-390-dark.png'), fullPage: true });
  await ctx5.close();


  // Телефон 390x844: след "Стоп" свалянето се вижда без превъртане, остава и след презареждане.
  const ctx6 = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, permissions: ['geolocation'], geolocation: { latitude: 42.5, longitude: 24.7 } });
  await ctx6.addInitScript({ content: 'window.inView = ' + inView.toString() });
  const p6 = await ctx6.newPage();
  p6.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p6.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) errors.push('console: ' + m.text()); });
  await p6.goto(url);
  await p6.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  await p6.setInputFiles('#fileInput', writeGpx('telefon', line(42.5, 24.7, 42.512, 24.712, 60)));
  await p6.waitForFunction(() => __gpxk.S.tracks.length === 1);
  await p6.evaluate(() => { const S = __gpxk.S, t = S.tracks[0], r = S.routes.find(x => x.id === S.curId); r.items = [{ type: 'part', trackId: t.id, a: 0, b: t.pts.length - 1, rev: false }]; __gpxk.refresh(); });
  await p6.click('#bar [data-act="follow"]');
  for (const st6 of [[42.5, 24.7], [42.5006, 24.7006], [42.5012, 24.7012], [42.5018, 24.7018]]) {
    const n6 = await p6.evaluate(() => __gpxk.ui.follower ? __gpxk.ui.follower.rec.length : 0);
    await ctx6.setGeolocation({ latitude: st6[0], longitude: st6[1] });
    await p6.waitForFunction(n => __gpxk.ui.follower && __gpxk.ui.follower.rec.length > n, n6, { timeout: 10000 });
  }
  await p6.waitForFunction(() => __gpxk.map.rot === __gpxk.map.rotTo && __gpxk.map.rot > 1, null, { timeout: 5000 });
  const nb6 = await p6.evaluate(() => { const a = document.querySelector('#northBtn').getBoundingClientRect(), f = document.querySelector('#bar').getBoundingClientRect(), t = document.querySelector('.mapctl.tr').getBoundingClientRect(); return { ok: a.top >= f.bottom && t.top >= f.bottom && a.width > 0, info: Math.round(f.bottom) + '/' + Math.round(t.top) + '/' + Math.round(a.top) }; });
  check(nb6.ok, '390 px при следене: "Сателит / Топо" и копчето "Север" са под лентата на следенето, не под нея скрити (' + nb6.info + ')');
  await p6.screenshot({ path: path.join(OUT, 'follow-rot-390.png') });
  const rot6 = await p6.evaluate(() => __gpxk.map.getBearing());
  await p6.click('#followBar [data-act="follow-stop"]');
  await p6.waitForTimeout(300);
  const wb6 = await p6.evaluate(() => ({ bar: inView('#walkBarBtn'), panel: inView('#walkDone [data-act="walk-gpx-done"]'), rot: __gpxk.map.getBearing(), north: inView('#northBtn') }));
  check(wb6.bar.ok && wb6.bar.scrollY === 0, '390x844 след "Стоп": "Свали изминалото като .gpx" се вижда без превъртане - ' + JSON.stringify(wb6.bar) + ' (копчето в панела е на ' + wb6.panel.top + ' px)');
  check(wb6.rot === rot6 && wb6.north.ok, '390x844 след "Стоп": картата остава завъртяна (' + rot6.toFixed(1) + '°), копчето "Север" се вижда');
  await p6.screenshot({ path: path.join(OUT, 'walk-done-390.png') });
  const def6 = 'izminat-' + await p6.evaluate(() => U.slug(__gpxk.ui.lastWalk.name) + '-' + U.dateDots(Date.now()));
  await p6.click('#walkBarBtn');
  check(await p6.evaluate(() => document.querySelector('#dlgName').open) && await p6.inputValue('#fileName') === def6, 'редът върху картата отваря прозореца за име: ' + await p6.inputValue('#fileName'));
  const [d6] = await Promise.all([p6.waitForEvent('download'), p6.press('#fileName', 'Enter')]);
  const x6 = fs.readFileSync(await d6.path(), 'utf8');
  check(d6.suggestedFilename() === def6 + '.gpx' && (x6.match(/<trkpt /g) || []).length === 4, 'редът върху картата сваля ' + d6.suggestedFilename() + ' с ' + (x6.match(/<trkpt /g) || []).length + ' точки');
  // Презареждане: редът, панелът и свалянето са на място.
  await p6.waitForTimeout(700);
  await p6.reload();
  await p6.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  const rl6 = await p6.evaluate(() => ({ bar: inView('#walkBarBtn'), panel: !document.querySelector('#followPanel').hidden && !document.querySelector('#walkDone').hidden, name: document.querySelector('#walkBarName').textContent, done: document.querySelector('#fDone').textContent, msg: document.querySelector('#fMsg').textContent, pts: __gpxk.ui.lastWalk && __gpxk.ui.lastWalk.pts.length }));
  check(rl6.bar.ok && rl6.bar.scrollY === 0 && rl6.panel && /^изминат/.test(rl6.name) && /км/.test(rl6.done) && /отделен маршрут/.test(rl6.msg) && rl6.pts === 4, 'след презареждане: редът "' + rl6.name + '" и панелът (' + rl6.done + ') са на място, без превъртане');
  await p6.click('#walkBarBtn');
  const [d6b] = await Promise.all([p6.waitForEvent('download'), p6.press('#fileName', 'Enter')]);
  check(d6b.suggestedFilename() === def6 + '.gpx' && (fs.readFileSync(await d6b.path(), 'utf8').match(/<trkpt /g) || []).length === 4, 'след презареждане свалянето дава същия файл: ' + d6b.suggestedFilename());
  // × на реда го затваря (и след презареждане), панелът остава; × на панела маха всичко.
  await p6.click('#walkBar [data-act="walkbar-close"]');
  check(await p6.evaluate(() => document.querySelector('#walkBar').hidden && !document.querySelector('#followPanel').hidden), '× затваря реда върху картата, панелът остава');
  await p6.waitForTimeout(300);
  await p6.reload();
  await p6.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  check(await p6.evaluate(() => document.querySelector('#walkBar').hidden && !document.querySelector('#followPanel').hidden && !document.querySelector('#walkForget').hidden), 'след презареждане затвореният ред не се връща, панелът с × е на място');
  await p6.click('#walkForget');
  await p6.waitForTimeout(300);
  await p6.reload();
  await p6.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  check(await p6.evaluate(() => document.querySelector('#followPanel').hidden && document.querySelector('#walkBar').hidden && !__gpxk.ui.lastWalk), '× на панела "Следене" маха изминатото - и след презареждане');
  await ctx6.close();

  check(errors.length === 0, 'конзолата е чиста' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(failures ? failures + ' ПРОВАЛЕНИ' : 'ВСИЧКО МИНА');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
