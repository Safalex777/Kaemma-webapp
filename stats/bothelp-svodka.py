"""Сводка по подписчикам бота @KaemmaBot (BotHelp) в рабочую Telegram-группу.
Запускается из .github/workflows/bothelp-svodka.yml: каждый час тихий снимок, в 09:00, 15:00 и 21:00 по Москве отправка.
Руками: python3 stats/bothelp-svodka.py snapshot | send | dry

Откуда цифры: официальный API BotHelp (GET /v1/subscribers). У подписчика есть дата подписки (createdAt)
и признак subscribed, а даты отписки нет. Поэтому отписки считаем сами: каждый час сравниваем снимок
с прошлым и записываем, когда человек впервые стал «отписан». Снимок лежит в кэше GitHub Actions
(файл STATE), в репозиторий и в логи имена и id подписчиков не попадают: репозиторий открытый.

Ключи только в секретах GitHub: BOTHELP_CLIENT_ID, BOTHELP_CLIENT_SECRET (BotHelp → Профиль → Интеграции),
TG_BOT_TOKEN (бот, который пишет в группу), TG_CHAT_ID (необязательно: если пусто, группа находится сама,
когда бота добавили в группу и написали там любое сообщение)."""
import datetime, hashlib, json, os, pathlib, sys, time, urllib.error, urllib.parse, urllib.request

STATE = pathlib.Path(os.environ.get('STATE_FILE', pathlib.Path(__file__).resolve().parent / 'state' / 'bothelp-state.json'))
MSK = datetime.timezone(datetime.timedelta(hours=3))
# BotHelp отвечает 403 на запросы с подписью Python-urllib, поэтому своя подпись
UA = 'Mozilla/5.0 (kaemma-svodka)'
# тема «Бот» в рабочей группе «Владычица НС» (Саша, 26.10); TG_THREAD_ID в секретах может её заменить
THREAD = os.environ.get('TG_THREAD_ID') or '216'
MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']


def http(url, data=None, headers=None, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={'User-Agent': UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(5 * (i + 1))
                continue
            raise SystemExit('Ошибка %s от %s' % (e.code, url.split('?')[0]))
        except urllib.error.URLError:
            if i < tries - 1:
                time.sleep(5 * (i + 1))
                continue
            raise


def bothelp_subscribers():
    form = urllib.parse.urlencode({'grant_type': 'client_credentials',
                                   'client_id': os.environ['BOTHELP_CLIENT_ID'],
                                   'client_secret': os.environ['BOTHELP_CLIENT_SECRET']}).encode()
    tok = http('https://oauth.bothelp.io/oauth2/token', form,
               {'Content-Type': 'application/x-www-form-urlencoded'})['access_token']
    hdr = {'Authorization': 'Bearer ' + tok, 'Accept': 'application/json'}
    subs, after = [], None
    while True:
        url = 'https://api.bothelp.io/v1/subscribers/' + ('?after=%d' % after if after else '')
        page = http(url, headers=hdr)
        data = page.get('data') or []
        subs += data
        nxt = ((page.get('paging') or {}).get('cursor') or {}).get('after')
        if not data or not nxt or nxt == after:
            return subs
        after = nxt
        time.sleep(0.3)


def ts(v):
    v = int(v or 0)
    return datetime.datetime.fromtimestamp(v / 1000 if v > 10 ** 12 else v, MSK)


def key(sid):
    return hashlib.sha256(('kaemma-bh-%s' % sid).encode()).hexdigest()[:16]


def snapshot(state, now):
    subs = bothelp_subscribers()
    if not subs:
        raise SystemExit('BotHelp вернул пустой список подписчиков, снимок не сохраняю')
    first = 'since' not in state
    unsub = state.setdefault('unsub', {})
    now_s = now.strftime('%Y-%m-%d %H:%M')
    gone = set()
    for s in subs:
        k = key(s.get('id'))
        if s.get('subscribed') is False:
            gone.add(k)
            if k not in unsub:
                # при самом первом снимке не знаем, когда человек отписался
                unsub[k] = 'base' if first else now_s
    for k in [k for k in unsub if k not in gone]:
        del unsub[k]  # вернулся в бота
    state.setdefault('since', now_s)
    state['last'] = now_s
    # новые по дням: дата подписки есть у каждого, храним готовые счётчики за 40 дней
    days = {}
    for s in subs:
        d = ts(s.get('createdAt')).strftime('%Y-%m-%d')
        days[d] = days.get(d, 0) + 1
    cut = (now - datetime.timedelta(days=40)).strftime('%Y-%m-%d')
    state['new'] = {d: n for d, n in days.items() if d >= cut}
    state['total'] = sum(1 for s in subs if s.get('subscribed') is not False)
    return len(subs)


def count(state, d1, d2):
    """Новые и отписки за дни d1..d2 включительно (строки YYYY-MM-DD)."""
    new = sum(n for d, n in state.get('new', {}).items() if d1 <= d <= d2)
    out = sum(1 for v in state.get('unsub', {}).values() if v != 'base' and d1 <= v[:10] <= d2)
    return new, out


def dm(d):
    return d.strftime('%d.%m')


def text(state, now):
    today = now.date()
    yest = today - datetime.timedelta(days=1)
    week0 = today - datetime.timedelta(days=6)
    since = datetime.datetime.strptime(state['since'], '%Y-%m-%d %H:%M').replace(tzinfo=MSK)

    def line(title, d1, d2):
        new, out = count(state, d1.isoformat(), d2.isoformat())
        s = '%s: новых %d, отписались %d, итог %+d' % (title, new, out, new - out)
        if since > datetime.datetime.combine(d1, datetime.time(), MSK):
            s += ' (отписки с %s %s)' % (dm(since), since.strftime('%H:%M'))
        return s.replace('итог +0', 'итог 0')

    rows = ['📊 Подписчики бота @KaemmaBot',
            'на %s, %d %s' % (now.strftime('%H:%M'), now.day, MONTHS[now.month - 1]),
            '',
            line('Сегодня', today, today),
            line('Вчера, %s' % dm(yest), yest, yest),
            line('7 дней, %s-%s' % (dm(week0), dm(today)), week0, today),
            '',
            'Сейчас подписаны: %s' % format(state.get('total', 0), ',').replace(',', ' ')]
    return '\n'.join(rows)


def tg_chat(state):
    if os.environ.get('TG_CHAT_ID'):
        return os.environ['TG_CHAT_ID']
    if state.get('chat_id'):
        return state['chat_id']
    try:
        req = urllib.request.Request('https://api.telegram.org/bot%s/getUpdates' % os.environ['TG_BOT_TOKEN'])
        with urllib.request.urlopen(req, timeout=60) as r:
            upd = json.loads(r.read())
    except urllib.error.HTTPError:
        # у бота включён вебхук (им пользуется другой сервис): группу сам не найти
        raise SystemExit('Не могу найти группу сам: впишите номер группы в секрет TG_CHAT_ID')
    for u in reversed(upd.get('result', [])):
        for f in ('message', 'my_chat_member', 'channel_post'):
            chat = (u.get(f) or {}).get('chat') or {}
            if chat.get('type') in ('group', 'supergroup'):
                state['chat_id'] = chat['id']
                print('Группа найдена')
                return chat['id']
    raise SystemExit('Группа не найдена: добавьте бота в рабочую группу и напишите там любое сообщение')


def send(state, msg):
    body = json.dumps({'chat_id': tg_chat(state), 'message_thread_id': int(THREAD), 'text': msg}).encode()
    r = http('https://api.telegram.org/bot%s/sendMessage' % os.environ['TG_BOT_TOKEN'], body,
             {'Content-Type': 'application/json'})
    if not r.get('ok'):
        raise SystemExit('Telegram не принял сообщение')
    print('Сводка отправлена')


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'snapshot'
    now = datetime.datetime.now(MSK)
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    n = snapshot(state, now)
    save(state)
    print('Снимок: %d подписчиков в выгрузке, отписок с датой %d' %
          (n, sum(1 for v in state['unsub'].values() if v != 'base')))
    msg = text(state, now)
    if mode == 'send':
        send(state, msg)
    elif mode == 'dry':
        print(msg)
    save(state)


def save(state):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, ensure_ascii=False))


if __name__ == '__main__':
    main()
