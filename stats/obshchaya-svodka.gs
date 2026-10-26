/**
 * Аналитика каналов в тему «Аналитика» группы «Владычица НС». Продаж здесь нет, они в «доходах».
 * Живёт отдельным файлом «Общая сводка» в проекте «Уведомления о продажах» (аккаунт safalex777),
 * копия кода: webapp/stats/obshchaya-svodka.gs. Все имена с приставкой obsh, продажи и подписчиков не трогает.
 *
 * Три сообщения:
 *   каждый день 21:30 - коротко: по площадке сутки, неделя, месяц со стрелками к прошлому такому же сроку;
 *   понедельник 10:00 - итоги прошлой недели: главное, откуда пришли в бот, лучший пост и видео, Shorts/длинные;
 *   3-го числа 21:30 - итоги прошлого месяца (к 3-му YouTube досылает статистику за конец месяца).
 *
 * Откуда цифры:
 *   бот - свойства PODP_* и лист «_подписчики» (их ведёт файл «Подписчики»), покупки - лист «Заказы»;
 *   Telegram-канал - открытые страницы t.me/Kaemma144 (подписчики) и t.me/s/Kaemma144 (посты, просмотры, реакции);
 *   YouTube - таблица «YouTube для сводки» в аккаунте kaemma144 (открыта на чтение), её заполняет
 *     скрипт «YouTube для сводки»: общее число как в YouTube, дни, неделя и месяцы из аналитики (с задержкой 2-3 дня).
 * Каждый вечер цифры пишутся на скрытый лист «_аналитика»: по нему считаются прирост Telegram и просмотры YouTube за сутки.
 * Время: каждая отправка ставит разовый триггер на следующую.
 * Запустить один раз obshUstanovit(). Посмотреть без отправки: obshProba(), obshProbaNedelya(), obshProbaMesyac().
 */
var OBSH_CHAT = '-1004351530139';
var OBSH_THREAD = 216;
var OBSH_HOUR = 21, OBSH_MIN = 30;
var OBSH_NED_HOUR = 10;
var OBSH_ITOG_DAY = 3;
var OBSH_TZ = 'Europe/Moscow';
var OBSH_TG = 'Kaemma144';
var OBSH_YT_TABLICA = '1m6crZwNgZmkhJy-Q8P9bKd5-wWq7-DRaC2Kb2YJREj0';
var OBSH_LIST = '_аналитика';
var OBSH_KEYS = ['tg', 'yt', 'ytv'];
var OBSH_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
var OBSH_MONTHS_IM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
var OBSH_SRC = { tiktok: 'TikTok', tt: 'TikTok', youtube: 'YouTube', yt: 'YouTube', instagram: 'Instagram', ig: 'Instagram',
  inst: 'Instagram', vk: 'VK', telegram: 'Telegram', tg: 'Telegram', site: 'сайт', getcourse: 'сайт', '?': 'без метки' };

// ---------- расписание ----------

function obshUstanovit() {
  obshDalshe();
  obshNedDalshe();
  obshProba();
}

function obshSvodka() {
  try {
    obshSend(obshTekst(true));
    if (Number(Utilities.formatDate(new Date(), OBSH_TZ, 'd')) === OBSH_ITOG_DAY) obshSend(obshItogi());
  } finally {
    obshDalshe();
  }
}

function obshNedelya() {
  try {
    obshSend(obshNedTekst());
  } finally {
    obshNedDalshe();
  }
}

function obshProba() { Logger.log(obshTekst(false)); }
function obshProbaNedelya() { Logger.log(obshNedTekst()); }
function obshProbaMesyac() { Logger.log(obshItogi()); }

function obshSend(text) {
  var tok = PropertiesService.getScriptProperties().getProperty('BOT_TOKEN');
  var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + tok + '/sendMessage', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ chat_id: OBSH_CHAT, message_thread_id: OBSH_THREAD, text: text, parse_mode: 'HTML',
      disable_web_page_preview: true })
  });
  if (!JSON.parse(r.getContentText()).ok) throw new Error('Telegram не принял аналитику (ответ ' + r.getContentText().slice(0, 200) + ')');
}

/** Разовый триггер fn на ближайшее время hour:min по Москве (Москва всегда UTC+3); weekday - только этот день недели (1 = пн). */
function obshPostavit(fn, hour, min, weekday) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t);
  });
  var msk = new Date(Date.now() + 3 * 3600e3);
  for (var k = 0; k < 8; k++) {
    var t = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + k, hour - 3, min);
    if (t <= Date.now() + 5 * 60e3) continue;
    if (weekday && new Date(t + 3 * 3600e3).getUTCDay() !== weekday) continue;
    ScriptApp.newTrigger(fn).timeBased().at(new Date(t)).create();
    return;
  }
}

function obshDalshe() { obshPostavit('obshSvodka', OBSH_HOUR, OBSH_MIN); }
function obshNedDalshe() { obshPostavit('obshNedelya', OBSH_NED_HOUR, 0, 1); }

// ---------- каждый день ----------

function obshTekst(zapisat) {
  var now = new Date();
  var today = obshDay(0);
  var tg = obshTelegram();
  var yt = obshYoutube();
  var hist = obshIstoriya(today, { tg: tg.subs, yt: yt.subs, ytv: yt.viewsTotal }, zapisat);
  var b = obshBot();
  var rows = ['📊 <b>Аналитика · ' + Number(Utilities.formatDate(now, OBSH_TZ, 'd')) + ' ' +
    OBSH_MONTHS[Number(Utilities.formatDate(now, OBSH_TZ, 'M')) - 1] + '</b>'];

  // бот: итог = новые минус отписки (пока отписки не известны за весь срок - только новые)
  var bp = function (k, shift) { return b.per(obshDay(k - 1 + shift), obshDay(shift)); };
  var bv = function (p) { return p.out === null ? p.n : p.n - p.out; };
  var bTxt = function (k) {
    var c = bp(k, 0), p = bp(k, k);
    var same = (c.out === null) === (p.out === null);
    return obshZ(bv(c)) + (k > 1 && same ? obshStr(bv(c), bv(p)) : '');
  };
  rows.push('', '🤖 <b>Бот</b> · ' + obshN(b.total));
  rows.push('Сутки ' + bTxt(1) + ' · Неделя ' + bTxt(7) + ' · Месяц ' + bTxt(30));
  var n7 = bp(7, 0).n, pok = obshPokupki(obshDay(6), today);
  if (n7) rows.push('Покупок за неделю: ' + pok + ' (' + Math.round(pok / n7 * 100) + ' % от новых)');

  // Telegram
  rows.push('', '✈️ <b>Telegram</b> · ' + (tg.subs ? obshN(tg.subs) : 'страница не ответила'));
  if (tg.subs) {
    var start = Object.keys(hist).sort()[0] || today;
    var tTxt = function (k) {
      var v = obshRazn(hist, 'tg', tg.subs, 0, k);
      if (v === null) return 'с ' + obshDm(obshDayFrom(start, k));
      return obshZ(v) + (k > 1 ? obshStr(v, obshRazn(hist, 'tg', null, k, 2 * k)) : '');
    };
    rows.push('Сутки ' + tTxt(1) + ' · Неделя ' + tTxt(7) + ' · Месяц ' + tTxt(30));
    var r7 = obshTgPeriod(tg.posts, 7, 0), r7p = obshTgPeriod(tg.posts, 7, 7);
    if (r7.reach) rows.push('Охват поста: ' + obshN(r7.reach) + (r7p.reach ? obshStr(r7.reach, r7p.reach) + ' (было ' + obshN(r7p.reach) + ')' : ''));
  }

  // YouTube
  rows.push('', '▶️ <b>YouTube</b> · ' + (yt.subs ? obshN(yt.subs) : 'нет доступа к таблице'));
  if (yt.days.length) {
    var last = yt.days[yt.days.length - 1];
    var v1 = obshRazn(hist, 'ytv', yt.viewsTotal, 0, 1);
    rows.push('Сутки: ' + obshN(v1 !== null ? v1 : last[1]) + ' просм. · ' + obshZ(last[3] - last[4]) + ' подп.');
    var yTxt = function (k) {
      var c = obshYtSum(yt.days.slice(-k)), p = yt.days.length >= 2 * k ? obshYtSum(yt.days.slice(-2 * k, -k)) : null;
      return obshN(c.views) + ' просм.' + (p ? obshStr(c.views, p.views) : '') + ' · ' + obshZ(c.subs) + ' подп.' +
        (p ? obshStr(c.subs, p.subs) : '');
    };
    rows.push('Неделя: ' + yTxt(7));
    rows.push('Месяц: ' + yTxt(30));
    rows.push('<i>YouTube по ' + obshDm(last[0]) + (v1 !== null ? ', просмотры за сутки сегодняшние' : '') + '</i>');
  }
  return rows.join('\n');
}

// ---------- понедельник: итоги недели ----------

function obshNedTekst() {
  var from = obshDay(7), to = obshDay(1); // прошлая неделя пн-вс
  var b = obshBot(), tg = obshTelegram(), yt = obshYoutube();
  var rows = ['📈 <b>Итоги недели · ' + obshDm(from) + '-' + obshDm(to) + '</b>', '', '⭐ <b>Главное</b>'];

  // главное: самый сильный рост и самое сильное падение к позапрошлой неделе
  var bc = b.per(from, to), bpv = b.per(obshDay(14), obshDay(8));
  var tc = obshTgPeriod(tg.posts, 7, 1), tpv = obshTgPeriod(tg.posts, 7, 8);
  var w = yt.days.length >= 14 ? obshYtSum(yt.days.slice(-7)) : null, wp = w ? obshYtSum(yt.days.slice(-14, -7)) : null;
  var cand = [
    { name: 'Бот', what: 'новых', now: bc.n, was: bpv.n, znak: true },
    { name: 'Telegram', what: 'охват поста', now: tc.reach, was: tpv.reach },
    { name: 'YouTube', what: 'просмотров', now: w && w.views, was: wp && wp.views },
    { name: 'YouTube', what: 'подписчиков', now: w && w.subs, was: wp && wp.subs, znak: true, abs: true }
  ].filter(function (c) { return c.now !== null && c.now !== undefined && c.was; });
  cand.forEach(function (c) { c.ch = c.abs ? (c.now - c.was) / Math.max(Math.abs(c.was), 10) : c.now / c.was - 1; });
  var up = cand.filter(function (c) { return c.ch >= 0.1; }).sort(function (a, z) { return z.ch - a.ch; })[0];
  var down = cand.filter(function (c) { return c.ch <= -0.1; }).sort(function (a, z) { return a.ch - z.ch; })[0];
  var line = function (c, arrow) {
    var val = c.znak ? obshZ(c.now) : obshN(c.now), was = c.znak ? obshZ(c.was) : obshN(c.was);
    var how = !c.abs && c.now / c.was >= 2 ? ', в ' + String(Math.round(c.now / c.was * 10) / 10).replace('.', ',') + ' раза больше' :
      ', было ' + was;
    return arrow + ' ' + c.name + ': ' + c.what + ' ' + val + how;
  };
  if (up) rows.push(line(up, '🔼'));
  if (down) rows.push(line(down, '🔽'));
  if (!up && !down) rows.push('➖ без резких перемен к прошлой неделе');
  if (yt.best) rows.push('🏆 Лучшее видео: «' + obshKor(yt.best.title, 50) + '» ' + obshTys(yt.best.views));
  if (tc.best) rows.push('🏆 Лучший пост: «' + obshKor(tc.best.text, 50) + '» ' + obshN(tc.best.views));

  // бот: откуда пришли
  rows.push('', '🤖 <b>Бот</b>: ' + obshZ(bc.n) + ' новых' + (bc.out !== null ? ', отписались ' + bc.out : ''));
  var src = {};
  Object.keys(b.src).forEach(function (d) {
    if (d < from || d > to) return;
    Object.keys(b.src[d]).forEach(function (k) {
      var name = OBSH_SRC[k] || k;
      src[name] = (src[name] || 0) + b.src[d][k];
    });
  });
  var names = Object.keys(src).sort(function (a, z) { return src[z] - src[a]; });
  if (names.length && !(names.length === 1 && names[0] === 'без метки')) {
    rows.push('Откуда: ' + names.slice(0, 6).map(function (k) { return k + ' ' + src[k]; }).join(' · '));
  } else if (names.length) {
    rows.push('Откуда: на ссылках в бот нет меток источника');
  }
  var pok = obshPokupki(from, to);
  if (bc.n) rows.push('Покупок: ' + pok + ' (' + Math.round(pok / bc.n * 100) + ' % от новых)');

  // Telegram
  rows.push('', '✈️ <b>Telegram</b>: ' + tc.posts + ' постов · ' + obshN(tc.reactions) + ' реакций');
  if (tc.reach) rows.push('Охват поста: ' + obshN(tc.reach) + (tpv.reach ? obshStr(tc.reach, tpv.reach) + ' (было ' + obshN(tpv.reach) + ')' : '') +
    (tg.subs ? ' · ' + Math.round(tc.reach / tg.subs * 100) + ' % подписчиков' : ''));

  // YouTube
  if (yt.week) {
    rows.push('', '▶️ <b>YouTube</b> (' + obshDm(yt.week.start) + '-' + obshDm(yt.week.end) + ')');
    if (yt.week.shorts !== undefined) rows.push('Shorts ' + obshN(yt.week.shorts) + ' просм. · длинные ' + obshN(yt.week.long) +
      (yt.week.live ? ' · эфиры ' + obshN(yt.week.live) : ''));
    rows.push((yt.week.avg ? 'Досмотр ' + yt.week.avg + ' % · ' : '') + 'вышло ' + yt.new7 + ' видео и Shorts');
  }
  return rows.join('\n');
}

// ---------- 3-го числа: итоги месяца ----------

function obshItogi() {
  var msk = new Date(Date.now() + 3 * 3600e3);
  var ym = function (k) { return Utilities.formatDate(new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth() - k, 1)), 'UTC', 'yyyy-MM'); };
  var name = function (s) { return OBSH_MONTHS_IM[Number(s.slice(5, 7)) - 1]; };
  var cur = ym(1), prev = ym(2);
  var b = obshBot();
  var rows = ['🏆 <b>Итоги: ' + name(cur) + ' ' + cur.slice(0, 4) + '</b>', ''];

  var botM = {};
  Object.keys(b.newByDay).forEach(function (d) { botM[d.slice(0, 7)] = (botM[d.slice(0, 7)] || 0) + b.newByDay[d]; });
  delete botM[ym(0)];
  rows.push('🤖 <b>Бот</b>: ' + obshZ(botM[cur] || 0) + ' новых' + obshBylo(botM[cur] || 0, botM[prev], true, name(prev)) +
    obshLuchshiy(botM, cur));

  var hist = obshIstoriya(obshDay(0), {}, false);
  var tgM = function (s) {
    var days = Object.keys(hist).filter(function (x) { return x.slice(0, 7) === s && hist[x].tg; }).sort();
    return days.length > 1 ? hist[days[days.length - 1]].tg - hist[days[0]].tg : null;
  };
  var tc = tgM(cur);
  var tgp = obshTelegram(62).posts;
  var reachM = function (s) {
    var v = tgp.filter(function (p) { return p.day.slice(0, 7) === s; }).map(function (p) { return p.views; });
    return v.length ? obshMed(v) : 0;
  };
  rows.push('✈️ <b>Telegram</b>: ' + (tc === null ? 'подписчики: история с 26.10' : obshZ(tc) + ' подписчиков' + obshBylo(tc, tgM(prev), true, name(prev))) +
    (reachM(cur) ? ' · охват поста ' + obshN(reachM(cur)) + obshBylo(reachM(cur), reachM(prev) || null, false, name(prev)) : ''));

  var yt = obshYoutube(), ytS = {}, ytV = {};
  yt.months.forEach(function (x) { ytS[x[0]] = x[3] - x[4]; ytV[x[0]] = x[1]; });
  if (ytV[cur] !== undefined) {
    rows.push('▶️ <b>YouTube</b>: ' + obshZ(ytS[cur]) + ' подп.' + obshBylo(ytS[cur], ytS[prev], true, name(prev)) +
      ' · ' + obshN(ytV[cur]) + ' просм.' + obshBylo(ytV[cur], ytV[prev], false, name(prev)) + obshLuchshiy(ytV, cur));
  } else {
    rows.push('▶️ <b>YouTube</b>: статистика за месяц ещё не пришла');
  }
  return rows.join('\n');
}

/** « · 🥇 лучший месяц за год» среди последних 12 целых месяцев. */
function obshLuchshiy(map, cur) {
  var y = Number(cur.slice(0, 4)), m = Number(cur.slice(5, 7));
  var from = (m === 12 ? y : y - 1) + '-' + ('0' + (m % 12 + 1)).slice(-2);
  var keys = Object.keys(map).filter(function (k) { return k >= from && k <= cur; });
  if (keys.length < 2) return '';
  var best = keys.reduce(function (a, k) { return map[k] > map[a] ? k : a; }, keys[0]);
  return best === cur ? ' · 🥇 лучший месяц за год' : '';
}

// ---------- данные ----------

function obshBot() {
  var props = PropertiesService.getScriptProperties();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('_подписчики');
  var outs = {};
  if (sh && sh.getLastRow()) {
    sh.getRange(1, 2, sh.getLastRow(), 1).getValues().forEach(function (r) {
      var v = String(r[0]);
      if (v !== 'base') outs[v.slice(0, 10)] = (outs[v.slice(0, 10)] || 0) + 1;
    });
  }
  var newByDay = JSON.parse(props.getProperty('PODP_NEW') || '{}');
  var since = (props.getProperty('PODP_SINCE') || '9999').slice(0, 10);
  return {
    total: Number(props.getProperty('PODP_TOTAL') || 0),
    newByDay: newByDay,
    src: JSON.parse(props.getProperty('PODP_SRC') || '{}'),
    // новые и отписки за дни from..to; отписки известны только за полные дни после первого снимка
    per: function (from, to) {
      return { n: obshSum(newByDay, from, to), out: from > since ? obshSum(outs, from, to) : null };
    }
  };
}

/** Посты канала за days дней (по умолчанию 16) со страниц t.me/s: день, просмотры, реакции, начало текста.
 * Страницы запоминаются на 30 минут, чтобы не дёргать Telegram лишний раз. */
function obshTelegram(days) {
  days = days || 16;
  var r = { subs: 0, posts: [] };
  var opt = { muteHttpExceptions: true, headers: { 'Accept-Language': 'ru' } };
  var cache = CacheService.getScriptCache();
  var get = function (url) {
    var c = cache.get(url);
    if (c) return c;
    var t = UrlFetchApp.fetch(url, opt).getContentText();
    if (t.length < 95000) cache.put(url, t, 1800);
    return t;
  };
  try {
    var page = get('https://t.me/' + OBSH_TG);
    var m = page.match(/tgme_page_extra">([\d\s ]+)\s*(subscribers|подписчик)/);
    if (m) r.subs = Number(m[1].replace(/\D/g, ''));
    var before = '', oldest = Date.now();
    for (var i = 0; i < 10 && Date.now() - oldest < days * 864e5; i++) {
      var s = get('https://t.me/s/' + OBSH_TG + (before ? '?before=' + before : ''));
      var blocks = s.split('tgme_widget_message_wrap').slice(1);
      if (!blocks.length) break;
      blocks.forEach(function (bl) {
        var t = bl.match(/datetime="([^"]+)"/), v = bl.match(/tgme_widget_message_views">([^<]+)</);
        if (!t || !v) return;
        var when = new Date(t[1]).getTime();
        oldest = Math.min(oldest, when);
        var reac = 0;
        bl.replace(/class="tgme_reaction"[^]*?([\d.,]+K?)<\/span>/g, function (_, n) { reac += obshChislo(n); });
        var txt = (bl.match(/tgme_widget_message_text[^>]*>([^]*?)<\/div>/) || [])[1] || '';
        txt = txt.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '‹').replace(/&gt;/g, '›').replace(/\s+/g, ' ').trim();
        r.posts.push({ when: when, day: Utilities.formatDate(new Date(when), OBSH_TZ, 'yyyy-MM-dd'),
          views: obshChislo(v[1]), reactions: reac, text: txt || 'пост без текста' });
      });
      var more = s.match(/data-before="(\d+)"/);
      if (!more || more[1] === before) break;
      before = more[1];
    }
  } catch (e) { Logger.log('Telegram: ' + e); }
  return r;
}

/** Посты за k дней, закончившиеся shift дней назад: число, реакции, охват (середина просмотров, без постов моложе суток), лучший. */
function obshTgPeriod(posts, k, shift) {
  var to = Date.now() - shift * 864e5, from = to - k * 864e5;
  var p = posts.filter(function (x) { return x.when > from && x.when <= to; });
  var ripe = p.filter(function (x) { return Date.now() - x.when > 864e5; }).map(function (x) { return x.views; });
  var best = p.reduce(function (a, x) { return !a || x.views > a.views ? x : a; }, null);
  return { posts: p.length, reactions: p.reduce(function (a, x) { return a + x.reactions; }, 0),
    reach: ripe.length ? obshMed(ripe) : 0, best: best };
}

function obshYoutube() {
  var r = { subs: 0, viewsTotal: 0, new7: 0, days: [], months: [], week: null, best: null };
  try {
    var v = SpreadsheetApp.openById(OBSH_YT_TABLICA).getSheetByName('YouTube').getDataRange().getValues();
    v.forEach(function (x) {
      var k = String(x[0]);
      if (/^Подписчики/.test(k)) r.subs = Number(x[1]) || 0;
      if (/^Просмотры за всё время/.test(k)) r.viewsTotal = Number(x[1]) || 0;
      if (/^Видео за 7 дней/.test(k)) r.new7 = Number(x[1]) || 0;
      if (k === 'Неделя') r.week = { start: String(x[1]), end: String(x[2]) };
      if (r.week && k === 'Неделя: Shorts') r.week.shorts = Number(x[1]) || 0;
      if (r.week && k === 'Неделя: длинные') r.week.long = Number(x[1]) || 0;
      if (r.week && k === 'Неделя: эфиры') r.week.live = Number(x[1]) || 0;
      if (r.week && k === 'Неделя: досмотр %') r.week.avg = Number(x[1]) || 0;
      if (k === 'Неделя: лучшее видео') r.best = { title: String(x[1]), views: Number(x[2]) || 0 };
      var row = [k, Number(x[1]), Number(x[2]), Number(x[3]), Number(x[4])];
      if (/^\d{4}-\d\d-\d\d$/.test(k)) r.days.push(row);
      if (/^\d{4}-\d\d$/.test(k)) r.months.push(row);
    });
  } catch (e) { Logger.log('YouTube: ' + e); }
  return r;
}

function obshYtSum(days) {
  var r = { views: 0, min: 0, subs: 0 };
  days.forEach(function (x) { r.views += x[1]; r.min += x[2]; r.subs += x[3] - x[4]; });
  return r;
}

function obshPokupki(from, to) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Заказы');
  if (!sh || sh.getLastRow() < 2) return 0;
  var n = 0;
  sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach(function (row) {
    var d = Object.prototype.toString.call(row[0]) === '[object Date]' ? Utilities.formatDate(row[0], OBSH_TZ, 'yyyy-MM-dd') :
      String(row[0]).replace(/^(\d\d)\.(\d\d)\.(\d{4}).*/, '$3-$2-$1');
    var sum = Number(String(row[4]).replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
    if (sum && d >= from && d <= to) n++;
  });
  return n;
}

/** Скрытый лист «_аналитика»: день и цифры площадок на вечер. */
function obshIstoriya(today, vals, zapisat) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(OBSH_LIST);
  if (!sh) {
    sh = ss.insertSheet(OBSH_LIST, ss.getNumSheets());
    sh.getRange(1, 1, 1, OBSH_KEYS.length + 1).setValues([['День'].concat(OBSH_KEYS)]);
    sh.hideSheet();
  }
  var data = sh.getDataRange().getValues();
  var want = ['День'].concat(OBSH_KEYS);
  if (data[0].join() !== want.join()) {
    // добавились новые показатели: новые столбцы справа, старые на месте
    sh.getRange(1, 1, 1, want.length).setValues([want]);
    data[0] = want;
  }
  var head = data[0], hist = {};
  data.slice(1).forEach(function (row) {
    var o = {};
    head.forEach(function (h, i) { o[h] = Number(row[i]) || 0; });
    hist[String(row[0])] = o;
  });
  if (zapisat) {
    var line = [today].concat(head.slice(1).map(function (h) { return String(vals[h] || ''); }));
    var at = data.map(function (row) { return String(row[0]); }).indexOf(today);
    sh.getRange(at > 0 ? at + 1 : sh.getLastRow() + 1, 1, 1, line.length).setNumberFormat('@').setValues([line]);
  }
  return hist;
}

// ---------- мелочи ----------

function obshDay(k) { return Utilities.formatDate(new Date(Date.now() - k * 864e5), OBSH_TZ, 'yyyy-MM-dd'); }
function obshDayFrom(d, k) { return Utilities.formatDate(new Date(new Date(d + 'T12:00:00Z').getTime() + k * 864e5), 'UTC', 'yyyy-MM-dd'); }

function obshSum(map, from, to) {
  var n = 0;
  Object.keys(map).forEach(function (d) { if (d >= from && d <= to) n += Number(map[d]) || 0; });
  return n;
}

/** Разница значения между днём «a дней назад» (или now) и днём «b дней назад»; null, если истории нет. */
function obshRazn(hist, key, now, a, b) {
  var to = now !== null && a === 0 ? now : (hist[obshDay(a)] || {})[key];
  var from = (hist[obshDay(b)] || {})[key];
  return to && from ? to - from : null;
}

/** Стрелка к прошлому такому же сроку: « 🔼» / « 🔽» / ничего, если прошлого нет. */
function obshStr(now, was) {
  if (was === null || was === undefined) return '';
  return now > was ? ' 🔼' : now < was ? ' 🔽' : ' ➖';
}

/** « 🔼 (сентябрь +12)» для итогов месяца. */
function obshBylo(now, was, znak, label) {
  if (was === null || was === undefined) return '';
  return obshStr(now, was) + ' (' + label + ' ' + (znak ? obshZ(was) : obshN(was)) + ')';
}

function obshMed(arr) { var a = arr.slice().sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; }
function obshChislo(v) {
  var n = parseFloat(String(v).replace(',', '.'));
  if (/K/i.test(v)) n *= 1000;
  if (/M/i.test(v)) n *= 1e6;
  return Math.round(n) || 0;
}
function obshKor(t, n) { t = String(t); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; }
function obshTys(n) { return n >= 1000 ? String(Math.round(n / 100) / 10).replace('.', ',') + ' тыс.' : String(n); }
function obshDm(d) { return d.slice(8, 10) + '.' + d.slice(5, 7); }
function obshZ(n) { return n > 0 ? '+' + obshN(n) : n < 0 ? '-' + obshN(-n) : '0'; }
function obshN(n) { return String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
