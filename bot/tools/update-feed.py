"""Собирает bot/feed.json: свежие видео YouTube-канала и видео-посты Telegram-канала Каэммы.
Запускается каждый день из .github/workflows/daily.yml, можно и руками: python3 bot/tools/update-feed.py
YouTube: RSS канала, Shorts пропускаем. Telegram: публичная лента t.me/s, видео от 10 минут (клипы не берём).
Обложки сохраняются в v/yt/<id>.jpg и v/tg/<номер>.jpg. Если площадка не ответила, старые записи остаются."""
import datetime, html, json, pathlib, re, urllib.error, urllib.request

D = pathlib.Path(__file__).resolve().parent.parent
FEED = D / 'feed.json'
YT_CHANNEL = 'UC13b2gT33MFeIK6W4nM1cbQ'
TG_CHANNEL = 'Kaemma144'
TG_MIN_SEC = 10 * 60
KEEP = 40
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      'Accept-Language': 'ru'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def is_short(vid):
    """True - Shorts, False - обычное видео, None - YouTube ответил непонятно."""
    try:
        r = urllib.request.build_opener(NoRedirect).open(
            urllib.request.Request('https://www.youtube.com/shorts/' + vid, headers=UA, method='HEAD'), timeout=20)
        return r.status == 200
    except urllib.error.HTTPError as e:
        return False if e.code in (301, 302, 303) else None
    except Exception:
        return None


def save_img(url, name):
    f = D / 'v' / name
    if f.exists():
        return True
    try:
        f.write_bytes(get(url))
        return True
    except Exception:
        return False


def youtube(known):
    xml = get('https://www.youtube.com/feeds/videos.xml?channel_id=' + YT_CHANNEL).decode()
    out = []
    for e in xml.split('<entry>')[1:]:
        vid = re.search(r'<yt:videoId>([^<]+)', e).group(1)
        if 'y:' + vid in known:
            out.append(known['y:' + vid])
            continue
        if is_short(vid) is not False:
            continue
        title = html.unescape(re.search(r'<title>([^<]*)', e).group(1)).strip()
        day = re.search(r'<published>([^<]+)', e).group(1)[:10]
        if not (save_img(f'https://i.ytimg.com/vi/{vid}/sddefault.jpg', f'yt/{vid}.jpg')
                or save_img(f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg', f'yt/{vid}.jpg')):
            continue
        out.append({'k': 'y', 'id': vid, 't': title, 'd': day})
    return out


def tg_title(raw):
    txt = re.sub(r'<br\s*/?>', '\n', raw)
    txt = html.unescape(re.sub(r'<[^>]+>', '', txt))
    for line in txt.split('\n'):
        line = re.sub(r'[^\w\s«».,!?:;()\'"-]', '', line).strip(' -')
        if len(line) >= 8:
            return line if len(line) <= 90 else line[:88].rsplit(' ', 1)[0] + '…'
    return ''


def telegram(known):
    page = get('https://t.me/s/' + TG_CHANNEL).decode()
    out = []
    for p in page.split('<div class="tgme_widget_message_wrap')[1:]:
        m = re.search(r'data-post="' + TG_CHANNEL + r'/(\d+)"', p)
        dur = re.search(r'message_video_duration[^>]*>(\d+(?::\d+)+)<', p)
        if not m or not dur:
            continue
        num = m.group(1)
        if 't:' + num in known:
            out.append(known['t:' + num])
            continue
        sec = 0
        for x in dur.group(1).split(':'):
            sec = sec * 60 + int(x)
        thumb = re.search(r"message_video_thumb\"[^>]*background-image:url\('([^']+)'", p)
        text = re.search(r'tgme_widget_message_text[^>]*>(.*?)</div>', p, re.S)
        title = tg_title(text.group(1)) if text else ''
        if sec < TG_MIN_SEC or not thumb or not title or not save_img(thumb.group(1), f'tg/{num}.jpg'):
            continue
        day = re.search(r'datetime="([^"]+)"', p).group(1)[:10]
        out.append({'k': 't', 'id': num, 't': title, 'd': day, 'min': round(sec / 60)})
    return out


old = json.loads(FEED.read_text()) if FEED.exists() else {'items': []}
known = {i['k'] + ':' + str(i['id']): i for i in old['items']}
items = dict(known)
for name, fn in (('YouTube', youtube), ('Telegram', telegram)):
    try:
        got = fn(known)
        items.update({i['k'] + ':' + str(i['id']): i for i in got})
        print(name, 'видео в ленте:', len(got))
    except Exception as e:
        print(name, 'не ответил, оставляю старое:', e)
new = sorted(items.values(), key=lambda i: (i['d'], str(i['id'])), reverse=True)[:KEEP]
if new != old['items']:
    FEED.write_text(json.dumps({'updated': datetime.date.today().isoformat(), 'items': new},
                               ensure_ascii=False, indent=1) + '\n')
    print('feed.json обновлён:', len(new), 'видео')
else:
    print('Новых видео нет')
