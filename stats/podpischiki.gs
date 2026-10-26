/**
 * Сводка подписчиков бота @KaemmaBot (BotHelp) в тему «Бот» группы «Владычица НС».
 * Живёт отдельным файлом «Подписчики» в проекте Google Apps Script «Уведомления о продажах»,
 * копия кода: webapp/stats/podpischiki.gs. Функции продаж не трогает, все имена с приставкой podp.
 *
 * Каждый час тихий снимок: у BotHelp нет даты отписки, поэтому отписки считаем сами,
 * сравнивая снимки (скрытый лист «_подписчики»: id подписчика и когда впервые увидели отписку).
 * Сводка в 09:00, 15:00 и 21:00 по Москве: каждая отправка ставит разовый триггер на следующую,
 * так время точное (ежедневный триггер Google срабатывает в случайную минуту часа).
 *
 * Ключи BotHelp: Настройки проекта → Свойства скрипта, BOTHELP_CLIENT_ID и BOTHELP_CLIENT_SECRET.
 * Токен бота общий с продажами (свойство BOT_TOKEN).
 * Запустить один раз podpUstanovit(): ставит расписание, делает снимок и пробную сводку.
 */
var PODP_CHAT = '-1004351530139';
var PODP_THREAD = 216;
var PODP_SHEET = '_подписчики';
var PODP_HOURS = [9, 15, 21];
var PODP_TZ = 'Europe/Moscow';
var PODP_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function podpUstanovit() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'podpSnimok' || f === 'podpSvodka') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('podpSnimok').timeBased().everyHours(1).create();
  podpSvodka();
}

function podpSvodka() {
  try {
    podpSnimok();
    podpSend(podpTekst());
  } finally {
    podpDalshe();
  }
}

/** Разовый триггер на ближайшие 09:00, 15:00 или 21:00 по Москве (Москва всегда UTC+3). */
function podpDalshe() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'podpSvodka') ScriptApp.deleteTrigger(t);
  });
  var msk = new Date(Date.now() + 3 * 3600e3);
  for (var k = 0; k < 2; k++) {
    for (var j = 0; j < PODP_HOURS.length; j++) {
      var t = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + k, PODP_HOURS[j] - 3, 0);
      if (t > Date.now() + 5 * 60e3) {
        ScriptApp.newTrigger('podpSvodka').timeBased().at(new Date(t)).create();
        return;
      }
    }
  }
}

function podpSnimok() {
  var subs = podpBothelp();
  if (!subs.length) throw new Error('BotHelp вернул пустой список подписчиков, снимок не сохраняю');
  var props = PropertiesService.getScriptProperties();
  var now = Utilities.formatDate(new Date(), PODP_TZ, 'yyyy-MM-dd HH:mm');
  var first = !props.getProperty('PODP_SINCE');
  var sh = podpList();
  var old = {};
  if (sh.getLastRow()) {
    sh.getRange(1, 1, sh.getLastRow(), 2).getValues().forEach(function (r) { old[String(r[0])] = String(r[1]); });
  }
  var rows = [], days = {}, src = {}, total = 0;
  var cut60 = Utilities.formatDate(new Date(Date.now() - 60 * 864e5), PODP_TZ, 'yyyy-MM-dd');
  subs.forEach(function (s) {
    var d = Utilities.formatDate(podpDate(s.createdAt), PODP_TZ, 'yyyy-MM-dd');
    days[d] = (days[d] || 0) + 1;
    if (d >= cut60) {
      // откуда пришёл: метка источника на ссылке в бота (utm), для недельной аналитики
      var k = String(s.utmSource || s.utmMedium || '').trim().toLowerCase().slice(0, 20) || '?';
      src[d] = src[d] || {};
      src[d][k] = (src[d][k] || 0) + 1;
    }
    if (s.subscribed === false) {
      var id = String(s.id);
      // при самом первом снимке не знаем, когда человек отписался
      rows.push([id, old[id] || (first ? 'base' : now)]);
    } else {
      total++;
    }
  });
  sh.clearContents();
  if (rows.length) sh.getRange(1, 1, rows.length, 2).setNumberFormat('@').setValues(rows);
  // новые по дням за 400 дней: из них аналитика считает сутки, неделю, месяц и итоги месяцев
  var cut = Utilities.formatDate(new Date(Date.now() - 400 * 864e5), PODP_TZ, 'yyyy-MM-dd');
  var fresh = {};
  Object.keys(days).forEach(function (d) { if (d >= cut) fresh[d] = days[d]; });
  if (first) props.setProperty('PODP_SINCE', now);
  props.setProperties({ PODP_NEW: JSON.stringify(fresh), PODP_SRC: JSON.stringify(src), PODP_TOTAL: String(total), PODP_LAST: now });
  // страховка: если цепочка сводок оборвалась, ставим следующую
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'podpSvodka'; });
  if (!has) podpDalshe();
}

function podpTekst() {
  var props = PropertiesService.getScriptProperties();
  var news = JSON.parse(props.getProperty('PODP_NEW') || '{}');
  var since = props.getProperty('PODP_SINCE');
  var sh = podpList();
  var outs = sh.getLastRow() ? sh.getRange(1, 2, sh.getLastRow(), 1).getValues().map(function (r) { return String(r[0]); }) : [];
  var day = function (k) { return Utilities.formatDate(new Date(Date.now() - k * 864e5), PODP_TZ, 'yyyy-MM-dd'); };
  var dm = function (d) { return d.slice(8, 10) + '.' + d.slice(5, 7); };
  var partial = false;

  function line(title, d1, d2) {
    var n = 0, out = 0;
    Object.keys(news).forEach(function (d) { if (d >= d1 && d <= d2) n += news[d]; });
    outs.forEach(function (v) { if (v !== 'base' && v.slice(0, 10) >= d1 && v.slice(0, 10) <= d2) out++; });
    if (since > d1 + ' 00:00') {
      // отписки за этот период известны не полностью: считаем их только с первого снимка
      partial = true;
      return title + ': новых ' + n + ', отписались ?';
    }
    var itog = n - out;
    return title + ': новых ' + n + ', отписались ' + out + ', итог ' + (itog > 0 ? '+' + itog : String(itog));
  }

  var now = new Date();
  var today = day(0), yest = day(1), week0 = day(6);
  var rows = ['📊 Подписчики бота @KaemmaBot',
    'на ' + Utilities.formatDate(now, PODP_TZ, 'HH:mm') + ', ' + Number(Utilities.formatDate(now, PODP_TZ, 'd')) + ' ' +
      PODP_MONTHS[Number(Utilities.formatDate(now, PODP_TZ, 'M')) - 1],
    '',
    line('Сегодня', today, today),
    line('Вчера, ' + dm(yest), yest, yest),
    line('7 дней, ' + dm(week0) + '-' + dm(today), week0, today),
    '',
    'Сейчас подписаны: ' + String(props.getProperty('PODP_TOTAL') || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')];
  if (partial) rows.push('? - отписки считаю с ' + dm(since.slice(0, 10)) + ' ' + since.slice(11) + ', дальше цифры будут полными');
  return rows.join('\n');
}

function podpBothelp() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('BOTHELP_CLIENT_ID'), sec = p.getProperty('BOTHELP_CLIENT_SECRET');
  if (!id || !sec) throw new Error('Нет ключей BotHelp: Настройки проекта → Свойства скрипта, BOTHELP_CLIENT_ID и BOTHELP_CLIENT_SECRET');
  var tok = JSON.parse(podpFetch('https://oauth.bothelp.io/oauth2/token', {
    method: 'post',
    payload: { grant_type: 'client_credentials', client_id: id, client_secret: sec }
  })).access_token;
  var subs = [], after = null;
  for (var i = 0; i < 1000; i++) {
    var page = JSON.parse(podpFetch('https://api.bothelp.io/v1/subscribers/' + (after ? '?after=' + after : ''), {
      headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' }
    }));
    var data = page.data || [];
    subs = subs.concat(data);
    var nxt = page.paging && page.paging.cursor && page.paging.cursor.after;
    if (!data.length || !nxt || nxt === after) break;
    after = nxt;
    Utilities.sleep(300);
  }
  return subs;
}

function podpFetch(url, opt) {
  opt.muteHttpExceptions = true;
  for (var i = 0; i < 5; i++) {
    var r = UrlFetchApp.fetch(url, opt);
    var c = r.getResponseCode();
    if (c === 200) return r.getContentText();
    if ([429, 500, 502, 503, 504].indexOf(c) < 0 || i === 4) throw new Error('Ошибка ' + c + ' от ' + url.split('?')[0]);
    Utilities.sleep(5000 * (i + 1));
  }
}

function podpSend(text) {
  var tok = PropertiesService.getScriptProperties().getProperty('BOT_TOKEN');
  var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + tok + '/sendMessage', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ chat_id: PODP_CHAT, message_thread_id: PODP_THREAD, text: text })
  });
  if (!JSON.parse(r.getContentText()).ok) throw new Error('Telegram не принял сводку (ответ ' + r.getResponseCode() + ')');
}

function podpList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PODP_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PODP_SHEET, ss.getNumSheets()); // в конец, чтобы не сдвигать листы продаж
    sh.hideSheet();
  }
  return sh;
}

function podpDate(v) {
  v = Number(v || 0);
  return new Date(v > 1e12 ? v : v * 1000);
}
