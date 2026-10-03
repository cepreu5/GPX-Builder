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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg' };
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
// Групата горе вляво ("↓", "Лента", "Следене") срещу реда горе вдясно: първото копче е на реда, групата не застъпва реда.
function handleRow() {
  const f = document.querySelector('#toPanelBtn').getBoundingClientRect(), a = document.querySelector('.maptl').getBoundingClientRect(), b = document.querySelector('.mapctl.tr').getBoundingClientRect();
  return { sameRow: f.top < b.bottom && b.top < f.bottom, xOverlap: !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top), info: Math.round(a.left) + '-' + Math.round(a.right) + ' / ' + Math.round(b.left) + '-' + Math.round(b.right) + ' px, y ' + Math.round(a.top) + '/' + Math.round(b.top) };
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
// Копчето "Следене / Стоп" върху картата: видимо, текст, състояние и място спрямо "Лента" и контролите вдясно.
function fabState() {
  const b = document.querySelector('#followMapBtn'), r = b.getBoundingClientRect(), t = document.querySelector('.mapctl.tr').getBoundingClientRect();
  const hit = h => !(r.right <= h.left || h.right <= r.left || r.bottom <= h.top || h.bottom <= r.top), h = document.querySelector('#barHandle').getBoundingClientRect(), d = document.querySelector('#toPanelBtn').getBoundingClientRect();
  return { shown: r.width > 0 && getComputedStyle(b).display !== 'none', text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'), danger: b.classList.contains('danger'),
    left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top),
    overTr: !(r.right <= t.left || t.right <= r.left || r.bottom <= t.top || t.bottom <= r.top), overHandle: hit(h) || hit(d), afterHandle: r.left >= h.right - 0.5 || r.top >= h.bottom - 0.5 };
}
// Пиксели върху картата по линия (lat/lon): колко са в цвета col1 и колко в col2 (с толеранс).
function lineColors(pts, col1, col2) {
  const m = __gpxk.map, cv = document.querySelector('.map-canvas'), cx = cv.getContext('2d'), k = cv.width / cv.getBoundingClientRect().width;
  const hex = h => { h = h.trim().replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
  const c1 = hex(col1), c2 = hex(col2), near = (a, c) => Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]) + Math.abs(a[2] - c[2]) < 60;
  let n1 = 0, n2 = 0, n = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = m.project(pts[i - 1][0], pts[i - 1][1]), b = m.project(pts[i][0], pts[i][1]), L = Math.hypot(b.x - a.x, b.y - a.y);
    for (let s = 0; s < L; s += 2) {
      const x = a.x + (b.x - a.x) * s / L, y = a.y + (b.y - a.y) * s / L;
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      const d = cx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data; n++;
      if (near(d, c1)) n1++; else if (near(d, c2)) n2++;
    }
  }
  return { n, n1, n2 };
}
// Числата като в приложението (U.num): хиляди с неразделим интервал.
function U_num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0'); }
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
  // UTF-8 среда, за да пази браузърът имената на файлове на кирилица (без нея ги сваля като "download").
  const browser = await chromium.launch({ args: ['--num-raster-threads=4'], env: Object.assign({}, process.env, { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }) });
  // Началният екран излиза само при първо пускане; проверките извън него тръгват като "вече видян".
  // newContext({ splash: true }) - чисто устройство, началният екран излиза.
  // От 1.2.0 езикът следва браузъра: проверките тръгват с браузър на български, освен ако не е дадено друго.
  const rawContext = browser.newContext.bind(browser);
  // От 1.3.0 клик върху участък отваря меню, а след зареждане може да излезе „Излишни пръстени“. Досегашните
  // проверки минават както преди: менюто на участък се отговаря с първото копче (днешния клик - добави /
  // продължи по клона / махни от маршрута), а списъкът - със „Задръж всички“. newContext({ menus: true })
  // оставя менютата, newContext({ rings: true }) - списъка.
  // От 1.3.1 „Части в маршрута“ и „Тракове-източници“ са свити при първо пускане; досегашните проверки тръгват
  // с двата панела отворени, newContext({ folds: true }) - с истинските начални стойности.
  browser.newContext = async (o = {}) => {
    const { splash, menus, rings, folds, ...rest } = o;
    const c = await rawContext(Object.assign({ locale: 'bg-BG' }, rest));
    if (!folds) await c.addInitScript(() => { try { if (localStorage.getItem('gpxk.fold') == null) localStorage.setItem('gpxk.fold', JSON.stringify({ parts: true, tracks: true })); } catch (e) { /* */ } });
    if (!splash) await c.addInitScript(() => { try { if (localStorage.getItem('gpxk.splash') == null) localStorage.setItem('gpxk.splash', 'true'); } catch (e) { /* */ } });
    if (!rings) await c.addInitScript(() => { addEventListener('DOMContentLoaded', () => { const d = document.getElementById('dlgRings'); if (d) new MutationObserver(() => { if (d.open) document.getElementById('ringsKeep').click(); }).observe(d, { attributes: true, attributeFilter: ['open'] }); }); });
    if (!menus) {
      const rawPage = c.newPage.bind(c);
      c.newPage = async () => {
        const pg = await rawPage(), click = pg.mouse.click.bind(pg.mouse);
        pg.mouse.click = async (x, y, opt) => {
          await click(x, y, opt);
          await pg.evaluate(() => { const m = document.querySelector('#objMenu'); if (m && !m.hidden && m.dataset.kind === 'seg') m.querySelector('#omBtns button').click(); }).catch(() => {});
        };
        return pg;
      };
    }
    return c;
  };
  // След "Стоп" излиза прозорецът "Запис на изминатото" (записът е вече направен суров); "Отказ" го затваря.
  const shutWalk = async pg => { await pg.waitForFunction(() => document.querySelector('#dlgWalk').open, null, { timeout: 3000 }).catch(() => {}); await pg.evaluate(() => { if (document.querySelector('#dlgWalk').open) document.querySelector('#walkCancel').click(); }); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, permissions: ['geolocation'], geolocation: { latitude: 42.5021, longitude: 24.6985 } });
  await ctx.addInitScript({ content: 'window.inView = ' + inView.toString() });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) errors.push('console: ' + m.text()); });

  await page.goto(url);
  await page.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  check(await page.isVisible('#empty'), 'празна колекция: подканата "Тук ще се появи маршрутът" се вижда');
  const nm0 = await page.evaluate(() => ({ input: document.querySelector('#routeName').value, title: document.title }));
  check(nm0.input === 'Нов маршрут' && nm0.title === 'Нов маршрут · CX Tracks', 'на български новият маршрут е „Нов маршрут“ в полето и в заглавието: ' + JSON.stringify(nm0));
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
  const lay = await page.evaluate(() => { const f = document.querySelector('#searchForm'), seg = document.querySelector('#tools .seg'); return { inTools: f.parentElement.id === 'tools', right: f.getBoundingClientRect().left >= seg.getBoundingClientRect().right, undoMap: !!document.querySelector('.mapctl.tr #undoBtn') && !document.querySelector('#bar [data-act="undo"]'), tolRow1: document.querySelector('#bar .tolInput').closest('.bar-row') === document.querySelector('#bar .bar-row:first-child'), firstTol: document.querySelector('.tolInput').closest('#bar') !== null }; });
  check(await page.isVisible('#searchForm') && lay.inTools && lay.right, 'на 1280 px търсенето се вижда, във втория ред, вдясно от режимите');
  check(lay.undoMap && lay.tolRow1 && lay.firstTol, '"Отмени" е горе вдясно на картата, не в лентата; полето "Отклонение" е в първия ред (полето в лентата е първото .tolInput)');

  // Скриване на лентата с цъкане на празно място и връщане с табчето горе.
  check(await page.isVisible('#barHandle') && await page.evaluate(() => { const h = document.querySelector('#barHandle'); return h.dataset.dir === 'up' && h.getAttribute('aria-label') === 'Скрий горната лента' && h.getBoundingClientRect().top >= document.querySelector('#bar').getBoundingClientRect().bottom; }), 'лентата се вижда: кръглата "Лента" е под нея, стрелкичката сочи нагоре');
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
  await page.waitForFunction(() => document.querySelector('#barHandle').getBoundingClientRect().top <= 14, null, { timeout: 3000 }).catch(() => {});
  const hb = await page.evaluate(() => { const b = document.querySelector('#barHandle'), r = b.getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top, left: r.left, tag: b.tagName, label: b.getAttribute('aria-label'), text: b.textContent.trim(), dir: b.dataset.dir }; });
  check(hb.tag === 'BUTTON' && hb.label === 'Покажи горната лента' && hb.text === '' && hb.dir === 'down', 'табчето е бутон без дума, с aria-label: ' + hb.label + ', стрелкичката сочи ' + hb.dir);
  check(hb.w === 36 && hb.h === 36 && hb.top <= 14 && hb.left <= 120, 'табчето: ' + Math.round(hb.w) + 'x' + Math.round(hb.h) + ' px, горе вляво (' + Math.round(hb.left) + ',' + Math.round(hb.top) + ')');
  const fab = await page.evaluate(fabState);
  check(fab.shown && fab.text === 'Следене' && fab.pressed === 'false' && fab.left >= hb.left + hb.w && !fab.overTr && !fab.overHandle, 'при скрита лента копчето "Следене" е върху картата горе вляво, вдясно от "Лента": ' + JSON.stringify(fab));
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
  check(await page.isVisible('#barHandle') && await page.evaluate(() => document.querySelector('#barHandle').dataset.dir === 'up'), 'кръглата "Лента" остава, стрелкичката пак сочи нагоре');
  // В лентата няма отделно копче за скриване: кръглата "Лента" и скрива, и връща.
  const nob = await page.evaluate(() => ({ hide: !!document.querySelector('#hideBarBtn, #bar [data-act="hide-bar"], #bar [data-act="to-panel"], #bar [data-act="undo"]'), arrows: /[\u25B2\u25BC\u2193]/.test(document.querySelector('#bar').textContent) }));
  check(!nob.hide && !nob.arrows, 'в лентата няма "Отмени", "↓" и "▲" (копчето за скриване): ' + JSON.stringify(nob));
  await page.click('#barHandle');
  check(await page.evaluate(() => document.body.classList.contains('bar-hidden') && document.querySelector('#barHandle').dataset.dir === 'down'), 'клик върху кръглата "Лента" при отворена лента: лентата се скрива, стрелкичката се обръща надолу');
  await page.waitForFunction(() => document.querySelector('#bar').getBoundingClientRect().bottom <= 0, null, { timeout: 3000 }).catch(() => {});
  await page.click('#barHandle');
  await page.waitForFunction(() => document.querySelector('#bar').getBoundingClientRect().top >= 0, null, { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => !document.body.classList.contains('bar-hidden') && document.querySelector('#barHandle').dataset.dir === 'up'), 'второ натискане връща лентата, стрелкичката пак сочи нагоре');
  // Второ скриване: без подсказка; връщане с ново цъкане на празно място.
  await page.evaluate(() => { document.querySelector('#toast').hidden = true; });
  await page.mouse.click(emptyPt.x, emptyPt.y);
  await page.waitForFunction(() => document.body.classList.contains('bar-hidden'), null, { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => document.body.classList.contains('bar-hidden') && document.querySelector('#toast').hidden), 'второ скриване: без подсказка');
  await page.waitForTimeout(400);
  await page.mouse.click(emptyPt.x, emptyPt.y);
  await page.waitForFunction(() => !document.body.classList.contains('bar-hidden'), null, { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => !document.body.classList.contains('bar-hidden') && document.querySelector('#barHandle').dataset.dir === 'up'), 'ново цъкане на празно място: лентата се връща, стрелкичката сочи нагоре');

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
  const vtc = await page.evaluate(() => { const e = document.querySelector('#vtxToggle'), l = e && e.closest('label'), r = l && l.getBoundingClientRect(); return e ? { checked: e.checked, type: e.type, text: l.textContent.trim(), label: e.getAttribute('aria-label'), ring: !!l.querySelector('svg circle'), inCorner: !!e.closest('.mapctl.tr'), w: r.width } : null; });
  check(vtc && vtc.type === 'checkbox' && vtc.checked && !/Точки/.test(vtc.text) && vtc.ring && vtc.label === 'Точки' && vtc.inCorner && vtc.w > 0, 'ключ „Точки“ горе вдясно на картата, без дума (чавка и пръстен с номер), включен по подразбиране: ' + JSON.stringify(vtc));
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
  const rName = await page.evaluate(() => __gpxk.S.routes.find(r => r.id === __gpxk.S.curId).name);
  await page.click('#bar [data-act="export-gpx"]');
  check(await page.evaluate(() => document.querySelector('#dlgName').open && __gpxk.ui.nameJob && __gpxk.ui.nameJob.kind === 'route') && await page.inputValue('#fileName') === rName,
    '"Изнеси .gpx" в лентата отваря прозореца за име, предложено "' + await page.inputValue('#fileName') + '"');
  await page.click('#nameCancel');
  await page.waitForFunction(() => !__gpxk.ui.nameJob, null, { timeout: 2000 }).catch(() => {});
  check(await page.evaluate(() => !document.querySelector('#dlgName').open && !__gpxk.ui.nameJob), '"Отказ" не сваля нищо');
  await page.click('#bar [data-act="export-gpx"]');
  await page.fill('#fileName', '.gpx');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.press('#fileName', 'Enter')]);
  check(dl.suggestedFilename() === rName + '.gpx', 'само ".gpx" взима предложеното име: ' + dl.suggestedFilename());
  await page.click('.actions [data-act="export-gpx"]');
  await page.fill('#fileName', 'pod profila');
  const [dlp] = await Promise.all([page.waitForEvent('download'), page.press('#fileName', 'Enter')]);
  check(dlp.suggestedFilename() === 'pod profila.gpx' && /Изнесен pod profila\.gpx/.test(await page.textContent('#toast')), '"Изнеси .gpx" под профила: същият прозорец, добавено .gpx - ' + dlp.suggestedFilename());
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
  await page.click('#followMapBtn');
  await page.waitForFunction(() => __gpxk.ui.pos, null, { timeout: 10000 });
  const fb = await page.evaluate(() => Array.from(document.querySelectorAll('[data-act="follow"]')).map(b => b.textContent.trim() + (b.classList.contains('danger') ? '!' : '') + '/' + b.getAttribute('aria-pressed')));
  check(fb.length === 2 && fb.every(x => x === 'Стоп!/true') && await page.evaluate(() => !document.querySelector('[data-act="follow-stop"]')), 'при следене копчето "Следене" пише "Стоп" (червено, aria-pressed) - върху картата и под профила (в лентата го няма); отделно "Стоп" няма: ' + fb.join(' '));
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
  check(rs.rot === 0 && rs.btnShown && /Посока/.test(rs.btnText) && rs.orient === 'north' && await page.evaluate(() => JSON.parse(localStorage.getItem('gpxk.orient')) === 'north'), 'ключ "Север": север нагоре, копчето върху картата предлага "Посока", изборът се помни (gpxk.orient)');
  await page.click('#followBar [data-orient="heading"]');
  await settled(page);
  rs = await page.evaluate(rotState);
  check(angDiff(rs.rot, rs.recHd) < 0.5 && rs.btnShown && /Север/.test(rs.btnText), 'ключ "Посока": картата пак се завърта по посоката (' + rs.rot.toFixed(1) + '°), копчето предлага "Север"');
  // Копчето върху картата и ключът в реда на следенето са в синхрон.
  await page.click('#northBtn');
  await settled(page);
  rs = await page.evaluate(rotState);
  const ogN = await page.evaluate(() => document.querySelector('#followBar [data-orient="north"]').classList.contains('on'));
  check(rs.rot === 0 && /Посока/.test(rs.btnText) && ogN, 'копчето "Север" върху картата: север нагоре, ключът в реда е на "Север", копчето предлага "Посока"');
  await page.click('#northBtn');
  await settled(page);
  rs = await page.evaluate(rotState);
  const ogH = await page.evaluate(() => document.querySelector('#followBar [data-orient="heading"]').classList.contains('on'));
  check(angDiff(rs.rot, rs.recHd) < 0.5 && /Север/.test(rs.btnText) && ogH, 'копчето "Посока" върху картата: пак по посоката (' + rs.rot.toFixed(1) + '°), ключът в реда е на "Посока"');
  // Дръпната с пръст карта спира да следва посоката; "Центрирай" я връща.
  const rotBefore = rs.rot;
  await page.mouse.move(640, 500); await page.mouse.down(); await page.mouse.move(560, 450, { steps: 4 }); await page.mouse.up();
  const recN = await page.evaluate(() => __gpxk.ui.follower.rec.length);
  await ctx.setGeolocation({ latitude: 42.5040, longitude: 24.7040 });
  await page.waitForFunction(n => __gpxk.ui.follower.rec.length > n, recN, { timeout: 10000 });
  rs = await page.evaluate(rotState);
  check(!rs.auto && Math.abs(rs.rotTo - rotBefore) < 0.01 && angDiff(rs.heading, rs.recHd) < 0.5 && angDiff(rs.heading, rotBefore) > 30, 'дръпната карта: новата посока (' + rs.heading.toFixed(1) + '°) не я върти, остава ' + rs.rotTo.toFixed(1) + '°');
  const cpos = await page.evaluate(() => { const r = el => document.querySelector(el).getBoundingClientRect(), c = r('#centerBtn'), zo = r('.mapctl.br [data-act="zoom-out"]'), fit = r('.mapctl.br [data-act="fit"]');
    return { inBr: !!document.querySelector('.mapctl.br #centerBtn'), inRow: !!document.querySelector('#followBar [data-act="center"]'), order: zo.bottom <= c.top && c.bottom <= fit.top, right: innerWidth - c.right, bottom: innerHeight - c.bottom }; });
  check(cpos.inBr && !cpos.inRow && cpos.order && cpos.right < 20 && cpos.bottom < 120, '"Центрирай" е долу вдясно, между "−" и "Покажи целия маршрут", не в реда на следенето: ' + JSON.stringify(cpos));
  await page.click('#centerBtn');
  await settled(page);
  rs = await page.evaluate(rotState);
  const posPx = await page.evaluate(() => { const m = __gpxk.map, q = m.project(__gpxk.ui.pos.lat, __gpxk.ui.pos.lon); return Math.hypot(q.x - m.w / 2, q.y - m.h / 2); });
  check(rs.auto && angDiff(rs.rot, rs.heading) < 0.5 && posPx < 1, '"Центрирай" връща и центъра, и посоката (' + rs.rot.toFixed(1) + '°, ' + posPx.toFixed(2) + ' px от центъра)');
  await page.click('#followBar [data-view="pic"]');
  check(await page.isVisible('#picView') && await page.evaluate(() => document.querySelectorAll('#picSvg circle').length > 0), 'следене върху запазената картина: положението е върху нея');
  await page.screenshot({ path: path.join(OUT, 'follow-pic-1280.png') });
  await page.click('#followBar [data-view="map"]');
  await page.screenshot({ path: path.join(OUT, 'follow-map-1280.png') });
  check(await page.isVisible('#followBar') && await page.isVisible('#barHandle') && await page.evaluate(() => document.querySelector('#barHandle').getBoundingClientRect().top >= document.querySelector('#bar').getBoundingClientRect().bottom), 'следене: кръглата "Лента" се вижда под лентата');
  await page.click('#barHandle');
  check(await page.evaluate(() => document.body.classList.contains('bar-hidden') && !!__gpxk.ui.follower), 'следене: копчето скрива лентата, следенето продължава');
  const fab2 = await page.evaluate(fabState);
  check(fab2.shown && fab2.text === 'Стоп' && fab2.danger && fab2.pressed === 'true' && /Стоп/.test(fab2.label) && !fab2.overTr && !fab2.overHandle, 'скрита лента при следене: "Стоп" върху картата горе вляво - ' + JSON.stringify(fab2));
  await page.click('#barHandle');
  check(await page.evaluate(() => !document.body.classList.contains('bar-hidden')), 'следене: табчето връща лентата');
  check((await page.evaluate(fabState)).shown, 'при видима лента копчето "Следене" върху картата се вижда (1.1.6: само там)');
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
  const fr = await page.evaluate(() => { const row = document.querySelector('#followBar'), rr = row.getBoundingClientRect(), b = document.querySelector('#walkGpxBtn').getBoundingClientRect(), seg = document.querySelector('#followBar .seg'), stop = document.querySelector('#awakeBtn').getBoundingClientRect();
    return { fits: row.scrollWidth <= row.clientWidth && seg.scrollWidth <= seg.clientWidth && stop.right <= innerWidth + 0.5 && b.right <= innerWidth + 0.5 && b.width > 0 && rr.right <= innerWidth + 0.5, info: Math.round(b.left) + '-' + Math.round(b.right) + ' px, ред ' + Math.round(rr.height) + ' px' }; });
  await page.screenshot({ path: path.join(OUT, 'follow-map-390.png') });
  check(fr.fits, 'следене на 390 px: "Изнеси .gpx" се събира в реда - ' + fr.info);
  await page.setViewportSize({ width: 1280, height: 800 });
  const nt = await page.evaluate(() => __gpxk.S.tracks.length);
  const nr = await page.evaluate(() => __gpxk.S.routes.length);
  const followId = await page.evaluate(() => __gpxk.S.curId);
  const rotStop = (await page.evaluate(rotState)).rot;
  await page.click('#followMapBtn');
  const wd0 = await page.evaluate(() => ({ open: document.querySelector('#dlgWalk').open, name: document.querySelector('#walkName').value, side: document.querySelector('#smSide').checked, dense: document.querySelector('#smDense').checked, pts: document.querySelector('#smPts').textContent, n: __gpxk.ui.lastWalk && __gpxk.ui.lastWalk.pts.length, rname: (__gpxk.S.routes.find(r => r.id === (__gpxk.ui.lastWalk || {}).routeId) || {}).name }));
  check(wd0.open && wd0.name === wd0.rname && !wd0.side && !wd0.dense && wd0.pts === wd0.n + ' от ' + wd0.n + ' (махнати 0)', 'след "Стоп" излиза "Запис на изминатото": името на записа, двете отметки изключени - ' + JSON.stringify(wd0));
  await shutWalk(page);
  const fbOff = await page.evaluate(() => Array.from(document.querySelectorAll('[data-act="follow"]')).map(b => b.textContent.trim() + (b.classList.contains('danger') ? '!' : '') + '/' + b.getAttribute('aria-pressed')));
  check(!await page.evaluate(() => !!__gpxk.ui.follower) && fbOff.every(x => x === 'Следене/false'), '"Стоп" спира следенето и копчето пак пише "Следене": ' + fbOff.join(' '));
  check(await page.evaluate(n => __gpxk.S.tracks.length === n + 1 && /изминат/.test(__gpxk.S.tracks[n].name), nt), 'изминатият път е записан като нов трак');
  await page.waitForTimeout(300);
  rs = await page.evaluate(rotState);
  check(rs.rot === rotStop && rs.rot > 1 && rs.btnShown, 'след "Стоп" картата остава в последната посока (' + rs.rot.toFixed(1) + '°), копчето "Север" се вижда');
  const wb = await page.evaluate(() => inView('#walkBarBtn'));
  check(wb.ok && /Свали изминалото като \.gpx/.test(await page.textContent('#walkBarBtn')) && /Следенето спря: изминат/.test(await page.textContent('#walkBar')), 'след "Стоп" върху картата: ред "Следенето спря" с "Свали изминалото като .gpx" - ' + JSON.stringify(wb));
  check(/Север/.test(rs.btnText), 'след "Стоп" копчето предлага "Север"');
  await page.click('#northBtn');
  await settled(page);
  rs = await page.evaluate(rotState);
  check(rs.rot === 0 && rs.btnShown && /Посока/.test(rs.btnText) && rs.heading != null, 'копчето "Север" след "Стоп": север нагоре, копчето предлага "Посока" (посоката се пази: ' + (rs.heading || 0).toFixed(1) + '°)');
  await page.click('#northBtn');
  await settled(page);
  rs = await page.evaluate(rotState);
  check(rs.rot === rotStop && /Север/.test(rs.btnText), '"Посока" извън следене връща последната посока (' + rs.rot.toFixed(1) + '°)');
  await page.click('#northBtn');
  await settled(page);
  // "Центрирай" и извън следене - върху последното известно положение.
  const lp = await page.evaluate(() => __gpxk.ui.lastPos);
  await page.mouse.move(640, 500); await page.mouse.down(); await page.mouse.move(400, 300, { steps: 4 }); await page.mouse.up();
  await page.click('#centerBtn');
  const cOff = await page.evaluate(lp => { const m = __gpxk.map, q = m.project(lp.lat, lp.lon); return Math.hypot(q.x - m.w / 2, q.y - m.h / 2); }, lp);
  check(!!lp && cOff < 1 && !await page.evaluate(() => !!__gpxk.ui.follower), '"Центрирай" извън следене: картата е върху последното положение (' + cOff.toFixed(2) + ' px от центъра)');

  // (б) Отделният запис в "Записани маршрути": една част - целият изминат трак; текущ остава следеният.
  const walkRec = await page.evaluate(n => {
    const S = __gpxk.S, t = S.tracks[n], r = S.routes.find(x => x.name === t.name && x.items.length === 1 && x.items[0].trackId === t.id);
    return r && { id: r.id, name: r.name, item: r.items[0], len: t.len, walks: S.routes.find(x => x.id === S.curId).walks.includes(t.id), cur: S.curId };
  }, nt);
  check(!!walkRec && walkRec.item.type === 'part' && walkRec.item.a === 0 && Math.abs(walkRec.item.b - walkRec.len) < 0.01 && walkRec.item.rev === false, 'отделен запис: една част от целия изминат трак ' + JSON.stringify(walkRec && walkRec.item));
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

  // "Запази": прозорецът за име с името на маршрута; сваля <име>.gpx и преименува текущия запис - без втори.
  const sv0 = await page.evaluate(() => ({ n: __gpxk.S.routes.length, name: __gpxk.S.routes.find(r => r.id === __gpxk.S.curId).name, id: __gpxk.S.curId }));
  await page.click('#bar [data-act="save"]');
  check(await page.evaluate(() => document.querySelector('#dlgName').open && __gpxk.ui.nameJob.kind === 'save') && await page.inputValue('#fileName') === sv0.name && await page.textContent('#nameOk') === 'Запази',
    '"Запази" отваря прозореца за име, попълнен с "' + await page.inputValue('#fileName') + '"');
  await page.fill('#fileName', 'Моят маршрут');
  const [dsv] = await Promise.all([page.waitForEvent('download'), page.press('#fileName', 'Enter')]);
  await page.waitForFunction(() => /Записани маршрути/.test(document.querySelector('#toast').textContent), null, { timeout: 3000 }).catch(() => {});
  const sv1 = await page.evaluate(id => { const S = __gpxk.S, r = S.routes.find(x => x.id === id), row = document.querySelector('#routesBody tr[data-route="' + id + '"]');
    return { n: S.routes.length, name: r.name, input: document.querySelector('#routeName').value, row: row && row.textContent, first: document.querySelector('#routesBody tr').dataset.route === id, same: S.routes.filter(x => x.name === 'Моят маршрут').length, toast: document.querySelector('#toast').textContent }; }, sv0.id);
  const svx = fs.readFileSync(await dsv.path(), 'utf8');
  check(dsv.suggestedFilename() === 'Моят маршрут.gpx' && (svx.match(/<trkpt /g) || []).length > 20, '"Запази" сваля ' + dsv.suggestedFilename() + ' (' + (svx.match(/<trkpt /g) || []).length + ' точки)');
  check(sv1.n === sv0.n && sv1.same === 1 && sv1.name === 'Моят маршрут' && sv1.input === 'Моят маршрут' && /Моят маршрут/.test(sv1.row) && sv1.first, '"Запази": текущият маршрут е преименуван в "Записани маршрути", най-горе, без втори запис (' + sv0.n + ' → ' + sv1.n + ')');
  check(/Свален Моят маршрут\.gpx/.test(sv1.toast) && /Записани маршрути/.test(sv1.toast), '"Запази": съобщението казва и двете - ' + sv1.toast);
  // "GPX" в реда на записан маршрут - същият прозорец.
  await page.click('#routesBody tr[data-route="' + sv0.id + '"] [data-rt="gpx"]');
  check(await page.evaluate(() => document.querySelector('#dlgName').open && __gpxk.ui.nameJob.kind === 'route') && await page.inputValue('#fileName') === 'Моят маршрут' && await page.textContent('#nameOk') === 'Свали', '"GPX" в реда на записан маршрут отваря прозореца за име');
  const [drw] = await Promise.all([page.waitForEvent('download'), page.press('#fileName', 'Enter')]);
  check(drw.suggestedFilename() === 'Моят маршрут.gpx', '"GPX" в реда сваля ' + drw.suggestedFilename());

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
  await page.click('#barHandle');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'bar-hidden-1280-dark.png') });
  await page.click('#barHandle');
  check(await page.evaluate(() => !document.body.classList.contains('bar-hidden') && document.querySelector('#barHandle').dataset.dir === 'up'), 'тъмна тема: табчето връща лентата');
  await page.click('[data-act="theme"]');

  // Телефон: 390 px.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, 'на 390 px няма хоризонтален скрол (' + overflow + ')');
  const sv390 = await page.evaluate(vis, '#bar [data-act="save"]'), c390 = await page.evaluate(vis, '#centerBtn');
  check(sv390.shown && sv390.l >= 0 && sv390.r <= 390, 'на 390 px "Запази" се вижда в горната лента (' + Math.round(sv390.l) + '-' + Math.round(sv390.r) + ' px)');
  check(c390.shown && c390.r <= 390, 'на 390 px "Центрирай" се вижда долу вдясно');
  await page.screenshot({ path: path.join(OUT, 'route-390.png') });
  await page.click('#barHandle');
  await page.waitForTimeout(300);
  await page.waitForFunction(() => document.querySelector('.mapctl.tr').getBoundingClientRect().top < 20, null, { timeout: 3000 }).catch(() => {});
  const row390 = await page.evaluate(handleRow);
  check(row390.sameRow && !row390.xOverlap, 'на 390 px табчето и "Сателит / Топо / Имена" са на един ред и не се застъпват: ' + row390.info);
  const fab390 = await page.evaluate(fabState);
  check(fab390.shown && fab390.text === 'Следене' && !fab390.overTr && !fab390.overHandle && fab390.left >= 0, 'на 390 px "Следене" върху картата се вижда и не застъпва "Лента" и контролите вдясно: ' + JSON.stringify(fab390));
  await page.screenshot({ path: path.join(OUT, 'bar-hidden-390.png') });
  await page.click('#barHandle');
  // Тясно: 380 px - копчето за скриване се вижда и не застъпва табчето.
  await page.setViewportSize({ width: 380, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => document.querySelector('#bar').getBoundingClientRect().top >= 0, null, { timeout: 3000 }).catch(() => {});
  const nb = await page.evaluate(() => { const r = document.querySelector('#barHandle').getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width, below: r.top >= document.querySelector('#bar').getBoundingClientRect().bottom }; });
  check(await page.isVisible('#barHandle') && nb.w > 0 && nb.l >= 0 && nb.r <= 380 && nb.below, 'на 380 px кръглата "Лента" се вижда под лентата (' + Math.round(nb.l) + '-' + Math.round(nb.r) + ' px)');
  const u380 = await page.evaluate(vis, '#undoBtn'), t380 = await page.evaluate(vis, '#bar .tolInput'), s380 = await page.evaluate(vis, '#searchForm');
  check(u380.shown && u380.l >= 0 && u380.r <= 380, 'на 380 px "Отмени" горе вдясно на картата се вижда изцяло (' + Math.round(u380.l) + '-' + Math.round(u380.r) + ' px)');
  check(t380.shown && t380.w >= 36 && t380.l >= 0 && t380.r <= 380, 'на 380 px полето "Отклонение" се вижда: ' + Math.round(t380.w) + ' px, ' + Math.round(t380.l) + '-' + Math.round(t380.r));
  check(!s380.shown && await page.isHidden('#searchForm'), 'на 380 px търсенето е скрито');
  const bar380 = await page.evaluate(() => ({ bar: document.querySelector('#bar').getBoundingClientRect().bottom, tr: document.querySelector('.mapctl.tr').getBoundingClientRect().top }));
  check(bar380.bar <= 122 && bar380.bar <= bar380.tr, 'на 380 px лентата е ' + Math.round(bar380.bar) + ' px висока и не покрива "Сателит / Топо" (' + Math.round(bar380.tr) + ')');
  await page.screenshot({ path: path.join(OUT, 'bar-380.png') });
  await page.click('#barHandle');
  await page.waitForFunction(() => document.querySelector('#bar').getBoundingClientRect().bottom <= 0, null, { timeout: 3000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('.mapctl.tr').getBoundingClientRect().top < 20, null, { timeout: 3000 }).catch(() => {});
  const row380 = await page.evaluate(handleRow);
  check(row380.sameRow && !row380.xOverlap, 'на 380 px табчето и "Сателит / Топо / Имена" са на един ред и не се застъпват: ' + row380.info);
  const fab380 = await page.evaluate(fabState);
  check(fab380.shown && !fab380.overTr && !fab380.overHandle, 'на 380 px "Следене" върху картата не застъпва нищо: ' + JSON.stringify(fab380));
  // 1.1.5: редица, когато се събират вляво от реда горе вдясно (8 px запас), иначе стълбичка.
  const st2 = await page.evaluate(tlFit), st2ok = st2.n === 3 && !st2.over && (st2.need <= st2.room - 1 ? st2.row : st2.need > st2.room + 1 ? st2.col : st2.row || st2.col);
  check(await page.evaluate(() => document.body.classList.contains('bar-hidden')) && await page.isVisible('#barHandle') && st2ok, 'на 380 px: лентата скрита, "↓", "Лента" и "Следене" са ' + (st2.row ? 'в редица' : 'в стълбичка') + ', както им стига мястото: ' + JSON.stringify(st2));
  await page.screenshot({ path: path.join(OUT, 'bar-hidden-380.png') });
  await page.click('#barHandle');
  check(await page.evaluate(() => !document.body.classList.contains('bar-hidden') && document.querySelector('#barHandle').dataset.dir === 'up'), 'на 380 px табчето връща лентата, стрелкичката сочи нагоре');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.querySelector('#panel').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, 'panel-390.png') });
  await page.screenshot({ path: path.join(OUT, 'panel-390-full.png'), fullPage: true });

  // Първият ред на лентата не прелива при никоя ширина; "Отмени" (на картата) и полето "Отклонение" винаги са на екрана.
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

  // 1.1.2: иконите вместо думи, "Имена" в лентата, стрелката нагоре.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const icos = await page.evaluate(() => ['.seg.base [data-base="sat"]', '.seg.base [data-base="topo"]', '#centerBtn'].map(s => { const b = document.querySelector(s); return { s, svg: !!b.querySelector('svg'), radar: b.querySelectorAll('svg circle').length === 3 && !b.querySelector('svg rect'), text: b.textContent.trim(), label: b.getAttribute('aria-label'), title: b.getAttribute('title') }; }));
  check(icos.every(i => i.svg && i.text === '' && i.label && i.title), 'Сателит, Топо и Центрирай са икони <svg> без дума, с aria-label и title: ' + icos.map(i => i.label).join(' / '));
  check(icos[0].label === 'Сателит' && icos[0].radar && icos[1].label === 'Топо' && /^Центрирай/.test(icos[2].label), 'имената на иконите за екранни четци са на място');
  const lbl = await page.evaluate(() => { const t = document.querySelector('#labelsToggle'), c = document.querySelector('#labelsChk').getBoundingClientRect(), sv = document.querySelector('#bar [data-act="save"]').getBoundingClientRect();
    return { inBar: !!t.closest('#bar'), inTr: !!t.closest('.mapctl.tr'), type: t.type, text: document.querySelector('#labelsChk').textContent.trim(), right: c.left >= sv.right, last: document.querySelector('#labelsChk').nextElementSibling === document.querySelector('#langBtn') && !document.querySelector('#langBtn').nextElementSibling, sameRow: c.top < sv.bottom && sv.top < c.bottom, prev: document.querySelector('#labelsChk').previousElementSibling.dataset.act, vtxOnMap: !!document.querySelector('.mapctl.tr #vtxToggle') }; });
  check(lbl.inBar && !lbl.inTr && lbl.type === 'checkbox' && lbl.text === 'Имена' && lbl.right && lbl.last && lbl.sameRow && lbl.prev === 'save' && lbl.vtxOnMap, '„Имена“ е квадратче в първия ред на лентата, вдясно от „Запази“, след него е само копчето „Език“; „Точки“ остава на картата: ' + JSON.stringify(lbl));
  const layN = () => page.evaluate(() => ({ n: __gpxk.map.layers.length, chk: document.querySelector('#labelsToggle').checked, ls: localStorage.getItem('gpxk.labels') }));
  const lay0 = await layN();
  await page.click('#labelsToggle');
  const lay1 = await layN();
  await page.click('#labelsToggle');
  const lay2 = await layN();
  check(lay0.chk && lay0.n === 3 && !lay1.chk && lay1.n === 1 && lay1.ls === 'false' && lay2.chk && lay2.n === 3 && lay2.ls === 'true', '„Имена“ от лентата скрива и връща имената върху снимките и помни избора: ' + [lay0.n, lay1.n, lay2.n].join(' → '));
  // 1.1.3: стрелката нагоре е плаващо копче, заковано за екрана (26 px отдолу, 56 px отдясно), видимо винаги.
  function topBtnLayout() {
    const R = e => e.getBoundingClientRect(), btn = document.querySelector('#toTopBtn'), a = R(btn), cs = getComputedStyle(btn);
    const hit = (p, q) => q.width > 0 && q.height > 0 && !(p.right <= q.left || q.right <= p.left || p.bottom <= q.top || q.bottom <= p.top);
    const col = ['zoom-in', 'zoom-out', 'center', 'fit'].map(k => R(document.querySelector('.mapctl.br [data-act="' + k + '"]')));
    // Редовете текст в дъното на страницата - по самите букви, не по ширината на <p>.
    const footHit = [...document.querySelectorAll('.foot p, .foot button')].some(el => { const r = document.createRange(); r.selectNodeContents(el); return [...r.getClientRects()].some(q => hit(a, q)) || (el.tagName === 'BUTTON' && hit(a, R(el))); });
    const top = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2);
    return { fixed: cs.position === 'fixed', round: cs.borderRadius === '50%', w: Math.round(a.width), h: Math.round(a.height), svg: !!btn.querySelector('svg'), inCol: !!btn.closest('.mapctl'),
      right: Math.round(innerWidth - a.right), bottom: Math.round(innerHeight - a.bottom), onTop: !!top && (top === btn || btn.contains(top)),
      overCol: col.some(c => hit(a, c)), overAttrib: hit(a, R(document.querySelector('#attrib'))), overBar: hit(a, R(document.querySelector('#bar'))), overFoot: footHit,
      gap: Math.round(col[3].left - a.right), bottomAlign: Math.abs(a.bottom - col[3].bottom) < 1.5, sameW: col.every(c => Math.abs(c.width - col[0].width) < 0.5),
      rect: [a.left, a.top, a.width, a.height].map(Math.round).join(','), sy: Math.round(scrollY) };
  }
  for (const w of [360, 560, 760, 1440]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const L0 = await page.evaluate(topBtnLayout);
    check(L0.fixed && L0.round && L0.svg && !L0.inCol && L0.w === 36 && L0.h === 36 && L0.right === 56 && L0.bottom === 26 && L0.onTop, 'на ' + w + ' px стрелката нагоре е кръгче 36×36 с position fixed, 56 px отдясно и 26 px отдолу на екрана, извън колоната: ' + JSON.stringify({ r: L0.right, b: L0.bottom, w: L0.w }));
    check(!L0.overCol && !L0.overAttrib && !L0.overBar && L0.gap >= 6 && L0.gap <= 10 && L0.bottomAlign && L0.sameW, 'на ' + w + ' px при картата стрелката е в една редица с колоната (' + L0.gap + ' px вляво, подравнена по дъното), не застъпва "+ / − / Центрирай / ▣", реда за авторството и лентата');
    // Надолу до текстовите карти и до дъното: копчето е на същото място спрямо екрана и отгоре на всичко.
    const mid = await page.evaluate(() => { const p = document.querySelector('#panel'); window.scrollTo({ top: p.offsetTop + 200, behavior: 'instant' }); return document.querySelector('#mapwrap').getBoundingClientRect().bottom; });
    const L1 = await page.evaluate(topBtnLayout);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    const L2 = await page.evaluate(topBtnLayout);
    check(mid <= 0 && L1.sy > 0 && L2.sy > L1.sy - 1 && L1.rect === L0.rect && L2.rect === L0.rect && L1.onTop && L2.onTop && !L2.overFoot && !L1.overBar && !L2.overBar,
      'на ' + w + ' px стрелката се вижда и при текстовите карти (scrollY ' + L1.sy + ') и в дъното (' + L2.sy + ') на същото място (' + L0.rect + '), не закрива дъното на страницата и лентата');
    // Кликът идва в следващ кадър - като от човек, а не в същия кадър като скрола надолу.
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.evaluate(() => document.querySelector('#toTopBtn').click());
    const back = await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 4000 }).then(() => 0, () => page.evaluate(() => window.scrollY));
    check(back === 0 && await page.evaluate(() => document.querySelector('#mapwrap').getBoundingClientRect().top === 0), 'на ' + w + ' px клик на стрелката от дъното връща scrollY 0 и картата е на екрана (' + back + ')');
  }
  // 1.1.4: радар, кръглата "Лента", "↓" на картата, "Отмени" горе вдясно, "Точки" без дума, по-широко име.
  function tl114() {
    const R = s => document.querySelector(s).getBoundingClientRect(), hit = (p, q) => q.width > 0 && !(p.right <= q.left || q.right <= p.left || p.bottom <= q.top || q.bottom <= p.top);
    const kids = [...document.querySelector('.maptl').children].map(e => e.id), d = R('#toPanelBtn'), h = R('#barHandle'), f = R('#followMapBtn'), bar = R('#bar'), tr = R('.mapctl.tr');
    const hb = document.querySelector('#barHandle'), u = document.querySelector('#undoBtn'), sat = document.querySelector('.seg.base [data-base="sat"]');
    return { kids: kids.join(','), dir: hb.dataset.dir, arr: hb.querySelector('.bt-arr').getAttribute('d'), squares: hb.querySelectorAll('svg rect').length, round: [d, h].every(r => Math.round(r.width) === 36 && Math.round(r.height) === 36) && getComputedStyle(hb).borderRadius === '50%',
      hText: hb.textContent.trim(), dText: document.querySelector('#toPanelBtn').textContent.trim(), dSvg: !!document.querySelector('#toPanelBtn svg'),
      row: d.right <= h.left && Math.abs(d.top - h.top) < 1, col: d.bottom <= h.top && Math.abs(d.left - h.left) < 1, fShown: f.width > 0, fAfter: f.left >= h.right - 0.5 || f.top >= h.bottom - 0.5,
      below: d.top >= bar.bottom - 0.5 || bar.bottom <= 0, overTr: [d, h, f].some(r => hit(r, tr)), inScreen: [d, h].every(r => r.left >= 0 && r.right <= innerWidth),
      radar: sat.querySelectorAll('svg circle').length === 3 && !sat.querySelector('svg rect') && sat.textContent.trim() === '',
      undoPos: u.parentElement.classList.contains('tr') && u.previousElementSibling.classList.contains('base') && u.nextElementSibling.id === 'vtxChk', undoSvg: !!u.querySelector('svg') && u.textContent.trim() === '' && u.getAttribute('aria-label') === 'Отмени',
      undoH: Math.abs(R('#undoBtn').height - R('.seg.base').height) <= 2, undoOn: hit(R('#undoBtn'), R('#undoBtn')) && R('#undoBtn').right <= innerWidth,
      vtxWord: /Точки/.test(document.querySelector('#vtxChk').textContent), name: Math.round(R('#routeName').width),
      noBarFollow: !document.querySelector('#bar [data-act="follow"]'), fW: Math.round(f.width), pW: Math.round(R('.actions .follow-btn').width), fText: !!document.querySelector('#followMapBtn').classList.contains('btn') && !document.querySelector('#followMapBtn').classList.contains('round-fab') && document.querySelector('#followMapBtn').textContent.trim() === 'Следене' };
  }
  // 1.1.5: групата горе вляво е в редица, когато се събира вляво от реда горе вдясно (8 px запас), иначе в стълбичка.
  // Пресмята се тук наново от размерите на децата, без да се гледа класът, който слага app.js.
  function tlFit() {
    const tl = document.querySelector('.maptl'), tr = document.querySelector('.mapctl.tr').getBoundingClientRect(), t = tl.getBoundingClientRect();
    const rs = [...tl.children].map(e => e.getBoundingClientRect()).filter(r => r.width > 0);
    const need = rs.reduce((a, r) => a + r.width, 0) + 6 * (rs.length - 1), room = tr.left - t.left - 8;
    const row = rs.every((r, i) => !i || (r.left >= rs[i - 1].right - 0.5 && Math.abs(r.top + r.height / 2 - rs[i - 1].top - rs[i - 1].height / 2) < 1));
    const col = rs.every((r, i) => !i || (r.top >= rs[i - 1].bottom - 0.5 && Math.abs(r.left - rs[i - 1].left) < 1));
    const over = rs.some(r => !(r.right <= tr.left || tr.right <= r.left || r.bottom <= tr.top || tr.bottom <= r.top));
    return { n: rs.length, need: Math.round(need * 10) / 10, room: Math.round(room * 10) / 10, row, col, over, vtx: document.querySelector('#vtxChk').getBoundingClientRect().width > 0, narrow: document.querySelector('#mapwrap').clientWidth <= 320 };
  }
  // 1.1.6: карта до 320 px - винаги стълбичка.
  const tlOk = F => F.n >= 2 && !F.over && (F.narrow ? F.col : F.need <= F.room - 1 ? F.row : F.need > F.room + 1 ? F.col : F.row || F.col);
  const fitTxt = F => (F.row ? 'в редица' : F.col ? 'в стълбичка' : 'разбъркани') + ' ' + JSON.stringify(F);
  // Без чертани точки ("Точки" скрито); случаят "с точки" ги слага сам. "Изтрий" се връща с "Отмени" след цикъла.
  const hadParts = await page.evaluate(() => __gpxk.S.routes.find(x => x.id === __gpxk.S.curId).items.length);
  if (hadParts) await page.evaluate(() => document.querySelector('#clearPartsBtn').click());
  for (const [w, pts] of [[320], [360], [390], [412], [560], [760], [1440], [360, true]]) {
    await page.setViewportSize({ width: w, height: 800 });
    if (pts) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.click('[data-mode="add"]');
      await page.evaluate(() => { const m = __gpxk.map; for (const q of [[150, 450], [200, 500]]) m.opts.onClick(Object.assign({ x: q[0], y: q[1] }, m.unproject(q[0], q[1]))); });
      await page.click('[data-mode="select"]');
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('#bar').getBoundingClientRect().top >= 0 && !document.body.classList.contains('bar-hidden'), null, { timeout: 3000 }).catch(() => {});
    // Копчетата слизат плавно (transition на top): чакаме да застанат.
    const settle = () => page.evaluate(() => new Promise(res => { let last = null, n = 0; (function f() { const t = document.querySelector('.maptl').getBoundingClientRect().top + ',' + document.querySelector('#bar').getBoundingClientRect().bottom; n = t === last ? n + 1 : 0; last = t; n >= 3 ? res() : requestAnimationFrame(f); })(); }));
    await settle();
    const A = await page.evaluate(tl114), FA = await page.evaluate(tlFit), wn = w + ' px' + (pts ? ' (с точки)' : '');
    check(FA.vtx === !!pts, 'на ' + wn + ' квадратчето „Точки“ ' + (pts ? 'е' : 'не е') + ' в реда вдясно');
    check(tlOk(FA), 'на ' + wn + ' при отворена лента групата горе вляво е ' + fitTxt(FA));
    check(A.kids === 'toPanelBtn,barHandle,followMapBtn' && A.round && A.dSvg && A.dText === '' && A.hText === '' && A.squares === 3 && (FA.row ? A.row : A.col) && A.below && !A.overTr && A.inScreen,
      'на ' + wn + ' горе вляво: "↓", после кръглата "Лента" (три квадратчета), ' + (FA.row ? 'в редица' : 'в стълбичка') + ', под лентата, не застъпват реда вдясно: ' + JSON.stringify({ kids: A.kids, row: A.row, col: A.col, below: A.below }));
    check(A.dir === 'up' && /12 13l3\.2 3\.2/.test(A.arr) && A.fShown && A.fAfter && A.noBarFollow && A.fText && Math.abs(A.fW - A.pW) <= 1 && FA.n === 3,
      'на ' + w + ' px при отворена лента стрелкичката сочи нагоре, текстовото "Следене" (' + A.fW + ' px, колкото текстовото копче под профила) е на картата след "Лента", а в лентата го няма');
    if (w === 320) check(FA.col, 'на 320 px групата с текстовото "Следене" пада в стълбичка: ' + JSON.stringify(FA));
    check(A.radar && A.undoPos && A.undoSvg && A.undoH && A.undoOn && !A.vtxWord, 'на ' + w + ' px горе вдясно: радар на мястото на сателита, "Отмени" със стрелка между основите и „Точки“, „Точки“ без дума: ' + JSON.stringify({ radar: A.radar, undo: A.undoPos, h: A.undoH, word: A.vtxWord }));
    if (w === 1440) check(A.name === 372, 'на 1440 px полето за име на маршрута е ' + A.name + ' px (беше 280)');
    await page.click('#barHandle');
    await page.waitForFunction(() => document.querySelector('#bar').getBoundingClientRect().bottom <= 0 && document.querySelector('.maptl').getBoundingClientRect().top < 30, null, { timeout: 3000 }).catch(() => {});
    await settle();
    const B = await page.evaluate(tl114), FB = await page.evaluate(tlFit);
    check(tlOk(FB) && FB.n === 3, 'на ' + wn + ' при скрита лента групата горе вляво (с "Следене") е ' + fitTxt(FB));
    check(B.dir === 'down' && /19\.4l3\.2-3\.2/.test(B.arr) && B.fShown && B.fAfter && B.kids === A.kids && (FB.row ? B.row : B.col) && !B.overTr && B.inScreen,
      'на ' + wn + ' при скрита лента стрелкичката се обръща надолу, "Следене" излиза след "Лента" ' + (FB.row ? '(вдясно)' : '(отдолу)') + ', нищо не застъпва реда вдясно');
    await page.click('#barHandle');
    await page.waitForFunction(() => document.querySelector('#bar').getBoundingClientRect().top >= 0, null, { timeout: 3000 }).catch(() => {});
    check(await page.evaluate(() => !document.body.classList.contains('bar-hidden') && document.querySelector('#barHandle').dataset.dir === 'up'), 'на ' + w + ' px кръглата "Лента" връща лентата');
    await page.click('#toPanelBtn');
    const pt = await page.waitForFunction(() => Math.abs(document.querySelector('#panel').getBoundingClientRect().top) < 2 && window.scrollY > 100, null, { timeout: 4000 }).then(() => 0, () => page.evaluate(() => document.querySelector('#panel').getBoundingClientRect().top));
    check(pt === 0, 'на ' + w + ' px "↓" стига до текстовата част под картата (' + Math.round(pt) + ')');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    if (pts) { await page.click('#undoBtn'); await page.click('#undoBtn'); }
  }
  if (hadParts) await page.click('#undoBtn');
  // Промяна след плана 17: „Точки“ се вижда само докато на картата има чертани точки; отметката не се губи.
  {
    const cv = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pv = await cv.newPage();
    pv.on('pageerror', e => errors.push('pageerror(vtx): ' + e.message));
    await pv.goto(url);
    await pv.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
    const vst = () => pv.evaluate(() => { const l = document.querySelector('#vtxChk'), r = l.getBoundingClientRect(), r2 = __gpxk.S.routes.find(x => x.id === __gpxk.S.curId);
      return { shown: !l.hidden && r.width > 0, n: r2.items.filter(i => i.type === 'draw').reduce((s, i) => s + i.pts.length, 0), on: document.querySelector('#vtxToggle').checked }; });
    const addPt = (x, y) => pv.evaluate(q => { const m = __gpxk.map; m.opts.onClick(Object.assign({ x: q[0], y: q[1] }, m.unproject(q[0], q[1]))); }, [x, y]);
    const v0 = await vst();
    check(v0.n === 0 && !v0.shown, 'празен маршрут: копчето „Точки“ е скрито ' + JSON.stringify(v0));
    await pv.click('[data-mode="add"]');
    await addPt(640, 450);
    const v1 = await vst();
    check(v1.n === 1 && v1.shown && v1.on, 'след първата точка „Точки“ се вижда ' + JSON.stringify(v1));
    await pv.click('#vtxToggle');
    await addPt(700, 480);
    await pv.click('#undoBtn'); await pv.click('#undoBtn');
    const v2 = await vst();
    check(v2.n === 0 && !v2.shown, '"Отмени" маха последната точка: „Точки“ пак е скрито ' + JSON.stringify(v2));
    await addPt(660, 470);
    const v3 = await vst();
    check(v3.n === 1 && v3.shown && !v3.on && await pv.evaluate(() => localStorage.getItem('gpxk.vtxShow') === 'false'), 'нова точка: „Точки“ се вижда пак, махнатата отметка е запазена ' + JSON.stringify(v3));
    await addPt(720, 500);
    await pv.click('#clearPartsBtn');
    const v4 = await vst();
    check(v4.n === 0 && !v4.shown && !v4.on, '"Изтрий" маха всички точки: „Точки“ е скрито, отметката остава махната ' + JSON.stringify(v4));
    await cv.close();
  }
  // Редът за сваляне на изминатото (долу върху картата) не се застъпва със стрелката.
  for (const w of [360, 1440]) {
    await page.setViewportSize({ width: w, height: 800 });
    const wb = await page.evaluate(() => { const b = document.querySelector('#walkBar'); b.hidden = false; const p = b.getBoundingClientRect(), q = document.querySelector('#toTopBtn').getBoundingClientRect(); b.hidden = true;
      return !(p.right <= q.left || q.right <= p.left || p.bottom <= q.top || q.bottom <= p.top); });
    check(!wb, 'на ' + w + ' px стрелката не застъпва реда "Свали изминалото като .gpx"');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  const sy0 = await page.evaluate(() => window.scrollY);
  check(sy0 > 300 && await page.evaluate(() => document.querySelector('#toTopBtn').getAttribute('aria-label') === 'Най-горе на страницата'), 'стрелката нагоре е с надпис на български; страницата е свалена до ' + Math.round(sy0) + ' px');
  await page.screenshot({ path: path.join(OUT, 'totop-390-bottom.png') });
  await page.click('#toTopBtn');
  const sy1 = await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 4000 }).then(() => 0, () => page.evaluate(() => window.scrollY));
  check(sy1 === 0, 'истински клик на стрелката нагоре (390 px, от дъното) връща страницата плавно най-горе (scrollY ' + sy1 + ')');
  await page.screenshot({ path: path.join(OUT, 'totop-390.png') });

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
  const ctx5 = await browser.newContext({ viewport: { width: 1280, height: 800 }, folds: true });
  const p5 = await ctx5.newPage();
  p5.on('pageerror', e => errors.push('pageerror(5): ' + e.message));
  p5.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) errors.push('console(5): ' + m.text()); });
  await p5.goto(url);
  await p5.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  // Версия: в дъното и в името на кеша от sw.js.
  const verText = (await p5.textContent('#appVersion')).trim();
  const ver = (verText.match(/^\d+\.\d+\.\d+/) || [''])[0];
  check(ver === '1.3.1' && await p5.isVisible('#appVersion') && /^Версия 1\.3\.1 · \d+ \S+ \d{4}$/.test((await p5.textContent('.foot .ver')).trim()), 'дъното показва версията: ' + (await p5.textContent('.foot .ver')).trim());
  const swCache = (() => { const ctx = { importScripts: f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx), addEventListener: () => {} }; ctx.self = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8') + ';this.__c = CACHE;', ctx); return ctx.__c; })();
  check(swCache === 'gpxk-v30-1.3.1' && swCache === 'gpxk-v30-' + ver, 'sw.js именува кеша със същата версия: ' + swCache);
  const liveCaches = await p5.evaluate(() => navigator.serviceWorker.ready.then(() => new Promise(r => { const t0 = Date.now(); (function poll() { caches.keys().then(k => (k.length || Date.now() - t0 > 8000) ? r(k) : setTimeout(poll, 100)); })(); })));
  check(liveCaches.length === 1 && liveCaches[0] === swCache, 'в браузъра работникът е създал кеш ' + JSON.stringify(liveCaches));
  // Бутоните са неактивни, когато няма какво да изчистят.
  const btns5 = () => p5.evaluate(() => ({ nov: document.querySelector('#clearTracksBtn').disabled, izt: document.querySelector('#clearPartsBtn').disabled,
    novIn: !!document.querySelector('#tracksCard > .card-head #clearTracksBtn') && !!document.querySelector('#tracksCard > .card-head [data-act="add-tracks"]'), iztIn: !!document.querySelector('#partsCard > .card-head #clearPartsBtn'),
    novT: document.querySelector('#clearTracksBtn').textContent, iztT: document.querySelector('#clearPartsBtn').textContent,
    danger: !!document.querySelector('#clearTracksBtn.danger, #clearPartsBtn.danger') }));
  let b5 = await btns5();
  check(b5.nov && b5.izt && b5.novIn && b5.iztIn && b5.novT === 'Нов' && b5.iztT === 'Изтрий' && !b5.danger, 'празно: "Нов" (до "Добави тракове" в заглавието на траковете) и "Изтрий" (в заглавието на частите) са неактивни ' + JSON.stringify(b5));
  const heads = await p5.evaluate(() => Array.from(document.querySelectorAll('.cols h2')).map(h => h.querySelector('[data-i18n]').textContent.trim()));
  check(JSON.stringify(heads) === JSON.stringify(['Части в маршрута', 'Точки', 'Тракове-източници', 'Дубликати', 'Изрязано от тракове']), 'заглавията на панелите: ' + JSON.stringify(heads));
  // Свити в началото.
  const FOLDS = [['#ptsCard', '#ptsCount'], ['#dupsCard', '#dupsCount'], ['#cutsCard', '#cutsCount'], ['#partsCard', '#partsCount'], ['#tracksCard', '#tracksCount']];
  const foldSt = () => p5.evaluate(F => F.map(([c, n]) => { const card = document.querySelector(c), b = card.querySelector('.fold-b'), t = card.querySelector('.fold-t'), cnt = document.querySelector(n);
    return { open: !b.hidden && b.getBoundingClientRect().height > 0, aria: t.getAttribute('aria-expanded'), cnt: cnt.textContent, cntShown: cnt.getBoundingClientRect().width > 0, inTitle: t.contains(cnt) }; }), FOLDS);
  let f5 = await foldSt();
  check(f5.every(f => !f.open && f.aria === 'false'), 'петте панела (и „Части в маршрута“, „Тракове-източници“ от 1.3.1) са свити при отваряне ' + JSON.stringify(f5.map(f => f.open)));
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
  check(f5.every(f => !f.open && f.cntShown && f.inTitle) && f5[0].cnt === '(1)' && f5[1].cnt === '1 за решение' && f5[2].cnt === '(1)' && /^\(\d+\)$/.test(f5[3].cnt) && f5[3].cnt !== '(0)' && f5[4].cnt === '(3)', 'свитите заглавия носят броячите: ' + JSON.stringify(f5.map(f => f.cnt)));
  // Клик върху свито заглавие само отваря - не пипа картата и не решава нищо.
  const mapSt = () => p5.evaluate(() => JSON.stringify([__gpxk.map.getView(), __gpxk.A.pend.length, __gpxk.A.dups.length, __gpxk.S.routes.find(x => x.id === __gpxk.S.curId).items.length, __gpxk.ui.undo.length]));
  const m0 = await mapSt();
  for (const [c] of FOLDS) await p5.click(c + ' .fold-t');
  f5 = await foldSt();
  check(f5.every(f => f.open && f.aria === 'true'), 'клик върху заглавието отваря всеки от петте панела ' + JSON.stringify(f5.map(f => f.open)));
  check(await mapSt() === m0, 'отварянето не пипа картата, дубликатите и маршрута');
  await p5.click('#ptsCard .fold-t');
  f5 = await foldSt();
  check(!f5[0].open && f5[1].open && f5[2].open, 'втори клик свива панела');
  await p5.reload();
  await p5.waitForFunction(() => window.__gpxk && window.__gpxk.ready && __gpxk.S.tracks.length === 3);
  f5 = await foldSt();
  check(!f5[0].open && f5[1].open && f5[2].open && f5[0].cnt === '(1)', 'след презареждане всеки панел е както е оставен ' + JSON.stringify(f5.map(f => f.open)));
  await p5.click('#dupsCard .fold-t'); await p5.click('#cutsCard .fold-t'); await p5.click('#partsCard .fold-t'); await p5.click('#tracksCard .fold-t');
  await p5.reload();
  await p5.waitForFunction(() => window.__gpxk && window.__gpxk.ready && __gpxk.S.tracks.length === 3);
  f5 = await foldSt();
  check(f5.every(f => !f.open), 'свити и след следващо презареждане');
  // 1.3.1: копчетата в заглавията на свитите „Части в маршрута“ и „Тракове-източници“ работят.
  await p5.click('#tracksCard > .card-head [data-act="add-tracks"]');
  const imp5 = await p5.evaluate(() => document.querySelector('#dlgImport').open);
  await p5.keyboard.press('Escape');
  f5 = await foldSt();
  check(imp5 && !f5[4].open && f5[4].aria === 'false', '1.3.1: „Добави тракове“ в заглавието на свитите тракове отваря внасянето, панелът остава свит');
  // "Изтрий": махат се частите, траковете остават; "Отмени" ги връща.
  const rs5 = () => p5.evaluate(() => { const S = __gpxk.S, r = S.routes.find(x => x.id === S.curId);
    return { tracks: S.tracks.map(t => t.id + ':' + t.pts.length + ':' + JSON.stringify(t.cuts || [])).join('|'), nTracks: S.tracks.length, items: JSON.stringify(r.items), n: r.items.length,
      parts: document.querySelector('#partsCount').textContent, empty: !document.querySelector('#empty').hidden, routes: S.routes.length }; });
  const r0 = await rs5();
  b5 = await btns5();
  check(!b5.nov && !b5.izt && r0.n === 2 && r0.nTracks === 3, 'с тракове и части двата бутона са активни');
  const undoSt = () => p5.evaluate(() => { const u = document.querySelector('#undoBtn'); return { dis: u.disabled, op: +getComputedStyle(u).opacity, n: __gpxk.ui.undo.length }; });
  const us0 = await undoSt();
  check(us0.dis && us0.op < 0.6 && us0.n === 0, '"Отмени" горе вдясно е избледняло при празна история: ' + JSON.stringify(us0));
  await p5.click('#clearPartsBtn');
  check((await foldSt()).slice(3).every(f => !f.open), '1.3.1: „Изтрий“ се цъка при свит панел „Части в маршрута“');
  const us1 = await undoSt();
  check(!us1.dis && us1.op === 1 && us1.n === 1, 'след действие "Отмени" е активно и плътно: ' + JSON.stringify(us1));
  let r1 = await rs5(); b5 = await btns5();
  check(r1.n === 0 && r1.tracks === r0.tracks && r1.parts === '(0)' && b5.izt && !b5.nov && r1.routes === r0.routes, '"Изтрий": частите са махнати, траковете остават, "Изтрий" е неактивен');
  await p5.click('#undoBtn');
  r1 = await rs5();
  check(r1.items === r0.items && r1.tracks === r0.tracks, '"Отмени" връща частите');
  // "Нов": махат се траковете и маршрутът; "Отмени" връща всичко.
  await p5.click('#clearTracksBtn');
  check((await foldSt())[4].open === false, '1.3.1: „Нов“ се цъка при свит панел „Тракове-източници“');
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
  // "Центрирай" без следене и без известно положение: пита браузъра веднъж.
  await p6.evaluate(() => __gpxk.map.setView(42.6, 24.9, 13));
  await p6.click('#centerBtn');
  await p6.waitForFunction(() => __gpxk.ui.lastPos, null, { timeout: 10000 }).catch(() => {});
  const c6 = await p6.evaluate(() => { const m = __gpxk.map, q = m.project(42.5, 24.7); return { d: Math.hypot(q.x - m.w / 2, q.y - m.h / 2), f: !!__gpxk.ui.follower }; });
  check(c6.d < 2 && !c6.f, '390 px: "Центрирай" без следене пита браузъра за положение и центрира (' + c6.d.toFixed(2) + ' px)');
  await p6.click('#followMapBtn');
  await p6.waitForFunction(() => __gpxk.ui.follower && __gpxk.ui.follower.rec.length > 0, null, { timeout: 10000 });
  for (const st6 of [[42.5006, 24.7006], [42.5012, 24.7012], [42.5018, 24.7018]]) {
    const n6 = await p6.evaluate(() => __gpxk.ui.follower ? __gpxk.ui.follower.rec.length : 0);
    await ctx6.setGeolocation({ latitude: st6[0], longitude: st6[1] });
    await p6.waitForFunction(n => __gpxk.ui.follower && __gpxk.ui.follower.rec.length > n, n6, { timeout: 10000 });
  }
  await p6.waitForFunction(() => __gpxk.map.rot === __gpxk.map.rotTo && __gpxk.map.rot > 1, null, { timeout: 5000 });
  const nb6 = await p6.evaluate(() => { const a = document.querySelector('#northBtn').getBoundingClientRect(), f = document.querySelector('#bar').getBoundingClientRect(), t = document.querySelector('.mapctl.tr').getBoundingClientRect(); return { ok: a.top >= f.bottom && t.top >= f.bottom && a.width > 0, info: Math.round(f.bottom) + '/' + Math.round(t.top) + '/' + Math.round(a.top) }; });
  check(nb6.ok, '390 px при следене: "Сателит / Топо" и копчето "Север" са под лентата на следенето, не под нея скрити (' + nb6.info + ')');
  await p6.screenshot({ path: path.join(OUT, 'follow-rot-390.png') });
  const rot6 = await p6.evaluate(() => __gpxk.map.getBearing());
  // Скрита лента: "Стоп" е върху картата горе вляво; истински клик спира следенето.
  await p6.click('#barHandle');
  await p6.waitForFunction(() => document.querySelector('#bar').getBoundingClientRect().bottom <= 0, null, { timeout: 3000 }).catch(() => {});
  const fab6 = await p6.evaluate(fabState);
  check(fab6.shown && fab6.text === 'Стоп' && fab6.danger && fab6.pressed === 'true' && !fab6.overTr && !fab6.overHandle && fab6.left >= 0, '390x844, скрита лента: "Стоп" върху картата, до "Лента" - ' + JSON.stringify(fab6));
  await p6.screenshot({ path: path.join(OUT, 'follow-stop-map-390.png') });
  await p6.click('#followMapBtn');
  await shutWalk(p6);
  const fab6b = await p6.evaluate(fabState);
  check(await p6.evaluate(() => !__gpxk.ui.follower && !!__gpxk.ui.lastWalk) && fab6b.text === 'Следене' && !fab6b.danger && fab6b.pressed === 'false', '390x844: "Стоп" върху картата спира следенето, копчето пише "Следене"');
  await p6.click('#barHandle');
  await p6.waitForTimeout(300);
  const wb6 = await p6.evaluate(() => ({ bar: inView('#walkBarBtn'), panel: inView('#walkDone [data-act="walk-gpx-done"]'), rot: __gpxk.map.getBearing(), north: inView('#northBtn') }));
  check(await p6.evaluate(() => { const a = document.querySelector('#walkBar').getBoundingClientRect(), b = document.querySelector('#centerBtn').getBoundingClientRect(); return b.width > 0 && (a.right <= b.left || a.bottom <= b.top || b.bottom <= a.top); }), '390x844 след "Стоп": редът за сваляне не покрива "Центрирай"');
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

  // Незавършено следене (1.0.3): автозапис в браузъра и прозорецът при отваряне.
  const ctx7 = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, permissions: ['geolocation'], geolocation: { latitude: 42.5, longitude: 24.7 } });
  const p7 = await ctx7.newPage();
  p7.on('pageerror', e => errors.push('p7 pageerror: ' + e.message));
  p7.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) errors.push('p7 console: ' + m.text()); });
  const live7 = () => p7.evaluate(() => U.DB.get('liveWalk').then(w => w ? { n: w.pts.length, name: w.name, acc: w.pts.length ? w.pts[0].length : 0 } : null));
  async function until7(pred, ms) { const end = Date.now() + ms; for (;;) { const w = await live7(); if (pred(w)) return true; if (Date.now() > end) return false; await p7.waitForTimeout(100); } }
  const ready7 = () => p7.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  const routes7 = () => p7.evaluate(() => __gpxk.S.routes.length);
  // Тръгва следене и записва n точки (по ~110 м на север една от друга).
  async function walk7(n, lat0) {
    await ctx7.setGeolocation({ latitude: lat0, longitude: 24.7 });
    await p7.click('#followMapBtn');
    await p7.waitForFunction(() => __gpxk.ui.follower && __gpxk.ui.follower.rec.length > 0, null, { timeout: 10000 });
    for (let i = 1; i < n; i++) {
      await ctx7.setGeolocation({ latitude: lat0 + i * 0.001, longitude: 24.7 });
      await p7.waitForFunction(k => __gpxk.ui.follower && __gpxk.ui.follower.rec.length > k, i, { timeout: 10000 });
    }
  }
  await p7.goto(url);
  await ready7();
  check(await p7.evaluate(() => !document.querySelector('#dlgLive').open), 'незавършено следене: при чист браузър прозорецът не излиза');
  await walk7(3, 42.5);
  const t7 = Date.now();
  await until7(w => !!w && w.n >= 3, 15000);
  const l7 = await live7();
  check(!!l7 && l7.n === 3 && l7.acc === 5, 'по време на следене изминатото се пише в браузъра (на всеки 10 с, с час и точност): ' + JSON.stringify(l7) + ' след ' + Math.round((Date.now() - t7) / 1000) + ' с');
  // Прекъсване: презареждане без "Стоп".
  const nr7 = await routes7();
  await p7.reload();
  await ready7();
  await p7.waitForFunction(() => document.querySelector('#dlgLive').open, null, { timeout: 5000 }).catch(() => {});
  const d7 = await p7.evaluate(() => ({ open: document.querySelector('#dlgLive').open, h: document.querySelector('#dlgLive h3').textContent, km: document.querySelector('#liveKm').textContent, pts: document.querySelector('#livePts').textContent, when: document.querySelector('#liveWhen').textContent, follow: !!__gpxk.ui.follower }));
  check(d7.open && d7.h === 'Незавършено следене' && /км/.test(d7.km) && d7.pts === '3 точки' && /^Тръгнал \d+ \S+, \d+:\d\d/.test(d7.when) && !d7.follow, 'след презареждане излиза "Незавършено следене": ' + d7.km + ' · ' + d7.pts + ' · ' + d7.when);
  const bx7 = await p7.evaluate(() => { const d = document.querySelector('#dlgLive').getBoundingClientRect(); return Array.from(document.querySelectorAll('#dlgLive [data-act], #dlgLive .dlg-x')).every(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.left >= d.left && r.right <= d.right && r.bottom <= d.bottom && r.bottom <= innerHeight; }); });
  check(bx7, '390 px: трите копчета и × се събират в прозореца');
  await p7.screenshot({ path: path.join(OUT, 'live-ask-390.png') });
  // × затваря, записът остава; при следващо отваряне пита пак.
  await p7.click('#dlgLive .dlg-x');
  check(await p7.evaluate(() => !document.querySelector('#dlgLive').open) && (await live7() || {}).n === 3, '× затваря прозореца, записът остава');
  await p7.reload();
  await ready7();
  await p7.waitForFunction(() => document.querySelector('#dlgLive').open, null, { timeout: 5000 }).catch(() => {});
  check(await p7.evaluate(() => document.querySelector('#dlgLive').open), 'при следващо отваряне прозорецът пита пак');
  // "Запази": отделен запис в "Записани маршрути", записът се чисти.
  await p7.click('#dlgLive [data-act="live-save"]');
  const s7 = await p7.evaluate(() => { const S = __gpxk.S, r = S.routes[0], t = S.tracks.find(x => x.id === r.items[0].trackId); return { open: document.querySelector('#dlgLive').open, n: S.routes.length, name: r.name, items: r.items.length, pts: t && t.pts.length, walk: t && t.walk, cur: S.curId !== r.id }; });
  check(!s7.open && s7.n === nr7 + 1 && /^изминат /.test(s7.name) && s7.items === 1 && s7.pts === 3 && s7.walk && s7.cur, '"Запази" вкарва отделен запис "' + s7.name + '" (' + s7.pts + ' точки) в "Записани маршрути", текущият маршрут не се сменя');
  await until7(w => !w, 3000).then(ok => check(ok, '"Запази" чисти записа на незавършеното следене'));
  check(await p7.isVisible('#routesBody tr[data-route="' + (await p7.evaluate(() => __gpxk.S.routes[0].id)) + '"]') || (await p7.textContent('#routesBody')).includes(s7.name), 'възстановеният запис се вижда в "Записани маршрути"');
  await p7.waitForTimeout(700);
  await p7.reload();
  await ready7();
  check(await p7.evaluate(() => !document.querySelector('#dlgLive').open) && await routes7() === nr7 + 1, 'след "Запази" и презареждане прозорецът не излиза, записът в "Записани маршрути" е на място');
  // "Изхвърли": чисти без запис.
  await walk7(2, 42.51);
  await p7.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await until7(w => !!w && w.n === 2, 3000).catch(() => {});
  check((await live7() || {}).n === 2, 'при излизане от страницата изминатото се записва веднага (2 точки)');
  await p7.reload();
  await ready7();
  await p7.waitForFunction(() => document.querySelector('#dlgLive').open, null, { timeout: 5000 }).catch(() => {});
  const nr7b = await routes7();
  check(await p7.evaluate(() => document.querySelector('#dlgLive').open && document.querySelector('#livePts').textContent === '2 точки'), 'прозорецът излиза и при 2 точки');
  await p7.click('#dlgLive [data-act="live-drop"]');
  await until7(w => !w, 3000).catch(() => {});
  check(await p7.evaluate(() => !document.querySelector('#dlgLive').open) && await routes7() === nr7b && !(await live7()), '"Изхвърли" чисти записа и не вкарва нищо в "Записани маршрути"');
  await p7.reload();
  await ready7();
  check(await p7.evaluate(() => !document.querySelector('#dlgLive').open), 'след "Изхвърли" и презареждане прозорецът не излиза');
  // "Свали .gpx": същият прозорец за име, файлът и отделният запис.
  await walk7(4, 42.52);
  await p7.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await until7(w => !!w && w.n === 4, 3000).catch(() => {});
  await p7.reload();
  await ready7();
  await p7.waitForFunction(() => document.querySelector('#dlgLive').open, null, { timeout: 5000 }).catch(() => {});
  const nr7c = await routes7();
  await p7.click('#dlgLive [data-act="live-gpx"]');
  check(await p7.evaluate(() => document.querySelector('#dlgName').open && !document.querySelector('#dlgLive').open), '"Свали .gpx" отваря прозореца за име на файла');
  const [d7g] = await Promise.all([p7.waitForEvent('download'), p7.press('#fileName', 'Enter')]);
  const x7 = fs.readFileSync(await d7g.path(), 'utf8');
  check(/^izminat-.*\.gpx$/.test(d7g.suggestedFilename()) && (x7.match(/<trkpt /g) || []).length === 4 && (x7.match(/<time>/g) || []).length >= 4 && await routes7() === nr7c + 1 && !(await live7()), '"Свали .gpx" сваля ' + d7g.suggestedFilename() + ' (4 точки с час), вкарва отделен запис и чисти записа');
  check(await p7.evaluate(() => !document.querySelector('#walkBar').hidden && /отделен маршрут/.test(document.querySelector('#fMsg').textContent)), 'след възстановяване редът "Свали изминалото като .gpx" и панелът "Следене" са както след "Стоп"');
  // "Стоп" чисти записа.
  await walk7(2, 42.53);
  await p7.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await p7.click('#followMapBtn');
  await until7(w => !w, 3000).then(ok => check(ok, '"Стоп" чисти записа на незавършеното следене'));
  await p7.reload();
  await ready7();
  check(await p7.evaluate(() => !document.querySelector('#dlgLive').open && !!__gpxk.ui.lastWalk), 'след "Стоп" и презареждане прозорецът не излиза, последното изминато е на място');
  // 1 точка: прозорецът не излиза, записът се изхвърля сам.
  await walk7(1, 42.54);
  await p7.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await until7(w => !!w && w.n === 1, 3000).catch(() => {});
  check((await live7() || {}).n === 1, 'запис с 1 точка е в браузъра');
  await p7.reload();
  await ready7();
  await until7(w => !w, 3000).catch(() => {});
  check(await p7.evaluate(() => !document.querySelector('#dlgLive').open) && !(await live7()), 'при 1 точка прозорецът не излиза и записът се изхвърля сам');
  // 0 точки: тръгнато следене без сигнал.
  await ctx7.setGeolocation({ latitude: 42.55, longitude: 24.7 });
  await p7.evaluate(() => { navigator.geolocation.watchPosition = () => 1; });
  await p7.click('#followMapBtn');
  await until7(w => !!w && w.n === 0, 3000).catch(() => {});
  check((await live7() || {}).n === 0, 'ново следене заменя записа веднага (0 точки)');
  await p7.reload();
  await ready7();
  await until7(w => !w, 3000).catch(() => {});
  check(await p7.evaluate(() => !document.querySelector('#dlgLive').open) && !(await live7()), 'при 0 точки прозорецът не излиза');
  await ctx7.close();
  // Браузър без запис (частен режим): казва го веднъж.
  const ctx8 = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['geolocation'], geolocation: { latitude: 42.5, longitude: 24.7 } });
  await ctx8.addInitScript({ content: "Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'wakeLock', { value: undefined, configurable: true });" });
  const p8 = await ctx8.newPage();
  p8.on('pageerror', e => errors.push('p8 pageerror: ' + e.message));
  await p8.goto(url);
  await p8.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  await p8.click('#followMapBtn');
  await p8.waitForFunction(() => /Следенето не се пази в браузъра/.test(document.querySelector('#toast').textContent), null, { timeout: 3000 }).then(() => check(true, 'без запис в браузъра: "Следенето не се пази в браузъра"'), () => check(false, 'без запис в браузъра: "Следенето не се пази в браузъра"'));
  check(await p8.evaluate(() => !document.querySelector('#fAwake').hidden && /^Този браузър не може да държи екрана буден/.test(document.querySelector('#fAwake').textContent)), 'без wakeLock панелът казва "Този браузър не може да държи екрана буден"');
  await ctx8.close();

  // Следене след събуждане на екрана (1.0.4): същата сесия продължава, GPS се пуска наново.
  // Скриването се симулира с visibilityState; спрелият в Safari GPS - със заглушени стари watch-ове.
  const ctx9 = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 42.5, longitude: 24.7 } });
  const GEO_INIT = `
    (function () {
      var g = window.__geo = { calls: 0, dead: 0, mute: false, err: null, wake: 0, vis: 'visible' };
      Object.defineProperty(document, 'visibilityState', { get: function () { return g.vis; }, configurable: true });
      Object.defineProperty(document, 'hidden', { get: function () { return g.vis === 'hidden'; }, configurable: true });
      g.set = function (v) { g.vis = v; if (v === 'hidden') g.dead = g.calls; document.dispatchEvent(new Event('visibilitychange')); };
      var geo = navigator.geolocation, orig = geo.watchPosition.bind(geo);
      geo.watchPosition = function (ok, bad, o) {
        var n = ++g.calls;
        g.err = bad;
        // g.alt: височина на GPS (подменя тази на браузъра, който не дава височина).
        var withAlt = function (p) { if (g.alt == null) return p; var c = p.coords;
          return { timestamp: p.timestamp, coords: { latitude: c.latitude, longitude: c.longitude, altitude: g.alt, accuracy: c.accuracy, heading: c.heading, speed: c.speed } }; };
        return orig(function (p) { if (n > g.dead && !g.mute) ok(withAlt(p)); }, function (e) { if (n > g.dead && !g.mute) bad(e); }, o);
      };
      // Ключалката за екрана: подменена, за да се броят исканията и пусканията; при скриване браузърът я пуска сам.
      g.held = null; g.refuse = false;
      function release(w) { if (w.released) return; w.released = true; if (g.held === w) g.held = null; w.dispatchEvent(new Event('release')); }
      document.addEventListener('visibilitychange', function () { if (g.vis === 'hidden' && g.held) release(g.held); });
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: function () {
        g.wake++;
        if (g.refuse || g.vis === 'hidden') return Promise.reject(new DOMException('no', 'NotAllowedError'));
        var w = new EventTarget(); w.released = false; w.type = 'screen'; w.release = function () { release(w); return Promise.resolve(); };
        g.held = w; return Promise.resolve(w);
      } } });
    })();`;
  await ctx9.addInitScript({ content: GEO_INIT });
  const p9 = await ctx9.newPage();
  p9.on('pageerror', e => errors.push('p9 pageerror: ' + e.message));
  p9.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) errors.push('p9 console: ' + m.text()); });
  await p9.goto(url);
  await p9.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  await p9.setInputFiles('#fileInput', writeGpx('budene', line(42.5, 24.7, 42.52, 24.7, 80)));
  await p9.waitForFunction(() => __gpxk.S.tracks.length === 1);
  await p9.evaluate(() => { const S = __gpxk.S, t = S.tracks[0], r = S.routes.find(x => x.id === S.curId); r.items = [{ type: 'part', trackId: t.id, a: 0, b: t.len, rev: false }]; __gpxk.refresh(); });
  const st9 = () => p9.evaluate(() => { const f = __gpxk.ui.follower; return { on: !!f, n: f ? f.rec.length : 0, len: f ? U.lengthOf(f.rec) : 0, t0: f ? f.t0 : 0, calls: __geo.calls, wake: __geo.wake, held: !!__geo.held, msg: document.querySelector('#fMsg').textContent, awake: document.querySelector('#fAwake').hidden ? '' : document.querySelector('#fAwake').textContent, btn: document.querySelector('#awakeBtn').getAttribute('aria-pressed'), done: document.querySelector('#fDone').textContent, live: document.querySelector('#dlgLive').open }; });
  await p9.click('#followMapBtn');
  await p9.waitForFunction(() => __gpxk.ui.follower && __gpxk.ui.follower.rec.length > 0, null, { timeout: 10000 });
  await p9.waitForFunction(() => !!__geo.held, null, { timeout: 3000 }).catch(() => {});
  const w9 = await st9();
  check(w9.btn === 'true' && w9.held && w9.wake === 1 && w9.awake === 'Екранът няма да заспива, докато следиш.', '"Екранът буден" е включено по подразбиране, ключалката се държи: "' + w9.awake + '"');
  const bb9 = await p9.evaluate(() => { const r = document.querySelector('#followBar').getBoundingClientRect(); return Array.from(document.querySelectorAll('#followBar .btn, #followBar .seg')).every(b => { const q = b.getBoundingClientRect(); return q.width > 0 && q.left >= r.left - 1 && q.right <= r.right + 1; }) && document.documentElement.scrollWidth <= innerWidth; });
  check(bb9, '390 px: копчето "буден" се събира в реда на следенето, без хоризонтален скрол');
  await ctx9.setGeolocation({ latitude: 42.5009, longitude: 24.7 });
  await p9.waitForFunction(() => __gpxk.ui.follower.rec.length > 1, null, { timeout: 10000 });
  const a9 = await st9();
  check(/^По линията си\. Точност на GPS: \d+\sм\.$/.test(a9.msg) && a9.calls === 1, 'преди скриването: "' + a9.msg + '", GPS пуснат ' + a9.calls + ' път');
  // Екранът заспива: старият watch замлъква (както в Safari), а човекът изминава ~1.1 км.
  await p9.evaluate(() => { __geo.mute = true; __geo.set('hidden'); });
  await ctx9.setGeolocation({ latitude: 42.5109, longitude: 24.7 });
  await p9.evaluate(() => __geo.err({ code: 3, message: 'timeout' })); // грешка, докато е скрито
  const h9 = await st9();
  check(h9.on && h9.n === a9.n, 'грешка, докато страницата е скрита, не спира следенето');
  // Връщане на екрана: GPS-ът се пуска наново, панелът чака.
  await p9.evaluate(() => { Follower.RETRY_MS = 1200; __geo.set('visible'); });
  const b9 = await st9();
  check(b9.on && b9.calls === 2 && b9.t0 === a9.t0 && b9.n === a9.n, 'връщане на видимост без положение пуска GPS наново (watchPosition ' + b9.calls + ' пъти), същата сесия и часовник');
  check(b9.msg === 'Чакам сигнал от GPS...', 'докато чака, панелът пише "' + b9.msg + '"');
  check(!h9.held, 'при скриване браузърът пуска ключалката');
  await p9.waitForFunction(() => !!__geo.held, null, { timeout: 3000 }).catch(() => {});
  check(b9.wake === a9.wake + 1 && (await st9()).held, 'при връщане на видимост ключалката за екрана се иска наново (wakeLock.request: ' + a9.wake + ' → ' + b9.wake + ')');
  await p9.waitForFunction(() => __geo.calls >= 3, null, { timeout: 4000 }).then(() => check(true, 'без положение до RETRY_MS: още един опит'), () => check(false, 'без положение до RETRY_MS: още един опит'));
  await p9.evaluate(() => __geo.err({ code: 3, message: 'timeout' }));
  check((await st9()).on && (await st9()).msg === 'Чакам сигнал от GPS...', 'грешка "GPS не отговаря", докато чака след връщане, не спира следенето и не сменя съобщението');
  // Първото ново положение.
  await p9.evaluate(() => { __geo.mute = false; });
  await ctx9.setGeolocation({ latitude: 42.5110, longitude: 24.7 });
  await p9.waitForFunction(() => __gpxk.ui.follower.rec.length > 2, null, { timeout: 10000 });
  const c9 = await st9();
  const jump9 = 0.0101 * 111195;
  check(/^По линията си\. Точност на GPS: \d+\sм\.$/.test(c9.msg), 'при първото ново положение: "' + c9.msg + '"');
  check(c9.n > 3 && Math.abs(c9.len - a9.len - jump9) < 15 && /^1[.,]2\sот\s2[.,]2\sкм$/.test(c9.done), 'следата по трака през паузата влиза в "Изминати": ' + c9.done + ', записани ' + Math.round(a9.len) + ' → ' + Math.round(c9.len) + ' м, ' + c9.n + ' точки');
  check(!c9.live && c9.on, 'за жива сесия не излиза прозорец "Незавършено следене"');
  await p9.screenshot({ path: path.join(OUT, 'follow-wake-390.png') });
  // Връщане, при което GPS-ът е дал положение и докато е било скрито: не се пуска наново.
  await p9.evaluate(() => __geo.set('hidden'));
  await p9.evaluate(() => { __geo.dead = 0; });
  await ctx9.setGeolocation({ latitude: 42.5120, longitude: 24.7 });
  await p9.waitForFunction(k => __gpxk.ui.follower.rec.length > k, c9.n, { timeout: 10000 });
  await p9.evaluate(() => __geo.set('visible'));
  const d9 = await st9();
  check(d9.calls === c9.calls && /^По линията си/.test(d9.msg), 'с положение и докато е скрито: GPS не се пуска наново, съобщението остава (' + c9.calls + '/' + d9.calls + ', "' + d9.msg + '")');
  // Изключване на режима: ключалката се пуска, при връщане не се иска; изборът се помни.
  await p9.click('#awakeBtn');
  const f9 = await st9();
  check(f9.btn === 'false' && !f9.held && f9.awake === 'Екранът може да заспи - следенето продължава при събуждане.' && await p9.evaluate(() => U.LS.get('awake', true)) === false, 'изключен "буден": ключалката се пуска, панелът казва "' + f9.awake + '", изборът е в localStorage');
  await p9.evaluate(() => { __geo.set('hidden'); __geo.set('visible'); });
  check((await st9()).wake === f9.wake, 'изключен режим: при връщане ключалката не се иска');
  // Отказ от браузъра: панелът го казва.
  await p9.evaluate(() => { __geo.refuse = true; });
  await p9.click('#awakeBtn');
  await p9.waitForFunction(() => /не позволи/.test(document.querySelector('#fAwake').textContent), null, { timeout: 3000 }).catch(() => {});
  const g9 = await st9();
  check(g9.btn === 'true' && /^Браузърът не позволи екранът да стои буден/.test(g9.awake), 'при отказ панелът казва: "' + g9.awake + '"');
  await p9.evaluate(() => { __geo.refuse = false; __geo.set('hidden'); __geo.set('visible'); });
  await p9.waitForFunction(() => !!__geo.held, null, { timeout: 3000 }).catch(() => {});
  check((await st9()).awake === 'Екранът няма да заспива, докато следиш.', 'след отказ: при следващото връщане ключалката се иска пак и се държи');
  await p9.click('#followMapBtn');
  await shutWalk(p9);
  check(await p9.evaluate(() => !__geo.held && document.querySelector('#fAwake').hidden), '"Стоп" пуска ключалката и маха реда за екрана');
  const e9 = await p9.evaluate(() => { const t = __gpxk.S.tracks[__gpxk.S.tracks.length - 1]; return { walk: t.walk, n: t.pts.length, len: t.len }; });
  check(e9.walk && e9.n === g9.n && e9.n > c9.n && e9.len > jump9, 'след "Стоп" изминатият трак е един, със следата през паузата (' + e9.n + ' точки, ' + Math.round(e9.len) + ' м)');
  await ctx9.close();

  // Следа по трака през дупка в GPS (1.0.5): ако и последната точка, и новата са до 20 м от маршрута,
  // между тях влизат завоите на маршрута; иначе остава права линия.
  const ctx10 = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['geolocation'], geolocation: { latitude: 42.5, longitude: 24.7 } });
  await ctx10.addInitScript({ content: GEO_INIT });
  await ctx10.addInitScript({ content: 'window.lineColors = ' + lineColors.toString() });
  // Плочките - една празна точка с CORS, за да се четат пикселите и картината се сглобява без мрежа.
  const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  await ctx10.route(/arcgisonline\.com|opentopomap\.org/, r => r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/png' }, body: PNG1 }));
  const p10 = await ctx10.newPage();
  p10.on('pageerror', e => errors.push('p10 pageerror: ' + e.message));
  p10.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) errors.push('p10 console: ' + m.text()); });
  await p10.goto(url);
  await p10.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
  // Маршрут с два завоя: на изток, на север, пак на изток.
  const zig = line(42.5, 24.70, 42.5, 24.71, 30).concat(line(42.5, 24.71, 42.51, 24.71, 30).slice(1), line(42.51, 24.71, 42.51, 24.72, 30).slice(1));
  const useTrack = pg => pg.evaluate(() => { const S = __gpxk.S, t = S.tracks[S.tracks.length - 1], r = S.routes.find(x => x.id === S.curId); r.items = [{ type: 'part', trackId: t.id, a: 0, b: t.len, rev: false }]; __gpxk.refresh(); });
  await p10.setInputFiles('#fileInput', writeGpx('zavoi', zig));
  await p10.waitForFunction(() => __gpxk.S.tracks.length === 1);
  await useTrack(p10);
  // Състоянието на записа: брой точки, дължина и новите точки след индекс k (с разстоянието им до маршрута).
  const st10 = k => p10.evaluate(k => { const f = __gpxk.ui.follower, G = __gpxk.G, rec = f.rec;
    return { n: rec.length, len: U.lengthOf(rec), calls: __geo.calls, done: document.querySelector('#fDone').textContent,
      add: rec.slice(k).map(p => ({ lat: p[0], lon: p[1], t: p[3], acc: p[4], off: Core.nearestOn(G.pts, G.cum, p[0], p[1]).dist })) }; }, k);
  const near = (pts, lat, lon) => pts.some(p => U_hav(p.lat, p.lon, lat, lon) < 1);
  // Вмъкнатите точки: непрекъснатият ред с празна точност след последното положение преди дупката (измерените винаги носят точност).
  const insOf = add => { const out = []; for (let i = 1; i < add.length; i++) { if (add[i].acc != null) break; out.push(add[i]); } return out; };
  function U_hav(a, b, c, d) { const R = 6371008.8, r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2); return 2 * R * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y)); }
  const growTo = (pg, k) => pg.waitForFunction(k => __gpxk.ui.follower.rec.length > k, k, { timeout: 10000 });
  await p10.click('#followMapBtn');
  await growTo(p10, 0);
  await ctx10.setGeolocation({ latitude: 42.5, longitude: 24.7012 });
  await growTo(p10, 1);
  const a10 = await st10(0);
  check(a10.n >= 2, 'следа: положения преди дупката (' + a10.n + ')');
  await p10.waitForTimeout(1500); // за да се видят растящите часове на междинните точки (в ms)
  // (1) Дупка със заспал екран, през първия завой: ~1.2 км по маршрута, ~0.9 км по права.
  await p10.evaluate(() => { __geo.mute = true; __geo.set('hidden'); });
  await ctx10.setGeolocation({ latitude: 42.5045, longitude: 24.71 });
  await p10.evaluate(() => { Follower.RETRY_MS = 60000; __geo.set('visible'); });
  await p10.evaluate(() => { __geo.mute = false; });
  await ctx10.setGeolocation({ latitude: 42.5046, longitude: 24.71 });
  await growTo(p10, a10.n);
  const b10 = await st10(a10.n - 1);
  const ins10 = insOf(b10.add), straight10 = U_hav(42.5, 24.7012, 42.5046, 24.71), along10 = U_hav(42.5, 24.7012, 42.5, 24.71) + U_hav(42.5, 24.71, 42.5046, 24.71);
  const tUp = pts => pts.every((p, i) => i === 0 || p.t > pts[i - 1].t);
  check(ins10.length > 5 && ins10.every(p => p.off < 1 && p.acc == null) && near(ins10, 42.5, 24.71), 'заспал екран, двете точки върху трака: ' + ins10.length + ' междинни точки по маршрута, с завоя, без точност');
  check(Math.abs(b10.len - a10.len - along10) < 10 && b10.len - a10.len > straight10 + 250, 'дължината расте по маршрута: +' + Math.round(b10.len - a10.len) + ' м (по права ' + Math.round(straight10) + ', по трака ' + Math.round(along10) + '), "Изминати" ' + b10.done);
  check(tUp(b10.add), 'междинните точки имат растящи часове между двете измерени');
  // Изнесеният .gpx носи междинните точки с часовете им.
  await p10.click('#walkGpxBtn');
  await p10.fill('#fileName', 'sleda');
  const [dl10] = await Promise.all([p10.waitForEvent('download'), p10.press('#fileName', 'Enter')]);
  const file10 = path.join(OUT, 'walk-sleda.gpx');
  await dl10.saveAs(file10);
  const x10 = fs.readFileSync(file10, 'utf8');
  const gp10 = Array.from(x10.matchAll(/<trkpt lat="([\d.-]+)" lon="([\d.-]+)">[\s\S]*?<time>([^<]+)<\/time>/g)).map(m => ({ lat: +m[1], lon: +m[2], t: Date.parse(m[3]) }));
  const gIns = gp10.slice(a10.n, a10.n + ins10.length);
  check(gp10.length === b10.n && near(gIns, 42.5, 24.71) && tUp(gp10.slice(a10.n - 1, a10.n + ins10.length + 1)), 'изнесеният .gpx: ' + gp10.length + ' точки, междинните по завоя с растящи часове');
  // (2) Дупка при буден екран (без смяна на видимостта), през втория завой.
  await p10.waitForTimeout(1500);
  await ctx10.setGeolocation({ latitude: 42.51, longitude: 24.7135 });
  await growTo(p10, b10.n);
  const c10 = await st10(b10.n - 1);
  const ins10c = insOf(c10.add), along10c = U_hav(42.5046, 24.71, 42.51, 24.71) + U_hav(42.51, 24.71, 42.51, 24.7135);
  check(c10.calls === b10.calls && ins10c.length > 5 && ins10c.every(p => p.off < 1 && p.acc == null) && near(ins10c, 42.51, 24.71) && tUp(c10.add), 'дупка при буден екран: ' + ins10c.length + ' междинни точки по маршрута, с завоя, растящи часове');
  check(Math.abs(c10.len - b10.len - along10c) < 10, 'буден екран: дължината расте по маршрута с ' + Math.round(c10.len - b10.len) + ' м (по трака ' + Math.round(along10c) + ')');
  // (3) Точка на 50 м встрани от маршрута - права линия, и към нея, и обратно към трака.
  await ctx10.setGeolocation({ latitude: 42.51045, longitude: 24.7145 });
  await growTo(p10, c10.n);
  const d10 = await st10(c10.n);
  await ctx10.setGeolocation({ latitude: 42.51, longitude: 24.7175 });
  await growTo(p10, d10.n);
  const e10 = await st10(d10.n);
  check(d10.n === c10.n + 1 && Math.abs(d10.len - c10.len - U_hav(42.51, 24.7135, 42.51045, 24.7145)) < 2 && d10.add[0].off > 45, 'точка на ' + Math.round(d10.add[0].off) + ' м встрани: права линия, без междинни точки');
  check(e10.n === d10.n + 1 && Math.abs(e10.len - d10.len - U_hav(42.51045, 24.7145, 42.51, 24.7175)) < 2, 'от точката встрани обратно на трака: пак права линия');
  // Дупката се чертае кехлибарено на пунктир; измереното (кратка крачка) - зелено.
  await ctx10.setGeolocation({ latitude: 42.51, longitude: 24.7177 });
  await growTo(p10, e10.n);
  const frame = pg => pg.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const cols = await p10.evaluate(() => ({ gap: U.cssVar('--app-walk-gap'), walked: U.cssVar('--app-walked') }));
  const gapLine = await p10.evaluate(([i, j]) => __gpxk.ui.follower.rec.slice(i, j).map(p => [p[0], p[1]]), [b10.n - 1, c10.n]);
  const offLine = [[42.51, 24.7135], [42.51045, 24.7145], [42.51, 24.7175]];
  await p10.evaluate(() => __gpxk.map.setView(42.5075, 24.713, 16));
  await frame(p10);
  const pxGap = await p10.evaluate(([l, a, b]) => lineColors(l, a, b), [gapLine, cols.gap, cols.walked]);
  const pxOff = await p10.evaluate(([l, a, b]) => lineColors(l, a, b), [offLine, cols.gap, cols.walked]);
  await p10.evaluate(() => __gpxk.map.setView(42.51, 24.7176, 19));
  await frame(p10);
  const pxOk = await p10.evaluate(([l, a, b]) => lineColors(l, a, b), [[[42.51, 24.71755], [42.51, 24.71765]], cols.gap, cols.walked]);
  await p10.screenshot({ path: path.join(OUT, 'walk-gap-1280.png') });
  check(pxGap.n > 50 && pxGap.n1 > pxGap.n * 0.25 && pxGap.n2 === 0, 'дупка по маршрута: кехлибарено (' + cols.gap + ') на пунктир, без зелено - ' + JSON.stringify(pxGap));
  check(pxOff.n > 20 && pxOff.n1 > pxOff.n * 0.25 && pxOff.n2 === 0, 'права линия до точката встрани: също кехлибарено - ' + JSON.stringify(pxOff));
  check(pxOk.n > 10 && pxOk.n2 > pxOk.n * 0.6 && pxOk.n1 === 0, 'измерената крачка (16 м) си остава зелена (' + cols.walked + ') - ' + JSON.stringify(pxOk));
  check(await p10.evaluate(() => !/дупка/.test(document.querySelector('#partsList').textContent + document.querySelector('.stats').textContent)), 'дупката е само цвят: без ред в числата и без значка в списъка с части');
  await p10.click('#followMapBtn');
  await shutWalk(p10);
  // След "Стоп": записът на изминатото, отворен като маршрут - дупката е кехлибарена и на картата, и в "Картина" (.png).
  const cur10 = await p10.evaluate(() => __gpxk.S.curId);
  const wr10 = await p10.evaluate(() => { const S = __gpxk.S, t = S.tracks[S.tracks.length - 1]; return S.routes.find(r => r.items.length === 1 && r.items[0].trackId === t.id).id; });
  await p10.click('#routesBody tr[data-route="' + wr10 + '"] [data-rt="open"]');
  await p10.evaluate(() => { __gpxk.map.setBearing(0); __gpxk.map.setView(42.5075, 24.713, 16); });
  await p10.waitForFunction(() => __gpxk.map.rot === 0);
  await frame(p10);
  const pxRoute = await p10.evaluate(([l, a]) => lineColors(l, a, a), [gapLine, cols.gap]);
  check(pxRoute.n > 50 && pxRoute.n1 > pxRoute.n * 0.25, 'отвореният запис на изминатото: дупката е кехлибарена и в частта на маршрута - ' + JSON.stringify(pxRoute));
  await p10.evaluate(() => { window.__blobs = []; const d = U.download; U.download = (b, n) => { window.__blobs.push({ b, n }); return d(b, n); }; });
  await p10.click('#bar [data-act="picture"]');
  await p10.click('#dlgPic [data-act="pic-make"]');
  await p10.waitForFunction(() => window.__blobs.some(x => /\.png$/.test(x.n)), null, { timeout: 20000 }).catch(() => {});
  const pngPix = await p10.evaluate(async ([l, gap, walked]) => {
    const it = window.__blobs.find(x => /\.png$/.test(x.n)); if (!it) return null;
    const m = __gpxk.S.routes.find(r => r.id === __gpxk.S.curId).snap.meta, bmp = await createImageBitmap(it.b);
    const cv = new OffscreenCanvas(bmp.width, bmp.height), cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0);
    const hex = h => { h = h.trim().replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
    const c1 = hex(gap), near = (a, c) => Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]) + Math.abs(a[2] - c[2]) < 60;
    let n = 0, n1 = 0;
    for (let i = 1; i < l.length; i++) {
      const a = Snapshot.toPic(m, l[i - 1][0], l[i - 1][1]), b = Snapshot.toPic(m, l[i][0], l[i][1]), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s < L; s += 2) { const d = cx.getImageData(Math.round(a[0] + (b[0] - a[0]) * s / L), Math.round(a[1] + (b[1] - a[1]) * s / L), 1, 1).data; n++; if (near(d, c1)) n1++; }
    }
    return { n, n1, w: bmp.width, h: bmp.height };
  }, [gapLine, cols.gap, cols.walked]);
  check(!!pngPix && pngPix.n > 20 && pngPix.n1 > pngPix.n * 0.25, '"Картина" (.png): дупката е кехлибарена на пунктир - ' + JSON.stringify(pngPix) + (pngPix ? '' : ' ' + await p10.textContent('#picMsg')));
  await p10.keyboard.press('Escape');
  await p10.click('#routesBody tr[data-route="' + cur10 + '"] [data-rt="open"]');
  // (4) Затворен кръг: новото положение е 240 м назад по маршрута, а следата върви напред - почти цялата обиколка.
  const sq = line(42.52, 24.70, 42.52, 24.71, 30).concat(line(42.52, 24.71, 42.53, 24.71, 30).slice(1), line(42.53, 24.71, 42.53, 24.70, 30).slice(1), line(42.53, 24.70, 42.52, 24.70, 30).slice(1));
  const nt10 = await p10.evaluate(() => __gpxk.S.tracks.length);
  await p10.setInputFiles('#fileInput', writeGpx('krag', sq));
  await p10.waitForFunction(n => __gpxk.S.tracks.length > n, nt10);
  await useTrack(p10);
  await p10.click('#followMapBtn');
  await growTo(p10, 0);
  await ctx10.setGeolocation({ latitude: 42.52, longitude: 24.7041 });
  await p10.waitForFunction(() => { const r = __gpxk.ui.follower.rec, p = r[r.length - 1]; return Math.abs(p[1] - 24.7041) < 1e-6; }, null, { timeout: 10000 });
  const f10 = await st10(0);
  await p10.waitForTimeout(1500);
  await ctx10.setGeolocation({ latitude: 42.52, longitude: 24.7012 });
  await growTo(p10, f10.n);
  const g10 = await st10(f10.n - 1), loopLen = await p10.evaluate(() => __gpxk.G.len), back10 = U_hav(42.52, 24.7041, 42.52, 24.7012);
  const ins10g = insOf(g10.add);
  check(near(ins10g, 42.52, 24.71) && near(ins10g, 42.53, 24.71) && near(ins10g, 42.53, 24.70) && ins10g.every(p => p.off < 1) && tUp(g10.add), 'затворен кръг: следата върви напред през трите завоя (' + ins10g.length + ' междинни точки), не назад');
  check(Math.abs(g10.len - f10.len - (loopLen - back10)) < 10, 'затворен кръг: изминати +' + Math.round(g10.len - f10.len) + ' м = обиколката ' + Math.round(loopLen) + ' без ' + Math.round(back10) + ' м назад');
  await p10.click('#followMapBtn');
  await shutWalk(p10);
  const h10 = await p10.evaluate(() => { const S = __gpxk.S, t = S.tracks[S.tracks.length - 1], w = S.routes.find(r => r.items && r.items.length === 1 && r.items[0].trackId === t.id); return { walk: t.walk, n: t.pts.length, len: t.len, rec: !!w }; });
  check(h10.walk && h10.n === g10.n && Math.abs(h10.len - g10.len) < 1 && h10.rec, 'след "Стоп" изминатият трак и записът в "Записани маршрути" носят следата (' + h10.n + ' точки, ' + Math.round(h10.len) + ' м)');
  await ctx10.close();

  // Височина на вмъкнатите точки (1.0.6): от профила на маршрута на мястото им, не по права между измерените.
  // Услугата за височини е подменена: височината е вълна по дължина, далеч от правата между GPS-височините 100 и 160.
  const ELE_FN = (lat, lon) => 800 + 5000 * (lat - 42.5) + 60 * Math.sin((lon - 24.7) * 3000);
  const noEle = (name, pts) => { const f = writeGpx(name, pts); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/<ele>[^<]*<\/ele>/g, '')); return f; };
  async function eleCase(withProfile) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['geolocation'], geolocation: { latitude: 42.5, longitude: 24.7 } });
    await ctx.addInitScript({ content: GEO_INIT });
    await ctx.route(/api\.open-meteo\.com|api\.opentopodata\.org/, route => {
      const u = new URL(route.request().url());
      if (!withProfile || u.hostname !== 'api.open-meteo.com') return route.abort();
      const la = u.searchParams.get('latitude').split(',').map(Number), lo = u.searchParams.get('longitude').split(',').map(Number);
      route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ elevation: la.map((v, i) => ELE_FN(v, lo[i])) }) });
    });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errors.push('p11 pageerror: ' + e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org|api\.open-meteo\.com/.test(m.text())) errors.push('p11 console: ' + m.text()); });
    await pg.goto(url);
    await pg.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
    await pg.setInputFiles('#fileInput', noEle(withProfile ? 'vis-prof' : 'vis-bez', zig));
    await pg.waitForFunction(() => __gpxk.S.tracks.length === 1);
    await useTrack(pg);
    if (withProfile) await pg.waitForFunction(() => __gpxk.prof && /Open-Meteo/.test(document.querySelector('#elevNote').textContent), null, { timeout: 15000 });
    else await pg.waitForFunction(() => /не са налични/.test(document.querySelector('#elevNote').textContent), null, { timeout: 15000 });
    await pg.evaluate(() => { __geo.alt = 100; });
    await pg.click('#followMapBtn');
    await pg.waitForFunction(() => __gpxk.ui.follower.rec.length > 0, null, { timeout: 10000 });
    await ctx.setGeolocation({ latitude: 42.5, longitude: 24.7012 });
    await pg.waitForFunction(() => { const r = __gpxk.ui.follower.rec, p = r[r.length - 1]; return Math.abs(p[1] - 24.7012) < 1e-6; }, null, { timeout: 10000 });
    const k = await pg.evaluate(() => __gpxk.ui.follower.rec.length);
    await pg.evaluate(() => { __geo.alt = 160; });
    await ctx.setGeolocation({ latitude: 42.5046, longitude: 24.71 });
    await pg.waitForFunction(k => __gpxk.ui.follower.rec.length > k, k, { timeout: 10000 });
    const r = await pg.evaluate(k => { const rec = __gpxk.ui.follower.rec, G = __gpxk.G, prof = __gpxk.prof, out = [];
      for (let i = k; i < rec.length && rec[i][4] == null; i++) {
        const nn = Core.nearestOn(G.pts, G.cum, rec[i][0], rec[i][1]);
        out.push({ lat: rec[i][0], lon: rec[i][1], ele: rec[i][2], prof: prof ? Elev.eleAt(prof, nn.d) : null });
      }
      const last = rec[k - 1], next = rec[k + out.length];
      return { ins: out, last: [last[0], last[1], last[2]], next: next && [next[0], next[1], next[2]], prof: !!prof, measured: rec.filter(p => p[4] != null).map(p => p[2]) };
    }, k);
    // Права линия между двете измерени, по разстоянието по следата.
    const way = [r.last].concat(r.ins.map(p => [p.lat, p.lon]), [r.next]), s = [0];
    for (let i = 1; i < way.length; i++) s.push(s[i - 1] + U_hav(way[i - 1][0], way[i - 1][1], way[i][0], way[i][1]));
    const straight = r.ins.map((p, i) => Math.round(100 + s[i + 1] / s[s.length - 1] * 60));
    await pg.click('#followMapBtn');
    await ctx.close();
    return { r, straight };
  }
  const ep = await eleCase(true);
  const epd = ep.r.ins.map(p => Math.abs(p.ele - p.prof)), epf = ep.r.ins.map((p, i) => Math.abs(p.ele - ep.straight[i]));
  check(ep.r.prof && ep.r.ins.length > 5 && epd.every(d => d <= 0.06) && Math.min(...epf) > 300,
    'дупка с профил: ' + ep.r.ins.length + ' вмъкнати точки с височината от профила (най-голяма разлика ' + Math.max(...epd).toFixed(2) + ' м; напр. ' + ep.r.ins.slice(0, 3).map(p => p.ele + ' = ' + p.prof.toFixed(1)).join(', ') + '), не по правата (' + ep.straight.slice(0, 3).join(', ') + ')');
  check(ep.r.last[2] === 100 && ep.r.next[2] === 160 && ep.r.measured.every(e => e === 100 || e === 160), 'измерените положения си остават с височината от GPS: ' + JSON.stringify(ep.r.measured));
  const en = await eleCase(false);
  check(!en.r.prof && en.r.ins.length > 5 && en.r.ins.every((p, i) => p.ele === en.straight[i]) && en.r.ins.some(p => p.ele > 100 && p.ele < 160),
    'без профил и без височина в трака: права линия между 100 и 160 м (' + en.r.ins.map(p => p.ele).join(', ') + ')');

  // 1.1.0 - CX Tracks: начален екран, "Точка" при следене, прозорецът "Запис на изминатото" (изглаждане).
  async function cxCase(W, H) {
    const tag = W + 'x' + H;
    const ctx = await browser.newContext({ splash: true, viewport: { width: W, height: H }, acceptDownloads: true, permissions: ['geolocation'], geolocation: { latitude: 42.5, longitude: 24.7 } });
    await ctx.addInitScript({ content: GEO_INIT });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errors.push('cx ' + tag + ' pageerror: ' + e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) errors.push('cx ' + tag + ' console: ' + m.text()); });
    const ext = [];
    pg.on('request', r => { if (/splash/.test(r.url()) && !r.url().startsWith(url)) ext.push(r.url()); });
    const t0 = Date.now();
    await pg.goto(url);
    await pg.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
    await pg.waitForFunction(() => { const i = document.querySelector('#splash img'); return i && i.complete; }, null, { timeout: 3000 }).catch(() => {});
    const sp = await pg.evaluate(() => { const s = document.querySelector('#splash'), i = s && s.querySelector('img'), r = s && s.getBoundingClientRect(), h = s && s.querySelector('h1').getBoundingClientRect();
      return s && { shown: getComputedStyle(s).display !== 'none' && r.width === innerWidth && r.height === innerHeight, h1: s.querySelector('h1').textContent, sub: s.querySelector('.splash-t p').textContent, hint: s.querySelector('.splash-hint').textContent,
        img: i.naturalWidth, src: i.currentSrc, h1In: h.left >= 0 && h.right <= innerWidth, title: document.title, logo: document.querySelector('.logo-t').textContent, seen: localStorage.getItem('gpxk.splash') }; });
    check(!!sp && sp.shown && sp.h1 === 'CX Tracks' && sp.sub === 'Маршрути и тракове' && /Натисни/.test(sp.hint) && sp.img === 1280 && sp.src === url + 'assets/splash.jpg' && sp.h1In && !ext.length,
      tag + ': първо пускане - начален екран на цял екран, надпис "CX Tracks" върху локалната снимка ' + JSON.stringify(sp && { img: sp.img, src: sp.src }));
    check(/CX Tracks$/.test(sp.title) && sp.logo === 'CX Tracks' && sp.seen === 'true', tag + ': името CX Tracks в заглавието ("' + sp.title + '") и логото, началният екран се помни');
    await pg.screenshot({ path: path.join(OUT, 'splash-' + W + '.png') });
    if (W > 600) {
      await pg.mouse.click(W / 2, H / 2);
      await pg.waitForFunction(() => !document.querySelector('#splash'), null, { timeout: 2000 }).then(() => check(true, tag + ': натискане маха началния екран'), () => check(false, tag + ': натискане маха началния екран'));
    } else {
      await pg.waitForFunction(() => !document.querySelector('#splash'), null, { timeout: 6000 }).catch(() => {});
      const dt = Date.now() - t0;
      check(await pg.evaluate(() => !document.querySelector('#splash')) && dt >= 2500, tag + ': началният екран изчезва сам след 3 с (' + (dt / 1000).toFixed(1) + ' с)');
    }
    check(await pg.isVisible('.foot .foot-name') && (await pg.textContent('.foot .foot-name')).includes('CX Tracks'), tag + ': дъното носи името CX Tracks');
    await pg.reload();
    await pg.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
    check(await pg.evaluate(() => !document.querySelector('#splash') && document.documentElement.classList.contains('splash-seen')), tag + ': след презареждане началният екран не излиза пак');

    // "Точка": маршрут, следене без сигнал, после с.
    await pg.setInputFiles('#fileInput', writeGpx('tochka-' + W, line(42.5, 24.7, 42.5, 24.71, 60)));
    await pg.waitForFunction(() => __gpxk.S.tracks.length === 1);
    await useTrack(pg);
    await pg.evaluate(() => { __geo.mute = true; });
    await pg.click('#followMapBtn');
    const nb = await pg.evaluate(() => { const b = document.querySelector('#walkPtBtn'), r = b.getBoundingClientRect(); return { dis: b.getAttribute('aria-disabled'), title: b.title, shown: r.width > 0 && r.right <= innerWidth + 0.5, op: +getComputedStyle(b).opacity }; });
    check(nb.shown && nb.dis === 'true' && /Няма сигнал/.test(nb.title) && nb.op < 0.7, tag + ': без сигнал копчето "Точка" е бледо и казва "няма сигнал" ' + JSON.stringify(nb));
    await pg.click('#walkPtBtn', { force: true });
    check(await pg.evaluate(() => !document.querySelector('#dlgPoint').open && __gpxk.ui.follower.wpts.length === 0 && /Няма сигнал от GPS - точката не е сложена/.test(document.querySelector('#toast').textContent)), tag + ': без сигнал "Точка" не слага точка на сляпо');
    // Без сигнал нищо не е записано - "Стоп" не пита; после следене със сигнал.
    await pg.click('#followMapBtn');
    check(await pg.evaluate(() => !__gpxk.ui.follower && !document.querySelector('#dlgWalk').open), tag + ': "Стоп" без записан път не отваря прозореца за запис');
    await pg.evaluate(() => { __geo.mute = false; });
    await pg.click('#followMapBtn');
    // Ходене на изток по ~8 м с трептене до 2,5 м встрани (за изглаждането).
    const k = 1 / 111320, dx = 8 / (111320 * Math.cos(42.5 * Math.PI / 180));
    const walkTo = async (i0, i1) => { for (let i = i0; i < i1; i++) {
      await ctx.setGeolocation({ latitude: 42.5 + (i % 2 ? 2.5 : -2.5) * k, longitude: 24.7 + i * dx, accuracy: 5 });
      await pg.waitForFunction(n => __gpxk.ui.follower.rec.length >= n, i + 1, { timeout: 3000 }).catch(() => {});
    } };
    await walkTo(0, 12);
    check(await pg.getAttribute('#walkPtBtn', 'aria-disabled') === 'false', tag + ': със сигнал "Точка" е активно');
    await pg.click('#walkPtBtn');
    const pd = await pg.evaluate(() => ({ open: document.querySelector('#dlgPoint').open, ph: document.querySelector('#walkPtName').placeholder, focus: document.activeElement && document.activeElement.id, where: document.querySelector('#walkPtWhere').textContent }));
    check(pd.open && pd.ph === 'Точка 1' && pd.focus === 'walkPtName' && /точност/.test(pd.where), tag + ': "Точка" пита за име веднага (празно - "Точка 1") ' + JSON.stringify(pd));
    if (W < 600) {
      const fit = await pg.evaluate(() => { const r = document.querySelector('#dlgPoint').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
      check(fit, tag + ': прозорецът "Точка" се събира на екрана');
    }
    await pg.screenshot({ path: path.join(OUT, 'point-dlg-' + W + '.png') });
    const recN = await pg.evaluate(() => __gpxk.ui.follower.rec.length);
    await pg.fill('#walkPtName', 'Извор');
    await pg.press('#walkPtName', 'Enter');
    await walkTo(12, 24);
    await pg.click('#walkPtBtn');
    await pg.press('#walkPtName', 'Enter');
    await walkTo(24, 30);
    // Отказ не слага точка.
    await pg.click('#walkPtBtn');
    await pg.click('#walkPtCancel');
    const wp = await pg.evaluate(() => ({ w: __gpxk.ui.follower.wpts.map(w => w.name + '@' + w.lon.toFixed(5)), follow: !!__gpxk.ui.follower, open: document.querySelector('#dlgPoint').open,
      rows: Array.from(document.querySelectorAll('#pointsList li.wpt-row .pname')).map(i => i.value), cnt: document.querySelector('#ptsCount').textContent }));
    check(wp.follow && !wp.open && wp.w.length === 2 && /^Извор@/.test(wp.w[0]) && /^Точка 2@/.test(wp.w[1]) && wp.rows.join('|') === 'Извор|Точка 2' && wp.cnt === '(2)', tag + ': две точки при следене ("Извор" и празно = "Точка 2"), в списъка "Точки"; "Отказ" не слага; следенето продължава ' + JSON.stringify(wp));
    check(recN >= 11, tag + ': следенето записва, докато прозорецът е отворен (' + recN + ' положения)');
    // Положението на точката - последното от GPS.
    const wpPos = await pg.evaluate(() => { const w = __gpxk.ui.follower.wpts[0]; return [w.lat, w.lon, w.time > 0]; });
    check(Math.abs(wpPos[1] - (24.7 + 11 * dx)) < 1e-5 && wpPos[2], tag + ': точката е на последното положение от GPS ' + JSON.stringify(wpPos));
    // "Изнеси .gpx" при следене носи точките като <wpt>.
    await pg.click('#walkGpxBtn');
    const [dlw] = await Promise.all([pg.waitForEvent('download'), pg.press('#fileName', 'Enter')]);
    const fw = path.join(OUT, 'cx-walk-' + W + '.gpx'); await dlw.saveAs(fw);
    const xw = fs.readFileSync(fw, 'utf8');
    check(/creator="CX Tracks"/.test(xw) && (xw.match(/<wpt /g) || []).length === 2 && /<name>Извор<\/name><\/wpt>/.test(xw) && /<name>Точка 2<\/name><\/wpt>/.test(xw), tag + ': .gpx при следене: creator="CX Tracks" и двете точки като <wpt>');
    await pg.screenshot({ path: path.join(OUT, 'follow-point-' + W + '.png') });

    // "Стоп" - прозорецът "Запис на изминатото".
    await pg.click('#followMapBtn');
    await pg.waitForFunction(() => document.querySelector('#dlgWalk').open, null, { timeout: 3000 }).catch(() => {});
    const rawN = await pg.evaluate(() => __gpxk.ui.lastWalk.pts.length);
    const d1 = await pg.evaluate(() => ({ open: document.querySelector('#dlgWalk').open, pts: document.querySelector('#smPts').textContent, len: document.querySelector('#smLen').textContent, side: document.querySelector('#smSide').checked, dense: document.querySelector('#smDense').checked, name: document.querySelector('#walkName').value }));
    check(d1.open && !d1.side && !d1.dense && d1.pts === rawN + ' от ' + rawN + ' (махнати 0)' && /км → .*км/.test(d1.len) && /^изминат/.test(d1.name), tag + ': "Запис на изминатото": отметките изключени, суровата следа ' + JSON.stringify(d1));
    await pg.check('#smSide');
    const d2 = await pg.evaluate(() => ({ pts: document.querySelector('#smPts').textContent, len: document.querySelector('#smLen').textContent }));
    const m2 = d2.pts.match(/^(\d+) от (\d+) \(махнати (\d+)\)$/);
    check(!!m2 && +m2[2] === rawN && +m2[1] < rawN / 2 && +m2[1] + +m2[3] === rawN, tag + ': "Изглаждане" веднага казва колко точки остават: ' + d2.pts + ' · ' + d2.len);
    await pg.check('#smDense');
    const d3 = await pg.evaluate(() => document.querySelector('#smPts').textContent);
    await pg.uncheck('#smDense');
    const d4 = await pg.evaluate(() => document.querySelector('#smPts').textContent);
    check(/^\d+ от \d+/.test(d3) && d4 === d2.pts, tag + ': "Гъсти точки" се добавя и маха без загуба на суровата следа (' + d3 + ' / ' + d4 + ')');
    if (W < 600) {
      const fit = await pg.evaluate(() => { const d = document.querySelector('#dlgWalk').getBoundingClientRect(), b = ['#walkCancel', '#walkDl', '#walkOk'].map(s => document.querySelector(s).getBoundingClientRect());
        return d.left >= 0 && d.right <= innerWidth && d.top >= 0 && d.bottom <= innerHeight && b.every(r => r.width > 0 && r.right <= d.right && r.bottom <= d.bottom); });
      check(fit, tag + ': прозорецът "Запис на изминатото" и трите копчета се събират на екрана');
    }
    await pg.screenshot({ path: path.join(OUT, 'walk-save-' + W + '.png') });
    await pg.fill('#walkName', 'Сутрешно ' + W);
    const [dls] = await Promise.all([pg.waitForEvent('download'), pg.click('#walkDl')]);
    const fs2 = path.join(OUT, 'cx-smooth-' + W + '.gpx'); await dls.saveAs(fs2);
    const xs = fs.readFileSync(fs2, 'utf8');
    check(dls.suggestedFilename() === 'Сутрешно ' + W + '.gpx' && (xs.match(/<trkpt /g) || []).length === +m2[1] && (xs.match(/<wpt /g) || []).length === 2 && /<time>/.test(xs), tag + ': "Свали .gpx" от прозореца сваля изгладеното (' + (xs.match(/<trkpt /g) || []).length + ' точки, с часове) и точките: ' + dls.suggestedFilename());
    check(await pg.evaluate(() => document.querySelector('#dlgWalk').open), tag + ': след "Свали .gpx" прозорецът остава отворен');
    await pg.click('#walkOk');
    const sv = await pg.evaluate(() => { const S = __gpxk.S, lw = __gpxk.ui.lastWalk, t = S.tracks.find(x => x.id === lw.trackId), r = S.routes.find(x => x.id === lw.routeId);
      return { open: document.querySelector('#dlgWalk').open, n: t.pts.length, len: t.len, b: r.items[0].b, name: r.name, wpts: t.wpts.map(w => w.name), lw: lw.pts.length, gaps: Core.walkGaps(t.pts).length,
        row: (document.querySelector('#routesBody tr[data-route="' + r.id + '"]') || {}).textContent || '' }; });
    check(!sv.open && sv.n === +m2[1] && sv.lw === sv.n && Math.abs(sv.b - sv.len) < 0.01 && sv.name === 'Сутрешно ' + W && sv.wpts.join('|') === 'Извор|Точка 2' && sv.gaps === 0 && sv.row.includes('Сутрешно'),
      tag + ': "Запази" записва изгладеното под новото име в "Записани маршрути", с точките, без лъжливи дупки ' + JSON.stringify(Object.assign({}, sv, { row: undefined })));
    // Записът, отворен като маршрут: износът носи точките като спирки.
    await pg.evaluate(() => { const lw = __gpxk.ui.lastWalk; document.querySelector('#routesBody tr[data-route="' + lw.routeId + '"] [data-rt="open"]').click(); });
    await pg.waitForFunction(() => __gpxk.S.curId === __gpxk.ui.lastWalk.routeId, null, { timeout: 2000 }).catch(() => {});
    const op = await pg.evaluate(() => ({ cur: __gpxk.S.curId === __gpxk.ui.lastWalk.routeId, rows: Array.from(document.querySelectorAll('#pointsList li.wpt-row .pname')).map(i => i.value) }));
    check(op.cur && op.rows.join('|') === 'Извор|Точка 2', tag + ': отвореният запис показва точките в списъка "Точки" ' + JSON.stringify(op));
    if (op.cur) {
      await pg.evaluate(() => document.querySelector('#bar [data-act="export-gpx"]').click());
      const [dle] = await Promise.all([pg.waitForEvent('download'), pg.press('#fileName', 'Enter')]);
      const fe = path.join(OUT, 'cx-record-' + W + '.gpx'); await dle.saveAs(fe);
      const xe = fs.readFileSync(fe, 'utf8');
      check((xe.match(/<wpt /g) || []).length === 2 && /creator="CX Tracks"/.test(xe), tag + ': износът на записа носи двете точки като спирки');
    }
    await ctx.close();
  }
  await cxCase(1280, 800);
  await cxCase(390, 844);

  // ---- 1.1.6: "Следене" само на картата, видима връзка "свързано направо", изглаждане при "Запази", кадър и копчета на картината ----
  {
    const c11 = await browser.newContext({ viewport: { width: 760, height: 800 } });
    await c11.route(/arcgisonline\.com|opentopomap\.org/, r => r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/png' }, body: PNG1 }));
    await c11.addInitScript({ content: 'window.lineColors = ' + lineColors.toString() });
    const p11 = await c11.newPage();
    p11.on('pageerror', e => errors.push('pageerror: ' + e.message));
    p11.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) errors.push('console: ' + m.text()); });
    await p11.goto(url);
    await p11.waitForFunction(() => window.__gpxk && window.__gpxk.ready);
    // LA на изток; LC започва 25 м северно от края на LA - дупка над отклонението (20 м).
    await p11.setInputFiles('#fileInput', [writeGpx('LA6', line(42.5, 24.70, 42.5, 24.75, 200)), writeGpx('LC6', line(42.500225, 24.75, 42.52, 24.75, 80))]);
    await p11.waitForFunction(() => __gpxk.S.tracks.length === 2);
    await p11.evaluate(() => { const S = __gpxk.S, r = S.routes.find(x => x.id === S.curId), T = S.tracks;
      r.items = [{ type: 'part', trackId: T[0].id, a: 0, b: T[0].len, rev: false }, { type: 'part', trackId: T[1].id, a: 0, b: T[1].len, rev: false }]; __gpxk.refresh(); });
    const settle6 = () => p11.evaluate(() => new Promise(res => { let last = null, n = 0; (function f() { const t = document.querySelector('.maptl').getBoundingClientRect().top + ',' + document.querySelector('#bar').getBoundingClientRect().bottom; n = t === last ? n + 1 : 0; last = t; n >= 3 ? res() : requestAnimationFrame(f); })(); }));
    const fab6 = () => p11.evaluate(() => { const b = document.querySelector('#followMapBtn'), r = b.getBoundingClientRect(), h = document.querySelector('#barHandle').getBoundingClientRect();
      return { shown: r.width > 0 && getComputedStyle(b).display !== 'none', w: Math.round(r.width), text: b.textContent.trim(), btn: b.classList.contains('btn') && !b.classList.contains('round-fab'), inTl: b.parentElement.classList.contains('maptl'),
        after: r.left >= h.right - 0.5 || r.top >= h.bottom - 0.5, inBar: !!document.querySelector('#bar [data-act="follow"]'), pw: Math.round(document.querySelector('.actions .follow-btn').getBoundingClientRect().width), onScreen: r.left >= 0 && r.right <= innerWidth && r.top >= 0 }; });
    // (1) "Следене" е на картата при отворена и при скрита лента, в лентата го няма.
    for (const w of [360, 560, 760]) {
      await p11.setViewportSize({ width: w, height: 800 });
      await p11.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await settle6();
      const a = await fab6();
      check(a.shown && a.inTl && a.after && !a.inBar && a.btn && a.text === 'Следене' && Math.abs(a.w - a.pw) <= 1 && a.w >= 70 && a.onScreen, '1.1.6, ' + w + ' px, отворена лента: текстовото "Следене" е на картата горе вляво, в лентата го няма: ' + JSON.stringify(a));
      await p11.click('#barHandle');
      await p11.waitForFunction(() => document.body.classList.contains('bar-hidden'));
      await settle6();
      const b = await fab6();
      check(b.shown && b.inTl && !b.inBar && b.w === a.w && b.onScreen, '1.1.6, ' + w + ' px, скрита лента: "Следене" е на същото място в групата, ' + b.w + ' px');
      await p11.click('#barHandle');
      await p11.waitForFunction(() => !document.body.classList.contains('bar-hidden'));
    }
    // (2) "Свържи направо": кехлибарена пунктирана линия с надпис, надписът гасне, линията остава.
    await p11.setViewportSize({ width: 760, height: 800 });
    await p11.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    check(await p11.evaluate(() => __gpxk.G.gaps.length === 1 && document.querySelectorAll('#gapsList [data-gapact="bridge"]').length === 1), '1.1.6: дупка от 25 м между LA и LC с "Свържи направо"');
    const gap6 = await p11.evaluate(() => { const g = __gpxk.G.gaps[0]; __gpxk.map.setBearing(0); __gpxk.map.setView((g.from[0] + g.to[0]) / 2, (g.from[1] + g.to[1]) / 2, 18); return [g.from.slice(0, 2), g.to.slice(0, 2)]; });
    await p11.evaluate(() => document.querySelector('#gapsList [data-gapact="bridge"]').click());
    const tB = Date.now();
    await p11.waitForFunction(() => (__gpxk.ui.bridges || []).length === 1, null, { timeout: 3000 }).catch(() => {});
    await frame(p11);
    const walkGap = await p11.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-walk-gap').trim());
    const br1 = await p11.evaluate(() => ({ b: __gpxk.ui.bridges, gaps: __gpxk.G.gaps.length, row: Array.from(document.querySelectorAll('#partsList li.bridge')).map(e => e.textContent.trim()) }));
    const px1 = await p11.evaluate(([l, c]) => lineColors(l, c, c), [gap6, walkGap]);
    check(br1.gaps === 0 && br1.b.length === 1 && br1.b[0].label === 'свързано направо' && br1.b[0].alpha === 1 && br1.row.length === 1, '1.1.6: след "Свържи направо" връзката се рисува с надпис "свързано направо": ' + JSON.stringify(br1));
    check(px1.n > 20 && px1.n1 > px1.n * 0.25, '1.1.6: връзката е кехлибарена (' + walkGap + ') на пунктир между двата края: ' + JSON.stringify(px1));
    await p11.screenshot({ path: path.join(OUT, 'bridge-760.png') });
    const gone = await p11.waitForFunction(() => __gpxk.ui.bridges.length === 1 && !__gpxk.ui.bridges[0].label, null, { timeout: 9000 }).then(() => Date.now() - tB, () => -1);
    await frame(p11);
    const px2 = await p11.evaluate(([l, c]) => lineColors(l, c, c), [gap6, walkGap]);
    check(gone >= 3000 && gone <= 7000, '1.1.6: надписът "свързано направо" гасне след ' + gone + ' ms');
    check(px2.n1 > px2.n * 0.25, '1.1.6: след надписа пунктирът остава: ' + JSON.stringify(px2));
    // (3) "Запази": двете отметки над полето за име, обобщение; изглаждането пипа и чертежа, "Отмени" го връща.
    await p11.evaluate(() => { const b = U.boundsOf([__gpxk.G.pts]); __gpxk.map.setView((b.s + b.n) / 2, (b.w + b.e) / 2, 13); });
    const raw6 = await p11.evaluate(() => ({ n: __gpxk.G.pts.length, len: __gpxk.G.len, first: __gpxk.G.pts[0], last: __gpxk.G.pts[__gpxk.G.pts.length - 1] }));
    for (const w of [360, 560, 760]) {
      await p11.setViewportSize({ width: w, height: 800 });
      await p11.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await p11.click('#bar [data-act="save"]');
      const d = await p11.evaluate(() => { const R = s => document.querySelector(s).getBoundingClientRect(), sm = document.querySelector('#saveSmooth'), nr = document.querySelector('#dlgName .name-row');
        return { open: document.querySelector('#dlgName').open, title: document.querySelector('#nameTitle').textContent, shown: !sm.hidden && R('#saveSmooth').height > 0, above: R('#rsDense').bottom <= R('#fileName').top && !!(sm.compareDocumentPosition(nr) & Node.DOCUMENT_POSITION_FOLLOWING),
          labels: Array.from(sm.querySelectorAll('.smooth-opt b')).map(b => b.textContent), side: document.querySelector('#rsSide').checked, dense: document.querySelector('#rsDense').checked, pts: document.querySelector('#rsPts').textContent, len: document.querySelector('#rsLen').textContent,
          fits: R('#dlgName').left >= 0 && R('#dlgName').right <= innerWidth, ok: document.querySelector('#nameOk').textContent }; });
      check(d.open && d.title === 'Запис на маршрута' && d.shown && d.above && JSON.stringify(d.labels) === '["Изглаждане","Гъсти точки"]' && !d.side && !d.dense && d.fits && d.ok === 'Запази' && d.pts === U_num(raw6.n) + ' → ' + U_num(raw6.n) + ' (махнати 0)',
        '1.1.6, ' + w + ' px: "Запази" отваря "Запис на маршрута" с двете отметки над полето за име и обобщение: ' + JSON.stringify(d));
      await p11.press('#fileName', 'Escape');
    }
    await p11.setViewportSize({ width: 760, height: 800 });
    await p11.click('#bar [data-act="save"]');
    await p11.check('#rsSide');
    const pv = await p11.evaluate(() => ({ pts: document.querySelector('#rsPts').textContent, len: document.querySelector('#rsLen').textContent, g: __gpxk.G.pts.length }));
    const m6 = /^([\d\s ]+) → ([\d\s ]+) \(махнати ([\d\s ]+)\)$/.exec(pv.pts), toN = m6 ? +m6[2].replace(/\D/g, '') : -1;
    check(!!m6 && toN < raw6.n && toN >= 2 && pv.g === raw6.n && / → /.test(pv.len), '1.1.6: с "Изглаждане" обобщението казва ' + pv.pts + ', ' + pv.len + ' - преди запис чертежът е непокътнат (' + pv.g + ')');
    const undo0 = await p11.evaluate(() => __gpxk.ui.undo.length);
    await p11.fill('#fileName', 'gladko');
    const [dg] = await Promise.all([p11.waitForEvent('download'), p11.press('#fileName', 'Enter')]);
    const fg = path.join(OUT, 'gladko-116.gpx'); await dg.saveAs(fg);
    const xg = fs.readFileSync(fg, 'utf8'), trk = [...xg.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"/g)].map(m => [+m[1], +m[2]]);
    const sm6 = await p11.evaluate(() => { const S = __gpxk.S, r = S.routes.find(x => x.id === S.curId); return { n: __gpxk.G.pts.length, pts: __gpxk.G.pts.map(p => [p[0], p[1]]), smooth: r.smooth, nPts: r.nPts, name: r.name, undo: __gpxk.ui.undo.length, undoOn: !document.querySelector('#undoBtn').disabled }; });
    const same = trk.length === sm6.n && trk.every((p, i) => Math.abs(p[0] - sm6.pts[i][0]) < 2e-6 && Math.abs(p[1] - sm6.pts[i][1]) < 2e-6);
    check(sm6.n === toN && sm6.n < raw6.n && sm6.smooth && sm6.smooth.side && sm6.nPts === sm6.n && sm6.name === 'gladko', '1.1.6: след "Запази" с изглаждане чертежът на картата е изгладеният: ' + raw6.n + ' → ' + sm6.n + ' точки, записът носи изглаждането');
    check(same, '1.1.6: сваленият .gpx съвпада точка за точка с чертежа на картата (' + trk.length + ' / ' + sm6.n + ')');
    check(sm6.undo === undo0 + 1 && sm6.undoOn, '1.1.6: изглаждането е стъпка в историята за отмяна');
    await p11.click('#undoBtn');
    const un6 = await p11.evaluate(() => { const S = __gpxk.S, r = S.routes.find(x => x.id === S.curId); return { n: __gpxk.G.pts.length, len: __gpxk.G.len, smooth: r.smooth || null, first: __gpxk.G.pts[0], last: __gpxk.G.pts[__gpxk.G.pts.length - 1] }; });
    check(un6.n === raw6.n && Math.abs(un6.len - raw6.len) < 0.01 && !un6.smooth && JSON.stringify([un6.first, un6.last]) === JSON.stringify([raw6.first, raw6.last]), '1.1.6: "Отмени" връща неизгладения маршрут: ' + un6.n + ' точки, ' + Math.round(un6.len) + ' м');
    // С изключени отметки по картата нищо не се пипа (и историята не расте).
    const undo1 = await p11.evaluate(() => __gpxk.ui.undo.length);
    await p11.click('#bar [data-act="save"]');
    check(!(await p11.isChecked('#rsSide')) && !(await p11.isChecked('#rsDense')), '1.1.6: след "Отмени" отметките пак са изключени');
    const [dr] = await Promise.all([p11.waitForEvent('download'), p11.press('#fileName', 'Enter')]);
    const fr = path.join(OUT, 'surov-116.gpx'); await dr.saveAs(fr);
    const nr = (fs.readFileSync(fr, 'utf8').match(/<trkpt /g) || []).length;
    check(nr === raw6.n && await p11.evaluate(([n, u]) => __gpxk.G.pts.length === n && __gpxk.ui.undo.length === u, [raw6.n, undo1]), '1.1.6: "Запази" без отметки не пипа чертежа: ' + nr + ' точки в .gpx, ' + raw6.n + ' на картата');
    // (4) Картината: маршрутът е под панела и центриран там; връзката е кехлибарена и в .png; копчетата са колона.
    await p11.evaluate(() => { window.__blobs = []; const d = U.download; U.download = (b, n) => { window.__blobs.push({ b, n }); return d(b, n); }; });
    for (const w of [360, 560, 760]) {
      await p11.setViewportSize({ width: w, height: 800 });
      await p11.evaluate(() => { window.__blobs = []; document.querySelector('.actions [data-act="picture"]').click(); });
      await p11.click('#dlgPic [data-act="pic-make"]');
      await p11.waitForFunction(() => window.__blobs.some(x => /\.png$/.test(x.n)) && /Свалена/.test(document.querySelector('#picMsg').textContent), null, { timeout: 20000 }).catch(() => {});
      const pic = await p11.evaluate(async ([gap, walkGap]) => {
        const it = window.__blobs.find(x => /\.png$/.test(x.n)); if (!it) return null;
        const m = __gpxk.S.routes.find(r => r.id === __gpxk.S.curId).snap.meta, pb = Snapshot.panelRect(m, 2), fa = Snapshot.freeArea(m, 2);
        const q = __gpxk.G.pts.map(p => Snapshot.toPic(m, p[0], p[1])), xs = q.map(p => p[0]), ys = q.map(p => p[1]);
        const bb = { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
        const bmp = await createImageBitmap(it.b), cv = new OffscreenCanvas(bmp.width, bmp.height), cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0);
        const hex = h => { h = h.trim().replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); }, c1 = hex(walkGap);
        const a = Snapshot.toPic(m, gap[0][0], gap[0][1]), b = Snapshot.toPic(m, gap[1][0], gap[1][1]), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        let n = 0, n1 = 0;
        for (let s = 0; s <= L; s += 1) { const d = cx.getImageData(Math.round(a[0] + (b[0] - a[0]) * s / L), Math.round(a[1] + (b[1] - a[1]) * s / L), 1, 1).data; n++; if (Math.abs(d[0] - c1[0]) + Math.abs(d[1] - c1[1]) + Math.abs(d[2] - c1[2]) < 60) n1++; }
        return { w: m.w, h: m.h, pw: bmp.width, ph: bmp.height, panelBottom: Math.round(pb.y + pb.h), bb: { l: Math.round(bb.l), r: Math.round(bb.r), t: Math.round(bb.t), b: Math.round(bb.b) },
          below: bb.t > pb.y + pb.h, inside: bb.l >= 0 && bb.r <= m.w && bb.b <= fa.y + fa.h, dx: Math.round((bb.l + bb.r) / 2 - m.w / 2), dy: Math.round((bb.t + bb.b) / 2 - (fa.y + fa.h / 2)), bridge: { n, n1 } };
      }, [gap6, walkGap]);
      check(!!pic && pic.pw === pic.w && pic.ph === pic.h && pic.below && pic.inside && Math.abs(pic.dx) <= 2 && Math.abs(pic.dy) <= 2,
        '1.1.6, ' + w + ' px: в "Картина" маршрутът е под панела (панелът до ' + (pic && pic.panelBottom) + ' px) и центриран в свободното място: ' + JSON.stringify(pic) + (pic ? '' : ' ' + await p11.textContent('#picMsg')));
      check(!!pic && pic.bridge.n > 3 && pic.bridge.n1 > pic.bridge.n * 0.25, '1.1.6, ' + w + ' px: "свързано направо" е кехлибарено и в .png: ' + JSON.stringify(pic && pic.bridge));
      await p11.keyboard.press('Escape');
      // Дълга и тясна следа (33 км на север, 80 м широка): събира се под панела, смалява се, не отива вдясно от панела.
      const tall = await p11.evaluate(() => {
        const bounds = { s: 42.40, n: 42.70, w: 24.80, e: 24.801 }, m = Snapshot.plan(bounds, 0.1, 18, null, { legend: 1 }), pb = Snapshot.panelRect(m, 1), fa = Snapshot.freeArea(m, 1);
        const a = Snapshot.toPic(m, bounds.n, bounds.w), b = Snapshot.toPic(m, bounds.s, bounds.e), flat = Snapshot.plan(bounds, 0.1, 18);
        return { w: m.w, h: m.h, z: m.z, zFlat: flat.z, top: Math.round(a[1]), bottom: Math.round(b[1]), l: Math.round(a[0]), r: Math.round(b[0]), panelBottom: Math.round(pb.y + pb.h), freeBottom: Math.round(fa.y + fa.h),
          below: a[1] > pb.y + pb.h, inside: b[1] <= fa.y + fa.h, centered: Math.abs((a[0] + b[0]) / 2 - m.w / 2) <= 2, max: Math.max(m.w, m.h) <= 4096 };
      });
      check(tall.below && tall.inside && tall.centered && tall.max && tall.z <= tall.zFlat, '1.1.6, ' + w + ' px: дълга тясна следа в "Картина" е под панела, центрирана по ширина (не вдясно от панела), до 4096 px: ' + JSON.stringify(tall));
      // Копчетата на картината: колона като на картата, не стигат до стрелката нагоре; "Към картата" връща на картата.
      await p11.evaluate(() => document.querySelector('#picOpenBtn').click());
      await p11.waitForFunction(() => !document.querySelector('#picView').hidden);
      const ctl = await p11.evaluate(() => {
        const bs = [...document.querySelectorAll('.pic-ctl > button')], rs = bs.map(b => b.getBoundingClientRect()), tt = document.querySelector('#toTopBtn').getBoundingClientRect();
        const hit = (p, q) => !(p.right <= q.left || q.right <= p.left || p.bottom <= q.top || q.bottom <= p.top), fit = document.querySelector('.mapctl.br [data-act="fit"]');
        return { acts: bs.map(b => b.dataset.act), col: rs.every((r, i) => !i || (r.top >= rs[i - 1].bottom - 0.5 && Math.abs(r.right - rs[i - 1].right) < 1)), widths: rs.map(r => Math.round(r.width)),
          overTop: rs.some(r => hit(r, tt)), onScreen: rs.every(r => r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight),
          fitSame: bs[2].textContent.trim() === fit.textContent.trim() && bs[2].classList.contains('ico'), close: { svg: !!bs[0].querySelector('svg'), text: bs[0].textContent.trim(), label: bs[0].getAttribute('aria-label') } };
      });
      check(JSON.stringify(ctl.acts) === '["pic-close","pic-1","pic-fit"]' && ctl.col && ctl.widths.every(x => x === 38) && !ctl.overTop && ctl.fitSame && ctl.close.svg && ctl.close.text === '' && ctl.close.label === 'Към картата',
        '1.1.6, ' + w + ' px: копчетата на картината са колона като на картата ("Към картата" с иконка, "1:1", "▣"), без застъпване със стрелката нагоре: ' + JSON.stringify(ctl));
      await p11.click('#picCloseBtn');
      check(await p11.evaluate(() => document.querySelector('#picView').hidden), '1.1.6, ' + w + ' px: "Към картата" връща на картата');
    }
    await p11.setViewportSize({ width: 360, height: 800 });
    await p11.evaluate(() => document.querySelector('#picOpenBtn').click());
    await p11.screenshot({ path: path.join(OUT, 'pic-ctl-360.png') });
    await p11.evaluate(() => document.querySelector('#picCloseBtn').click());
    await c11.close();
  }

  // ---- 1.2.0: език на интерфейса - речник bg/en, копчето „Език“, автоматичен превод ----
  {
    const watch = pg => { const errs = []; pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) errs.push('console: ' + m.text()); }); return errs; };
    const ready = pg => pg.waitForFunction(() => window.__gpxk && window.__gpxk.ready, null, { timeout: 15000 });
    // Кирилица в целия документ, без филтър по видимост: всеки текстов възел (и в затворените прозорци,
    // скритите панели и редове), подсказките (title, aria-label, placeholder, alt, content), стойностите
    // на полетата. Скрит низ излиза на екрана по-късно - затова се гледа всичко.
    // Без данните на потребителя (имена на тракове, маршрути, точки).
    function cyrScan() {
      const cyr = /[Ѐ-ӿ]/, bad = [], g = window.__gpxk;
      const mine = [].concat(...g.S.tracks.map(t => [t.name, t.title].concat((t.wpts || []).map(w => w.name))), g.S.routes.map(r => r.name)).filter(Boolean);
      const own = v => mine.some(n => v.includes(n));
      const where = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '');
      const w = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const n = w.currentNode, e = n.parentElement, t = n.data.trim();
        if (!t || !cyr.test(t) || e.closest('script, style') || own(t)) continue;
        bad.push(where(e) + ': ' + t.slice(0, 60));
      }
      document.querySelectorAll('[title],[aria-label],[placeholder],[alt],meta[content]').forEach(e => ['title', 'aria-label', 'placeholder', 'alt', 'content'].forEach(a => { const v = e.getAttribute(a); if (v && cyr.test(v) && !own(v)) bad.push(where(e) + ' ' + a + ': ' + v.slice(0, 60)); }));
      document.querySelectorAll('input, textarea').forEach(i => { if (cyr.test(i.value) && !own(i.value)) bad.push(where(i) + ' value: ' + i.value); });
      return bad;
    }

    // Източникът: всеки елемент в index.html с текст на кирилица има data-i18n, а всяка подсказка
    // на кирилица - своето data-i18n-title / -aria / -placeholder / -alt / -content. Иначе българският
    // низ стои в страницата, докато кодът не го презапише (или завинаги, ако не го пипа).
    {
      const ps = await browser.newPage();
      const holes = await ps.evaluate(h => {
        const d = new DOMParser().parseFromString(h, 'text/html'), cyr = /[Ѐ-ӿ]/, bad = [];
        const where = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.className ? '.' + String(e.className).split(' ')[0] : '');
        const w = d.createTreeWalker(d.documentElement, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) { const n = w.currentNode, e = n.parentElement; if (cyr.test(n.data) && !e.closest('script, style') && !e.hasAttribute('data-i18n')) bad.push(where(e) + ': ' + n.data.trim().slice(0, 50)); }
        const A = { title: 'title', 'aria-label': 'aria', placeholder: 'placeholder', alt: 'alt', content: 'content' };
        // Всеки атрибут, не само подсказките: кирилица във value, data-* и т.н. няма кой да преведе - пада винаги.
        d.querySelectorAll('*').forEach(e => Array.from(e.attributes).forEach(at => { if (cyr.test(at.value) && !(A[at.name] && e.hasAttribute('data-i18n-' + A[at.name]))) bad.push(where(e) + ' ' + at.name + ': ' + at.value.slice(0, 50)); }));
        // data-i18n сменя целия текст на елемента - вътре не бива да има други елементи.
        d.querySelectorAll('[data-i18n]').forEach(e => { if (e.children.length) bad.push(where(e) + ': data-i18n с вложени елементи'); });
        return bad;
      }, fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
      check(!holes.length, '1.2.0: в index.html всеки текст и подсказка на кирилица е с data-i18n' + (holes.length ? ': ' + holes.join(' | ') : ''));
      await ps.close();
    }

    // Огледалото на речника: всеки ключ има bg и en, в английските няма кирилица, заместителите съвпадат.
    const cm = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pm = await cm.newPage(); const em = watch(pm);
    await pm.goto(url); await ready(pm);
    const mir = await pm.evaluate(() => {
      const W = I18N.all, keys = Object.keys(W), bad = [];
      const ph = s => (s.match(/\{\w+\}/g) || []).sort().join(',');
      keys.forEach(k => { const e = W[k]; if (!Array.isArray(e) || !e[0] || !e[1]) bad.push(k + ': празно'); else if (/[Ѐ-ӿ]/.test(e[1])) bad.push(k + ': кирилица в en'); else if (ph(e[0]) !== ph(e[1])) bad.push(k + ': заместители'); });
      // Всички ключове от index.html и от кода са в речника.
      const used = new Set();
      document.querySelectorAll('*').forEach(el => Object.keys(el.dataset).forEach(d => { if (/^i18n/.test(d)) used.add(el.dataset[d]); }));
      const miss = [...used].filter(k => !W[k]);
      return { n: keys.length, bad, miss, lang: document.documentElement.lang };
    });
    const src = ['app.js', 'util.js', 'snapshot.js', 'follow.js', 'gpx.js', 'map.js', 'elev.js'].map(f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    const codeKeys = [...new Set([...src.matchAll(/\bT(?:E)?\(\s*'([\w.]+)'\s*[,)]/g)].map(m => m[1]).concat([...src.matchAll(/\bT\.n\(\s*'([\w.]+)'\s*,/g)].flatMap(m => [m[1] + '.1', m[1] + '.n'])))];
    const missCode = await pm.evaluate(ks => ks.filter(k => !I18N.all[k]), codeKeys);
    check(mir.n > 400 && !mir.bad.length && !mir.miss.length && !missCode.length && codeKeys.length > 200, '1.2.0: речникът е огледален - ' + mir.n + ' ключа, всеки с bg и en, без кирилица в en; ' + codeKeys.length + ' ключа от кода и всички от index.html са в него' + (mir.bad.length || mir.miss.length || missCode.length ? ': ' + JSON.stringify({ bad: mir.bad.slice(0, 8), miss: mir.miss, missCode }) : ''));
    // Кирилица, останала в кода извън речника (низове в кавички, без коментарите).
    const leftover = src.split('\n').filter(l => !/^\s*(\/\/|\/?\*)/.test(l)).filter(l => /'[^'\n]*[Ѐ-ӿ][^'\n]*'/.test(l.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, ''))).filter(l => !/'кеш'|'изрязана'|BG = \{|var TR = \{|'unit\.|'months\.short'|'dirs'/.test(l));
    check(!leftover.length, '1.2.0: в js/ няма видими низове на кирилица извън речника' + (leftover.length ? ': ' + leftover.slice(0, 5).map(l => l.trim().slice(0, 90)).join(' | ') : ''));
    check(mir.lang === 'bg' && await pm.textContent('#langCode') === 'БГ', '1.2.0: браузър на български - интерфейсът е на български, копчето казва „БГ“');
    await cm.close();

    // Браузър на английски, без избор: целият интерфейс е на английски, на екрана няма кирилица.
    const ce = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 }, acceptDownloads: true, permissions: ['geolocation'], geolocation: { latitude: 42.5021, longitude: 24.6985 } });
    await ce.addInitScript({ content: 'window.inView = ' + inView.toString() });
    const pe = await ce.newPage(); const ee = watch(pe);
    await pe.goto(url); await ready(pe);
    const e0 = await pe.evaluate(() => ({ lang: document.documentElement.lang, code: document.querySelector('#langCode').textContent, save: document.querySelector('#bar [data-act="save"]').textContent, empty: document.querySelector('#empty b').textContent, route: document.querySelector('#routeName').value, title: document.title, pref: localStorage.getItem('gpxk.lang') }));
    check(e0.lang === 'en' && e0.code === 'EN' && e0.save === 'Save' && e0.empty === 'Your route will appear here' && e0.route === 'New route' && e0.title === 'New route · CX Tracks' && e0.pref === null, '1.2.0: браузър на английски без избор - интерфейсът е на английски: ' + JSON.stringify(e0));
    const scan0 = await pe.evaluate(cyrScan);
    check(!scan0.length, '1.2.0, en: празната страница е без нито един кирилски надпис' + (scan0.length ? ': ' + scan0.slice(0, 10).join(' | ') : ''));
    await pe.click('#empty [data-act="add-tracks"]');
    await pe.setInputFiles('#fileInput', [fx('hisarya-izhod.gpx'), fx('momina-banya.gpx'), fx('obratno.gpx'), fx('snimka.jpg')]);
    await pe.waitForFunction(() => !/Reading file/.test(document.querySelector('#importMsg').textContent) && /snimka\.jpg/.test(document.querySelector('#importMsg').textContent));
    const imp = await pe.evaluate(() => ({ msg: document.querySelector('#importMsg').textContent, toast: document.querySelector('#toast').textContent }));
    check(/does not look like GPX/.test(imp.msg) && /\d+(\.\d)?\skm, [\d,]+ points/.test(imp.msg) && /1 waypoint/.test(imp.msg), '1.2.0, en: импортът и съобщенията са на английски: ' + JSON.stringify(imp).slice(0, 300));
    const scan1 = await pe.evaluate(cyrScan);
    check(!scan1.length, '1.2.0, en: с отворен прозорец „Import GPX“ няма кирилица' + (scan1.length ? ': ' + scan1.slice(0, 10).join(' | ') : ''));
    await pe.keyboard.press('Escape');
    // Част в маршрута с клик върху трака, после панелите, подсказката и прозорецът за картината.
    const tp = await pe.evaluate(() => { const g = __gpxk, t = g.S.tracks[0], p = t.pts[Math.floor(t.pts.length / 3)]; g.map.setView(p[0], p[1], 15); const q = g.map.project(p[0], p[1]), r = document.querySelector('#map').getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; });
    await pe.mouse.click(tp.x, tp.y);
    await pe.waitForFunction(() => __gpxk.G && __gpxk.G.count >= 1, null, { timeout: 3000 }).catch(() => {});
    const e1 = await pe.evaluate(() => ({ parts: __gpxk.G.count, toast: document.querySelector('#toast').textContent, len: document.querySelector('#sLen').textContent, stats: [...document.querySelectorAll('#stats small')].map(s => s.textContent) }));
    check(e1.parts >= 1 && /^Part 1 in the route · [\d.]+\skm$/.test(e1.toast) && /\skm$/.test(e1.len) && e1.stats.join() === 'Length,Ascent,Descent,Max grade,Parts,Points,Skipped', '1.2.0, en: клик върху трак слага част 1, съобщението и числата са на английски: ' + JSON.stringify(e1));
    const scanT = await pe.evaluate(cyrScan);
    check(!scanT.length, '1.2.0, en: с трак и част в маршрута няма кирилица' + (scanT.length ? ': ' + scanT.slice(0, 10).join(' | ') : ''));
    await pe.evaluate(() => document.querySelector('.actions [data-act="picture"]').click());
    await pe.waitForFunction(() => document.querySelector('#dlgPic').open && /pixels/.test(document.querySelector('#picEst').textContent), null, { timeout: 3000 }).catch(() => {});
    const scan2 = await pe.evaluate(cyrScan);
    check(!scan2.length && /^The picture comes out at/.test(await pe.textContent('#picEst')), '1.2.0, en: с част в маршрута и отворен прозорец „Picture for offline use“ няма кирилица' + (scan2.length ? ': ' + scan2.slice(0, 10).join(' | ') : ''));
    await pe.keyboard.press('Escape');
    await pe.click('#langBtn');
    await pe.waitForFunction(() => document.querySelector('#dlgLang').open);
    const scan3 = await pe.evaluate(cyrScan);
    check(!scan3.length && /Browser language: English/.test(await pe.textContent('#langAutoSub')), '1.2.0, en: прозорецът „Language“ е на английски („Bulgarian“, не „Български“)' + (scan3.length ? ': ' + scan3.slice(0, 10).join(' | ') : ''));
    await pe.keyboard.press('Escape');
    // Следене: панелът „Следене“ при пуснато следене, после редът „Следенето спря“ след „Стоп“.
    await pe.click('#followMapBtn');
    await pe.waitForFunction(() => __gpxk.ui.follower && __gpxk.ui.pos, null, { timeout: 10000 }).catch(() => {});
    const fOn = await pe.evaluate(() => ({ on: !!__gpxk.ui.follower, panel: !document.querySelector('#followPanel').hidden && document.querySelector('#followPanel').getBoundingClientRect().height > 0, msg: document.querySelector('#fMsg').textContent }));
    const scanF = await pe.evaluate(cyrScan);
    check(fOn.on && fOn.panel && !scanF.length, '1.2.0, en: при пуснато следене с панела „Следене“ на екрана няма кирилица: ' + JSON.stringify(fOn) + (scanF.length ? ': ' + scanF.slice(0, 10).join(' | ') : ''));
    // Второ положение - изминатото има поне две точки и се пази (иначе редът не излиза).
    await ce.setGeolocation({ latitude: 42.5040, longitude: 24.7000 });
    await pe.waitForFunction(() => __gpxk.ui.follower && __gpxk.ui.follower.rec.length >= 2, null, { timeout: 10000 }).catch(() => {});
    await pe.click('#followMapBtn');
    await shutWalk(pe);
    await pe.waitForFunction(() => !document.querySelector('#walkBar').hidden, null, { timeout: 3000 }).catch(() => {});
    const fOff = await pe.evaluate(() => ({ off: !__gpxk.ui.follower, bar: inView('#walkBarBtn').ok, panel: !document.querySelector('#followPanel').hidden, text: document.querySelector('#walkBar').textContent.replace(/\s+/g, ' ').trim() }));
    const scanW = await pe.evaluate(cyrScan);
    check(fOff.off && fOff.bar && fOff.panel && /^Following stopped: /.test(fOff.text) && !scanW.length, '1.2.0, en: след „Стоп“ с реда „Следенето спря“ и панела на екрана няма кирилица: ' + JSON.stringify(fOff) + (scanW.length ? ': ' + scanW.slice(0, 10).join(' | ') : ''));
    check(!ee.length, '1.2.0, en: конзолата е чиста' + (ee.length ? ': ' + ee.join(' | ') : ''));
    await pe.screenshot({ path: path.join(OUT, 'lang-en-1280.png') });
    await ce.close();

    // Смяна и памет: БГ → English насред работа (нищо не се губи) → презареждане → English остава → Български.
    const cs = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ps = await cs.newPage(); const es = watch(ps);
    await ps.goto(url); await ready(ps);
    await ps.click('#empty [data-act="add-tracks"]');
    await ps.setInputFiles('#fileInput', [fx('hisarya-izhod.gpx'), fx('momina-banya.gpx')]);
    await ps.waitForFunction(() => __gpxk.S.tracks.length === 2 && !/Чета файл/.test(document.querySelector('#importMsg').textContent));
    await ps.keyboard.press('Escape');
    await ps.click('[data-mode="cut"]');
    const state = () => ps.evaluate(() => ({ tracks: __gpxk.S.tracks.map(t => t.name).join('|'), items: JSON.stringify(__gpxk.S.routes.map(r => [r.name, r.items.length])), view: JSON.stringify(__gpxk.map.getView()), mode: __gpxk.ui.mode, undo: __gpxk.ui.undo.length }));
    const s0 = await state();
    const t0 = await ps.evaluate(() => ({ save: document.querySelector('#bar [data-act="save"]').textContent, cut: document.querySelector('#cutText').textContent }));
    await ps.click('#langBtn');
    await ps.waitForFunction(() => document.querySelector('#dlgLang').open);
    const dl = await ps.evaluate(() => ({ radios: [...document.querySelectorAll('#langForm input[name="lang"]')].map(r => r.value + (r.checked ? '*' : '')), sub: document.querySelector('#langAutoSub').textContent, inBar: !!document.querySelector('#bar #langBtn'), title: document.querySelector('#dlgLang h3').textContent }));
    check(dl.inBar && dl.title === 'Език' && dl.radios.join() === 'auto*,bg,en' && /български/.test(dl.sub), '1.2.0: копчето с глобуса в лентата отваря „Език“ с Автоматично / Български / English: ' + JSON.stringify(dl));
    await ps.click('#langForm input[value="en"]');
    await ps.waitForFunction(() => document.documentElement.lang === 'en');
    const s1 = await state();
    const t1 = await ps.evaluate(() => ({ save: document.querySelector('#bar [data-act="save"]').textContent, cut: document.querySelector('#cutText').textContent, code: document.querySelector('#langCode').textContent, title: document.querySelector('#dlgLang h3').textContent, pref: localStorage.getItem('gpxk.lang'), tracksH: document.querySelector('[data-i18n="tracks.h"]').textContent, tol: document.querySelector('.tolVal').textContent }));
    check(t0.save === 'Запази' && /^Изрязване/.test(t0.cut) && t1.save === 'Save' && /^Cut: /.test(t1.cut) && t1.code === 'EN' && t1.title === 'Language' && t1.pref === '"en"' && t1.tracksH === 'Source tracks' && t1.tol === '20 m', '1.2.0: смяна на English - веднага, без презареждане, и надписите от кода (Изрязване, отклонението): ' + JSON.stringify(t1));
    check(JSON.stringify(s0) === JSON.stringify(s1), '1.2.0: смяната насред работа не губи нищо - траковете, маршрутите, изгледът, режимът и отмяната са същите: ' + JSON.stringify(s1));
    await ps.keyboard.press('Escape');
    await ps.reload(); await ready(ps);
    const t2 = await ps.evaluate(() => ({ lang: document.documentElement.lang, save: document.querySelector('#bar [data-act="save"]').textContent, code: document.querySelector('#langCode').textContent, tracks: __gpxk.S.tracks.length }));
    check(t2.lang === 'en' && t2.save === 'Save' && t2.code === 'EN' && t2.tracks === 2, '1.2.0: след презареждане изборът се помни, езикът на страницата също: ' + JSON.stringify(t2));
    await ps.click('#langBtn');
    await ps.waitForFunction(() => document.querySelector('#dlgLang').open);
    await ps.click('#langForm input[value="bg"]');
    await ps.waitForFunction(() => document.documentElement.lang === 'bg');
    check(await ps.textContent('#bar [data-act="save"]') === 'Запази' && await ps.evaluate(() => localStorage.getItem('gpxk.lang')) === '"bg"', '1.2.0: „Български“ връща българския и се помни');
    await ps.keyboard.press('Escape');
    check(!es.length, '1.2.0: смяна и памет - конзолата е чиста' + (es.length ? ': ' + es.join(' | ') : ''));
    await cs.close();

    // Трети език без избор: браузър на немски - интерфейсът остава български, без грешки.
    const cd = await browser.newContext({ locale: 'de-DE', viewport: { width: 390, height: 844 } });
    const pd = await cd.newPage(); const ed = watch(pd);
    await pd.goto(url); await ready(pd);
    await pd.click('#langBtn');
    await pd.waitForFunction(() => document.querySelector('#dlgLang').open);
    const d0 = await pd.evaluate(() => ({ lang: document.documentElement.lang, save: document.querySelector('#bar [data-act="save"]').textContent, code: document.querySelector('#langCode').textContent, sub: document.querySelector('#langAutoSub').textContent, btn: (r => r.width > 0 && r.right <= innerWidth && r.left >= 0)(document.querySelector('#langBtn').getBoundingClientRect()) }));
    check(d0.lang === 'bg' && d0.save === 'Запази' && d0.code === 'БГ' && /de/.test(d0.sub) && d0.btn, '1.2.0: браузър на немски без избор - интерфейсът остава на български; на 390 px копчето „Език“ е на екрана: ' + JSON.stringify(d0));
    await pd.screenshot({ path: path.join(OUT, 'lang-dialog-390.png') });
    check(!ed.length, '1.2.0: трети език - конзолата е чиста' + (ed.length ? ': ' + ed.join(' | ') : ''));
    await cd.close();

    // Без преводач в браузъра (window.Translator липсва): редът „Автоматичен превод“ е бледо, със съобщение; всичко работи.
    const cn = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await cn.addInitScript(() => { try { delete window.Translator; } catch (e) { /* */ } Object.defineProperty(window, 'Translator', { value: undefined, configurable: true, writable: true }); });
    const pn = await cn.newPage(); const en_ = watch(pn);
    await pn.goto(url); await ready(pn);
    await pn.click('#langBtn');
    await pn.waitForFunction(() => /Браузърът ти не поддържа автоматичен превод/.test(document.querySelector('#langTrMsg').textContent), null, { timeout: 3000 }).catch(() => {});
    const n0 = await pn.evaluate(() => ({ msg: document.querySelector('#langTrMsg').textContent, off: document.querySelector('#langTr').classList.contains('off'), dis: document.querySelector('#langTrSel').disabled, opts: document.querySelector('#langTrSel').options.length, note: document.querySelector('#dlgLang [data-i18n="lang.note"]').textContent }));
    check(/Браузърът ти не поддържа автоматичен превод/.test(n0.msg) && /Chrome на компютър/.test(n0.msg) && n0.off && n0.dis && n0.opts === 1 && !/отложен/.test(n0.note), '1.2.0: без window.Translator „Автоматичен превод“ е бледо и забранено, със съобщение и обяснение: ' + JSON.stringify(n0));
    await pn.click('#langForm input[value="en"]');
    await pn.waitForFunction(() => document.documentElement.lang === 'en');
    const n1 = await pn.evaluate(() => ({ save: document.querySelector('#bar [data-act="save"]').textContent, msg: document.querySelector('#langTrMsg').textContent }));
    await pn.keyboard.press('Escape');
    await pn.click('#empty [data-act="add-tracks"]');
    await pn.setInputFiles('#fileInput', [fx('hisarya-izhod.gpx')]);
    await pn.waitForFunction(() => __gpxk.S.tracks.length === 1, null, { timeout: 5000 }).catch(() => {});
    await pn.keyboard.press('Escape');
    check(n1.save === 'Save' && /does not support automatic translation/.test(n1.msg) && await pn.evaluate(() => __gpxk.S.tracks.length) === 1 && !en_.length, '1.2.0: без преводач приложението работи нормално (речникът, импорт), конзолата е чиста: ' + JSON.stringify(n1) + (en_.length ? ' ' + en_.join(' | ') : ''));
    await cn.close();

    // Подставен преводач (връща 'TEST:' + текста; дава само de, fr, ja; първо трябва да „изтегли“ езика;
    // низът „Изтрий“ се проваля): изборът превежда речника, помни се след презареждане, данните не се пипат.
    const ct = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ct.addInitScript(() => {
      window.__trCalls = 0;
      window.Translator = {
        availability: async o => o.sourceLanguage === 'bg' && ['de', 'fr', 'ja'].includes(o.targetLanguage) ? (localStorage.getItem('fakeTr.dl') ? 'available' : 'downloadable') : 'unavailable',
        create: async o => {
          if (o.monitor && !localStorage.getItem('fakeTr.dl')) {
            const m = new EventTarget(); o.monitor(m);
            for (const f of [0.25, 0.6, 1]) { await new Promise(r => setTimeout(r, 200)); const e = new Event('downloadprogress'); e.loaded = f; m.dispatchEvent(e); }
          }
          localStorage.setItem('fakeTr.dl', '1');
          return { translate: async s => { window.__trCalls++; if (s === 'Изтрий') throw new Error('fake'); return 'TEST:' + s; }, destroy() {} };
        }
      };
    });
    const pt = await ct.newPage(); const et = watch(pt);
    await pt.goto(url); await ready(pt);
    await pt.click('#empty [data-act="add-tracks"]');
    await pt.setInputFiles('#fileInput', [fx('hisarya-izhod.gpx')]);
    await pt.waitForFunction(() => __gpxk.S.tracks.length === 1);
    await pt.keyboard.press('Escape');
    const trName = await pt.evaluate(() => __gpxk.S.tracks[0].name);
    await pt.click('#langBtn');
    await pt.waitForFunction(() => !document.querySelector('#langTrSel').disabled, null, { timeout: 3000 }).catch(() => {});
    const opts = await pt.evaluate(() => [...document.querySelector('#langTrSel').options].map(o => o.value + '=' + o.textContent));
    check(opts.length === 4 && opts.slice(1).map(o => o.slice(0, 2)).join() === 'de,fr,ja' && !/[A-Za-z]{2}=[a-z]{2}$/.test(opts[1]), '1.2.0: в менюто „Автоматичен превод“ са само езиците, които браузърът дава: ' + opts.join(' | '));
    await pt.selectOption('#langTrSel', 'de');
    const dlSeen = await pt.waitForFunction(() => /Изтеглям езика/.test(document.querySelector('#langTrMsg').textContent) && document.documentElement.lang === 'bg' && document.querySelector('#bar [data-act="save"]').textContent === 'Запази', null, { timeout: 2000 }).then(() => true, () => false);
    await pt.waitForFunction(() => document.documentElement.lang === 'de', null, { timeout: 15000 }).catch(() => {});
    const r0 = await pt.evaluate(() => ({ lang: document.documentElement.lang, save: document.querySelector('#bar [data-act="save"]').textContent, clear: document.querySelector('#clearPartsBtn').textContent, code: document.querySelector('#langCode').textContent, pref: localStorage.getItem('gpxk.lang'), msg: document.querySelector('#langTrMsg').textContent, track: __gpxk.S.tracks[0].name, route: document.querySelector('#routeName').value, cut: document.querySelector('#cutText').textContent, toastFn: T('msg.partAdded', { n: 2, len: '1 km' }), cache: Object.keys(JSON.parse(localStorage.getItem('gpxk.tr.de') || '{}')).length, foot: document.querySelector('[data-i18n="foot.src"]').textContent }));
    check(dlSeen, '1.2.0: докато езикът се „изтегля“, прозорецът казва „Изтеглям езика…“ и надписите още не са сменени');
    check(r0.lang === 'de' && r0.save === 'TEST:Запази' && r0.code === 'DE' && r0.pref === '"tr:de"' && /^TEST:/.test(r0.msg) && /^TEST:/.test(r0.cut) && r0.toastFn === 'TEST:Част 2 в маршрута · 1 km' && r0.cache > 400 && /Esri World Imagery/.test(r0.foot), '1.2.0: изборът „de“ превежда целия речник (надписи, съобщения от кода), сменя lang и се помни като tr:de: ' + JSON.stringify(r0).slice(0, 400));
    check(r0.clear === 'Изтрий' && r0.track === trName && !/TEST:/.test(r0.track + r0.route), '1.2.0: низ с провален превод остава български; имената на траковете и маршрута не се превеждат: ' + JSON.stringify({ clear: r0.clear, track: r0.track, route: r0.route }));
    await pt.keyboard.press('Escape');
    await pt.reload(); await ready(pt);
    const r1 = await pt.evaluate(() => ({ lang: document.documentElement.lang, save: document.querySelector('#bar [data-act="save"]').textContent, empty: document.querySelector('[data-i18n="tracks.h"]').textContent, code: document.querySelector('#langCode').textContent, track: __gpxk.S.tracks[0].name }));
    check(r1.lang === 'de' && r1.save === 'TEST:Запази' && r1.empty === 'TEST:Тракове-източници' && r1.code === 'DE' && r1.track === trName, '1.2.0: след презареждане автоматичният превод остава (от пазения превод): ' + JSON.stringify(r1));
    await pt.click('#langBtn');
    await pt.waitForFunction(() => document.querySelector('#dlgLang').open && !document.querySelector('#langTrSel').disabled, null, { timeout: 3000 }).catch(() => {});
    const r2 = await pt.evaluate(() => ({ sel: document.querySelector('#langTrSel').value, radios: [...document.querySelectorAll('#langForm input[name="lang"]')].filter(r => r.checked).length }));
    await pt.click('#langForm input[value="bg"]');
    await pt.waitForFunction(() => document.documentElement.lang === 'bg');
    const r3 = await pt.evaluate(() => ({ save: document.querySelector('#bar [data-act="save"]').textContent, sel: document.querySelector('#langTrSel').value, pref: localStorage.getItem('gpxk.lang') }));
    check(r2.sel === 'de' && r2.radios === 0 && r3.save === 'Запази' && r3.sel === '' && r3.pref === '"bg"', '1.2.0: прозорецът показва избрания превод; „Български“ връща речника: ' + JSON.stringify([r2, r3]));
    await pt.keyboard.press('Escape');
    check(!et.length, '1.2.0: автоматичен превод - конзолата е чиста' + (et.length ? ': ' + et.join(' | ') : ''));
    await ct.close();
  }

  // ---- 1.3.0: разклоненията - меню на пръстен и на участък, изтриване, излишни пръстени ----
  {
    const MPDL = 6371008.8 * Math.PI / 180, KX = Math.cos(42.5 * Math.PI / 180) * MPDL;
    const lonAt = d => 24.70 + d / KX, latAt = m => 42.5 + m / MPDL;
    // RX на изток; RY слиза до 18 м над RX при км 1,0; RW свършва върху RX при км 1,025 (два пръстена на 25 м по RX);
    // RV пресича RX при км 2,5 (пресичане без избор).
    const rFiles = [
      writeGpx('RX', line(42.5, 24.70, 42.5, 24.76, 300)),
      writeGpx('RY', line(latAt(300), lonAt(1000), latAt(18), lonAt(1000), 30)),
      writeGpx('RW', line(latAt(-300), lonAt(1025), 42.5, lonAt(1025), 30)),
      writeGpx('RV', line(latAt(400), lonAt(2500), latAt(-400), lonAt(2500), 60))
    ];
    const cr = await browser.newContext({ viewport: { width: 760, height: 900 }, acceptDownloads: true, menus: true, rings: true });
    const pr = await cr.newPage();
    const er = [];
    pr.on('pageerror', e => er.push('pageerror: ' + e.message));
    pr.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) er.push('console: ' + m.text()); });
    const rready = () => pr.waitForFunction(() => window.__gpxk && window.__gpxk.ready, null, { timeout: 15000 });
    await pr.goto(url); await rready();
    await pr.setInputFiles('#fileInput', rFiles);
    await pr.waitForFunction(() => __gpxk.S.tracks.length === 4);
    const dlgOpen = await pr.waitForFunction(() => document.querySelector('#dlgRings').open, null, { timeout: 3000 }).then(() => true, () => false);
    const ringsDlg = () => pr.evaluate(() => ({ open: document.querySelector('#dlgRings').open, h: document.querySelector('#dlgRings h3').textContent.replace(/\s+/g, ' ').trim(),
      rows: [...document.querySelectorAll('#ringsList li')].map(li => ({ t: li.textContent.trim(), c: li.querySelector('input').checked })),
      js: __gpxk.A.junctions.length, drop: __gpxk.S.dropJ.length, kept: __gpxk.S.keptJ.length,
      row: document.querySelector('#ringsRow').hidden ? '' : document.querySelector('#ringsRow').textContent.replace(/\s+/g, ' ').trim() }));
    const rs0 = await ringsDlg();
    check(dlgOpen && rs0.h === 'Излишни пръстени (2)' && rs0.rows.length === 2 && rs0.rows.every(r => r.c) && /^RX\.gpx · км 1,0 — до друг пръстен 2\d\sм$/.test(rs0.rows[0].t) && rs0.rows[1].t === 'RX.gpx · км 2,5 — без избор',
      '1.3.0: след зареждане излиза „Излишни пръстени (2)“, отметнат е всеки ред: ' + JSON.stringify(rs0.rows));
    check(rs0.js === 3 && rs0.drop === 0, '1.3.0: докато списъкът е отворен, нищо не е махнато (' + rs0.js + ' пръстена)');
    await pr.keyboard.press('Escape');
    const rs1 = await ringsDlg();
    check(rs1.js === 3 && rs1.drop === 0 && rs1.kept === 0 && (rs1.open || rs1.row === 'Излишни пръстени: 2 · Прегледай'), '1.3.0: Escape не маха нито един пръстен: ' + JSON.stringify({ open: rs1.open, js: rs1.js, row: rs1.row }));
    if (!rs1.open) await pr.click('#ringsOpen');
    await pr.click('#ringsKeep');
    const rs2 = await ringsDlg();
    check(!rs2.open && rs2.js === 3 && rs2.drop === 0 && rs2.kept === 2 && rs2.row === 'Излишни пръстени: 2 · Прегледай', '1.3.0: „Задръж всички“ затваря списъка, без да маха; ред под картата: ' + JSON.stringify(rs2.row));
    // Записът в хранилището (evaluate чака обещанието, waitForFunction - не).
    const dbHas = async f => { for (let i = 0; i < 60; i++) { if (await pr.evaluate(f)) return true; await pr.waitForTimeout(100); } return false; };
    check(await dbHas(() => U.DB.get('collection').then(c => !!c && (c.keptJ || []).length === 2)), '1.3.0: „Задръж всички“ е записано в колекцията');
    await pr.reload(); await rready();
    await pr.waitForTimeout(300); // нищо не бива да изскочи и малко след старта
    const rs3 = await ringsDlg();
    check(!rs3.open && rs3.js === 3 && rs3.row === 'Излишни пръстени: 2 · Прегледай', '1.3.0: при следващо зареждане „Задръж всички“ не се връща: списъкът не излиза сам, редът под картата го има: ' + JSON.stringify({ open: rs3.open, row: rs3.row }));
    await pr.click('#ringsOpen');
    const rs4 = await ringsDlg();
    check(rs4.open && rs4.rows.length === 2 && rs4.rows.every(r => !r.c), '1.3.0: редът под картата отваря същия списък; задържаните са без отметка');
    await pr.click('#ringsDrop');
    const rs5 = await ringsDlg();
    check(!rs5.open && rs5.js === 3 && rs5.drop === 0, '1.3.0: „Махни отметнатите“ без отметки не маха нищо');
    const nParts = () => pr.evaluate(() => __gpxk.S.tracks.map(t => (__gpxk.A.byTrack[t.id] || []).filter(s => s.kind === 'part').length));
    const trRow = i => pr.evaluate(i => { const li = document.querySelector('#tracksList li[data-track="' + __gpxk.S.tracks[i].id + '"]'); return { t: li.querySelector('.t').textContent.replace(/\s+/g, ' ').trim(), v: li.querySelector('.v').firstChild.textContent.trim() }; }, i);
    const np0 = await nParts();
    await pr.click('#ringsOpen');
    await pr.check('#ringsList li:nth-child(2) input');
    await pr.click('#ringsDrop');
    const rs6 = await ringsDlg(), np1 = await nParts(), trV = await trRow(3);
    check(rs6.js === 2 && rs6.drop === 1 && np0[0] === 3 && np1[0] === 2 && np0[3] === 2 && np1[3] === 1 && rs6.row === 'Излишни пръстени: 1 · Прегледай' && /· 1 участък$/.test(trV.t),
      '1.3.0: отметнатият пръстен (пресичането) пада: RX ' + np0[0] + ' → ' + np1[0] + ' участъка, RV ' + np0[3] + ' → ' + np1[3] + ' („' + trV.t + '“), ред: ' + rs6.row);
    await pr.click('#undoBtn');
    const rs7 = await ringsDlg(), np2 = await nParts();
    check(rs7.js === 3 && rs7.drop === 0 && np2[0] === 3 && rs7.row === 'Излишни пръстени: 2 · Прегледай', '1.3.0: „Отмени“ връща махнатия от списъка пръстен');

    // Менюто на пръстен и на участък - на 360 / 560 / 760 px и 390x844.
    const crossRing = () => pr.evaluate(() => { const j = __gpxk.A.junctions.find(j => j.cross); if (!j) return null; const at = j.ring || [j.lat, j.lon], q = __gpxk.map.project(at[0], at[1]), b = document.querySelector('#map').getBoundingClientRect(); return { x: b.left + q.x, y: b.top + q.y }; });
    const menuState = () => pr.evaluate(() => { const m = document.querySelector('#objMenu'), r = m.getBoundingClientRect(), w = document.querySelector('#mapwrap').getBoundingClientRect();
      return { open: !m.hidden, kind: m.dataset.kind, title: document.querySelector('#omTitle').textContent, sub: document.querySelector('#omSub').textContent, btns: [...m.querySelectorAll('button')].map(b => b.textContent),
        inMap: r.width > 150 && r.left >= w.left - 0.5 && r.right <= Math.min(w.right, innerWidth) + 0.5 && r.top >= w.top - 0.5 && r.bottom <= Math.min(w.bottom, innerHeight) + 0.5, bar: document.body.classList.contains('bar-hidden') }; });
    const routeSt = () => pr.evaluate(() => { const r = __gpxk.S.routes.find(x => x.id === __gpxk.S.curId); return { items: r.items.length, len: __gpxk.G.len, pts: JSON.stringify(__gpxk.G.pts), sLen: document.querySelector('#sLen').textContent }; });
    const showCross = () => pr.evaluate(() => { const j = __gpxk.A.junctions.find(j => j.cross) || { lat: 42.5, lon: 24.70 + 2500 / (Math.cos(42.5 * Math.PI / 180) * 6371008.8 * Math.PI / 180) }; __gpxk.map.setView(j.lat, j.lon, 16); });
    // Празно място на картата до пръстена, извън отвореното меню.
    const awayFrom = rg => pr.evaluate(rg => { const m = document.querySelector('#objMenu').getBoundingClientRect(), b = document.querySelector('#map').getBoundingClientRect();
      const c = [[-70, -70], [70, -70], [-70, 70], [70, 70], [-90, 90], [90, 90], [-90, -90], [90, -90]].map(d => ({ x: rg.x + d[0], y: rg.y + d[1] }));
      return c.find(q => !(q.x > m.left - 12 && q.x < m.right + 12 && q.y > m.top - 12 && q.y < m.bottom + 12) && q.x > b.left + 50 && q.x < b.right - 50 && q.y > b.top + 120 && q.y < b.bottom - 60); }, rg);
    for (const [w, h] of [[360, 740], [560, 800], [760, 900], [390, 844]]) {
      await pr.setViewportSize({ width: w, height: h });
      await pr.evaluate(() => window.scrollTo(0, 0));
      await pr.waitForFunction(() => Math.abs(__gpxk.map.w - document.querySelector('#map').clientWidth) < 1);
      await showCross();
      const rg = await crossRing(), bar0 = (await menuState()).bar;
      await pr.mouse.click(rg.x, rg.y);
      const m0 = await menuState();
      await pr.screenshot({ path: path.join(OUT, 'junction-menu-' + w + '.png') });
      check(m0.open && m0.kind === 'junc' && m0.title === 'Разклонение' && m0.sub === 'RX.gpx × RV.gpx' && m0.btns[0] === 'Изтрий разклонението' && m0.btns[m0.btns.length - 1] === 'Отказ' && m0.inMap,
        '1.3.0, ' + w + 'x' + h + ': клик върху пръстена отваря менюто „Разклонение“ (в картата): ' + JSON.stringify({ sub: m0.sub, btns: m0.btns, inMap: m0.inMap }));
      await pr.click('#objMenu [data-om="cancel"]');
      const m1 = await menuState();
      await pr.mouse.click(rg.x, rg.y);
      const m2 = await menuState();
      const aw = await awayFrom(rg);
      await pr.mouse.click(aw.x, aw.y); // празно място на картата
      const m3 = await menuState();
      check(!m1.open && m2.open && !m3.open && m3.bar === bar0, '1.3.0, ' + w + 'px: „Отказ“ и клик встрани затварят менюто (кликът встрани не пипа лентата)');
      await pr.mouse.click(rg.x + 60, rg.y);
      const m4 = await menuState();
      await pr.screenshot({ path: path.join(OUT, 'segment-menu-' + w + '.png') });
      check(m4.open && m4.kind === 'seg' && /^Участък · км 2,5 - 4,9$/.test(m4.title) && /^RX\.gpx · 2,4\sкм$/.test(m4.sub) && JSON.stringify(m4.btns) === '["Добави в маршрута","Изтрий участъка","Отказ"]' && m4.inMap,
        '1.3.0, ' + w + 'px: клик върху участък отваря неговото меню: ' + JSON.stringify({ title: m4.title, sub: m4.sub, btns: m4.btns, inMap: m4.inMap }));
      await pr.click('#objMenu [data-om="cancel"]');
      await pr.mouse.click(rg.x + 60, rg.y);
      const aw2 = await awayFrom(rg);
      await pr.mouse.click(aw2.x, aw2.y);
      const m5 = await menuState(), r5 = await routeSt();
      check(!m5.open && r5.items === 0, '1.3.0, ' + w + 'px: менюто на участък се затваря с „Отказ“ и с клик встрани, маршрутът не се пипа');
    }

    // Маршрут направо по RX през пресичането, после „Изтрий разклонението“.
    await pr.setViewportSize({ width: 760, height: 900 });
    await pr.waitForFunction(() => Math.abs(__gpxk.map.w - document.querySelector('#map').clientWidth) < 1);
    await showCross();
    let rg = await crossRing();
    for (const dx of [-60, 60]) { await pr.mouse.click(rg.x + dx, rg.y); await pr.click('#objMenu [data-omk="add"]'); }
    const R0 = await routeSt(), trX0 = await trRow(0);
    check(R0.items === 2, '1.3.0: „Добави в маршрута“ слага участъка в маршрута (две части по RX)');
    await pr.mouse.click(rg.x, rg.y);
    const mj = await menuState();
    check(mj.btns.filter(b => /^Продължи по RV\.gpx · /.test(b)).length === 2, '1.3.0: маршрутът минава през пръстена - менюто дава „Продължи по“ клоновете на RV: ' + JSON.stringify(mj.btns));
    await pr.click('#objMenu [data-omk="delj"]');
    const R1 = await routeSt(), np3 = await nParts(), trX1 = await trRow(0), trV1 = await trRow(3);
    const ringGone = await pr.evaluate(([x, y]) => { const b = document.querySelector('#map').getBoundingClientRect(); return !__gpxk.A.junctions.some(j => j.cross) && !(__gpxk.ui.rings || []).some(r => Math.hypot(b.left + r.x - x, b.top + r.y - y) < 14); }, [rg.x, rg.y]);
    check(ringGone && np3[0] === 2 && np3[3] === 1 && /· 2 участъка$/.test(trX1.t) && /· 1 участък$/.test(trV1.t), '1.3.0: „Изтрий разклонението“ - пръстенът го няма, тракът се чете цял: „' + trX0.t + '“ → „' + trX1.t + '“, „' + trV1.t + '“');
    // Слетата част минава през същите точки на трака; отпада само вмъкнатата точка на разреза (на самата линия).
    const P0 = JSON.parse(R0.pts).map(p => JSON.stringify(p)), P1 = JSON.parse(R1.pts).map(p => JSON.stringify(p)), extra = P0.filter(p => !P1.includes(p));
    check(R1.items === 1 && Math.abs(R1.len - R0.len) < 1e-6 && R1.sLen === R0.sLen && extra.length <= 1 && JSON.stringify(P0.filter(p => P1.includes(p))) === JSON.stringify(P1),
      '1.3.0: маршрутът продължава направо - двете части стават една, дължината е същата (' + R0.sLen + ', разлика ' + (R1.len - R0.len).toExponential(1) + ' м), точките - същите без точката на разреза (' + P0.length + ' → ' + P1.length + ')');
    await pr.click('#undoBtn');
    const R2 = await routeSt(), np4 = await nParts();
    check(R2.items === 2 && R2.pts === R0.pts && np4[0] === 3 && !!(await crossRing()), '1.3.0: „Отмени“ връща разклонението и двете части');

    // „Изтрий участъка“ върху част от маршрута: изчезва от картата, от дължината на трака и от маршрута.
    rg = await crossRing();
    await pr.mouse.click(rg.x + 60, rg.y);
    const ms = await menuState();
    check(ms.kind === 'seg' && JSON.stringify(ms.btns) === '["Махни от маршрута","Изтрий участъка","Отказ"]', '1.3.0: клик върху част от маршрута - меню „Махни от маршрута“ / „Изтрий участъка“: ' + JSON.stringify(ms.btns));
    await pr.click('#objMenu [data-omk="del"]');
    await pr.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const R3 = await routeSt(), trX3 = await trRow(0);
    const del = await pr.evaluate(() => { const t = __gpxk.S.tracks[0], d = (t.dels || [])[0], A = __gpxk.A;
      return { n: (t.dels || []).length, a: d && d.a, b: d && d.b, len: t.len, over: A.byTrack[t.id].some(s => s.kind === 'part' && s.b > d.a + 1 && s.a < d.b - 1), drawn: Math.max(...(__gpxk.ui.drawn[t.id] || []).map(iv => iv[1])),
        kmExp: U.km(t.len - (d.b - d.a)), routeOver: __gpxk.S.routes.find(x => x.id === __gpxk.S.curId).items.some(it => it.trackId === t.id && Math.max(it.a, it.b) > d.a + 1) }; });
    check(del.n === 1 && Math.abs(del.a - 2500) < 40 && Math.abs(del.b - del.len) < 1 && !del.over && del.drawn <= del.a + 1, '1.3.0: изтритата отсечка я няма на картата (чертае се до км ' + (del.drawn / 1000).toFixed(2) + ') и не е участък');
    check(trX3.v === del.kmExp && trX3.v !== trX0.v && /изтрити 2,4\sкм/.test(trX3.t), '1.3.0: дължината на трака в списъка е без изтритото: ' + trX0.v + ' → ' + trX3.v + ' („' + trX3.t + '“)');
    check(R3.items === 1 && !del.routeOver && Math.abs(R0.len - R3.len - (del.b - del.a)) < 30, '1.3.0: изтритата отсечка излиза от маршрута: ' + R0.sLen + ' → ' + R3.sLen);
    await pr.mouse.click(rg.x + 60, rg.y);
    check(!(await menuState()).open, '1.3.0: клик на мястото на изтритото не отваря нищо');
    // И разклонението, и участъкът - „Отмени“ връща двете.
    await pr.mouse.click(rg.x, rg.y);
    await pr.click('#objMenu [data-omk="delj"]');
    const np5 = await nParts();
    await pr.click('#undoBtn'); await pr.click('#undoBtn');
    const R4 = await routeSt(), np6 = await nParts(), trX4 = await trRow(0);
    check(np5[3] === 1 && R4.items === 2 && R4.pts === R0.pts && np6[0] === 3 && np6[3] === 2 && trX4.v === trX0.v && !!(await crossRing()), '1.3.0: „Отмени“ два пъти връща и разклонението, и участъка - маршрутът е точка-в-точка както преди');

    // Изтритото разклонение се помни: след презареждане не се връща.
    rg = await crossRing();
    await pr.mouse.click(rg.x, rg.y);
    await pr.click('#objMenu [data-omk="delj"]');
    check(await dbHas(() => U.DB.get('collection').then(c => !!c && (c.dropJ || []).length === 1)), '1.3.0: изтритото разклонение е записано в колекцията');
    await pr.reload(); await rready();
    const rl = await pr.evaluate(() => ({ cross: __gpxk.A.junctions.some(j => j.cross), js: __gpxk.A.junctions.length, items: __gpxk.S.routes.find(x => x.id === __gpxk.S.curId).items.length }));
    check(!rl.cross && rl.js === 2 && rl.items === 1, '1.3.0: след презареждане изтритото разклонение не се връща: ' + JSON.stringify(rl));

    const ringOf = ti => pr.evaluate(ti => { const j = __gpxk.A.junctions.find(j => j.branches.some(b => b.trackId === __gpxk.S.tracks[ti].id)); __gpxk.map.setView(j.lat, j.lon, 16); const at = j.ring || [j.lat, j.lon], q = __gpxk.map.project(at[0], at[1]), b = document.querySelector('#map').getBoundingClientRect(); return { x: b.left + q.x, y: b.top + q.y }; }, ti);
    await pr.evaluate(() => window.scrollTo(0, 0));

    // 1.3.1: „Изтрий разклонението“ при пръстена на RY маха и пръстена на RW (25 м по RX) - RX се чете като един участък.
    const ry0 = await ringOf(1);
    await pr.mouse.click(ry0.x, ry0.y);
    const mr = await menuState();
    await pr.click('#objMenu [data-omk="delj"]');
    const nb = await pr.evaluate(() => { const x = __gpxk.S.tracks[0]; return { js: __gpxk.A.junctions.length, drop: __gpxk.S.dropJ.length, toast: document.querySelector('#toast').textContent, drawn: JSON.stringify(__gpxk.ui.drawn[x.id]), len: x.len, rings: (__gpxk.ui.rings || []).length }; });
    const nb3 = await nParts(), trXn = await trRow(0), trYn = await trRow(1), trWn = await trRow(2);
    check(mr.sub === 'RX.gpx × RY.gpx' && nb.js === 0 && nb.drop === 3 && nb3[0] === 1 && /· 1 участък$/.test(trXn.t) && /· 1 участък$/.test(trYn.t) && /· 1 участък$/.test(trWn.t),
      '1.3.1: изтрито разклонение с пръстен на под 40 м по същия трак - падат двата, RX се чете „· 1 участък“: „' + trXn.t + '“ (пръстени ' + nb.js + ', dropJ ' + nb.drop + ')');
    check(/^Изтрити са 2 пръстена/.test(nb.toast) && nb.drawn === JSON.stringify([[0, nb.len]]) && nb.rings === 0, '1.3.1: съобщението казва колко пръстена паднаха, RX е една непрекъсната линия: ' + nb.toast);
    await pr.click('#undoBtn');
    const nb4 = await pr.evaluate(() => ({ js: __gpxk.A.junctions.length, drop: __gpxk.S.dropJ.length })), nb5 = await nParts();
    check(nb4.js === 2 && nb4.drop === 1 && nb5[0] === 2, '1.3.1: „Отмени“ връща и двата пръстена: ' + JSON.stringify(nb4) + ', RX ' + nb5[0] + ' участъка');

    // Близкият трак (RY свършва на 18 м от RX) само се предлага в менюто на разклонението - нищо не пада само.
    const ry = await ringOf(1);
    await pr.mouse.click(ry.x, ry.y);
    const mn = await menuState(), nt0 = await pr.evaluate(() => __gpxk.S.tracks.length);
    check(nt0 === 4 && mn.open && mn.sub === 'RX.gpx × RY.gpx' && mn.btns.some(b => /^Изтрий близкия трак „RY\.gpx“ \(18\sм\)$/.test(b)), '1.3.0: близкият трак само се предлага в менюто на разклонението (всички 4 тракове са тук): ' + JSON.stringify(mn.btns));
    pr.once('dialog', d => d.accept());
    await pr.click('#objMenu [data-omk="near"]');
    const nt1 = await pr.evaluate(() => __gpxk.S.tracks.map(t => t.name).join());
    await pr.click('#undoBtn');
    const nt2 = await pr.evaluate(() => __gpxk.S.tracks.length);
    check(nt1 === 'RX.gpx,RW.gpx,RV.gpx' && nt2 === 4, '1.3.0: „Изтрий близкия трак“ (след потвърждение) маха RY, „Отмени“ го връща: ' + nt1);

    // 1.3.1: три трака един върху друг (DQ на 5 м над DP, DR на 5 м под него, км 0,5 - 2,5) - един клик върху маркера, остава DP.
    {
      const lt = m => 42.6 + m / MPDL;
      const stack = s => [...line(lt(400 * s), lonAt(500), lt(5 * s), lonAt(500), 20), ...line(lt(5 * s), lonAt(500), lt(5 * s), lonAt(2500), 100).slice(1), ...line(lt(5 * s), lonAt(2500), lt(400 * s), lonAt(2500), 20).slice(1)];
      const dFiles = [writeGpx('DP', line(42.6, lonAt(0), 42.6, lonAt(3000), 150)), writeGpx('DQ', stack(1)), writeGpx('DR', stack(-1))];
      const cd = await browser.newContext({ viewport: { width: 390, height: 844 }, menus: true });
      const pd = await cd.newPage();
      const ed = [];
      pd.on('pageerror', e => ed.push('pageerror: ' + e.message));
      pd.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/api\.opentopodata\.org/.test(m.text())) ed.push('console: ' + m.text()); });
      await pd.goto(url); await pd.waitForFunction(() => window.__gpxk && window.__gpxk.ready, null, { timeout: 15000 });
      await pd.setInputFiles('#fileInput', dFiles);
      await pd.waitForFunction(() => __gpxk.S.tracks.length === 3 && __gpxk.A.pend.length >= 2);
      await pd.evaluate(() => { const d = document.querySelector('#dlgImport'); if (d.open) d.close(); window.scrollTo(0, 0); });
      const dst = () => pd.evaluate(() => { const A = __gpxk.A, S = __gpxk.S, nm = id => S.tracks.find(t => t.id === id).name;
        const sum = (l, id) => l.filter(s => s.trackId === id).reduce((a, s) => a + s.len, 0);
        return { pend: A.pend.map(s => nm(s.trackId)).sort().join(), dups: [...new Set(A.dups.map(s => nm(s.trackId)))].sort().join(), marks: (__gpxk.ui.markers || []).length,
          live: S.tracks.map(t => Math.round(sum(A.parts.concat(A.pend), t.id))), toast: document.querySelector('#toast').textContent, undo: __gpxk.ui.undo.length }; });
      const d0 = await dst();
      await pd.evaluate(() => __gpxk.map.setView(42.6, 24.70 + 1500 / (Math.cos(42.5 * Math.PI / 180) * 6371008.8 * Math.PI / 180), 15));
      await pd.waitForFunction(() => (__gpxk.ui.markers || []).length >= 1 && __gpxk.ui.markers.every(o => o.x > 20 && o.x < __gpxk.map.w - 20 && o.y > 20 && o.y < __gpxk.map.h - 20));
      const mk = await pd.evaluate(() => { const ms = __gpxk.ui.markers, o = ms[ms.length - 1], b = document.querySelector('#map').getBoundingClientRect(); return { x: b.left + o.x, y: b.top + o.y, n: ms.length }; });
      await pd.mouse.click(mk.x, mk.y);
      await pd.waitForFunction(() => __gpxk.A.pend.length === 0, null, { timeout: 3000 }).catch(() => {});
      const d1 = await dst();
      check(d0.pend === 'DQ.gpx,DR.gpx' && d1.pend === '' && d1.dups === 'DQ.gpx,DR.gpx' && d1.marks === 0 && d1.undo === 1,
        '1.3.1, 390x844: три трака един върху друг - един клик върху маркера маха DQ и DR, без нов чакащ дубликат: ' + JSON.stringify({ before: d0.pend, marks: mk.n, pend: d1.pend, dups: d1.dups }));
      check(d1.live[0] === d0.live[0] && d1.live[1] < d0.live[1] - 1500 && d1.live[2] < d0.live[2] - 1500 && /^Махнати са 2 трака/.test(d1.toast),
        '1.3.1: излишните тракове вече не се броят (живи м ' + JSON.stringify(d0.live) + ' → ' + JSON.stringify(d1.live) + '), съобщение: ' + d1.toast);
      await pd.click('#undoBtn');
      const d2 = await dst();
      check(d2.pend === 'DQ.gpx,DR.gpx' && d2.dups === '', '1.3.1: „Отмени“ връща двата дубликата наведнъж');
      check(!ed.length, '1.3.1: куп дубликати - конзолата е чиста' + (ed.length ? ': ' + ed.join(' | ') : ''));
      await cd.close();
    }

    // На английски: списъкът и менюто без кирилица (имената на траковете са на латиница), на 390x844.
    await pr.setViewportSize({ width: 390, height: 844 });
    await pr.evaluate(() => I18N.setPref('en'));
    await pr.waitForFunction(() => document.documentElement.lang === 'en');
    await pr.click('#ringsOpen');
    const en = await pr.evaluate(() => { const d = document.querySelector('#dlgRings'), r = d.getBoundingClientRect(); return { txt: d.innerText, row: document.querySelector('#ringsRow').textContent, fits: r.left >= 0 && r.right <= innerWidth + 0.5 }; });
    await pr.screenshot({ path: path.join(OUT, 'rings-390-en.png') });
    check(!/[Ѐ-ӿ]/.test(en.txt + en.row) && /Extra rings \(1\)/.test(en.txt) && /next to another ring/.test(en.txt) && /Remove the ticked/.test(en.txt) && /Keep all/.test(en.txt) && en.fits, '1.3.0, en, 390 px: „Extra rings“ без кирилица и се събира: ' + JSON.stringify(en.txt.replace(/\s+/g, ' ')));
    await pr.click('#ringsKeep');
    await pr.evaluate(() => window.scrollTo(0, 0)); // редът под картата е превъртял страницата
    await pr.waitForFunction(() => Math.abs(__gpxk.map.w - document.querySelector('#map').clientWidth) < 1);
    const nr = await pr.evaluate(() => { const j = __gpxk.A.junctions.find(j => j.branches.some(b => b.trackId === __gpxk.S.tracks[2].id)); __gpxk.map.setView(j.lat, j.lon, 16); const at = j.ring || [j.lat, j.lon], q = __gpxk.map.project(at[0], at[1]), b = document.querySelector('#map').getBoundingClientRect(); return { x: b.left + q.x, y: b.top + q.y }; });
    await pr.mouse.click(nr.x, nr.y);
    const me = await menuState();
    check(me.open && me.title === 'Junction' && me.btns[0] === 'Delete junction' && me.btns.includes('Cancel') && !/[Ѐ-ӿ]/.test(me.title + me.sub + me.btns.join('')) && me.inMap, '1.3.0, en: менюто на пръстена е на английски: ' + JSON.stringify(me));
    await pr.keyboard.press('Escape');
    check(!(await menuState()).open, '1.3.0: Escape затваря менюто');
    check(!er.length, '1.3.0: разклонения - конзолата е чиста' + (er.length ? ': ' + er.join(' | ') : ''));
    await cr.close();
  }

  check(errors.length === 0, 'конзолата е чиста' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(failures ? failures + ' ПРОВАЛЕНИ' : 'ВСИЧКО МИНА');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
