// Строка задачи в формате плагина Obsidian Tasks (Tasks Emoji Format).
// Поля читаются с конца строки, как это делает сам плагин: всё, что не
// распознано, остаётся в описании. Запись идёт в порядке полей Tasks по
// умолчанию, поэтому Obsidian видит те же строки, что написал бы сам.

export const PRIORITY_EMOJI = { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' };
const EMOJI_PRIORITY = Object.fromEntries(Object.entries(PRIORITY_EMOJI).map(([k, v]) => [v, k]));

export const DATE_FIELDS = [
  ['created', '➕'],
  ['start', '🛫'],
  ['scheduled', '⏳'],
  ['due', '📅'],
  ['cancelled', '❌'],
  ['done', '✅'],
];

const DATE = String.raw`(\d{4}-\d{2}-\d{2})`;
const dateField = (emoji) => new RegExp(String.raw`\s*(?:${emoji})️?\s*${DATE}$`, 'u');
const one = (m) => m[1];

const FIELDS = [
  ['priority', /\s*([🔺⏫🔼🔽⏬])️?$/u, (m) => EMOJI_PRIORITY[m[1]]],
  ['recurrence', /\s*🔁️?\s*([a-zA-Z0-9, !]+)$/u, (m) => m[1].trim()],
  ['onCompletion', /\s*🏁️?\s*([a-zA-Z]+)$/u, one],
  ['id', /\s*🆔️?\s*([a-zA-Z0-9_-]+)$/u, one],
  ['dependsOn', /\s*⛔️?\s*([a-zA-Z0-9_-]+(?:\s*,\s*[a-zA-Z0-9_-]+)*)$/u, (m) => m[1].split(',').map((s) => s.trim())],
  ['created', dateField('➕'), one],
  ['start', dateField('🛫'), one],
  ['scheduled', dateField('⏳|⌛'), one],
  ['due', dateField('📅|📆|🗓'), one],
  ['cancelled', dateField('❌'), one],
  ['done', dateField('✅'), one],
];

const TASK_LINE = /^([\s>]*(?:[-*+]|\d+[.)])\s+)\[(.)\] ?(.*)$/u;
const TRAILING_TAG = /(?:^|\s+)(#[^\s#]+)$/u;
const BLOCK_LINK = /\s+(\^[a-zA-Z0-9-]+)$/u;

export function parseBody(body) {
  let rest = body.trim();
  const task = {};
  const tags = [];

  const link = rest.match(BLOCK_LINK);
  if (link) {
    task.blockLink = link[1];
    rest = rest.slice(0, link.index).trimEnd();
  }

  for (let matched = true; matched; ) {
    matched = false;
    for (const [name, re, read] of FIELDS) {
      if (name in task) continue;
      const m = rest.match(re);
      if (!m) continue;
      task[name] = read(m);
      rest = rest.slice(0, m.index).trimEnd();
      matched = true;
    }
    const tag = rest.match(TRAILING_TAG);
    if (tag && rest.slice(0, tag.index).trim()) {
      tags.unshift(tag[1]);
      rest = rest.slice(0, tag.index).trimEnd();
      matched = true;
    }
  }

  task.description = [rest, ...tags].join(' ').trim();
  return task;
}

export function serializeBody(task) {
  const parts = [task.description];
  if (task.id) parts.push(`🆔 ${task.id}`);
  if (task.dependsOn?.length) parts.push(`⛔ ${task.dependsOn.join(',')}`);
  if (task.priority) parts.push(PRIORITY_EMOJI[task.priority]);
  if (task.recurrence) parts.push(`🔁 ${task.recurrence}`);
  if (task.onCompletion) parts.push(`🏁 ${task.onCompletion}`);
  for (const [name, emoji] of DATE_FIELDS) if (task[name]) parts.push(`${emoji} ${task[name]}`);
  if (task.blockLink) parts.push(task.blockLink);
  return parts.filter(Boolean).join(' ');
}

export function parseTaskLine(line) {
  const m = line.match(TASK_LINE);
  if (!m) return null;
  return { prefix: m[1], status: m[2], ...parseBody(m[3]) };
}

export function formatTaskLine(task) {
  return `${task.prefix}[${task.status}] ${serializeBody(task)}`.trimEnd();
}

// --- Даты: строки YYYY-MM-DD, арифметика в UTC, чтобы не мешал переход на летнее время.

const DAY = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');
const toUTC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

export const localToday = (now = new Date()) =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * DAY);
const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / DAY);
const weekday = (iso) => (new Date(toUTC(iso)).getUTCDay() + 6) % 7; // 0 — понедельник

function addMonths(iso, n, day = +iso.slice(8, 10)) {
  const first = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return fromUTC(first.getTime());
}

// --- Повторы 🔁: поддержаны правила, которые Tasks пишет чаще всего.
// Для остальных возвращается null, и задачу нужно отметить в самом Obsidian.

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function parseWeekdays(text) {
  const days = text.split(/\s*(?:,|\band\b)\s*/).filter(Boolean).map((d) => WEEKDAYS.indexOf(d));
  return days.length && days.every((d) => d >= 0) ? [...new Set(days)].sort() : null;
}

export function parseRecurrence(text) {
  let rule = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const whenDone = rule.endsWith(' when done');
  if (whenDone) rule = rule.slice(0, -' when done'.length);
  if (!rule.startsWith('every ')) return null;

  if (rule === 'every weekday') return { unit: 'week', interval: 1, weekdays: [0, 1, 2, 3, 4], whenDone };
  const bareDays = parseWeekdays(rule.slice('every '.length));
  if (bareDays) return { unit: 'week', interval: 1, weekdays: bareDays, whenDone };

  const m = rule.match(/^every (?:(\d+) )?(day|week|month|year)s?(?: on (.+))?$/);
  if (!m) return null;
  const base = { unit: m[2], interval: Number(m[1] ?? 1), whenDone };
  if (!m[3]) return base;
  if (base.unit === 'week') {
    const weekdays = parseWeekdays(m[3]);
    return weekdays && { ...base, weekdays };
  }
  const monthDay = base.unit === 'month' && m[3].match(/^the (\d{1,2})(?:st|nd|rd|th)$/);
  return monthDay ? { ...base, monthDay: Number(monthDay[1]) } : null;
}

function nextDate(from, rule) {
  const { unit, interval } = rule;
  if (unit === 'day') return addDays(from, interval);
  if (unit === 'year') return addMonths(from, 12 * interval);
  if (unit === 'month') {
    if (!rule.monthDay) return addMonths(from, interval);
    for (let k = 0; k <= 48; k += interval) {
      const candidate = addMonths(from, k, rule.monthDay);
      if (candidate > from && +candidate.slice(8, 10) === rule.monthDay) return candidate;
    }
    return null;
  }
  if (!rule.weekdays) return addDays(from, 7 * interval);
  const wd = weekday(from);
  const later = rule.weekdays.find((d) => d > wd);
  if (later !== undefined) return addDays(from, later - wd);
  return addDays(from, 7 * interval - wd + rule.weekdays[0]);
}

// Даты следующего повтора: опорная дата (срок, иначе план, иначе начало)
// переходит на следующее вхождение, остальные даты сдвигаются на столько же.
export function nextRecurrence(task, today) {
  const rule = parseRecurrence(task.recurrence);
  if (!rule) return null;
  const baseField = ['due', 'scheduled', 'start'].find((name) => task[name]);
  if (!baseField) return {};
  const base = task[baseField];
  const next = nextDate(rule.whenDone ? today : base, rule);
  if (!next) return null;
  const shift = diffDays(next, base);
  return Object.fromEntries(
    ['start', 'scheduled', 'due'].filter((name) => task[name]).map((name) => [name, addDays(task[name], shift)]),
  );
}
