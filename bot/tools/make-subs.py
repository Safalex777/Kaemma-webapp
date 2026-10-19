# Субтитры подарка: куски расшифровки whisper (формат Remotion Caption, по 5 минут) -> фразы для плеера.
# python3 tools/make-subs.py <папка с c00.json..c11.json> <правки.tsv или -> v/gift-subs.json <фразы.txt>
# Фраза в выходе: [начало мс, конец мс, [[слово, начало мс], ...]].
# Разрыв фразы: конец предложения, пауза > 0,7 с, длина > 70 знаков (или > 45 после запятой).
# Правки: «номер<TAB>исправленный текст фразы». Если число слов совпало, время слов сохраняется,
# иначе время раскладывается по фразе пропорционально длине слов.
import json, re, sys, os, glob

src, fixf, out, txt = sys.argv[1:5]
CHUNK = 300000
words = []
for f in sorted(glob.glob(os.path.join(src, 'c*.json'))):
    off = int(re.search(r'c(\d+)\.json$', f).group(1)) * CHUNK
    for c in json.load(open(f)):
        t = c['text'].strip().replace('—', '-').replace('–', '-')
        if not t:
            continue
        if t.startswith('-') and len(t) > 1 and words and not c['text'].startswith(' -'):
            words[-1][0] += t; words[-1][2] = int(c['endMs']) + off
        elif t.startswith('-') and len(t) > 1 and words and re.match(r'-(то|либо|нибудь|таки|ка|клетк|клетка|клеткой|клетку)', t):
            words[-1][0] += t; words[-1][2] = int(c['endMs']) + off
        else:
            words.append([t, int(c['startMs']) + off, int(c['endMs']) + off])

phrases, cur = [], []
def flush():
    if cur:
        phrases.append([cur[0][1], cur[-1][2], [[w[0], w[1]] for w in cur]])
        cur.clear()
for i, w in enumerate(words):
    cur.append(w)
    nxt = words[i + 1] if i + 1 < len(words) else None
    text = ' '.join(x[0] for x in cur)
    gap = (nxt[1] - w[2]) if nxt else 9999
    if re.search(r'[.!?…]$', w[0]) or gap > 700 or len(text) > 75 or (len(text) > 40 and w[0].endswith(',')):
        flush()
flush()
# короткий обрывок (до 12 знаков) присоединить к предыдущей фразе, если она не кончилась точкой и вместе не длиннее 90
merged = []
for p in phrases:
    t = ' '.join(x[0] for x in p[2])
    if merged and len(t) <= 12:
        q = merged[-1]; qt = ' '.join(x[0] for x in q[2])
        if not re.search(r'[.!?…]$', qt) and len(qt) + len(t) < 90:
            q[1] = p[1]; q[2] += p[2]; continue
    merged.append(p)
phrases = merged

fixes = {}
if fixf != '-' and os.path.exists(fixf):
    for line in open(fixf):
        if '\t' in line:
            n, t = line.rstrip('\n').split('\t', 1)
            fixes[int(n)] = t.strip()
for n, t in fixes.items():
    if n >= len(phrases):
        continue
    p = phrases[n]
    new = t.split()
    if not new:
        p[2] = []
        continue
    if len(new) == len(p[2]):
        p[2] = [[nw, ow[1]] for nw, ow in zip(new, p[2])]
    else:
        total = sum(len(x) + 1 for x in new)
        acc, res = 0, []
        for x in new:
            res.append([x, int(p[0] + (p[1] - p[0]) * acc / total)])
            acc += len(x) + 1
        p[2] = res
phrases = [p for p in phrases if p[2]]
# длинную фразу (больше 60 знаков) с несколькими предложениями разбить по концам предложений
split = []
for p in phrases:
    t = ' '.join(x[0] for x in p[2])
    if len(t) <= 60:
        split.append(p); continue
    parts, cur2 = [], []
    for k, w in enumerate(p[2]):
        cur2.append(w)
        rest = p[2][k + 1:]
        if re.search(r'[.!?…]$', w[0]) and rest and len(' '.join(x[0] for x in cur2)) >= 12:
            parts.append(cur2); cur2 = []
    if cur2: parts.append(cur2)
    for j, ws in enumerate(parts):
        end = parts[j + 1][0][1] if j + 1 < len(parts) else p[1]
        split.append([ws[0][1], end, ws])
phrases = split
# заглавная буква только в начале предложения
prev_end = True
for p in phrases:
    w = p[2][0][0]
    if prev_end:
        p[2][0][0] = w[:1].upper() + w[1:]
    elif w[:1].isupper() and not re.match(r'(Я|Каэмм|ЭльЛит|Бог|Вселенн|Мир)', w):
        p[2][0][0] = w[:1].lower() + w[1:]
    prev_end = bool(re.search(r'[.!?…:]$', p[2][-1][0]))

json.dump(phrases, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
with open(txt, 'w') as f:
    for i, p in enumerate(phrases):
        f.write('%d\t%d:%02d\t%s\n' % (i, p[0] // 60000, p[0] // 1000 % 60, ' '.join(x[0] for x in p[2])))
full = ' '.join(' '.join(x[0] for x in p[2]) for p in phrases)
print('фраз:', len(phrases), 'слов:', len(words), 'конец, мин:', round(phrases[-1][1] / 60000, 1) if phrases else 0, 'правок:', len(fixes))
CLOSED = ['манас', 'кенас', 'анзус', 'гебо', 'руна', 'руны', 'чакр', 'аджна', 'вишудх', 'сахасрар', 'шишковид', 'ананда', 'корона всемогущества', 'совершенный двойник', 'дух']
low = full.lower()
for k in CLOSED:
    n = len(re.findall(r'(?<![а-яё])' + k, low))
    if n:
        print('  закрытое слово:', k, n, 'раз')
