/**
 * Аналитика каналов раз в день в тему «Аналитика» группы «Владычица НС». Продаж здесь нет, они в «доходах».
 * Живёт отдельным файлом «Общая сводка» в проекте «Уведомления о продажах» (аккаунт safalex777),
 * копия кода: webapp/stats/obshchaya-svodka.gs. Все имена с приставкой obsh, продажи и подписчиков не трогает.
 *
 * Вид: по каждой площадке сутки, неделя (с прошлой неделей для сравнения), месяц = 30 дней.
 * 3-го числа отдельным сообщением итоги прошлого месяца (к 3-му YouTube досылает статистику за конец месяца).
 *
 * Откуда цифры:
 *   бот - свойства PODP_* и лист «_подписчики» (их ведёт файл «Подписчики»), покупки - лист «Заказы»;
 *   Telegram-канал - открытые страницы t.me/Kaemma144 и t.me/s/Kaemma144;
 *   YouTube - таблица «YouTube для сводки» в аккаунте kaemma144 (открыта на чтение), её заполняет
 *     скрипт «YouTube для сводки»: общее число как в YouTube, по дням и месяцам из аналитики (с задержкой 2-3 дня).
 * Каждый вечер цифры пишутся на скрытый лист «_аналитика», по нему считаются изменения Telegram и просмотры YouTube за сутки.
 * Время: каждая отправка ставит разовый триггер на следующие 21:30 по Москве.
 * Запустить один раз obshUstanovit(). Посмотреть текст без отправки: obshProba() и obshProbaMesyac() (текст в журнале).
 */
var OBSH_CHAT = '-1004351530139';
var OBSH_THREAD = 216;
var OBSH_HOUR = 21, OBSH_MIN = 30;
var OBSH_ITOG_DAY = 3;
var OBSH_TZ = 'Europe/Moscow';
var OBSH_TG = 'Kaemma144';
var OBSH_YT_TABLICA = '1m6crZwNgZmkhJy-Q8P9bKd5-wWq7-DRaC2Kb2YJREj0';
var OBSH_LIST = '_аналитика';
var OBSH_KEYS = ['tg', 'yt', 'ytv'];
var OBSH_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
var OBSH_MONTHS_IM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function obshUstanovit() {
  obshDalshe();
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

function obshProba() { Logger.log(obshTekst(false)); }
function obshProbaMesyac() { Logger.log(obshItogi()); }

function obshSend(text) {
  var tok = PropertiesService.getScriptProperties().getProperty('BOT_TOKEN');
  var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + tok + '/sendMessage', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ chat_id: OBSH_CHAT, message_thread_id: OBSH_THREAD, text: text, parse_mode: 'HTML' })
  });
  if (!JSON.parse(r.getContentText()).ok) throw new Error('Telegram не принял аналитику (ответ ' + r.getResponseCode() + ')');
}

function obshDalshe() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'obshSvodka') ScriptApp.deleteTrigger(t);
  });
  var msk = new Date(Date.now() + 3 * 3600e3);
  for (var k = 0; k < 2; k++) {
    var t = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + k, OBSH_HOUR - 3, OBSH_MIN);
    if (t > Date.now() + 5 * 60e3) {
      ScriptApp.newTrigger('obshSvodka').timeBased().at(new Date(t)).create();
      return;
    }
  }
}

function obshDay(k) { return Utilities.formatDate(new Date(Date.now() - k * 864e5), OBSH_TZ, 'yyyy-MM-dd'); }

/** Сумма по дням из словаря {день: число} за дни с from по to включительно. */
function obshSum(map, from, to) {
  var n = 0;
  Object.keys(map).forEach(function (d) { if (d >= from && d <= to) n += Number(map[d]) || 0; });
  return n;
}

function obshDannye() {
  var props = PropertiesService.getScriptProperties();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('_подписчики');
  var outs = {};
  if (sh && sh.getLastRow()) {
    sh.getRange(1, 2, sh.getLastRow(), 1).getValues().forEach(function (r) {
      var v = String(r[0]);
      if (v !== 'base') outs[v.slice(0, 10)] = (outs[v.slice(0, 10)] || 0) + 1;
    });
  }
  return {
    botNew: JSON.parse(props.getProperty('PODP_NEW') || '{}'),
    botOut: outs,
    botSince: (props.getProperty('PODP_SINCE') || '9999').slice(0, 10),
    botTotal: Number(props.getProperty('PODP_TOTAL') || 0)
  };
}

function obshTekst(zapisat) {
  var now = new Date();
  var today = obshDay(0);
  var tg = obshTelegram();
  var yt = obshYoutube();
  var hist = obshIstoriya(today, { tg: tg.subs, yt: yt.subs, ytv: yt.viewsTotal }, zapisat);
  var d = obshDannye();
  var rows = ['📊 <b>Аналитика · ' + Number(Utilities.formatDate(now, OBSH_TZ, 'd')) + ' ' +
    OBSH_MONTHS[Number(Utilities.formatDate(now, OBSH_TZ, 'M')) - 1] + '</b>', ''];

  // бот: сутки - сегодняшний день, неделя - 7 дней по сегодня, месяц - 30 дней
  var botPer = function (k, shift) {
    var from = obshDay(k - 1 + shift), to = obshDay(shift);
    var n = obshSum(d.botNew, from, to);
    var out = from > d.botSince ? obshSum(d.botOut, from, to) : null; // отписки известны только за полные дни после первого снимка
    return { n: n, out: out };
  };
  var b1 = botPer(1, 0), b7 = botPer(7, 0), b7p = botPer(7, 7), b30 = botPer(30, 0);
  var botLine = function (p) {
    return '+' + p.n + ' новых' + (p.out === null ? '' : ', отписались ' + p.out + ' → итог ' + obshZ(p.n - p.out));
  };
  rows.push('🤖 <b>Бот</b> · подписаны ' + obshN(d.botTotal));
  rows.push('Сутки: ' + botLine(b1));
  rows.push('Неделя: ' + botLine(b7) + obshBylo(b7.n, b7p.n, false));
  rows.push('Месяц: ' + botLine(b30));
  var pok = obshPokupki(obshDay(6), today);
  if (b7.n) rows.push('🛒 Покупки за неделю: ' + pok + ' на ' + b7.n + ' новых (' + Math.round(pok / b7.n * 100) + ' %)');
  rows.push('');

  // Telegram
  rows.push('✈️ <b>Telegram</b> · ' + (tg.subs ? 'подписчики ' + obshN(tg.subs) : 'страница канала не ответила'));
  if (tg.subs) {
    var t1 = obshRazn(hist, 'tg', tg.subs, 0, 1), t7 = obshRazn(hist, 'tg', tg.subs, 0, 7);
    var t7p = obshRazn(hist, 'tg', null, 7, 14), t30 = obshRazn(hist, 'tg', tg.subs, 0, 30);
    rows.push('Сутки: ' + (t1 === null ? 'считаю с сегодня' : obshZ(t1)) + ' · постов ' + tg.posts1);
    rows.push('Неделя: ' + (t7 === null ? 'копится' : obshZ(t7) + obshBylo(t7, t7p, true)) + ' · постов ' + tg.posts7 +
      ' · охват поста ' + obshN(tg.median) + ' (' + Math.round(tg.median / tg.subs * 100) + ' %)');
    rows.push('Месяц: ' + (t30 === null ? 'копится' : obshZ(t30)));
  }
  rows.push('');

  // YouTube
  rows.push('▶️ <b>YouTube</b> · ' + (yt.subs ? 'подписчики ' + obshN(yt.subs) : 'нет доступа к таблице «YouTube для сводки»'));
  if (yt.days.length) {
    var v1 = obshRazn(hist, 'ytv', yt.viewsTotal, 0, 1);
    var last = yt.days[yt.days.length - 1];
    rows.push('Сутки: ' + (v1 !== null ? obshN(v1) + ' просмотров' :
      obshN(last[1]) + ' просм. · ' + obshZ(last[3] - last[4]) + ' подп. (за ' + obshDm(last[0]) + ')'));
    var w = obshYtSum(yt.days.slice(-7)), wp = obshYtSum(yt.days.slice(-14, -7)), m = obshYtSum(yt.days.slice(-30));
    rows.push('Неделя: ' + obshZ(w.subs) + ' подп.' + obshBylo(w.subs, wp.subs, true) + ' · ' + obshN(w.views) +
      ' просм.' + obshBylo(w.views, wp.views, false));
    rows.push('Месяц: ' + obshZ(m.subs) + ' подп. · ' + obshN(m.views) + ' просм. · ' + obshN(m.min / 60) + ' ч просмотра');
    rows.push('Видео и Shorts за неделю: ' + yt.new7);
    rows.push('<i>неделя и месяц YouTube по ' + obshDm(last[0]) + ': YouTube отдаёт статистику с задержкой</i>');
  }
  rows.push('');
  rows.push('⏳ VK, Instagram, TikTok подключаем');
  return rows.join('\n');
}

/** Итоги прошлого месяца: сравнение с позапрошлым и лучший месяц. */
function obshItogi() {
  var msk = new Date(Date.now() + 3 * 3600e3);
  var ym = function (k) {
    var t = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth() - k, 1));
    return Utilities.formatDate(t, 'UTC', 'yyyy-MM');
  };
  var name = function (s) { return OBSH_MONTHS_IM[Number(s.slice(5, 7)) - 1]; };
  var cur = ym(1), prev = ym(2);
  var d = obshDannye();
  var rows = ['🏆 <b>Итоги: ' + name(cur) + ' ' + cur.slice(0, 4) + '</b>', ''];

  // бот: новые по месяцам из истории подписок
  var botM = {};
  Object.keys(d.botNew).forEach(function (day) { botM[day.slice(0, 7)] = (botM[day.slice(0, 7)] || 0) + d.botNew[day]; });
  delete botM[ym(0)];
  rows.push('🤖 <b>Бот</b>: +' + (botM[cur] || 0) + ' новых' + obshBylo(botM[cur] || 0, botM[prev], false, name(prev)) +
    obshLuchshiy(botM, cur, 'новым в боте'));
  var outCur = obshSum(d.botOut, cur + '-01', cur + '-31');
  if (d.botSince <= cur + '-01') rows.push('   ушли за месяц: ' + outCur);

  // Telegram: разница между концом и началом месяца по истории
  var hist = obshIstoriya(obshDay(0), {}, false);
  var tgM = function (s) {
    var days = Object.keys(hist).filter(function (x) { return x.slice(0, 7) === s && hist[x].tg; }).sort();
    return days.length > 1 ? hist[days[days.length - 1]].tg - hist[days[0]].tg : null;
  };
  var tc = tgM(cur), tp = tgM(prev);
  rows.push('✈️ <b>Telegram</b>: ' + (tc === null ? 'история копится с 26 октября' : obshZ(tc) + ' подписчиков' + obshBylo(tc, tp, true, name(prev))));

  // YouTube: целые месяцы из аналитики
  var yt = obshYoutube();
  var ytS = {}, ytV = {};
  yt.months.forEach(function (x) { ytS[x[0]] = x[3] - x[4]; ytV[x[0]] = x[1]; });
  if (ytV[cur] !== undefined) {
    rows.push('▶️ <b>YouTube</b>: ' + obshZ(ytS[cur]) + ' подписчиков' + obshBylo(ytS[cur], ytS[prev], true, name(prev)));
    rows.push('   просмотры ' + obshN(ytV[cur]) + obshBylo(ytV[cur], ytV[prev], false, name(prev)) + obshLuchshiy(ytV, cur, 'просмотрам'));
  } else {
    rows.push('▶️ <b>YouTube</b>: статистика за месяц ещё не пришла');
  }
  return rows.join('\n');
}

/** «🥇 лучший месяц за год» или «лучший был …». */
function obshLuchshiy(map, cur, what) {
  // последние 12 целых месяцев, считая отчётный
  var y = Number(cur.slice(0, 4)), m = Number(cur.slice(5, 7));
  var from = (m === 12 ? y : y - 1) + '-' + ('0' + (m % 12 + 1)).slice(-2);
  var keys = Object.keys(map).filter(function (k) { return k >= from && k <= cur; });
  var best = null;
  keys.forEach(function (k) { if (best === null || map[k] > map[best]) best = k; });
  if (!best || keys.length < 2) return '';
  return best === cur ? '\n   🥇 лучший месяц за год по ' + what :
    '\n   лучший за год: ' + OBSH_MONTHS_IM[Number(best.slice(5, 7)) - 1] + ' ' + best.slice(0, 4) + ' (' + obshN(map[best]) + ')';
}

function obshYtSum(days) {
  var r = { views: 0, min: 0, subs: 0 };
  days.forEach(function (x) { r.views += x[1]; r.min += x[2]; r.subs += x[3] - x[4]; });
  return r;
}

/** « 🔼 (было 47)» для недели или « 🔼 (сентябрь +12)» для месяца; znak - писать ли плюс у прошлого числа. */
function obshBylo(now, was, znak, label) {
  if (was === null || was === undefined) return '';
  var arrow = now > was ? ' 🔼' : now < was ? ' 🔽' : ' ➖';
  return arrow + ' (' + (label || 'было') + ' ' + (znak ? obshZ(was) : obshN(was)) + ')';
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

function obshTelegram() {
  var r = { subs: 0, median: 0, posts1: 0, posts7: 0 };
  var opt = { muteHttpExceptions: true, headers: { 'Accept-Language': 'ru' } };
  try {
    var page = UrlFetchApp.fetch('https://t.me/' + OBSH_TG, opt).getContentText();
    var m = page.match(/tgme_page_extra">([\d\s ]+)\s*(subscribers|подписчик)/);
    if (m) r.subs = Number(m[1].replace(/\D/g, ''));
    var s = UrlFetchApp.fetch('https://t.me/s/' + OBSH_TG, opt).getContentText();
    var views = [];
    s.replace(/tgme_widget_message_views">([^<]+)</g, function (_, v) {
      var n = parseFloat(v.replace(',', '.'));
      if (/K/i.test(v)) n *= 1000;
      if (/M/i.test(v)) n *= 1e6;
      views.push(Math.round(n));
    });
    var last = views.slice(-10).sort(function (a, b) { return a - b; });
    if (last.length) r.median = last[Math.floor(last.length / 2)];
    s.replace(/<time datetime="([^"]+)"/g, function (_, t) {
      var age = Date.now() - new Date(t).getTime();
      if (age < 864e5) r.posts1++;
      if (age < 7 * 864e5) r.posts7++;
    });
  } catch (e) { Logger.log('Telegram: ' + e); }
  return r;
}

function obshYoutube() {
  var r = { subs: 0, viewsTotal: 0, new7: 0, days: [], months: [] };
  try {
    var v = SpreadsheetApp.openById(OBSH_YT_TABLICA).getSheetByName('YouTube').getDataRange().getValues();
    v.forEach(function (x) {
      var k = String(x[0]);
      if (/^Подписчики/.test(k)) r.subs = Number(x[1]) || 0;
      if (/^Просмотры за всё время/.test(k)) r.viewsTotal = Number(x[1]) || 0;
      if (/^Видео за 7 дней/.test(k)) r.new7 = Number(x[1]) || 0;
      var row = [k, Number(x[1]), Number(x[2]), Number(x[3]), Number(x[4])];
      if (/^\d{4}-\d\d-\d\d$/.test(k)) r.days.push(row);
      if (/^\d{4}-\d\d$/.test(k)) r.months.push(row);
    });
  } catch (e) { Logger.log('YouTube: ' + e); }
  return r;
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

/** Разница значения между днём «a дней назад» (или now) и днём «b дней назад»; null, если истории нет. */
function obshRazn(hist, key, now, a, b) {
  var to = now !== null && a === 0 ? now : (hist[obshDay(a)] || {})[key];
  var from = (hist[obshDay(b)] || {})[key];
  return to && from ? to - from : null;
}

function obshDm(d) { return d.slice(8, 10) + '.' + d.slice(5, 7); }
function obshZ(n) { return n > 0 ? '+' + obshN(n) : n < 0 ? '-' + obshN(-n) : '0'; }
function obshN(n) { return String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
