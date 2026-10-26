/**
 * YouTube для общей сводки: точные цифры канала «ДНК Код Красоты и Молодости» (владелец kaemma144@gmail.com).
 * Живёт отдельным проектом Apps Script «YouTube для сводки» в аккаунте kaemma144, копия: webapp/stats/youtube-dlya-svodki.gs.
 * Пишет в таблицу «YouTube для сводки» (тоже kaemma144).
 * Каждые 3 часа пишет цифры на лист «YouTube». Общую сводку собирает скрипт «Уведомления о продажах»
 * (аккаунт safalex777), он читает этот лист: таблица открыта ему на просмотр.
 *
 * Общее число подписчиков берём как показывает YouTube (оно же в Studio). Сумма «подписались минус отписались
 * за всё время» не годится: не учитывает удалённые аккаунты и последние дни. Аналитика по дням идёт с задержкой 2-3 дня.
 * Сервисы проекта: YouTube Data API v3 (YouTube) и YouTube Analytics API (YouTubeAnalytics).
 * Запустить один раз ytUstanovit().
 */
var YT_TZ = 'Europe/Moscow';
var YT_TABLICA = '1m6crZwNgZmkhJy-Q8P9bKd5-wWq7-DRaC2Kb2YJREj0';

function ytUstanovit() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'ytSobrat') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('ytSobrat').timeBased().everyHours(3).create();
  ytSobrat();
}

function ytSobrat() {
  var ch = YouTube.Channels.list('statistics,snippet,contentDetails', { mine: true }).items[0];
  // сколько видео вышло за 7 дней: последние 50 загрузок канала
  var uploads = YouTube.PlaylistItems.list('contentDetails', {
    playlistId: ch.contentDetails.relatedPlaylists.uploads, maxResults: 50 }).items || [];
  var new7 = uploads.filter(function (i) {
    return Date.now() - new Date(i.contentDetails.videoPublishedAt).getTime() < 7 * 864e5;
  }).length;
  var day = function (k) { return Utilities.formatDate(new Date(Date.now() - k * 864e5), YT_TZ, 'yyyy-MM-dd'); };
  var query = function (start, end, dims) {
    var p = { ids: 'channel==MINE', startDate: start, endDate: end,
      metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost' };
    if (dims) { p.dimensions = dims; p.sort = dims; }
    return YouTubeAnalytics.Reports.query(p).rows || [];
  };
  var rows = query(day(75), day(0), 'day'); // 75 дней: месяц и прошлые 30 дней для сравнения
  var m0 = new Date(Date.now() + 3 * 3600e3);
  // по месяцам YouTube отдаёт только целые месяцы, обе даты - первые числа: год назад ... прошлый месяц
  var months = query(Utilities.formatDate(new Date(Date.UTC(m0.getUTCFullYear() - 1, m0.getUTCMonth(), 1)), 'UTC', 'yyyy-MM-dd'),
    Utilities.formatDate(new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() - 1, 1)), 'UTC', 'yyyy-MM-dd'), 'month');
  var ss = SpreadsheetApp.openById(YT_TABLICA);
  var sh = ss.getSheetByName('YouTube') || ss.insertSheet('YouTube');
  var out = [
    ['Обновлено', Utilities.formatDate(new Date(), YT_TZ, 'yyyy-MM-dd HH:mm'), '', '', ''],
    ['Канал', ch.snippet.title, '', '', ''],
    ['Подписчики (как показывает YouTube)', Number(ch.statistics.subscriberCount), '', '', ''],
    ['Просмотры за всё время', Number(ch.statistics.viewCount), '', '', ''],
    ['Видео на канале', Number(ch.statistics.videoCount), '', '', ''],
    ['Видео за 7 дней', new7, '', '', ''],
    ['', '', '', '', ''],
    ['День', 'Просмотры', 'Минуты просмотра', 'Подписались', 'Отписались']
  ];
  rows.forEach(function (r) { out.push([String(r[0]), r[1], r[2], r[3], r[4]]); });
  out.push(['', '', '', '', '']);
  out.push(['Месяц', 'Просмотры', 'Минуты просмотра', 'Подписались', 'Отписались']);
  months.forEach(function (r) { out.push([String(r[0]), r[1], r[2], r[3], r[4]]); });
  sh.clearContents();
  sh.getRange(1, 1, out.length, 1).setNumberFormat('@');
  sh.getRange(1, 2).setNumberFormat('@');
  sh.getRange(1, 1, out.length, 5).setValues(out);
}

/** Только чтобы выдать разрешения обычной страницей (окно разрешений в Chrome открывалось пустым). */
function doGet() {
  ytSobrat();
  return ContentService.createTextOutput('YouTube для сводки: доступ выдан, цифры записаны в таблицу.');
}
