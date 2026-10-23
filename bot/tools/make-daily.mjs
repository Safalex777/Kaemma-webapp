// Собирает bot/daily.json: на каждый день слова Каэммы и практику дня из библиотеки приложения.
// Запуск: node bot/tools/make-daily.mjs [первый день ГГГГ-ММ-ДД] [сколько дней]
// Тема дня по дню недели, видео внутри темы берётся то, что реже всего было практикой дня.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const dir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(dir, 'app-src.html'), 'utf8');
const lib = {};
vm.runInNewContext(src.slice(src.indexOf('var KP='), src.indexOf('var BYKEY=')), lib);
const topics = Object.fromEntries(lib.T.map(t => [t.id, t.v.map(v => v.k + ':' + v.id)]));

const words = fs.readFileSync(path.join(dir, 'tools/daily-words.txt'), 'utf8').split('\n')
  .filter(l => l.trim() && !l.startsWith('#'))
  .map(l => { const [t, w, s] = l.split('|').map(x => x.trim()); return { t, w, s }; });
if (words.some(x => /—/.test(x.w))) throw new Error('длинное тире в словах дня');

const out = path.join(dir, 'daily.json');
const old = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { days: {} };
const start = process.argv[2] || new Date(Date.now() + 3 * 36e5 + 864e5).toISOString().slice(0, 10);
const n = +process.argv[3] || 30;

// вс, пн, вт, ср, чт, пт, сб
const BYDAY = ['calm', 'utro', 'love', 'money', 'telo', 'calm', 'init'];
const used = {};
Object.values(old.days).forEach(d => { used[d.p] = (used[d.p] || 0) + 1; });
const left = words.slice();
const days = {};
for (let i = 0; i < n; i++) {
  const d = new Date(Date.parse(start + 'T00:00:00Z') + i * 864e5);
  const t = BYDAY[d.getUTCDay()];
  let wi = left.findIndex(x => x.t === t);
  if (wi < 0) wi = 0;
  const w = left.splice(wi, 1)[0];
  const p = topics[t].slice().sort((a, b) => (used[a] || 0) - (used[b] || 0))[0];
  used[p] = (used[p] || 0) + 1;
  days[d.toISOString().slice(0, 10)] = { t, w: w ? w.w : '', p };
}
const all = { ...old.days, ...days };
fs.writeFileSync(out, JSON.stringify({ words: words.map(x => x.w), days: all }, null, 1) + '\n');
console.log('daily.json: ' + Object.keys(days)[0] + ' … ' + Object.keys(days).pop() + ', дней ' + n);
