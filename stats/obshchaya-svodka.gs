/**
 * Аналитика каналов раз в день в тему «Аналитика» группы «Владычица НС». Продаж здесь нет, они в «доходах».
 * Живёт отдельным файлом «Общая сводка» в проекте «Уведомления о продажах» (аккаунт safalex777),
 * копия кода: webapp/stats/obshchaya-svodka.gs. Все имена с приставкой obsh, продажи и подписчиков не трогает.
 *
 * Откуда цифры:
 *   бот - свойства PODP_* и лист «_подписчики» (их ведёт файл «Подписчики»), покупки - лист «Заказы»;
 *   Telegram-канал - открытые страницы t.me/Kaemma144 и t.me/s/Kaemma144;
 *   YouTube - таблица «YouTube для сводки» в аккаунте kaemma144 (открыта на чтение), её заполняет
 *     скрипт «YouTube для сводки»: общее число как в YouTube, по дням из аналитики (с задержкой 2-3 дня).
 * Каждый вечер цифры пишутся на скрытый лист «_аналитика», по нему считаются изменения за сутки, 7 и 30 дней.
 * Время: каждая отправка ставит разовый триггер на следующие 21:30 по Москве.
 * Запустить один раз obshUstanovit(). Посмотреть текст без отправки: obshProba() (текст в журнале).
 */
var OBSH_CHAT = '-1004351530139';
var OBSH_THREAD = 216;
var OBSH_HOUR = 21, OBSH_MIN = 30;
var OBSH_TZ = 'Europe/Moscow';
var OBSH_TG = 'Kaemma144';
var OBSH_YT_TABLICA = '1m6crZwNgZmkhJy-Q8P9bKd5-wWq7-DRaC2Kb2YJREj0';
var OBSH_LIST = '_аналитика';
var OBSH_KEYS = ['tg', 'yt', 'ytv'];
var OBSH_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function obshUstanovit() {
  obshDalshe();
  obshProba();
}

function obshSvodka() {
  try {
    var tok = PropertiesService.getScriptProperties().getProperty('BOT_TOKEN');
    var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + tok + '/sendMessage', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ chat_id: OBSH_CHAT, message_thread_id: OBSH_THREAD, text: obshTekst(true) })
    });
    if (!JSON.parse(r.getContentText()).ok) throw new Error('Telegram не принял аналитику (ответ ' + r.getResponseCode() + ')');
  } finally {
    obshDalshe();
  }
}

function obshProba() {
  Logger.log(obshTekst(false));
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

function obshTekst(zapisat) {
  var now = new Date();
  var today = obshDay(0);
  var tg = obshTelegram();
  var yt = obshYoutube();
  var hist = obshIstoriya(today, { tg: tg.subs, yt: yt.subs, ytv: yt.viewsTotal }, zapisat);
  var rows = ['📊 Аналитика каналов · ' + Number(Utilities.formatDate(now, OBSH_TZ, 'd')) + ' ' +
    OBSH_MONTHS[Number(Utilities.formatDate(now, OBSH_TZ, 'M')) - 1], ''];

  // бот
  var props = PropertiesService.getScriptProperties();
  var news = JSON.parse(props.getProperty('PODP_NEW') || '{}');
  var since = props.getProperty('PODP_SINCE') || today;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('_подписчики');
  var outs = sh && sh.getLastRow() ? sh.getRange(1, 2, sh.getLastRow(), 1).getValues().map(function (r) { return String(r[0]); }) : [];
  var botNew = function (k) {
    var n = 0, from = obshDay(k - 1);
    Object.keys(news).forEach(function (d) { if (d >= from && d <= today) n += news[d]; });
    return n;
  };
  var botOut = function (k) {
    var from = obshDay(k - 1);
    if (since > from + ' 00:00') return null; // отписки считаем только с первого снимка
    return outs.filter(function (v) { return v !== 'base' && v.slice(0, 10) >= from && v.slice(0, 10) <= today; }).length;
  };
  var pok = obshPokupki(obshDay(6), today);
  rows.push('🤖 Бот @KaemmaBot');
  rows.push('👥 Подписаны: ' + obshN(props.getProperty('PODP_TOTAL') || 0));
  rows.push('🟢 Новые: ' + obshTri(function (k) { return botNew(k); }, true));
  rows.push('🔴 Отписались: ' + obshTri(function (k) { return botOut(k); }, false));
  if (botNew(7)) {
    rows.push('🛒 Покупки к новым за 7 дн.: ' + pok + ' из ' + botNew(7) + ' · ' +
      String(Math.round(pok / botNew(7) * 1000) / 10).replace('.', ',') + ' %');
  }
  rows.push('');

  // Telegram
  rows.push('✈️ Telegram-канал');
  if (tg.subs) {
    rows.push('👥 Подписчики: ' + obshN(tg.subs));
    rows.push('📈 Прирост: ' + obshTri(function (k) { return obshRazn(hist, 'tg', tg.subs, k); }, true));
    if (tg.median) rows.push('👁 Охват поста: ' + obshN(tg.median) + ' · ' + Math.round(tg.median / tg.subs * 100) + ' % подписчиков');
    rows.push('📝 Постов: сутки ' + tg.posts1 + ' · 7 дн. ' + tg.posts7);
  } else {
    rows.push('⚠️ страница канала не ответила');
  }
  rows.push('');

  // YouTube
  rows.push('▶️ YouTube');
  if (yt.subs) {
    rows.push('👥 Подписчики: ' + obshN(yt.subs));
    rows.push('📈 Прирост: 7 дн. ' + obshZnak(yt.gain7 - yt.lost7) + ' (+' + yt.gain7 + ' / -' + yt.lost7 + ')' +
      ' · 28 дн. ' + obshZnak(yt.gain28 - yt.lost28));
    var v1 = obshRazn(hist, 'ytv', yt.viewsTotal, 1);
    rows.push('👁 Просмотры: ' + (v1 === null ? '' : 'сутки ' + obshN(v1) + ' · ') + '7 дн. ' + obshN(yt.views7) +
      ' · 28 дн. ' + obshN(yt.views28));
    rows.push('⏱ Часы просмотра: 7 дн. ' + obshN(yt.min7 / 60) + ' · 28 дн. ' + obshN(yt.min28 / 60));
    rows.push('🎬 Новых видео и Shorts за 7 дн.: ' + yt.new7);
    if (yt.last) rows.push('ℹ️ YouTube отдаёт статистику с задержкой, последний день ' + yt.last.slice(8, 10) + '.' + yt.last.slice(5, 7));
  } else {
    rows.push('⚠️ нет доступа к таблице «YouTube для сводки»');
  }
  rows.push('');
  rows.push('⏳ VK, Instagram, TikTok подключаем');
  return rows.join('\n');
}

/** «сутки … · 7 дн. … · 30 дн. …»; значение null - данных пока нет. */
function obshTri(f, plus) {
  var parts = [], wait = false;
  [[1, 'сутки'], [7, '7 дн.'], [30, '30 дн.']].forEach(function (p) {
    var v = f(p[0]);
    if (v === null || v === undefined) { wait = true; return; }
    parts.push(p[1] + ' ' + (plus ? obshZnak(v) : String(v)));
  });
  if (!parts.length) return 'считаю с сегодня, цифры появятся завтра';
  return parts.join(' · ') + (wait ? ' (дальше копится)' : '');
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
  var r = { subs: 0, viewsTotal: 0, new7: 0, last: '', gain7: 0, lost7: 0, gain28: 0, lost28: 0, views7: 0, views28: 0, min7: 0, min28: 0 };
  try {
    var v = SpreadsheetApp.openById(OBSH_YT_TABLICA).getSheetByName('YouTube').getDataRange().getValues();
    v.forEach(function (x) {
      var k = String(x[0]);
      if (/^Подписчики/.test(k)) r.subs = Number(x[1]) || 0;
      if (/^Просмотры за всё время/.test(k)) r.viewsTotal = Number(x[1]) || 0;
      if (/^Видео за 7 дней/.test(k)) r.new7 = Number(x[1]) || 0;
    });
    var days = v.filter(function (x) { return /^\d{4}-\d\d-\d\d$/.test(String(x[0])); });
    if (days.length) {
      r.last = String(days[days.length - 1][0]);
      days.slice(-7).forEach(function (x) { r.views7 += Number(x[1]); r.min7 += Number(x[2]); r.gain7 += Number(x[3]); r.lost7 += Number(x[4]); });
      days.slice(-28).forEach(function (x) { r.views28 += Number(x[1]); r.min28 += Number(x[2]); r.gain28 += Number(x[3]); r.lost28 += Number(x[4]); });
    }
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

/** Изменение за k дней по истории или null, если той даты ещё нет. */
function obshRazn(hist, key, now, k) {
  var past = hist[obshDay(k)];
  return past && past[key] && now ? now - past[key] : null;
}

function obshZnak(n) { return n > 0 ? '✅ +' + obshN(n) : n < 0 ? '🔻 -' + obshN(-n) : '➖ 0'; }
function obshN(n) { return String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
