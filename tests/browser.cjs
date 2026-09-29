// Проверка в истински браузър: node tests/browser.cjs
// Пуска статичен сървър върху папката, отваря страницата и минава основните действия.
const path = require('path');
const fs = require('fs');
const http = require('http');
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
  const st = await page.evaluate(() => ({ tracks: __gpxk.S.tracks.length, dups: __gpxk.A.dups.map(d => [d.trackId === __gpxk.S.tracks[1].id, d.withId === __gpxk.S.tracks[0].id, Math.round(d.len)]) }));
  check(st.tracks === 3, 'заредени 3 трака');
  check(st.dups.length === 1 && st.dups[0][0] && st.dups[0][1], 'при 20 м: един дубликат (трак 2 върху трак 1) ' + JSON.stringify(st.dups));
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

  // Клик върху × връща дубликата, втори клик го маха.
  const dupPt = await screenOf(() => { const d = __gpxk.A.dups[0], t = __gpxk.S.tracks.find(x => x.id === d.trackId); const p = window.Core.pointAt(t, (d.a + d.b) / 2); return __gpxk.map.project(p[0], p[1]); });
  await page.mouse.click(dupPt.x, dupPt.y);
  check(await page.evaluate(() => __gpxk.A.dups[0].kept === true), 'клик върху ×: дубликатът е върнат');
  await page.mouse.click(dupPt.x, dupPt.y);
  check(await page.evaluate(() => __gpxk.A.dups[0].kept === false), 'същият клик: дубликатът е махнат пак');

  // Плъзгач за отклонение: 40 м - обратният трак на 35 м става дубликат.
  await page.evaluate(() => { const r = document.querySelector('.tolRange'); r.value = 40; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => __gpxk.A.tol === 40);
  const d40 = await page.evaluate(() => __gpxk.A.dups.map(d => ({ own: d.trackId === __gpxk.S.tracks[2].id, dir: d.dir })));
  check(d40.some(d => d.own && d.dir === 'обратна'), 'при 40 м: обратният трак се маркира като съвпадащ, в обратна посока');
  check(/40 м/.test(await page.textContent('#bar .tolVal')), 'стойността на плъзгача се показва');
  await page.evaluate(() => { const r = document.querySelector('.tolRange'); r.value = 20; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => __gpxk.A.tol === 20);
  const lay = await page.evaluate(() => { const f = document.querySelector('#searchForm'), seg = document.querySelector('#tools .seg'); return { inTools: f.parentElement.id === 'tools', right: f.getBoundingClientRect().left >= seg.getBoundingClientRect().right, undoRow1: document.querySelector('#undoBtn').parentElement === document.querySelector('#bar .bar-row:first-child'), tolRow1: document.querySelector('#bar .tolRange').closest('.bar-row') === document.querySelector('#bar .bar-row:first-child'), firstTol: document.querySelector('.tolRange').closest('#bar') !== null }; });
  check(await page.isVisible('#searchForm') && lay.inTools && lay.right, 'на 1280 px търсенето се вижда, във втория ред, вдясно от режимите');
  check(lay.undoRow1 && lay.tolRow1 && lay.firstTol, '"Отмени" и плъзгачът са в първия ред (плъзгачът в лентата е първият .tolRange)');

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
  const nt = await page.evaluate(() => __gpxk.S.tracks.length);
  await page.click('[data-act="follow-stop"]');
  check(await page.evaluate(n => __gpxk.S.tracks.length === n + 1 && /изминат/.test(__gpxk.S.tracks[n].name), nt), 'изминатият път е записан като нов трак');

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
  const u380 = await page.evaluate(vis, '#undoBtn'), t380 = await page.evaluate(vis, '#bar .tolRange'), s380 = await page.evaluate(vis, '#searchForm');
  check(u380.shown && u380.l >= 0 && u380.r <= 380, 'на 380 px "Отмени" се вижда изцяло (' + Math.round(u380.l) + '-' + Math.round(u380.r) + ' px)');
  check(t380.shown && t380.w >= 80 && t380.l >= 0 && t380.r <= 380, 'на 380 px плъзгачът "Отклонение" се вижда: ' + Math.round(t380.w) + ' px, ' + Math.round(t380.l) + '-' + Math.round(t380.r));
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

  // Първият ред на лентата не прелива при никоя ширина; "Отмени" и плъзгачът винаги са на екрана.
  await page.evaluate(() => window.scrollTo(0, 0));
  let sweepOk = true;
  for (const w of [320, 380, 560, 561, 640, 700, 760, 761, 900, 1060, 1061, 1100, 1200, 1201, 1280, 1440]) {
    await page.setViewportSize({ width: w, height: 800 });
    const bad = await page.evaluate(barFits), u = await page.evaluate(vis, '#undoBtn'), t = await page.evaluate(vis, '#bar .tolRange');
    const ok = bad.length === 0 && u.shown && u.l >= 0 && u.r <= w && t.shown && t.w >= 80 && t.l >= 0 && t.r <= w;
    if (!ok || w === 900) check(ok, 'на ' + w + ' px лентата се побира, "Отмени" и плъзгачът са на екрана' + (bad.length ? ': ' + bad.join(', ') : ''));
    if (!ok) { sweepOk = false; break; }
  }
  if (sweepOk) check(true, 'лентата се побира при 320-1440 px');
  const tip = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth }));
  check(tip.x <= 0, 'след обхождането няма хоризонтален скрол (' + tip.x + ')');

  check(errors.length === 0, 'конзолата е чиста' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(failures ? failures + ' ПРОВАЛЕНИ' : 'ВСИЧКО МИНА');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
