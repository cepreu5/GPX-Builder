/* CX Tracks - езикът на интерфейса. Речник по ключове: всеки ключ е [български, английски].
   Българският е изходният (всеки ключ го има), английският е пълният втори. Липсващ превод
   показва българския низ, липсващ ключ - самия ключ.
   Изборът се пази в localStorage под gpxk.lang: 'auto' (езикът на браузъра: започва ли с "en" -
   английски, иначе български), 'bg', 'en' или 'tr:<код>' - автоматичен превод. Смяната е на място,
   без презареждане, и сменя и атрибута lang на страницата.
   Автоматичният превод е речникът, преведен веднъж: всички български низове минават през вградения
   в браузъра преводач (Translator API, на устройството, без ключ и външна услуга) и полученият речник
   се ползва навсякъде. Преводът се пази в gpxk.tr.<код> (български низ -> превод), за да не се
   превежда пак при всяко отваряне. Низ, чийто превод се провали или изгуби {заместител}, остава български.
   В index.html: data-i18n (текст), data-i18n-title, -aria, -placeholder, -alt, -content.
   В кода: T('ключ', {име: стойност}) и T.n('ключ', брой) за ключовете ключ.1 / ключ.n. */
(function () {
  'use strict';

  var W = {};
  var LANGS = ['bg', 'en'];
  // Езиците за автоматичен превод; в менюто остават само тези, които браузърът казва, че поддържа.
  var TR_LANGS = ['de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'uk', 'ro', 'el', 'tr', 'sr', 'cs', 'ja'];
  var pref = 'auto', lang = 'bg', subs = [];
  var TR = null; // { code, map: {български низ: превод} } при автоматичен превод
  var CYR = /[Ѐ-ӿ]/;

  function add(o) { for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) W[k] = o[k]; }
  function fill(s, p) {
    if (!p) return s;
    return s.replace(/\{(\w+)\}/g, function (m, n) { return p[n] != null ? p[n] : m; });
  }
  function t(k, p) {
    var e = W[k];
    if (!e) return fill(k, p);
    if (TR) return fill(TR.map[e[0]] || e[0], p);
    var s = e[LANGS.indexOf(lang)];
    return fill(s == null || s === '' ? e[0] : s, p);
  }
  // Множествено число: ключ.1 за едно, ключ.n за всичко друго; {n} е броят.
  function tn(k, n, p) {
    var o = { n: n };
    if (p) for (var x in p) o[x] = p[x];
    return t(k + (n === 1 ? '.1' : '.n'), o);
  }
  t.n = tn;

  function browser() {
    var l = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    return String(l).toLowerCase();
  }
  function trCode(p) { var m = /^tr:([a-z]{2,3})$/.exec(p || ''); return m && TR_LANGS.indexOf(m[1]) >= 0 ? m[1] : null; }
  function resolve(p) { return trCode(p) || (p === 'bg' || p === 'en' ? p : /^en\b/.test(browser()) ? 'en' : 'bg'); }
  function valid(p) { return p === 'bg' || p === 'en' || !!trCode(p) ? p : 'auto'; }
  function ls(k, v) {
    try {
      if (arguments.length > 1) { localStorage.setItem(k, JSON.stringify(v)); return v; }
      return JSON.parse(localStorage.getItem(k));
    } catch (e) { return null; }
  }

  var ATTRS = [['i18nTitle', 'title'], ['i18nAria', 'aria-label'], ['i18nPlaceholder', 'placeholder'], ['i18nAlt', 'alt'], ['i18nContent', 'content']];
  function apply(root) {
    root = root || document;
    var all = root.querySelectorAll('[data-i18n],[data-i18n-title],[data-i18n-aria],[data-i18n-placeholder],[data-i18n-alt],[data-i18n-content]');
    Array.prototype.forEach.call(all, function (e) {
      var d = e.dataset;
      if (d.i18n) e.textContent = t(d.i18n);
      ATTRS.forEach(function (a) { if (d[a[0]]) e.setAttribute(a[1], t(d[a[0]])); });
    });
    if (root === document) document.documentElement.lang = lang;
  }
  function changed(was) {
    apply(document);
    subs.forEach(function (f) { try { f(lang, was); } catch (e) { console.error(e); } });
  }
  function setPref(p) {
    pref = valid(p);
    ls('gpxk.lang', pref);
    var was = lang;
    lang = resolve(pref);
    var code = trCode(pref);
    TR = code ? { code: code, map: ls('gpxk.tr.' + code) || {} } : null;
    changed(was);
  }

  /* ---- Автоматичен превод ---- */
  function bgStrings() {
    var seen = {}, out = [];
    Object.keys(W).forEach(function (k) { var s = W[k][0]; if (s && CYR.test(s) && !seen[s]) { seen[s] = true; out.push(s); } });
    return out;
  }
  function holders(s) { return (s.match(/\{\w+\}/g) || []).sort().join(','); }
  // Има ли преводач изобщо и кои езици дава: [{code, state}] със state 'available' / 'downloadable' / 'downloading'.
  function trLangs() {
    var Tr = window.Translator;
    if (!Tr || typeof Tr.availability !== 'function' || typeof Tr.create !== 'function') return Promise.resolve([]);
    return Promise.all(TR_LANGS.map(function (c) {
      return Promise.resolve().then(function () { return Tr.availability({ sourceLanguage: 'bg', targetLanguage: c }); })
        .then(function (a) { return { code: c, state: a }; }, function () { return { code: c, state: 'unavailable' }; });
    })).then(function (l) { return l.filter(function (x) { return x && x.state && x.state !== 'unavailable'; }); });
  }
  /* Превежда целия речник на езика code. progress({stage: 'download'|'translate', f: 0..1}).
     Пазеното от по-рано не се превежда пак. Цял провал (нито един низ) - грешка. */
  function translateAll(code, progress) {
    var Tr = window.Translator;
    progress = progress || function () {};
    if (!Tr) return Promise.reject(new Error('no-translator'));
    var cache = ls('gpxk.tr.' + code) || {};
    var todo = bgStrings().filter(function (s) { return !cache[s]; });
    return Promise.resolve(Tr.availability({ sourceLanguage: 'bg', targetLanguage: code })).then(function (a) {
      if (!a || a === 'unavailable') throw new Error('unavailable');
      if (!todo.length) return null;
      if (a !== 'available') progress({ stage: 'download', f: 0 });
      return Tr.create({
        sourceLanguage: 'bg', targetLanguage: code,
        monitor: function (m) { m.addEventListener('downloadprogress', function (e) { progress({ stage: 'download', f: e.loaded || 0 }); }); }
      });
    }).then(function (tr) {
      if (!tr) return cache;
      var done = 0, ok = 0, i = 0;
      progress({ stage: 'translate', f: 0 });
      function one(s) {
        var lead = /^\s*/.exec(s)[0], tail = /\s*$/.exec(s)[0];
        return Promise.resolve().then(function () { return tr.translate(s.trim()); }).then(function (r) {
          r = String(r == null ? '' : r).trim();
          if (r && holders(r) === holders(s)) { cache[s] = lead + r + tail; ok++; }
        }, function () { /* този низ остава български */ }).then(function () { progress({ stage: 'translate', f: ++done / todo.length }); });
      }
      function worker() { return i < todo.length ? one(todo[i++]).then(worker) : null; }
      var pool = [];
      for (var w = 0; w < 4; w++) pool.push(worker());
      return Promise.all(pool).then(function () {
        if (tr.destroy) try { tr.destroy(); } catch (e) { /* */ }
        if (!ok) throw new Error('translate-failed');
        ls('gpxk.tr.' + code, cache);
        return cache;
      });
    });
  }
  // Избор на автоматичен превод: първо превежда (и изтегля езика, ако трябва), после сменя низовете.
  function useTranslation(code, progress) {
    return translateAll(code, progress).then(function (map) {
      pref = 'tr:' + code;
      ls('gpxk.lang', pref);
      var was = lang;
      lang = code;
      TR = { code: code, map: map };
      changed(was);
    });
  }

  function start() {
    pref = valid(ls('gpxk.lang'));
    lang = resolve(pref);
    var code = trCode(pref);
    if (code) {
      TR = { code: code, map: ls('gpxk.tr.' + code) || {} };
      // Нови низове (по-нова версия) или изтрит превод: допревеждат се тихо, ако браузърът може.
      var miss = bgStrings().some(function (s) { return !TR.map[s]; });
      if (miss && window.Translator) {
        translateAll(code).then(function (map) { if (TR && TR.code === code) { TR.map = map; changed(lang); } }, function () { /* остава каквото има */ });
      }
    }
    apply(document);
  }

  window.I18N = {
    add: add, t: t, n: tn, apply: apply, setPref: setPref, start: start, browser: browser,
    trLangs: trLangs, useTranslation: useTranslation, TR_LANGS: TR_LANGS,
    onChange: function (f) { subs.push(f); },
    get lang() { return lang; },
    get pref() { return pref; },
    get tr() { return TR ? TR.code : null; },
    // Всички записи [bg, en] - за проверката на огледалото в тестовете.
    get all() { return W; }
  };
  window.T = t;
})();

/* ---- index.html ---- */
I18N.add({
  'meta.desc': ['CX Tracks: сглобяване на нов маршрут от записани GPX тракове: дубликати, части, изрязване, износ като .gpx и картина за офлайн.', 'CX Tracks: build a new route from recorded GPX tracks: duplicates, parts, cutting, export as .gpx and a picture for offline use.'],
  'splash.aria': ['CX Tracks - натисни, за да продължиш', 'CX Tracks - tap to continue'],
  'splash.sub': ['Маршрути и тракове', 'Routes and tracks'],
  'splash.hint': ['Натисни, за да продължиш · изчезва сам след 3 с', 'Tap to continue · goes away by itself after 3 s'],
  'bar.aria': ['Горна лента', 'Top bar'],
  'bar.routeName': ['Име на маршрута', 'Route name'],
  'bar.tol': ['Отклонение', 'Tolerance'],
  'tol.title': ['Отклонение в метри, от 0 до 999. Enter прилага.', 'Tolerance in metres, from 0 to 999. Enter applies it.'],
  'tol.aria': ['Максимално допустимо отклонение в метри', 'Maximum allowed deviation in metres'],
  'unit.m': ['м', 'm'],
  'bar.add.title': ['Добави .gpx тракове', 'Add .gpx tracks'],
  'bar.add': ['Добави', 'Add'],
  'bar.addWide': [' тракове', ' tracks'],
  'act.picture': ['Картина', 'Picture'],
  'act.exportGpx': ['Изнеси .gpx', 'Export .gpx'],
  'bar.save.title': ['Свали .gpx и запиши маршрута в „Записани маршрути“', 'Download the .gpx and save the route in “Saved routes”'],
  'act.save': ['Запази', 'Save'],
  'bar.labels.title': ['Имената и номерата на пътищата върху сателитните снимки', 'Place names and road numbers on the satellite imagery'],
  'bar.labels': ['Имена', 'Labels'],
  'lang.btn.title': ['Език на интерфейса', 'Interface language'],
  'lang.btn.aria': ['Език на интерфейса', 'Interface language'],
  'lang.code': ['БГ', 'EN'],
  'mode.aria': ['Режим', 'Mode'],
  'mode.select.title': ['Клик върху сегмент го слага в маршрута', 'Clicking a segment adds it to the route'],
  'mode.select': ['Избор', 'Select'],
  'mode.cut.title': ['Две точки по трака махат част от него. „Отмени“ я връща.', 'Two points along a track remove a piece of it. “Undo” brings it back.'],
  'mode.cut': ['Изрязване', 'Cut'],
  'mode.add.title': ['Клик на картата слага точка', 'Clicking the map places a point'],
  'mode.add': ['Добавяне', 'Add'],
  'mode.move.title': ['Влачи точка', 'Drag a point'],
  'mode.move': ['Местене', 'Move'],
  'mode.remove.title': ['Клик върху точка я маха', 'Clicking a point removes it'],
  'mode.remove': ['Махане', 'Remove'],
  'search.ph': ['Търси адрес или място', 'Search for an address or place'],
  'follow.view.aria': ['Изглед при следене', 'View while following'],
  'follow.view.map': ['Карта', 'Map'],
  'wpt.h': ['Точка', 'Point'],
  'follow.orient.aria': ['Ориентация на картата при следене', 'Map orientation while following'],
  'orient.heading.title': ['Посоката на движение сочи нагоре', 'Direction of travel points up'],
  'orient.heading': ['Посока', 'Heading'],
  'orient.north.title': ['Север сочи нагоре', 'North points up'],
  'orient.north': ['Север', 'North'],
  'awake.title': ['Екранът да не заспива, докато следиш', 'Keep the screen awake while you follow'],
  'awake.w': ['Екранът ', 'Screen '],
  'awake.t': ['буден', 'awake'],
  'walkgpx.title': ['Свали изминатото дотук като .gpx - следенето продължава', 'Download the walk so far as .gpx - following goes on'],
  'walkgpx.w': ['Изнеси ', 'Export '],
  'totop': ['Най-горе на страницата', 'Back to the top of the page'],
  'map.aria': ['Карта', 'Map'],
  'topanel': ['Към числата под картата', 'To the figures below the map'],
  'base.aria': ['Основа на картата', 'Map base'],
  'base.sat': ['Сателит', 'Satellite'],
  'base.topo': ['Топо', 'Topo'],
  'act.undo': ['Отмени', 'Undo'],
  'vtx.title': ['Точки - кръгчетата и номерата на чертаните точки', 'Points - the circles and numbers of the drawn points'],
  'vtx.aria': ['Точки', 'Points'],
  'compass.n': ['С', 'N'],
  'zoom.in': ['Приближи', 'Zoom in'],
  'zoom.out': ['Отдалечи', 'Zoom out'],
  'center': ['Центрирай върху положението ти от GPS', 'Centre on your GPS position'],
  'fit': ['Покажи целия маршрут', 'Show the whole route'],
  'walkbar.aria': ['Изминатото', 'The walk'],
  'walkbar.stopped': ['Следенето спря: ', 'Following stopped: '],
  'walkbar.dl': ['Свали изминалото като .gpx', 'Download the walk as .gpx'],
  'walk.dl': ['Свали изминатото като .gpx', 'Download the walk as .gpx'],
  'act.close': ['Затвори', 'Close'],
  'walkbar.close': ['Затвори реда за сваляне', 'Close the download row'],
  'cut.ok': ['Потвърди', 'Confirm'],
  'cut.back': ['Върни', 'Back'],
  'empty.t': ['Тук ще се появи маршрутът', 'Your route will appear here'],
  'empty.p': ['Няма заредени тракове. Зареди колекция от файл или добави отделни .gpx.', 'No tracks loaded. Load a collection from a file or add individual .gpx files.'],
  'act.loadColl': ['Зареди колекция', 'Load collection'],
  'act.addGpx': ['Добави .gpx', 'Add .gpx'],
  'pt.name': ['Име на точката', 'Point name'],
  'pt.ph': ['Име на точката (напр. чешма)', 'Point name (e.g. spring)'],
  'act.remove': ['Махни', 'Remove'],
  'act.done': ['Готово', 'Done'],
  'pic.alt': ['Запазена картина на маршрута', 'Saved picture of the route'],
  'pic.close': ['Към картата', 'Back to the map'],
  'pic.one': ['1:1 - точка за точка', '1:1 - pixel for pixel'],
  'pic.fit': ['Цялата картина', 'Whole picture'],
  'walk.forget.title': ['Махни панела и изминатото за сваляне', 'Remove the panel and the walk waiting for download'],
  'walk.forget.aria': ['Махни панела „Следене“', 'Remove the “Follow” panel'],
  'fs.done': ['Изминати', 'Covered'],
  'fs.time': ['Време', 'Time'],
  'fs.left': ['Остават', 'Left'],
  'fs.off': ['Встрани', 'Off route'],
  'walk.done.note': ['записът се отваря от "Записани маршрути" и се редактира като всеки друг', 'the record opens from “Saved routes” and is edited like any other'],
  'st.len': ['Дължина', 'Length'],
  'st.up': ['Изкачване', 'Ascent'],
  'st.down': ['Спускане', 'Descent'],
  'st.grade': ['Наклон до', 'Max grade'],
  'st.parts': ['Части', 'Parts'],
  'st.pts': ['Точки', 'Points'],
  'st.skip': ['Пропуснати', 'Skipped'],
  'prof.t': ['Профил', 'Profile'],
  'prof.pct': ['Наклон в проценти', 'Grade in percent'],
  'prof.aria': ['Профил на височината', 'Elevation profile'],
  'hint': ['Клик върху сегмент отваря меню: „Добави в маршрута“ го слага като следваща част, „Изтрий участъка“ го маха от картата, от трака и от маршрута. Пръстенът е точка на разклонение: клик върху него отваря менюто му - „Продължи по“ сменя посоката там, „Изтрий разклонението“ слива двете парчета на трака. Дублиращите се участъци са извън маршрута, а общата отсечка между две части се минава веднъж. Режимът „Изрязване“ маха с две точки по линията произволна част от трака - завинаги, както „Изтрий участъка“; „Отмени“ я връща. Посочването на ред в списъка светва същия сегмент на картата.', 'Clicking a segment opens a menu: “Add to route” adds it as the next part, “Delete stretch” removes it from the map, the track and the route. A ring is a junction: clicking it opens its menu - “Continue along” changes the direction there, “Delete junction” joins the two pieces of the track. Duplicate stretches stay out of the route, and a stretch shared by two parts is ridden once. The “Cut” mode removes any piece of a track between two points on its line - for good, like “Delete stretch”; “Undo” brings it back. Pointing at a row in the list highlights the same segment on the map.'],
  'parts.h': ['Части в маршрута', 'Parts in the route'],
  'parts.clear.title': ['Махни всички части; траковете остават. "Отмени" ги връща.', 'Remove all parts; the tracks stay. “Undo” brings them back.'],
  'parts.clear': ['Изтрий', 'Clear'],
  'parts.empty': ['Още няма части. Клик върху трак на картата → „Добави в маршрута“.', 'No parts yet. Click a track on the map → “Add to route”.'],
  'pts.h': ['Точки', 'Points'],
  'pts.note': ['Чертаните точки затварят дупки между частите. Точка с име излиза като спирка (waypoint) в .gpx файла. На телефон: задръж точка, за да я преместиш; докосни я и избери "Махни".', 'Drawn points close gaps between parts. A named point is exported as a waypoint in the .gpx file. On a phone: hold a point to move it; tap it and choose “Remove”.'],
  'tracks.h': ['Тракове-източници', 'Source tracks'],
  'act.addTracks': ['Добави тракове', 'Add tracks'],
  'act.exportColl': ['Изнеси колекцията', 'Export collection'],
  'tracks.clear.title': ['Махни всички тракове и маршрута от тях. "Отмени" връща всичко.', 'Remove all tracks and the route built from them. “Undo” brings everything back.'],
  'tracks.clear': ['Нов', 'New'],
  'dups.h': ['Дубликати', 'Duplicates'],
  'dups.pendNote': ['Нищо още не е махнато - числата ги броят, а на картата стоят и двете линии. Всеки маркер се решава сам.', 'Nothing has been removed yet - the figures count them, and both lines stay on the map. Each marker is decided on its own.'],
  'dups.note1': ['Участък, който минава по-близо от ', 'A stretch that runs closer than '],
  'dups.note2': [' до вече приетото трасе, получава маркер × по средата си. Клик върху маркера го маха от маршрута и от картата; "Отмени" го връща. Дупка, по-къса от отклонението, се затваря сама. Отклонението се сменя с полето "Отклонение" в лентата.', ' to the already accepted line gets a × marker in its middle. Clicking the marker removes it from the route and the map; “Undo” brings it back. A gap shorter than the tolerance closes by itself. The tolerance is changed with the “Tolerance” field in the bar.'],
  'piccard.h': ['Запазена картина', 'Saved picture'],
  'piccard.make': ['Направи картина', 'Make a picture'],
  'piccard.open': ['Покажи върху картината', 'Show on the picture'],
  'routes.h': ['Записани маршрути', 'Saved routes'],
  'routes.filter.aria': ['Търси маршрут по име', 'Search routes by name'],
  'routes.filter': ['Търси по име', 'Search by name'],
  'routes.new': ['Нов от тракове', 'New from tracks'],
  'routes.empty': ['Празен маршрут', 'Empty route'],
  'routes.th.name': ['Име', 'Name'],
  'routes.th.mod': ['Последна промяна', 'Last change'],
  'routes.th.act': ['Действия', 'Actions'],
  'foot.sub': [' · маршрути и тракове', ' · routes and tracks'],
  'foot.data': ['Данните живеят само в този браузър. За друго устройство изнеси колекцията и я зареди там.', 'The data lives only in this browser. For another device, export the collection and load it there.'],
  'foot.src': ['Плочки: Esri World Imagery и Esri Reference, OpenTopoMap. Търсене: Nominatim (OpenStreetMap). Височини: Open-Meteo, резерва OpenTopoData.', 'Tiles: Esri World Imagery and Esri Reference, OpenTopoMap. Search: Nominatim (OpenStreetMap). Elevations: Open-Meteo, fallback OpenTopoData.'],
  'foot.ver': ['Версия ', 'Version '],
  'imp.h': ['Импорт на GPX', 'Import GPX'],
  'imp.drop': ['Плъзни .gpx файл тук или избери файл', 'Drop a .gpx file here or choose a file'],
  'imp.max': ['До 10 файла наведнъж. Приема и файл с колекция (.json).', 'Up to 10 files at once. A collection file (.json) works too.'],
  'imp.note': ['От файла влизат: името, точките, сегментите, имената на спирките и височината, ако я има.', 'Taken from the file: the name, the points, the segments, the waypoint names and the elevation, if there is one.'],
  'picd.h': ['Картина за офлайн', 'Picture for offline use'],
  'picd.base': ['Основа', 'Base'],
  'picd.sat': ['Сателит с надписи', 'Satellite with labels'],
  'picd.area': ['Обхват', 'Area'],
  'picd.route': ['Целия маршрут', 'The whole route'],
  'picd.view': ['Текущия изглед', 'The current view'],
  'picd.top': ['Отгоре', 'On top'],
  'picd.info': ['Числа и легенда', 'Figures and legend'],
  'picd.labels': ['Надписи', 'Labels'],
  'picd.file': ['Файл: ', 'File: '],
  'act.cancel': ['Отказ', 'Cancel'],
  'picd.both': ['Свали картина + .gpx', 'Download picture + .gpx'],
  'picd.make': ['Свали картината (.png)', 'Download the picture (.png)'],
  'live.x': ['Затвори - записът остава до следващото отваряне', 'Close - the record stays until the next time you open the app'],
  'live.h': ['Незавършено следене', 'Unfinished follow'],
  'live.note': ['Следенето прекъсна, преди да го спреш. Изминатото е запазено.', 'Following was cut off before you stopped it. The walk so far is saved.'],
  'live.drop': ['Изхвърли', 'Discard'],
  'act.dlGpx': ['Свали .gpx', 'Download .gpx'],
  'sm.side': ['Изглаждане', 'Smoothing'],
  'sm.side.note': ['маха точките до 5 м встрани от линията', 'removes points up to 5 m off the line'],
  'sm.dense': ['Гъсти точки', 'Dense points'],
  'sm.dense.note': ['маха съседни точки на под 5 м по линията', 'removes neighbouring points less than 5 m apart along the line'],
  'rs.note': ['Изглажда се маршрутът: чертежът на картата, записът и сваленият .gpx остават еднакви. „Отмени“ връща неизгладения. Чертаните точки и височините не се пипат.', 'The route itself is smoothed: the drawing on the map, the record and the downloaded .gpx stay the same. “Undo” brings back the unsmoothed one. Drawn points and elevations are not touched.'],
  'rs.nameLbl': ['Име на файла и на записа', 'Name of the file and the record'],
  'name.file': ['Име на файла', 'File name'],
  'name.keys': ['Enter сваля, Escape затваря', 'Enter downloads, Escape closes'],
  'wpt.empty': ['Празно име - номер', 'Empty name - a number'],
  'wpt.ok': ['Сложи', 'Place'],
  'walk.h': ['Запис на изминатото', 'Save the walk'],
  'walk.name': ['Име на записа', 'Record name'],
  'walk.ptsAfter': ['Точки след изглаждане', 'Points after smoothing'],
  'walk.note': ['Суровата следа остава, докато прозорецът е отворен: ако не ти хареса, изключваш отметките и записваш пак. Изглаждането не пипа височините, часовете и точките от „Точка“. „Отказ“ оставя записа суров, под името по подразбиране.', 'The raw trace stays while this window is open: if you do not like the result, untick the boxes and save again. Smoothing does not touch the elevations, the times or the points from “Point”. “Cancel” leaves the record raw, under the default name.'],
  'lang.h': ['Език', 'Language'],
  'lang.auto': ['Автоматично', 'Automatic'],
  'lang.bg': ['Български', 'Bulgarian'],
  'lang.dict': ['Надписите от речника', 'Labels from the dictionary'],
  'lang.en': ['English', 'English'],
  'lang.note': ['Речник: български и английски. Друг език на браузъра при „Автоматично“ → интерфейсът остава на български; за друг език избери автоматичен превод.', 'Dictionary: Bulgarian and English. Any other browser language with “Automatic” → the interface stays in Bulgarian; for another language choose automatic translation.']
});

/* ---- js/*.js: съобщения, списъци, картата и картината ---- */
I18N.add({
  'unit.km': ['км', 'km'],
  'unit.h': ['ч', 'h'],
  'months.short': ['яну,фев,мар,апр,май,юни,юли,авг,сеп,окт,ное,дек', 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec'],
  'months.full': ['януари,февруари,март,април,май,юни,юли,август,септември,октомври,ноември,декември', 'January,February,March,April,May,June,July,August,September,October,November,December'],
  'dirs': ['север,североизток,изток,югоизток,юг,югозапад,запад,северозапад', 'north,northeast,east,southeast,south,southwest,west,northwest'],
  'attr.labels': ['надписи', 'labels'],
  'attr.data': ['данни', 'data'],
  'route.new': ['Нов маршрут', 'New route'],
  'route.def': ['Маршрут', 'Route'],
  'track.missing': ['липсващ трак', 'missing track'],
  'km.range': ['км {a} - {b}', 'km {a} - {b}'],
  'km.at': ['км {d}', 'km {d}'],
  'n.branches.1': ['{n} клон', '{n} branch'],
  'n.branches.n': ['{n} клона', '{n} branches'],
  'n.tracks.1': ['{n} трак', '{n} track'],
  'n.tracks.n': ['{n} трака', '{n} tracks'],
  'n.routes.1': ['{n} маршрут', '{n} route'],
  'n.routes.n': ['{n} маршрута', '{n} routes'],
  'n.points.1': ['{n} точка', '{n} point'],
  'n.points.n': ['{n} точки', '{n} points'],
  'n.stops.1': ['{n} спирка', '{n} waypoint'],
  'n.stops.n': ['{n} спирки', '{n} waypoints'],
  'msg.saveFail': ['Браузърът не позволи записа. Изнеси колекцията, за да не се загуби.', 'The browser did not allow saving. Export the collection so it is not lost.'],
  'err.notColl': ['Файлът не е колекция от CX Tracks.', 'The file is not a CX Tracks collection.'],
  'msg.undone': ['Отменено', 'Undone'],
  'msg.dupErr': ['Грешка при търсенето на дубликати: {e}', 'Error while looking for duplicates: {e}'],
  'elev.asking': ['Питам за височините...', 'Asking for the elevations...'],
  'elev.askingP': ['Питам за височините... {p} %', 'Asking for the elevations... {p} %'],
  'elev.fromFiles': ['Услугата за височини не отговаря - височините са от файловете.', 'The elevation service is not answering - the elevations come from the files.'],
  'elev.none': ['Височините не са налични: услугата не отговаря.', 'Elevations are not available: the service is not answering.'],
  'elev.ok': ['Височини: {src}, през {step} м, изгладени.', 'Elevations: {src}, every {step} m, smoothed.'],
  'elev.cache': ['кеш', 'cache'],
  'elev.err': ['Височините не са налични: {e}', 'Elevations are not available: {e}'],
  'elev.bad': ['лош отговор', 'bad response'],
  'elev.noAnswer': ['няма отговор', 'no response'],
  'map.dupX': ['махни дубликата', 'remove duplicate'],
  'map.bridged': ['свързано направо', 'joined directly'],
  'map.end': ['Край', 'End'],
  'map.start': ['Старт', 'Start'],
  'map.startEnd': ['Старт / край', 'Start / end'],
  'map.gap': ['дупка {d}', 'gap {d}'],
  'map.off': ['{d} встрани', '{d} off route'],
  'tip.inRoute': ['Вече е в маршрута. Клик я маха', 'Already in the route. A click removes it'],
  'tip.fork': ['Клик: от точката на прекъсване маршрутът продължава по този клон', 'Click: from the junction the route continues along this branch'],
  'tip.addAs': ['Клик я слага в маршрута като част {n}', 'A click adds it to the route as part {n}'],
  'tip.link': ['Връзка между частите', 'Link between the parts'],
  'tip.clickRemove': ['Клик я маха от маршрута', 'A click removes it from the route'],
  'tip.part': ['Част {n}', 'Part {n}'],
  'tip.invalid': ['Вече не е валидна ({why}). Клик я маха', 'No longer valid ({why}). A click removes it'],
  'tip.gap': ['дупка', 'gap'],
  'tip.gapClick': ['Клик: затвори с чертаене', 'Click: close it by drawing'],
  'tip.junction': ['Точка на прекъсване', 'Junction'],
  'tip.forkSwitch': ['Клик върху клона, по който да продължи, сменя посоката', 'Clicking the branch to continue along changes the direction'],
  'tip.forkAdd': ['Клик върху клон го слага в маршрута', 'Clicking a branch adds it to the route'],
  'tip.vertex': ['Точка · клик за име или махане', 'Point · click to name or remove it'],
  'msg.partRemoved': ['Част {n} е махната от маршрута. "Отмени" я връща.', 'Part {n} was removed from the route. “Undo” brings it back.'],
  'msg.partAdded': ['Част {n} в маршрута · {len}', 'Part {n} in the route · {len}'],
  'msg.stretchRemoved': ['Участъкът е махнат от маршрута. "Отмени" го връща.', 'The stretch was removed from the route. “Undo” brings it back.'],
  'msg.forkSwitched': ['Посоката е сменена: оттук по {name}. "Отмени" връща старата.', 'Direction changed: from here along {name}. “Undo” brings back the old one.'],
  'msg.dupRemoved.1': ['Дубликатът е махнат · {len}. "Отмени" го връща.', 'Duplicate removed · {len}. “Undo” brings it back.'],
  'msg.dupRemoved.n': ['Махнати са {n} трака един върху друг · {len}, остава един. "Отмени" ги връща.', '{n} stacked tracks removed · {len}, one stays. “Undo” brings them back.'],
  'msg.gapOpened': ['Дупката е отворена. "Отмени" я затваря пак.', 'The gap is open again. “Undo” closes it again.'],
  'msg.drawLink': ['Цъкни по картата точките, през които да мине връзката', 'Click on the map the points the link should pass through'],
  'msg.drag': ['Влачи точката', 'Drag the point'],
  'msg.clickRemove': ['Цъкни върху чертана точка, за да я махнеш', 'Click a drawn point to remove it'],
  'msg.grabPoint': ['Хвани чертана точка и я влачи', 'Grab a drawn point and drag it'],
  'msg.forkClick': ['Цъкни върху клона, по който маршрутът да продължи оттук', 'Click the branch the route should continue along from here'],
  'bar.show': ['Покажи горната лента', 'Show the top bar'],
  'bar.hide': ['Скрий горната лента', 'Hide the top bar'],
  'msg.barHidden': ['Лентата се скри - цъкни бутона „Лента“ горе вляво или празно място на картата, за да я върнеш.', 'The bar is hidden - tap the “Bar” button at the top left or an empty spot on the map to bring it back.'],
  'msg.cutCloser': ['Цъкни по-близо до линията на трака', 'Click closer to the track line'],
  'msg.cutSame': ['Второто място трябва да е на същия трак', 'The second spot must be on the same track'],
  'cut.start': ['Изрязване: цъкни началото по линията на трака', 'Cut: click the start on the track line'],
  'cut.from': ['Начало: км {d} - цъкни края', 'Start: km {d} - click the end'],
  'cut.range': ['Изрязване: {r}', 'Cut: {r}'],
  'cut.sub': ['{len} се махат от трака завинаги. „Отмени“ ги връща.', '{len} are removed from the track for good. “Undo” brings them back.'],
  'msg.cutDone': ['Изрязани {len} от {name} - махнати от картата, от трака и от маршрута. „Отмени“ ги връща.', 'Cut {len} from {name} - removed from the map, the track and the route. “Undo” brings them back.'],
  'msg.cutMode': ['Цъкни два пъти по линията на трака: първо началото, после края на изрязваното', 'Click twice on the track line: first the start, then the end of the piece to cut'],
  'msg.addLink': ['Цъкни точките на връзката', 'Click the points of the link'],
  'msg.addBetween': ['Клик на картата слага връзка между двете най-близки части', 'Clicking the map places a link between the two nearest parts'],
  'msg.addEnd': ['Клик на картата слага точка в края на маршрута', 'Clicking the map places a point at the end of the route'],
  'bad.deleted': ['тракът е изтрит', 'the track was deleted'],
  'bad.cut': ['изрязана е', 'it is cut out'],
  'bad.dup': ['вече е дубликат', 'it is a duplicate now'],
  'parts.shared': ['обща отсечка', 'shared stretch'],
  'parts.sharedOnce': ['минава се веднъж', 'ridden once'],
  'parts.link': ['връзка', 'link'],
  'parts.between': ['между частите', 'between the parts'],
  'parts.delLink': ['Махни връзката', 'Remove the link'],
  'parts.linkDraw': ['връзка - цъкни точки на картата', 'link - click points on the map'],
  'parts.drawn': ['чертан участък', 'drawn stretch'],
  'parts.ptsShort': ['{n} т.', '{n} pts'],
  'parts.rev': ['обърната', 'reversed'],
  'parts.invalid': ['Вече не е валидна: {why}. Клик на картата я маха.', 'No longer valid: {why}. Clicking it on the map removes it.'],
  'parts.up': ['Нагоре', 'Up'],
  'parts.down': ['Надолу', 'Down'],
  'parts.revBtn': ['Обърни посоката', 'Reverse the direction'],
  'parts.del': ['Махни от маршрута', 'Remove from the route'],
  'gap.between': ['дупка {d} между част {a} и част {b}', 'gap {d} between part {a} and part {b}'],
  'gap.draw': ['Затвори с чертаене', 'Close by drawing'],
  'gap.bridge': ['Свържи направо', 'Join directly'],
  'gap.closed': ['Затворена дупка', 'Closed gap'],
  'gap.reopen': ['Отвори пак', 'Open again'],
  'pt.noname': ['без име', 'no name'],
  'pt.aria': ['Име на точка {n}', 'Name of point {n}'],
  'pt.del': ['Махни точката', 'Remove the point'],
  'pt.walk': ['Точка от следене', 'Point from following'],
  'pt.walkAria': ['Име на точка от следене {n}', 'Name of following point {n}'],
  'tr.walk': ['изминат', 'walked'],
  'tr.vis': ['Видим и участва в търсенето', 'Visible and taking part in the search'],
  'tr.fit.title': ['Покажи целия трак', 'Show the whole track'],
  'tr.fit': ['Покажи', 'Show'],
  'tr.gpx': ['Свали като .gpx', 'Download as .gpx'],
  'tr.del': ['Махни трака', 'Remove the track'],
  'dups.pend.1': ['Дубликати по картата: {n} маркер · {len}', 'Duplicates on the map: {n} marker · {len}'],
  'dups.pend.n': ['Дубликати по картата: {n} маркера · {len}', 'Duplicates on the map: {n} markers · {len}'],
  'dups.skipped.1': ['Пропуснати дубликати: {n} участък · {len}', 'Skipped duplicates: {n} stretch · {len}'],
  'dups.skipped.n': ['Пропуснати дубликати: {n} участъка · {len}', 'Skipped duplicates: {n} stretches · {len}'],
  'dups.toDecide': ['{n} за решение', '{n} to decide'],
  'dups.skippedN.1': ['{n} пропуснат', '{n} skipped'],
  'dups.skippedN.n': ['{n} пропуснати', '{n} skipped'],
  'rt.open': ['Отвори', 'Open'],
  'rt.del': ['Изтрий', 'Delete'],
  'rt.none': ['Няма маршрути с това име.', 'No routes with that name.'],
  'pic.info': ['Картина от {date} · {w} на {h} точки · {base}. Пази се с обхвата си, затова положението от GPS ляга върху нея и без връзка.', 'Picture from {date} · {w} by {h} pixels · {base}. It is kept with its extent, so your GPS position lands on it even offline.'],
  'pic.topo': ['топо', 'topo'],
  'pic.sat': ['сателит', 'satellite'],
  'pic.none': ['Още няма картина за този маршрут. Копчето "Картина" я прави и я пази заедно с обхвата ѝ.', 'No picture for this route yet. The “Picture” button makes one and keeps it together with its extent.'],
  'prof.waitEle': ['Профилът се появява, щом дойдат височините', 'The profile appears once the elevations arrive'],
  'prof.waitPart': ['Профилът се появява, щом в маршрута има част', 'The profile appears once the route has a part'],
  'err.read': ['Файлът не може да се прочете.', 'The file cannot be read.'],
  'imp.tooMany': ['Избрани са {n} файла - влизат първите {max}. Добави останалите на втори път.', '{n} files selected - the first {max} go in. Add the rest in a second go.'],
  'imp.reading': ['Чета файл {i} от {n}: {name}...', 'Reading file {i} of {n}: {name}...'],
  'err.badJson': ['Файлът не е колекция от CX Tracks (лош JSON).', 'The file is not a CX Tracks collection (bad JSON).'],
  'imp.coll': ['колекция: {t}, {r}', 'collection: {t}, {r}'],
  'imp.added.1': ['Добавен {n} трак', 'Added {n} track'],
  'imp.added.n': ['Добавени {n} трака', 'Added {n} tracks'],
  'imp.addedDups': [' · дубликати по картата: {n} (клик върху маркер маха дубликата)', ' · duplicates on the map: {n} (clicking a marker removes the duplicate)'],
  'imp.collLoaded': ['Колекцията е заредена', 'Collection loaded'],
  'msg.routeEmpty': ['Маршрутът е празен - клик върху трак го слага в маршрута.', 'The route is empty - clicking a track adds it to the route.'],
  'msg.exported': ['Изнесен {f} · {len}, една линия', 'Exported {f} · {len}, one line'],
  'msg.collExported': ['Колекцията е изнесена: {t}, {r}', 'Collection exported: {t}, {r}'],
  'picd.nothing': ['Няма какво да се снима - добави трак или част.', 'Nothing to capture - add a track or a part.'],
  'picd.est': ['Картината излиза {w} на {h} точки, около {mb} МБ. Сглобява се в браузъра от плочките и не качва маршрута никъде.', 'The picture comes out at {w} by {h} pixels, about {mb} MB. It is put together in the browser from the tiles and does not upload the route anywhere.'],
  'pic.partDrawn': ['част {n} (чертан участък)', 'part {n} (drawn stretch)'],
  'pic.partTrack': ['част {n} ({name})', 'part {n} ({name})'],
  'picd.nothing2': ['Няма какво да се снима - добави трак или част в маршрута.', 'Nothing to capture - add a track or a part to the route.'],
  'picd.tiles': ['Сглобявам плочките...', 'Putting the tiles together...'],
  'picd.tilesN': ['Сглобявам плочките: {done} от около {total}...', 'Putting the tiles together: {done} of about {total}...'],
  'picd.done': ['Свалена: {name} ({w} на {h}).', 'Downloaded: {name} ({w} by {h}).'],
  'picd.kept': ['Пази се и тук, заедно с обхвата си, за следене без връзка.', 'It is also kept here, with its extent, for following offline.'],
  'msg.noPic': ['Още няма запазена картина за този маршрут - направи я с "Картина", докато има връзка.', 'No saved picture for this route yet - make one with “Picture” while you are online.'],
  'pic.here': ['ти си тук', 'you are here'],
  'pic.of': ['{a} от {b}', '{a} of {b}'],
  'pic.outside': ['извън картината', 'outside the picture'],
  'follow.start': ['Следене', 'Follow'],
  'follow.stop': ['Стоп', 'Stop'],
  'follow.start.aria': ['Следене - пусни следенето по GPS', 'Follow - start following by GPS'],
  'follow.stop.aria': ['Стоп - спри следенето', 'Stop - stop following'],
  'follow.start.title': ['Пусни следенето по GPS', 'Start following by GPS'],
  'follow.stop.title': ['Спри следенето и запиши изминатото', 'Stop following and save the walk'],
  'msg.followEmpty': ['Маршрутът е празен - ще се записва само изминатото.', 'The route is empty - only the walk will be recorded.'],
  'follow.title': ['Следене: {name}', 'Following: {name}'],
  'follow.waiting': ['Чакам сигнал от GPS...', 'Waiting for a GPS signal...'],
  'follow.off': ['Отклонил си се на {d} от линията - върни се към пунктира. Линията е на {dir}.', 'You are {d} off the line - head back to the dashed line. The line is to the {dir}.'],
  'follow.on': ['По линията си. Точност на GPS: {acc}.', 'You are on the line. GPS accuracy: {acc}.'],
  'walk.headStop': ['Следенето спря.', 'Following stopped.'],
  'walk.headRestored': ['Възстановено незавършено следене.', 'Unfinished follow restored.'],
  'walk.savedAs': ['Изминатият път е записан като отделен маршрут "{name}".', 'The walk was saved as a separate route “{name}”.'],
  'msg.followNoPath': ['Следенето спря. Няма записан път.', 'Following stopped. No path was recorded.'],
  'awake.on': ['Екранът няма да заспива, докато следиш.', 'The screen will stay awake while you follow.'],
  'awake.off': ['Екранът може да заспи - следенето продължава при събуждане.', 'The screen may sleep - following goes on when it wakes up.'],
  'awake.none': ['Този браузър не може да държи екрана буден. Екранът може да заспи - следенето продължава при събуждане.', 'This browser cannot keep the screen awake. The screen may sleep - following goes on when it wakes up.'],
  'awake.denied': ['Браузърът не позволи екранът да стои буден (например при пестене на батерия). Екранът може да заспи - следенето продължава при събуждане.', 'The browser did not let the screen stay awake (for example in battery saver). The screen may sleep - following goes on when it wakes up.'],
  'wpt.btn.ok': ['Сложи точка там, където си сега', 'Place a point where you are now'],
  'wpt.btn.no': ['Няма сигнал от GPS - точката чака положение', 'No GPS signal - the point is waiting for a position'],
  'msg.wptNoGps': ['Няма сигнал от GPS - точката не е сложена.', 'No GPS signal - the point was not placed.'],
  'wpt.def': ['Точка {n}', 'Point {n}'],
  'wpt.where': ['Мястото: {lat}, {lon}', 'Location: {lat}, {lon}'],
  'wpt.acc': ['точност {d}', 'accuracy {d}'],
  'wpt.km': ['км {d} по маршрута', 'km {d} along the route'],
  'msg.wptPlaced': ['Точка „{name}“ е сложена · {cnt} при това следене', 'Point “{name}” placed · {cnt} on this follow'],
  'walk.trackName': ['изминат {d}', 'walked {d}'],
  'walk.def': ['изминат', 'walked'],
  'msg.walkSaved': ['Изминатият път е записан като отделен маршрут "{name}" · {len}', 'The walk was saved as a separate route “{name}” · {len}'],
  'sm.count': ['{a} от {n} (махнати {x})', '{a} of {n} ({x} removed)'],
  'msg.walkRec': ['Записан „{name}“ · {len}, {pts}', 'Saved “{name}” · {len}, {pts}'],
  'msg.smoothed': ['(изгладено, махнати {x})', '(smoothed, {x} removed)'],
  'msg.exportedPts': ['Изнесен {f} · {len}, {pts}', 'Exported {f} · {len}, {pts}'],
  'msg.noLive': ['Следенето не се пази в браузъра (частен режим или забранен запис). Ако страницата се затвори, изминатото ще се загуби.', 'Following is not being kept in the browser (private mode or storage blocked). If the page closes, the walk will be lost.'],
  'live.when': ['Тръгнал {d}, {hm}', 'Started {d}, {hm}'],
  'live.on': ['следене по „{name}“', 'following “{name}”'],
  'msg.liveDropped': ['Незавършеното следене е изхвърлено.', 'The unfinished follow was discarded.'],
  'compass.heading.aria': ['Посока - завърти картата по посоката на движение', 'Heading - turn the map to the direction of travel'],
  'compass.north.aria': ['Север - върни север нагоре', 'North - put north back up'],
  'compass.heading.title': ['Завърти картата по посоката на движение', 'Turn the map to the direction of travel'],
  'compass.north.title': ['Върни север нагоре', 'Put north back up'],
  'msg.noGps': ['Няма сигнал от GPS', 'No GPS signal'],
  'act.download': ['Свали', 'Download'],
  'name.saveTitle': ['Запис на маршрута', 'Save the route'],
  'rs.count': ['{a} → {b} (махнати {x})', '{a} → {b} ({x} removed)'],
  'msg.savedDl': ['Свален {f} · записан в „Записани маршрути“ като „{name}“', 'Downloaded {f} · saved in “Saved routes” as “{name}”'],
  'msg.savedSmooth': ['(изгладен - и на картата; „Отмени“ връща неизгладения)', '(smoothed - on the map too; “Undo” brings back the unsmoothed one)'],
  'msg.savedEmpty': ['Записан в „Записани маршрути“ като „{name}“. Маршрутът е празен - .gpx не е свален.', 'Saved in “Saved routes” as “{name}”. The route is empty - no .gpx was downloaded.'],
  'search.busy': ['Търся...', 'Searching...'],
  'search.none': ['Нищо не е намерено за "{q}".', 'Nothing found for “{q}”.'],
  'search.fail': ['Търсенето не отговаря в момента. Опитай пак след малко.', 'Search is not answering right now. Try again in a moment.'],
  'confirm.delRoute': ['Да изтрия ли маршрута "{name}"? Траковете-източници остават.', 'Delete the route “{name}”? The source tracks stay.'],
  'msg.tracksCleared': ['Траковете и маршрутът са махнати. "Отмени" ги връща.', 'The tracks and the route were removed. “Undo” brings them back.'],
  'msg.partsCleared': ['Частите са махнати. "Отмени" ги връща.', 'The parts were removed. “Undo” brings them back.'],
  'theme.light': ['Светла тема', 'Light theme'],
  'theme.dark': ['Тъмна тема', 'Dark theme'],
  'msg.newRoute': ['Нов маршрут: клик върху трак на картата го слага като първа част', 'New route: clicking a track on the map adds it as the first part'],
  'confirm.delTrack': ['Да махна ли трака "{name}"?', 'Remove the track “{name}”?'],
  'confirm.usedIn': ['Използва се в {n} маршрута - частите му ще се маркират като липсващи.', 'It is used in {n} routes - its parts will be marked as missing.'],
  'msg.tilesFail': ['Плочките на картата не се зареждат - няма връзка или услугата отказва. Запазената картина работи и без връзка.', 'The map tiles are not loading - no connection, or the service refuses. The saved picture works offline too.'],
  'msg.oops': ['Нещо се обърка: {e}. Данните са запазени.', 'Something went wrong: {e}. Your data is saved.'],
  'msg.unknownErr': ['непозната грешка', 'unknown error'],
  'snap.refused': ['Услугата за плочки ({name}) отказа {n} плочки. Картината не е направена, за да не излезе празна. Опитай пак след малко или избери друга основа.', 'The tile service ({name}) refused {n} tiles. The picture was not made so that it does not come out empty. Try again in a moment or choose another base.'],
  'snap.all': ['всички', 'all'],
  'snap.missing': ['{n} плочки от основата липсват.', '{n} base tiles are missing.'],
  'snap.noLabels': ['Слоят с надписи не отговори - картината е без част от имената.', 'The labels layer did not answer - some names are missing from the picture.'],
  'snap.blob': ['Браузърът не успя да запише картината.', 'The browser could not write the picture.'],
  'snap.cors': ['Услугата за плочки не позволи сглобяване на картина в браузъра (липсва разрешение CORS).', 'The tile service did not allow building a picture in the browser (CORS permission missing).'],
  'snap.up': ['{m} м изкачване', '{m} m ascent'],
  'snap.grade': ['наклон до {p}', 'max grade {p}'],
  'snap.more': ['и още {n} части', 'and {n} more parts'],
  'snap.startEnd': ['начало / край', 'start / end'],
  'geo.none': ['Този браузър не дава местоположение. Следенето не може да тръгне.', 'This browser does not provide a location. Following cannot start.'],
  'geo.https': ['Следенето иска защитена връзка (https). Отвори приложението от адреса в GitHub Pages.', 'Following needs a secure connection (https). Open the app from its GitHub Pages address.'],
  'geo.errMsg': ['Местоположението не е налично: {e}', 'The location is not available: {e}'],
  'geo.denied': ['Нямаш разрешение за местоположение. Разреши го от настройките на браузъра за този сайт и натисни "Следене" пак.', 'You have no location permission. Allow it in the browser settings for this site and press “Follow” again.'],
  'geo.timeout': ['GPS не отговаря. Излез на открито и изчакай малко.', 'The GPS is not answering. Go outside and wait a little.'],
  'geo.unavail': ['Местоположението не е налично в момента.', 'The location is not available right now.'],
  'gpx.bad': ['Този файл не изглежда като GPX. Пробвай .gpx файл от друго приложение.', 'This file does not look like GPX. Try a .gpx file from another app.'],
  'gpx.track': ['трак', 'track'],
  'gpx.onlyWpts': ['Във файла има само точки, без трак. Нужен е трак или маршрут.', 'The file has only points, no track. A track or a route is needed.']
});

/* ---- 1.3.0: разклоненията - меню, изтриване, излишни пръстени ---- */
I18N.add({
  'om.seg': ['Участък', 'Stretch'],
  'om.junc': ['Разклонение', 'Junction'],
  'om.add': ['Добави в маршрута', 'Add to route'],
  'om.fork': ['Продължи по този клон', 'Continue along this branch'],
  'om.out': ['Махни от маршрута', 'Remove from route'],
  'om.delSeg': ['Изтрий участъка', 'Delete stretch'],
  'om.delJ': ['Изтрий разклонението', 'Delete junction'],
  'om.go': ['Продължи по {name} · {len}', 'Continue along {name} · {len}'],
  'om.delNear': ['Изтрий близкия трак „{name}“ ({d})', 'Delete the nearby track “{name}” ({d})'],
  'tip.segMenu': ['Клик - меню: добави или изтрий', 'Click - menu: add or delete'],
  'tip.itemMenu': ['Клик - меню: махни от маршрута или изтрий участъка', 'Click - menu: remove from the route or delete the stretch'],
  'tip.juncMenu': ['Клик - меню: посока или изтриване', 'Click - menu: direction or delete'],
  'msg.juncDel.1': ['Разклонението е изтрито - тракът се чете цял. "Отмени" го връща.', 'The junction is deleted - the track reads whole. “Undo” brings it back.'],
  'msg.juncDel.n': ['Изтрити са {n} пръстена (и съседните до 40 м по трака) - тракът се чете цял. "Отмени" ги връща.', '{n} rings deleted (with the neighbours within 40 m along the track) - the track reads whole. “Undo” brings them back.'],
  'msg.segDel': ['Участъкът е изтрит ({len}) - няма го на картата, в трака и в маршрута. "Отмени" го връща.', 'The stretch is deleted ({len}) - gone from the map, the track and the route. “Undo” brings it back.'],
  'msg.ringsDropped.1': ['Махнат е {n} излишен пръстен. "Отмени" го връща.', '{n} extra ring removed. “Undo” brings it back.'],
  'msg.ringsDropped.n': ['Махнати са {n} излишни пръстена. "Отмени" ги връща.', '{n} extra rings removed. “Undo” brings them back.'],
  'tr.parts.1': ['{n} участък', '{n} stretch'],
  'tr.parts.n': ['{n} участъка', '{n} stretches'],
  'tr.dels': ['изтрити {len}', '{len} deleted'],
  'rings.h': ['Излишни пръстени', 'Extra rings'],
  'rings.note': ['Нищо не се маха, докато не потвърдиш. Отметка на ред = този пръстен да падне; двете парчета на трака се сливат.', 'Nothing is removed until you confirm. A tick on a row = this ring goes; the two pieces of the track join.'],
  'rings.cross': ['{name} · км {km} — без избор', '{name} · km {km} — no choice'],
  'rings.near': ['{name} · км {km} — до друг пръстен {d}', '{name} · km {km} — next to another ring {d}'],
  'rings.drop': ['Махни отметнатите', 'Remove the ticked'],
  'rings.keep': ['Задръж всички', 'Keep all'],
  'rings.row': ['Излишни пръстени: {n}', 'Extra rings: {n}'],
  'rings.review': ['Прегледай', 'Review']
});

/* ---- Прозорецът „Език“ ---- */
I18N.add({
  'lang.auto.sub': ['Език на браузъра: {lang}', 'Browser language: {lang}'],
  'lang.auto.other': ['Език на браузъра: {code} - няма речник, затова български', 'Browser language: {code} - no dictionary, so Bulgarian'],
  'lang.name.bg': ['български', 'Bulgarian'],
  'lang.name.en': ['английски', 'English'],
  'lang.tr.h': ['Автоматичен превод', 'Automatic translation'],
  'lang.tr.pick': ['Избери език…', 'Choose a language…'],
  'lang.tr.about': ['Вграденият в браузъра преводач превежда речника веднъж, на устройството, без външна услуга. Имената на маршрути, спирки, тракове и файлове не се превеждат.', 'The translator built into the browser translates the dictionary once, on the device, with no outside service. Names of routes, waypoints, tracks and files are not translated.'],
  'lang.tr.no': ['Браузърът ти не поддържа автоматичен превод', 'Your browser does not support automatic translation'],
  'lang.tr.noWhy': ['Работи в Chrome на компютър (версия 138 и нагоре), където преводачът е вграден. Интерфейсът остава на речника.', 'It works in Chrome on a computer (version 138 and up), where the translator is built in. The interface stays on the dictionary.'],
  'lang.tr.checking': ['Проверявам какви езици дава браузърът…', 'Checking which languages the browser offers…'],
  'lang.tr.dl': ['Изтеглям езика… {p}', 'Downloading the language… {p}'],
  'lang.tr.doing': ['Превеждам надписите… {p}', 'Translating the labels… {p}'],
  'lang.tr.on': ['Надписите са преведени автоматично: {lang}.', 'The labels are translated automatically: {lang}.'],
  'lang.tr.fail': ['Преводът не стана - интерфейсът се връща към речника.', 'The translation failed - the interface goes back to the dictionary.']
});

I18N.start();
