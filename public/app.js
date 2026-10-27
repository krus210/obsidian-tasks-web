// Интерфейс задач: фильтры, дерево заметок, матрица Эйзенхауэра и быстрый ввод.
// Все изменения уходят на сервер, который правит строки в заметках Obsidian.

import { calendarUrl, icsCalendar } from './calendar.js';

const QUADRANTS = [
  { key: 'q1', priority: 'highest', emoji: '🔺', short: 'Q1', title: 'Сделать сейчас', hint: 'Важно и срочно' },
  { key: 'q2', priority: 'high', emoji: '⏫', short: 'Q2', title: 'Планомерно двигать', hint: 'Важно, не срочно' },
  { key: 'q3', priority: 'medium', emoji: '🔼', short: 'Q3', title: 'Пачкой в конце дня', hint: 'Срочно, не важно' },
  { key: 'q4', priority: 'lowest', emoji: '⏬', short: 'Q4', title: 'Не делать', hint: 'Не важно и не срочно' },
  { key: 'someday', priority: 'low', emoji: '🔽', short: 'Позже', title: 'Когда-нибудь', hint: 'Без спешки' },
  { key: 'none', priority: null, emoji: '', short: 'Нет', title: 'Разобрать', hint: 'Квадрант не выбран' },
];
const QUADRANT = Object.fromEntries(QUADRANTS.map((q) => [q.key, q]));
const PRIORITY_EMOJI = Object.fromEntries(QUADRANTS.filter((q) => q.priority).map((q) => [q.priority, q.emoji]));
const PRIORITY_RANK = { highest: 0, high: 1, medium: 2, none: 3, low: 4, lowest: 5 };

const STATUSES = [
  [' ', 'Открыта'],
  ['/', 'В работе'],
  ['x', 'Выполнена'],
  ['-', 'Отменена'],
];

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const WEEKDAYS_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DAY_WORDS = {
  пн: 0, понедельник: 0, вт: 1, вторник: 1, ср: 2, среда: 2, среду: 2, чт: 3, четверг: 3,
  пт: 4, пятница: 4, пятницу: 4, сб: 5, суббота: 5, субботу: 5, вс: 6, воскресенье: 6,
};

// --- Даты

const DAY = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');
const toUTC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const addDays = (iso, n) => new Date(toUTC(iso) + n * DAY).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / DAY);
const weekday = (iso) => (new Date(toUTC(iso)).getUTCDay() + 6) % 7;
const nextWeekday = (from, day) => addDays(from, (day - weekday(from) + 7) % 7 || 7);

function ranges(today) {
  const weekStart = addDays(today, -weekday(today));
  return {
    today,
    tomorrow: addDays(today, 1),
    weekStart,
    weekEnd: addDays(weekStart, 6),
    nextStart: addDays(weekStart, 7),
    nextEnd: addDays(weekStart, 13),
  };
}

function fmtDate(iso) {
  const d = diffDays(iso, state.r.today);
  if (d === 0) return 'сегодня';
  if (d === 1) return 'завтра';
  if (d === -1) return 'вчера';
  const label = `${WEEKDAYS[weekday(iso)]}, ${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}`;
  return iso.slice(0, 4) === state.r.today.slice(0, 4) ? label : `${label} ${iso.slice(0, 4)}`;
}

const longDate = (iso) => `${WEEKDAYS[weekday(iso)]}, ${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}`;
const capitalize = (s) => `${s[0].toUpperCase()}${s.slice(1)}`;

function dateWord(word) {
  const w = word.toLowerCase();
  const today = state.r.today;
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  const dm = w.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (dm) {
    const iso = `${today.slice(0, 4)}-${pad(dm[2])}-${pad(dm[1])}`;
    return iso < today ? `${+today.slice(0, 4) + 1}${iso.slice(4)}` : iso;
  }
  if (w === 'сегодня') return today;
  if (w === 'завтра') return addDays(today, 1);
  if (w === 'послезавтра') return addDays(today, 2);
  if (w === 'неделя' || w === 'нед') return nextWeekday(today, 0);
  return w in DAY_WORDS ? nextWeekday(today, DAY_WORDS[w]) : null;
}

// --- Состояние

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('task-web') ?? '{}');
  } catch {
    return {};
  }
})();

const state = {
  data: null,
  r: null,
  byKey: new Map(),
  children: new Map(),
  files: new Map(),
  view: saved.view ?? 'list',
  when: saved.when ?? 'today',
  quadrant: saved.quadrant ?? 'all',
  area: saved.area ?? '',
  sort: saved.sort ?? 'priority',
  collapsed: new Set(saved.collapsed ?? []),
  search: '',
  editing: null,
  addingSub: null,
  qa: { priority: null, date: null, due: null, target: null },
  cal: null,
  plan: null,
  pendingReload: false,
};

function persist() {
  try {
    const { view, when, quadrant, area, sort } = state;
    localStorage.setItem('task-web', JSON.stringify({ view, when, quadrant, area, sort, collapsed: [...state.collapsed] }));
  } catch {
    // Без localStorage просто не запоминаем фильтры.
  }
}

// --- Данные

async function api(path, body) {
  const res = await fetch(path, body ? {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Сервер ответил ${res.status}`);
  return data;
}

async function load() {
  const data = await api('/api/state');
  state.data = data;
  state.r = ranges(data.today);
  state.byKey = new Map();
  state.children = new Map();
  state.files = new Map(data.files.map((f) => [f.path, f]));
  for (const t of data.tasks) {
    t.key = `${t.path}#${t.line}`;
    t.parentKey = t.parent === null ? null : `${t.path}#${t.parent}`;
    state.byKey.set(t.key, t);
  }
  const openIds = new Set(data.tasks.filter((t) => isOpen(t) && t.id).map((t) => t.id));
  for (const t of data.tasks) {
    t.blocked = Boolean(t.dependsOn?.some((id) => openIds.has(id)));
    if (t.parentKey && t.description) {
      if (!state.children.has(t.parentKey)) state.children.set(t.parentKey, []);
      state.children.get(t.parentKey).push(t);
    }
  }
  state.pendingReload = false;
  render();
}

const isOpen = (t) => t.status === ' ' || t.status === '/';
const isClosed = (t) => t.status === 'x' || t.status === '-';
const isActive = (t) => isOpen(t) && !t.archived && Boolean(t.description);
const datesOf = (t) => [t.start, t.scheduled, t.due].filter(Boolean);
const happens = (t, from, to) => datesOf(t).some((d) => d >= from && d <= to);
const overdue = (t) => (t.due && t.due < state.r.today) || (t.scheduled && t.scheduled < state.r.today);
const quadrantOf = (t) => QUADRANTS.find((q) => q.priority === (t.priority ?? null));
const inQuadrant = (t, key) => quadrantOf(t).key === key && !(key === 'none' && t.parentKey);
const inArea = (t) => !state.area || t.path === state.area || t.path.startsWith(`${state.area}/`);
const basename = (p) => p.split('/').pop().replace(/\.md$/, '');
const firstDate = (t) => datesOf(t).sort()[0] ?? '9999-99-99';
const obsidianUrl = (file) => `obsidian://open?vault=${encodeURIComponent(state.data.vault)}&file=${encodeURIComponent(file)}`;

const WHEN = [
  { key: 'today', label: 'Сегодня', test: (t) => happens(t, state.r.today, state.r.today) || overdue(t) },
  { key: 'overdue', label: 'Просрочено', test: overdue },
  { key: 'tomorrow', label: 'Завтра', test: (t) => happens(t, state.r.tomorrow, state.r.tomorrow) },
  { key: 'week', label: 'Эта неделя', test: (t) => happens(t, state.r.weekStart, state.r.weekEnd) },
  { key: 'nextweek', label: 'Следующая неделя', test: (t) => happens(t, state.r.nextStart, state.r.nextEnd) },
  { key: 'nodate', label: 'Без даты', test: (t) => !datesOf(t).length },
  { key: 'all', label: 'Все открытые', test: () => true },
  // Без фильтров: открытые и закрытые задачи, включая архив, — как в самой заметке.
  { key: 'everything', label: 'Все задачи', closed: true, test: () => true },
];
const whenDef = (key) => WHEN.find((w) => w.key === key) ?? WHEN[0];

function searchOk(t) {
  if (!state.search) return true;
  const q = state.search.toLowerCase();
  return t.description.toLowerCase().includes(q) || t.path.toLowerCase().includes(q);
}

function matches(t, skip = '') {
  const when = whenDef(state.when);
  if (!(when.closed ? Boolean(t.description) : isActive(t)) || !when.test(t) || !inArea(t)) return false;
  if (skip !== 'quadrant' && state.quadrant !== 'all' && !inQuadrant(t, state.quadrant)) return false;
  return searchOk(t);
}

function ancestors(t) {
  const list = [];
  for (let p = state.byKey.get(t.parentKey); p; p = state.byKey.get(p.parentKey)) list.push(p);
  return list;
}

// Задача показывается один раз: если подходит и её родитель, она видна внутри его дерева.
function roots(list) {
  const shown = new Set(list.map((t) => t.key));
  return list.filter((t) => !ancestors(t).some((a) => shown.has(a.key)));
}

const rank = (t) => PRIORITY_RANK[t.priority ?? 'none'];
const SORTS = {
  priority: (a, b) => rank(a) - rank(b) || firstDate(a).localeCompare(firstDate(b)) || a.line - b.line,
  date: (a, b) => firstDate(a).localeCompare(firstDate(b)) || rank(a) - rank(b) || a.line - b.line,
  file: (a, b) => a.line - b.line,
};

// --- Отрисовка: общие части

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TOKEN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[((?:[^[\]]|\[[^\]]*\])*)\]\((\S+?)\)|((?:https?|file):\/\/[^\s)]+)|\*\*([^*]+)\*\*|`([^`]+)`/g;

function shortUrl(url) {
  try {
    const u = new URL(url);
    const tail = u.pathname.length > 24 ? `${u.pathname.slice(0, 22)}…` : u.pathname;
    return `${u.hostname.replace(/^www\./, '')}${tail === '/' ? '' : tail}`;
  } catch {
    return url;
  }
}

// Ссылкой становятся только веб-адреса, почта и Obsidian: javascript: и другие схемы остаются текстом.
const SAFE_HREF = /^(https?|mailto|obsidian):/i;

function link(href, text) {
  if (!SAFE_HREF.test(href)) return text;
  const external = !href.startsWith('obsidian:');
  return `<a href="${esc(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
}

// Описание задачи: ссылки Markdown и [[вики-ссылки]] кликабельны, остальное — текст.
function renderText(text) {
  let html = '';
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    html += esc(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) html += link(obsidianUrl(m[1]), esc(m[2] ?? m[1]));
    else if (m[4] !== undefined) html += link(m[4], esc((m[3] || m[4]).replace(/\\([[\]|])/g, '$1')));
    else if (m[5]) html += link(m[5], esc(shortUrl(m[5])));
    else if (m[6]) html += `<strong>${esc(m[6])}</strong>`;
    else html += `<code>${esc(m[7])}</code>`;
  }
  return html + esc(text.slice(last));
}

const chip = (label, on, attrs, cls = '') =>
  `<button type="button" class="chip${on ? ' on' : ''}${cls ? ` ${cls}` : ''}" aria-pressed="${on}" ${attrs}>${label}</button>`;

// Выбор квадранта: на кнопке сразу видно, что делать с задачей и почему.
const quadChip = (q, on, attrs) => chip(q.priority
  ? `<span>${q.emoji} ${q.short.startsWith('Q') ? `<b>${q.short}</b> ` : ''}${q.title}</span><small>${q.hint}</small>`
  : '<span>Без квадранта</span><small>Разобрать потом</small>', on, attrs, `quad-chip q-${q.key}`);

function dateBadge(icon, iso, t, kind) {
  const open = isOpen(t);
  const cls = open && iso < state.r.today ? 'late' : open && iso === state.r.today ? 'now' : '';
  const titles = { scheduled: 'Запланировано', due: 'Срок', start: 'Начало', done: 'Выполнено' };
  return `<span class="badge date ${kind} ${cls}" title="${titles[kind]}: ${iso}">${icon} ${fmtDate(iso)}</span>`;
}

function meta(t, { kids, collapsed, showFile }) {
  const parts = [];
  const q = quadrantOf(t);
  if (q.priority) parts.push(`<button type="button" class="badge q-tag q-${q.key}" data-action="prio-menu" title="${q.title}. Сменить квадрант">${q.short}</button>`);
  if (t.start && t.start > state.r.today) parts.push(dateBadge('🛫', t.start, t, 'start'));
  if (t.scheduled) parts.push(dateBadge('⏳', t.scheduled, t, 'scheduled'));
  if (t.due) parts.push(dateBadge('📅', t.due, t, 'due'));
  if (t.done && !isOpen(t)) parts.push(dateBadge('✅', t.done, t, 'done'));
  if (t.recurrence) parts.push(`<span class="badge" title="Повтор: ${esc(t.recurrence)}">🔁</span>`);
  if (t.blocked) parts.push('<span class="badge late" title="Ждёт завершения другой задачи">⛔ ждёт</span>');
  if (kids.length) {
    const done = kids.filter(isClosed).length;
    parts.push(`<button type="button" class="badge kids" data-action="collapse" data-id="t:${esc(stableId(t))}" aria-expanded="${!collapsed}" title="Подзадачи: выполнено ${done} из ${kids.length}. ${collapsed ? 'Показать' : 'Скрыть'}">✓ ${done}/${kids.length}</button>`);
  }
  if (showFile) parts.push(`<span class="badge file-ref">${esc(basename(t.path))}</span>`);
  return parts.join('');
}

const stableId = (t) => `${t.path}::${t.description}`;
const STATUS_CLASS = { ' ': 'todo', '/': 'doing', x: 'done', '-': 'cancelled' };

function renderTask(t, { depth = 0, crumb = false, showFile = false, draggable = false } = {}) {
  const q = quadrantOf(t);
  const kids = state.children.get(t.key) ?? [];
  const collapsed = state.collapsed.has(`t:${stableId(t)}`);
  const parent = crumb && t.parentKey ? state.byKey.get(t.parentKey) : null;
  const editing = state.editing?.key === t.key;
  return `
    <div class="task q-${q.key} s-${STATUS_CLASS[t.status] ?? 'todo'}${editing ? ' is-editing' : ''}" data-key="${esc(t.key)}" style="--depth:${depth}"${draggable ? ' draggable="true"' : ''}>
      <button type="button" class="check" data-action="toggle" aria-label="${isClosed(t) ? 'Вернуть в работу' : 'Отметить выполненной'}"></button>
      <div class="task-main" data-action="edit">
        ${parent ? `<div class="crumb">${esc(parent.description)}</div>` : ''}
        <span class="task-text">${renderText(t.description)}</span>
        <span class="task-meta">${meta(t, { kids, collapsed, showFile })}</span>
      </div>
      <div class="task-actions">
        ${isOpen(t) ? '<button type="button" class="icon-btn" data-action="cal-menu" title="Поставить в Google Календарь" aria-label="Поставить в Google Календарь">📆</button>' : ''}
        ${isClosed(t) ? '' : '<button type="button" class="icon-btn" data-action="add-sub" title="Добавить подзадачу" aria-label="Добавить подзадачу">＋</button>'}
        ${t.inArchive && !t.parentKey ? '<button type="button" class="icon-btn text" data-action="toggle" title="Открыть задачу и вернуть к открытым задачам заметки">Вернуть</button>' : ''}
      </div>
    </div>
    ${editing ? renderEditor(t, depth) : ''}
    ${state.addingSub === t.key ? renderSubForm(t, depth + 1) : ''}`;
}

function renderTree(t, depth = 0, crumb = true) {
  let html = renderTask(t, { depth, crumb, draggable: true });
  if (state.collapsed.has(`t:${stableId(t)}`)) return html;
  for (const kid of state.children.get(t.key) ?? []) html += renderTree(kid, depth + 1, false);
  return html;
}

function dateChips(field, value) {
  const today = state.r.today;
  const options = [['Сегодня', today], ['Завтра', addDays(today, 1)], ['Пн', nextWeekday(today, 0)]];
  return options.map(([label, iso]) => chip(label, value === iso, `data-action="ed-date" data-field="${field}" data-value="${iso}"`)).join('')
    + `<input type="date" class="date-input" data-field="${field}" value="${value ?? ''}" aria-label="Другая дата">`
    + (value ? chip('Убрать', false, `data-action="ed-date" data-field="${field}" data-value=""`, 'ghost') : '');
}

function renderEditor(t, depth) {
  const d = state.editing.draft;
  return `
    <form class="editor" data-key="${esc(t.key)}" style="--depth:${depth}">
      <label class="visually-hidden" for="ed-text">Текст задачи</label>
      <input id="ed-text" class="ed-text" value="${esc(d.description)}">
      <div class="ed-grid">
        <span class="ed-label">Квадрант</span>
        <div class="seg wrap">${QUADRANTS.map((q) => quadChip(q, d.priority === q.priority, `data-action="ed-priority" data-value="${q.priority ?? ''}"`)).join('')}</div>
        <span class="ed-label">⏳ Запланировано</span>
        <div class="seg wrap">${dateChips('scheduled', d.scheduled)}</div>
        <span class="ed-label">📅 Срок</span>
        <div class="seg wrap">${dateChips('due', d.due)}</div>
        <span class="ed-label">Статус</span>
        <div class="seg wrap">${STATUSES.map(([s, label]) => chip(label, d.status === s, `data-action="ed-status" data-value="${s}"`)).join('')}</div>
        <label class="ed-label" for="ed-note">Заметка</label>
        <div class="seg wrap">
          <select id="ed-note" class="select">${noteOptions(d.target)}</select>
          <a class="icon-btn" href="${obsidianUrl(t.path)}" title="Открыть заметку в Obsidian" aria-label="Открыть заметку в Obsidian">↗</a>
        </div>
      </div>
      <div class="ed-actions">
        <button type="submit" class="btn primary">Сохранить</button>
        <button type="button" class="btn" data-action="ed-cancel">Отмена</button>
        ${bareUrls(d.description).length ? '<button type="button" class="btn ghost" data-action="ed-links" title="Заменить ссылки на [Название](ссылка)">Названия для ссылок</button>' : ''}
        <span class="spacer"></span>
        ${t.created ? `<span class="ed-meta">Создана ${longDate(t.created)}</span>` : ''}
      </div>
    </form>`;
}

// Варианты «Куда»: заметки по папкам, у заметок с несколькими разделами — ещё и разделы.
const targetOf = (t) => ((state.files.get(t.path)?.sections.length ?? 0) > 1 && t.section ? { path: t.path, section: t.section } : { path: t.path });

function noteOptions(selected) {
  const current = JSON.stringify(selected);
  const option = (value, label) => {
    const v = JSON.stringify(value);
    return `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(label)}</option>`;
  };
  const groups = new Map();
  for (const f of state.data.files) {
    if (f.archived || f.path === state.data.inbox) continue;
    const folder = f.path.includes('/') ? f.path.split('/').slice(0, -1).join(' / ') : 'Корень';
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(option({ path: f.path }, basename(f.path)));
    if (f.sections.length > 1) for (const s of f.sections) groups.get(folder).push(option({ path: f.path, section: s }, `${basename(f.path)} › ${s}`));
  }
  return option({ path: state.data.inbox }, `Входящие · ${basename(state.data.inbox)}`)
    + [...groups].map(([folder, opts]) => `<optgroup label="${esc(folder)}">${opts.join('')}</optgroup>`).join('');
}

function renderSubForm(t, depth) {
  return `
    <form class="sub-form" data-key="${esc(t.key)}" style="--depth:${depth}">
      <label class="visually-hidden" for="sub-text">Подзадача</label>
      <input id="sub-text" class="sub-input" placeholder="Подзадача для «${esc(t.description.slice(0, 40))}»">
      <button type="submit" class="btn">Добавить</button>
    </form>`;
}

// --- Список: папки → заметки → задачи

// В дерево попадают корни (подходящая подзадача видна внутри родителя), а счётчики
// папок и заметок учитывают все подходящие задачи — так же, как боковая панель.
function buildTree(matched) {
  const top = { folders: new Map(), files: new Map(), count: 0 };
  const shown = new Set(roots(matched));
  for (const t of matched) {
    const parts = t.path.split('/');
    let node = top;
    node.count++;
    parts.slice(0, -1).forEach((name, i) => {
      if (!node.folders.has(name)) node.folders.set(name, { path: parts.slice(0, i + 1).join('/'), folders: new Map(), files: new Map(), count: 0 });
      node = node.folders.get(name);
      node.count++;
    });
    if (!node.files.has(t.path)) node.files.set(t.path, { tasks: [], count: 0 });
    const file = node.files.get(t.path);
    file.count++;
    if (shown.has(t)) file.tasks.push(t);
  }
  return top;
}

function renderFolder(node) {
  let html = '';
  for (const [name, child] of node.folders) {
    const id = `d:${child.path}`;
    const collapsed = state.collapsed.has(id);
    html += `
      <section class="folder">
        <button type="button" class="folder-head" data-action="collapse" data-id="${esc(id)}" aria-expanded="${!collapsed}">
          <span class="caret" aria-hidden="true">${collapsed ? '▸' : '▾'}</span>
          <span class="folder-name">${esc(name)}</span>
          <span class="count">${child.count}</span>
        </button>
        ${collapsed ? '' : `<div class="folder-body">${renderFolder(child)}</div>`}
      </section>`;
  }
  for (const [file, { tasks, count }] of node.files) html += renderFile(file, tasks, count);
  return html;
}

function renderFile(file, tasks, count) {
  const sections = state.files.get(file)?.sections ?? [];
  const sectionIdx = (t) => sections.indexOf(t.section);
  const sorted = tasks.sort((a, b) => isClosed(a) - isClosed(b) || sectionIdx(a) - sectionIdx(b) || SORTS[state.sort](a, b));
  let html = `
    <div class="file">
      <div class="file-head" data-drop-note="${esc(file)}">
        <button type="button" class="file-name" data-action="area" data-area="${esc(file)}" title="Показать только эту заметку">${esc(basename(file))}</button>
        <span class="count">${count}</span>
        <button type="button" class="icon-btn" data-action="add-here" data-path="${esc(file)}" title="Добавить задачу в эту заметку" aria-label="Добавить задачу в эту заметку">＋</button>
        <a class="icon-btn" href="${obsidianUrl(file)}" title="Открыть в Obsidian" aria-label="Открыть в Obsidian">↗</a>
      </div>`;
  let section;
  for (const t of sorted) {
    if (sections.length > 1 && t.section !== section) {
      section = t.section;
      html += `<div class="section-label"${section ? ` data-drop-note="${esc(file)}" data-section="${esc(section)}"` : ''}>${esc(section ?? 'Без раздела')}</div>`;
    }
    html += renderTree(t);
  }
  return `${html}</div>`;
}

function emptyState() {
  const text = {
    today: 'На сегодня ничего не запланировано и нет просроченного. Выбери задачи в «Без даты» или в Q2 и поставь им ⏳ сегодня.',
    overdue: 'Просроченных задач нет.',
  }[state.when] ?? 'Под эти фильтры задач нет. Сними фильтр или добавь задачу в поле сверху.';
  return `<div class="empty">${text}</div>`;
}

function renderList() {
  const matched = state.data.tasks.filter((t) => matches(t));
  if (!matched.length) return emptyState();
  return `<div class="tree">${renderFolder(buildTree(matched))}</div>`;
}

// --- Матрица

function renderMatrix() {
  const cells = Object.fromEntries(QUADRANTS.map((q) => [q.key, []]));
  for (const t of state.data.tasks) {
    if (isClosed(t) || !matches(t, 'quadrant')) continue;
    const q = quadrantOf(t);
    if (q.key === 'none' && t.parentKey) continue;
    cells[q.key].push(t);
  }
  const cell = (key) => {
    const q = QUADRANT[key];
    const items = cells[key].sort(SORTS.date);
    return `
      <section class="quad q-${key}" data-drop="${q.priority ?? ''}" aria-label="${q.short}: ${q.title}">
        <header class="quad-head">
          <span class="quad-mark">${q.short}</span>
          <div><h2>${q.title}</h2><p>${q.hint}</p></div>
          <span class="count">${items.length}</span>
        </header>
        <div class="quad-list">
          ${items.map((t) => renderTask(t, { crumb: true, showFile: true, draggable: true })).join('') || '<p class="quad-empty">Перетащи сюда задачу</p>'}
        </div>
      </section>`;
  };
  return `
    <div class="matrix">
      <div class="axis axis-x" aria-hidden="true"><span>Срочно</span><span>Не срочно</span></div>
      <div class="axis axis-y important" aria-hidden="true"><span>Важно</span></div>
      <div class="axis axis-y unimportant" aria-hidden="true"><span>Не важно</span></div>
      ${['q1', 'q2', 'q3', 'q4'].map(cell).join('')}
    </div>
    <div class="lanes">${['none', 'someday'].map(cell).join('')}</div>`;
}

// --- Архив: закрытые задачи, последние сверху. Галочка или «Вернуть» открывает задачу
// и возвращает её к открытым задачам заметки.
const closedOutsideArchive = () => state.data.tasks.filter((t) => isClosed(t) && !t.parentKey && !t.archived && t.description);

function renderDone() {
  const doneDate = (t) => t.done ?? t.cancelled ?? '';
  const list = state.data.tasks
    .filter((t) => isClosed(t) && t.description && inArea(t) && searchOk(t))
    .filter((t) => !t.parentKey || !isClosed(state.byKey.get(t.parentKey) ?? {}))
    .sort((a, b) => doneDate(b).localeCompare(doneDate(a)))
    .slice(0, 200);
  const stray = closedOutsideArchive().length;
  const banner = stray ? `
    <div class="archive-note">
      <span>Выполнено, но ещё не в архиве: ${stray}. Такие задачи остаются наверху заметки, например если их отметили в Obsidian.</span>
      <button type="button" class="btn" data-action="archive-closed">Перенести в архив</button>
    </div>` : '';
  if (!list.length) return `${banner}<div class="empty">Архив пока пуст.</div>`;
  let html = `${banner}<div class="tree">`;
  let day;
  for (const t of list) {
    if (doneDate(t) !== day) {
      day = doneDate(t);
      html += `<div class="day-label">${day ? fmtDate(day) : 'Без даты'}</div>`;
    }
    html += renderTask(t, { showFile: true, crumb: true });
  }
  return `${html}</div>`;
}

// --- Боковая панель и заголовок

// Счётчики «Где» — все открытые задачи папки; «Когда» и «Матрица» — внутри выбранной папки,
// без учёта друг друга. Подзадачи считаются наравне с задачами, как в запросах Tasks.
function renderSidebar() {
  const active = state.data.tasks.filter(isActive);
  const scoped = active.filter(inArea);
  const count = (list, fn = () => true) => list.filter(fn).length;
  const overdueCount = count(scoped, overdue);
  const item = (action, key, label, n, on, extra = '') => `
    <button type="button" class="nav-item${on ? ' on' : ''}" data-action="${action}" data-value="${esc(key)}" aria-pressed="${on}">
      <span class="nav-label">${label}</span>${extra}<span class="count">${n ?? ''}</span>
    </button>`;

  const everything = state.data.tasks.filter((t) => t.description && inArea(t));
  const whenItems = WHEN.map((w) => item('when', w.key, w.label, count(w.closed ? everything : scoped, w.test), state.when === w.key,
    w.key === 'today' && overdueCount ? `<span class="late-dot" title="Из них просрочено">${overdueCount}</span>` : '')).join('')
    + item('when', 'done', 'Архив', '', state.when === 'done');

  const quadItems = item('quadrant', 'all', 'Все квадранты', count(scoped), state.quadrant === 'all')
    + QUADRANTS.map((q) => item('quadrant', q.key, `<span class="swatch q-${q.key}"></span>${q.short === 'Нет' || q.short === 'Позже' ? q.title : `${q.short} · ${q.title}`}`,
      count(scoped, (t) => inQuadrant(t, q.key)), state.quadrant === q.key)).join('');

  // Заметки видны под выбранной папкой, а во время перетаскивания — все, чтобы на них можно было бросить задачу.
  const folders = new Map();
  const notesIn = new Map();
  for (const f of state.data.files) {
    if (f.archived) continue;
    const parts = f.path.split('/').slice(0, -1);
    for (let i = 1; i <= Math.min(parts.length, 2); i++) folders.set(parts.slice(0, i).join('/'), i - 1);
    const home = parts.slice(0, 2).join('/');
    if (!home) continue;
    if (!notesIn.has(home)) notesIn.set(home, []);
    notesIn.get(home).push(f.path);
  }
  const opened = (folder) => state.area === folder || state.area.startsWith(`${folder}/`);
  const areaItems = item('area', '', 'Все заметки', count(active), !state.area)
    + [...folders].map(([folder, level]) => {
      const n = count(active, (t) => t.path.startsWith(`${folder}/`));
      const notes = (notesIn.get(folder) ?? []).map((file) => `
        <button type="button" class="nav-item nav-note${state.area === file ? ' on' : ''}${opened(folder) ? ' shown' : ''}" data-action="area" data-value="${esc(file)}" data-drop-note="${esc(file)}" aria-pressed="${state.area === file}">
          <span class="nav-label" style="padding-left:${(level + 1) * 14}px">${esc(basename(file))}</span><span class="count">${count(active, (t) => t.path === file) || ''}</span>
        </button>`).join('');
      return item('area', folder, `<span style="padding-left:${level * 14}px">${esc(folder.split('/').pop())}</span>`, n, state.area === folder) + notes;
    }).join('');

  document.getElementById('sidebar').innerHTML = `
    <div class="nav-group"><h2>Когда</h2>${whenItems}</div>
    <div class="nav-group"><h2>Матрица</h2>${quadItems}</div>
    <div class="nav-group"><h2>Где</h2>${areaItems}</div>
    <p class="nav-hint">Клавиши: N — новая задача, / — поиск, Esc — закрыть.</p>`;
}

function renderHeader() {
  const { today } = state.r;
  const title = state.when === 'done' ? 'Архив' : whenDef(state.when).label;
  document.getElementById('title').textContent = title;
  const weekdayName = WEEKDAYS_FULL[weekday(today)];
  const dateLine = `${weekdayName[0].toUpperCase()}${weekdayName.slice(1)}, ${+today.slice(8, 10)} ${MONTHS_FULL[+today.slice(5, 7) - 1]}`;
  const ranged = {
    week: `${fmtDate(state.r.weekStart)} — ${fmtDate(state.r.weekEnd)}`,
    nextweek: `${fmtDate(state.r.nextStart)} — ${fmtDate(state.r.nextEnd)}`,
  }[state.when];
  document.getElementById('subtitle').textContent = ranged ? `${dateLine}. Неделя: ${ranged}` : dateLine;

  const chips = [];
  if (state.area) chips.push(`<button type="button" class="filter-chip" data-action="clear-area">${esc(state.area.replace(/\.md$/, ''))} <span aria-hidden="true">✕</span><span class="visually-hidden">Снять фильтр</span></button>`);
  if (state.quadrant !== 'all' && state.view === 'list' && state.when !== 'done') {
    chips.push(`<button type="button" class="filter-chip" data-action="quadrant" data-value="all">${QUADRANT[state.quadrant].title} <span aria-hidden="true">✕</span></button>`);
  }
  document.getElementById('filters').innerHTML = chips.join('');

  const day = focusDay();
  const count = day ? dayTasks().length : 0;
  document.getElementById('day-actions').innerHTML = count
    ? `<button type="button" class="btn" data-action="plan-day">📆 В календарь на ${day === state.r.today ? 'сегодня' : 'завтра'}: ${count}</button>`
    : '';

  for (const btn of document.querySelectorAll('[data-action="view"]')) {
    const on = btn.dataset.view === state.view;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on);
  }
  document.getElementById('sort').value = state.sort;
  document.getElementById('sort').hidden = state.view !== 'list' || state.when === 'done';
}

// Новая задача идёт в выбранную вручную заметку, иначе в открытую сейчас, иначе во «Входящие».
function currentTarget() {
  if (state.qa.target) return state.qa.target;
  const open = state.files.get(state.area);
  return open && !open.archived ? { path: open.path } : { path: state.data.inbox };
}

function renderQuickAdd() {
  const today = state.r.today;
  const dates = [['Без даты', null], ['Сегодня', today], ['Завтра', addDays(today, 1)], ['Пн', nextWeekday(today, 0)]];
  const custom = state.qa.date && !dates.some(([, iso]) => iso === state.qa.date);

  document.getElementById('qa-target').innerHTML = noteOptions(currentTarget());
  document.getElementById('qa-options').innerHTML = `
    <div class="seg" role="group" aria-label="Квадрант">
      ${QUADRANTS.map((q) => quadChip(q, state.qa.priority === q.priority, `data-action="qa-priority" data-value="${q.priority ?? ''}"`)).join('')}
    </div>
    <div class="seg" role="group" aria-label="Запланировать">
      ${dates.map(([label, iso]) => chip(iso ? `⏳ ${label}` : label, state.qa.date === iso, `data-action="qa-date" data-value="${iso ?? ''}"`)).join('')}
      <input type="date" id="qa-date-input" class="date-input${custom ? ' on' : ''}" value="${custom ? state.qa.date : ''}" aria-label="Другая дата">
    </div>
    <label class="target"><span>📅 Срок</span><input type="date" id="qa-due-input" class="date-input${state.qa.due ? ' on' : ''}" value="${state.qa.due ?? ''}"></label>`;
}

function render() {
  if (!state.data) return;
  persist();
  renderSidebar();
  renderHeader();
  renderQuickAdd();
  const content = state.when === 'done' ? renderDone() : state.view === 'matrix' ? renderMatrix() : renderList();
  document.getElementById('content').innerHTML = content;
  document.body.dataset.view = state.when === 'done' ? 'done' : state.view;
}

// --- Действия

const ref = (t) => ({ path: t.path, line: t.line, raw: t.raw });
let toastTimer;

function toast(message, { opId, error = false } = {}) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(message)}</span>${opId ? `<button type="button" class="toast-btn" data-action="undo" data-op="${esc(opId)}">Отменить</button>` : ''}`;
  el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), error ? 7000 : opId ? 8000 : 4000);
}

async function mutate(endpoint, body, message) {
  try {
    const res = await api(endpoint, body);
    await load();
    toast(message, { opId: res.opId });
    return res;
  } catch (err) {
    toast(err.message, { error: true });
    await load().catch(() => {});
    return null;
  }
}

function closeEditor() {
  state.editing = null;
  state.addingSub = null;
  if (state.pendingReload) load();
  else render();
}

function openEditor(t) {
  if (state.editing?.key === t.key) return;
  state.addingSub = null;
  state.editing = {
    key: t.key,
    draft: {
      description: t.description,
      priority: t.priority ?? null,
      scheduled: t.scheduled ?? null,
      due: t.due ?? null,
      status: t.status,
      target: targetOf(t),
    },
  };
  render();
  const input = document.getElementById('ed-text');
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

// Сначала перенос (строка задачи при нём не меняется), затем правки уже на новом месте.
function toggleMessage(t) {
  if (t.parentKey || t.archived && !t.inArchive) return isClosed(t) ? 'Задача снова открыта' : 'Выполнено';
  if (isClosed(t)) return t.inArchive ? 'Задача возвращена из архива' : 'Задача снова открыта';
  return 'Выполнено и перенесено в архив';
}

async function saveEditor() {
  if (pendingTitles.size) await waitTitles();
  const t = state.byKey.get(state.editing.key);
  const d = state.editing.draft;
  const changes = {};
  if (d.description.trim() !== t.description) changes.description = d.description;
  if (d.priority !== (t.priority ?? null)) changes.priority = d.priority;
  for (const f of ['scheduled', 'due']) if (d[f] !== (t[f] ?? null)) changes[f] = d[f];
  if (d.status !== t.status) changes.status = d.status;
  const moveTo = JSON.stringify(d.target) === JSON.stringify(targetOf(t)) ? null : d.target;
  state.editing = null;
  if (!Object.keys(changes).length && !moveTo) return closeEditor();

  let where = ref(t);
  if (moveTo) {
    const moved = await mutate('/api/move', { ...where, to: moveTo }, `Перенесено в «${basename(moveTo.path)}»`);
    if (!moved) return;
    where = { path: moved.path, line: moved.line, raw: t.raw };
  }
  if (Object.keys(changes).length) {
    await mutate('/api/update', { ...where, changes }, moveTo ? `Перенесено в «${basename(moveTo.path)}», изменения сохранены` : 'Изменения сохранены');
  }
}

function setPriority(t, priority) {
  if ((t.priority ?? null) === priority) return;
  const q = QUADRANTS.find((x) => x.priority === priority);
  mutate('/api/update', { ...ref(t), changes: { priority } }, `Квадрант: ${q.title}`);
}

function showPopover(anchor, html) {
  const pop = document.getElementById('popover');
  pop.innerHTML = html;
  const rect = anchor.getBoundingClientRect();
  pop.hidden = false;
  pop.style.top = `${rect.bottom + window.scrollY + 4}px`;
  pop.style.left = `${Math.max(window.scrollX + 12, Math.min(rect.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 12))}px`;
}

function openPriorityMenu(anchor, t) {
  showPopover(anchor, QUADRANTS.map((q) => `
    <button type="button" class="pop-item q-${q.key}${(t.priority ?? null) === q.priority ? ' on' : ''}" data-action="set-priority" data-key="${esc(t.key)}" data-value="${q.priority ?? ''}">
      <span class="swatch q-${q.key}"></span>${q.short === 'Нет' ? 'Без квадранта' : q.short} <small>${q.title}</small>
    </button>`).join(''));
}

// --- Google Календарь: день, время и длительность выбираются здесь, событие сохраняется в Google.

const CAL_TIMES = ['09:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
const CAL_MINUTES = [[15, '15 мин'], [30, '30 мин'], [60, '1 ч'], [90, '1,5 ч'], [120, '2 ч']];

function calendarMenu() {
  const { date, time, minutes } = state.cal;
  const today = state.r.today;
  const days = [['Сегодня', today], ['Завтра', addDays(today, 1)], ['Пн', nextWeekday(today, 0)]];
  const otherDay = !days.some(([, iso]) => iso === date);
  const otherTime = time && !CAL_TIMES.includes(time);
  return `
    <div class="cal-pop">
      <div class="cal-grid">
        <span class="ed-label">День</span>
        <div class="seg wrap">
          ${days.map(([label, iso]) => chip(label, date === iso, `data-action="cal-date" data-value="${iso}"`)).join('')}
          <input type="date" id="cal-date" class="date-input${otherDay ? ' on' : ''}" value="${otherDay ? date : ''}" aria-label="Другой день">
        </div>
        <span class="ed-label">Время</span>
        <div class="seg wrap">
          ${CAL_TIMES.map((x) => chip(x, time === x, `data-action="cal-time" data-value="${x}"`)).join('')}
          <input type="time" id="cal-time" class="date-input${otherTime ? ' on' : ''}" step="900" value="${otherTime ? time : ''}" aria-label="Другое время">
        </div>
        <span class="ed-label">Длится</span>
        <div class="seg wrap">${CAL_MINUTES.map(([m, label]) => chip(label, minutes === m, `data-action="cal-minutes" data-value="${m}"`)).join('')}</div>
      </div>
      <button type="button" class="btn primary" data-action="cal-open"${time ? '' : ' disabled'}>${time ? `Открыть в календаре: ${longDate(date)}, ${time}` : 'Выбери время'}</button>
      <p class="cal-note">Откроется Google Календарь с готовым событием: проверь время и нажми «Сохранить».</p>
    </div>`;
}

function openCalendarMenu(anchor, t) {
  const today = state.r.today;
  const date = [t.scheduled, t.due].find((d) => d && d >= today) ?? addDays(today, 1);
  state.cal = { key: t.key, date, time: null, minutes: state.cal?.minutes ?? 30 };
  showPopover(anchor, calendarMenu());
}

function renderCalendarMenu(focusId) {
  document.getElementById('popover').innerHTML = calendarMenu();
  if (focusId) document.getElementById(focusId)?.focus();
}

// Описание события: ссылки из задачи и путь к заметке, чтобы вернуться к ней.
function eventDetails(t) {
  const links = [...t.description.matchAll(TOKEN)].map((m) => m[4] ?? m[5]).filter((url) => /^https?:/i.test(url ?? ''));
  return [...links, `Заметка: ${t.path}`, obsidianUrl(t.path)].join('\n');
}

function openInCalendar() {
  const t = state.byKey.get(state.cal.key);
  closePopover();
  if (!t) return toast('Задача изменилась, открой меню календаря ещё раз', { error: true });
  const { date, time, minutes } = state.cal;
  window.open(calendarUrl({
    title: plainText(t.description),
    details: eventDetails(t),
    date,
    time,
    minutes,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }), '_blank', 'noopener');
  toast('Событие открыто в Google Календаре — нажми там «Сохранить»');
}

// --- День в календарь: задачи «Сегодня» или «Завтра» одним файлом .ics.
// Время и длительность ставятся здесь; задача без времени станет событием на весь день.

const focusDay = () => ({ today: state.r.today, tomorrow: state.r.tomorrow })[state.when];
const dayTasks = () => state.data.tasks.filter((t) => matches(t) && t.description.trim());

function planMenu() {
  const { day, items } = state.plan;
  const chosen = items.filter((i) => i.on).length;
  const durations = CAL_MINUTES.map(([m, label]) => `<option value="${m}">${label}</option>`).join('');
  return `
    <div class="plan-pop">
      <p class="plan-head">${longDate(day)}. Без времени — событие на весь день.</p>
      <div class="plan-list">
        ${items.map((i, index) => `
          <div class="plan-row" data-index="${index}">
            <label class="plan-task"><input type="checkbox" data-plan="on"${i.on ? ' checked' : ''}><span>${esc(i.title)}</span></label>
            <input type="time" class="date-input" data-plan="time" step="900" value="${i.time}" aria-label="Время">
            <select class="select" data-plan="minutes" aria-label="Длительность">${durations.replace(`value="${i.minutes}"`, `value="${i.minutes}" selected`)}</select>
          </div>`).join('')}
      </div>
      <button type="button" class="btn primary" data-action="plan-download"${chosen ? '' : ' disabled'}>Скачать файл для календаря: ${chosen}</button>
      <p class="cal-note">Откроется импорт Google Календаря: выбери скачанный файл и нажми «Импорт».</p>
    </div>`;
}

function openPlan(anchor) {
  const day = focusDay();
  state.plan = {
    day,
    items: dayTasks().map((t) => ({ id: `${stableId(t)}|${day}`, title: plainText(t.description), details: eventDetails(t), on: true, time: '', minutes: 30 })),
  };
  showPopover(anchor, planMenu());
}

function updatePlan(input) {
  const item = state.plan.items[input.closest('.plan-row').dataset.index];
  const field = input.dataset.plan;
  item[field] = field === 'on' ? input.checked : field === 'minutes' ? Number(input.value) : input.value;
  const chosen = state.plan.items.filter((i) => i.on).length;
  const button = document.querySelector('[data-action="plan-download"]');
  button.disabled = !chosen;
  button.textContent = `Скачать файл для календаря: ${chosen}`;
}

function downloadPlan() {
  const { day, items } = state.plan;
  const ics = icsCalendar(items.filter((i) => i.on).map((i) => ({ ...i, date: day, time: i.time || null })));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  a.download = `tasks-${day}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  closePopover();
  window.open('https://calendar.google.com/calendar/r/settings/export', '_blank', 'noopener');
  toast(`Файл ${a.download} скачан: выбери его в импорте Google Календаря и нажми «Импорт»`);
}

const closePopover = () => {
  document.getElementById('popover').hidden = true;
};

function parseQuick(raw) {
  let priority;
  let scheduled;
  const map = { 1: 'highest', 2: 'high', 3: 'medium', 4: 'lowest' };
  let text = raw.replace(/(^|\s)!([1-4])(?=\s|$)/g, (_, sp, k) => {
    priority = map[k];
    return sp;
  });
  text = text.replace(/(^|\s)@(\S+)/g, (whole, sp, word) => {
    const iso = dateWord(word);
    if (!iso) return whole;
    scheduled = iso;
    return sp;
  });
  return { text: text.replace(/\s+/g, ' ').trim(), priority, scheduled };
}

async function quickAdd(event) {
  event.preventDefault();
  const input = document.getElementById('qa-text');
  closeSuggest();
  if (pendingTitles.size) await waitTitles();
  const { text, priority, scheduled } = parseQuick(input.value);
  if (!text) return input.focus();
  const p = priority ?? state.qa.priority;
  const date = scheduled ?? state.qa.date;
  const line = [text, p && PRIORITY_EMOJI[p], date && `⏳ ${date}`, state.qa.due && `📅 ${state.qa.due}`].filter(Boolean).join(' ');
  const target = currentTarget();
  const res = await mutate('/api/add', { ...target, text: line }, `Добавлено в «${basename(target.path)}»`);
  if (!res) return;
  input.value = '';
  state.qa.priority = null;
  state.qa.date = null;
  state.qa.due = null;
  renderQuickAdd();
  const added = state.byKey.get(`${target.path}#${res.line}`);
  if (added && state.when !== 'done' && !(state.view === 'matrix' ? matches(added, 'quadrant') : matches(added))) {
    toast(`Добавлено в «${basename(target.path)}». В текущем фильтре задача не видна`, { opId: res.opId });
  }
  input.focus();
}

document.getElementById('quick-add').addEventListener('submit', quickAdd);

document.addEventListener('submit', async (e) => {
  if (e.target.matches('.editor')) {
    e.preventDefault();
    await saveEditor();
  } else if (e.target.matches('.sub-form')) {
    e.preventDefault();
    if (pendingTitles.size) await waitTitles();
    const t = state.byKey.get(e.target.dataset.key);
    const text = e.target.querySelector('input').value.trim();
    if (!text || !t) return;
    state.addingSub = null;
    await mutate('/api/add', { path: t.path, text, parent: { line: t.line, raw: t.raw } }, 'Подзадача добавлена');
  }
});

document.addEventListener('click', async (e) => {
  if (e.target.closest('a')) return;
  const el = e.target.closest('[data-action]');
  if (!e.target.closest('#popover') && el?.dataset.action !== 'prio-menu') closePopover();
  if (!el) return;
  const taskEl = el.closest('[data-key]');
  const t = taskEl ? state.byKey.get(taskEl.dataset.key) : null;
  const { action, value = '' } = el.dataset;

  switch (action) {
    case 'toggle':
      return mutate('/api/update', { ...ref(t), changes: { status: isClosed(t) ? ' ' : 'x' } }, toggleMessage(t));
    case 'archive-closed':
      return mutate('/api/archive-closed', {}, `В архив перенесено задач: ${closedOutsideArchive().length}`);
    case 'edit':
      return openEditor(t);
    case 'ed-cancel':
      return closeEditor();
    case 'ed-priority':
      state.editing.draft.priority = value || null;
      return render();
    case 'ed-date':
      state.editing.draft[el.dataset.field] = value || null;
      return render();
    case 'ed-status':
      state.editing.draft.status = value;
      return render();
    case 'ed-links':
      return titlesForDraft();
    case 'add-sub':
      state.editing = null;
      state.addingSub = t.key;
      render();
      return document.getElementById('sub-text')?.focus();
    case 'prio-menu':
      return openPriorityMenu(el, t);
    case 'set-priority':
      closePopover();
      return setPriority(state.byKey.get(el.dataset.key), value || null);
    case 'cal-menu':
      return openCalendarMenu(el, t);
    case 'cal-date':
    case 'cal-time':
      state.cal[action.slice(4)] = value;
      return renderCalendarMenu();
    case 'cal-minutes':
      state.cal.minutes = Number(value);
      return renderCalendarMenu();
    case 'cal-open':
      return openInCalendar();
    case 'plan-day':
      return openPlan(el);
    case 'plan-download':
      return downloadPlan();
    case 'collapse':
      if (state.collapsed.has(el.dataset.id)) state.collapsed.delete(el.dataset.id);
      else state.collapsed.add(el.dataset.id);
      return render();
    case 'when':
      state.when = value;
      return render();
    case 'quadrant':
      state.quadrant = value;
      if (state.view === 'matrix' && value !== 'all') state.view = 'list';
      return render();
    case 'area':
      // Папка или заметка открывается целиком; дату и квадрант можно выбрать после.
      state.area = el.dataset.area ?? value;
      state.when = 'all';
      state.quadrant = 'all';
      return render();
    case 'clear-area':
      state.area = '';
      return render();
    case 'view':
      state.view = el.dataset.view;
      if (state.when === 'done') state.when = 'all';
      return render();
    case 'add-here':
      state.qa.target = { path: el.dataset.path };
      renderQuickAdd();
      return document.getElementById('qa-text').focus();
    case 'qa-priority':
      state.qa.priority = value || null;
      renderQuickAdd();
      return document.getElementById('qa-text').focus();
    case 'qa-date':
      state.qa.date = value || null;
      renderQuickAdd();
      return document.getElementById('qa-text').focus();
    case 'undo':
      try {
        await api('/api/undo', { opId: el.dataset.op });
        await load();
        return toast('Отменено');
      } catch (err) {
        return toast(err.message, { error: true });
      }
    default:
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'ed-text') state.editing.draft.description = e.target.value;
  if (e.target.id === 'search') {
    state.search = e.target.value.trim();
    render();
  }
});

document.addEventListener('change', (e) => {
  const { target } = e;
  if (target.id === 'sort') {
    state.sort = target.value;
    render();
  } else if (target.id === 'qa-target') {
    state.qa.target = JSON.parse(target.value);
  } else if (target.id === 'qa-date-input') {
    state.qa.date = target.value || null;
    renderQuickAdd();
  } else if (target.id === 'qa-due-input') {
    state.qa.due = target.value || null;
    renderQuickAdd();
  } else if (target.id === 'ed-note') {
    state.editing.draft.target = JSON.parse(target.value);
  } else if (target.dataset.plan) {
    updatePlan(target);
  } else if (target.id === 'cal-date' || target.id === 'cal-time') {
    if (target.value) state.cal[target.id.slice(4)] = target.value;
    renderCalendarMenu(target.id);
  } else if (target.matches('.editor .date-input')) {
    state.editing.draft[target.dataset.field] = target.value || null;
    render();
  }
});

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, textarea, select');
  if (e.key === 'Escape') {
    closePopover();
    if (state.editing || state.addingSub) closeEditor();
    else if (typing) e.target.blur();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'KeyN') {
    e.preventDefault();
    document.getElementById('qa-text').focus();
  } else if (e.key === '/' || e.code === 'Slash') {
    e.preventDefault();
    document.getElementById('search').focus();
  }
});

// --- Названия для ссылок: [Название](ссылка) вместо голого адреса, как у Auto Link Title.

const pendingTitles = new Set();
const plainText = (s) => s.replace(/\[((?:[^[\]]|\[[^\]]*\])*)\]\(\S+?\)/g, '$1').replace(/\\([[\]|])/g, '$1');
const shorten = (s, max = 40) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const bareUrls = (text) => [...text.matchAll(TOKEN)].filter((m) => m[5]).map((m) => ({ url: m[5], index: m.index }));
const waitTitles = () => Promise.race([Promise.allSettled([...pendingTitles]), new Promise((done) => setTimeout(done, 4000))]);

function withTitle(text, url, title) {
  const hit = bareUrls(text).find((u) => u.url === url);
  if (!hit) return text;
  return `${text.slice(0, hit.index)}[${title.replace(/([[\]])/g, '\\$1')}](${url})${text.slice(hit.index + url.length)}`;
}

async function fillTitle(inputId, url) {
  document.getElementById(inputId)?.classList.add('fetching');
  try {
    const { title } = await api('/api/title', { url });
    const el = document.getElementById(inputId);
    if (inputId === 'ed-text' && state.editing) {
      state.editing.draft.description = withTitle(state.editing.draft.description, url, title);
      if (el) el.value = state.editing.draft.description;
    } else if (el) {
      el.value = withTitle(el.value, url, title);
    }
  } catch (err) {
    toast(`Название для ссылки не получено: ${err.message}`);
  } finally {
    document.getElementById(inputId)?.classList.remove('fetching');
  }
}

document.addEventListener('paste', (e) => {
  const input = e.target.closest?.('#qa-text, #ed-text, #sub-text');
  const text = e.clipboardData?.getData('text/plain').trim() ?? '';
  if (!input || !/^https?:\/\/\S+$/.test(text)) return;
  const job = fillTitle(input.id, text);
  pendingTitles.add(job);
  job.finally(() => pendingTitles.delete(job));
});

async function titlesForDraft() {
  const draft = state.editing?.draft;
  if (!draft) return;
  const urls = [...new Set(bareUrls(draft.description).map((u) => u.url))];
  document.getElementById('ed-text')?.classList.add('fetching');
  const results = await Promise.allSettled(urls.map((url) => api('/api/title', { url })));
  if (state.editing?.draft !== draft) return;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') draft.description = withTitle(draft.description, urls[i], r.value.title);
  });
  render();
  document.getElementById('ed-text')?.focus();
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed) toast(`Не нашлось названий для ${failed} из ${urls.length} ссылок, они остались как есть`);
}

// --- Подсказки в поле новой задачи: ! — квадрант, @ — дата, # — заметка.

const suggest = { items: [], index: 0, start: 0, end: 0 };
const qaText = document.getElementById('qa-text');
const suggestBox = document.getElementById('suggest');

function suggestions(trigger, query) {
  const q = query.toLowerCase();
  const fits = (...texts) => !q || texts.some((s) => String(s).toLowerCase().includes(q));
  if (trigger === '!') {
    return QUADRANTS.filter((x, i) => fits(x.short, x.title, x.hint, x.key, i + 1)).map((x) => ({
      group: 'Квадрант',
      icon: x.emoji || '·',
      label: x.priority ? `${x.short} · ${x.title}` : 'Без квадранта',
      hint: x.hint,
      apply: () => { state.qa.priority = x.priority; },
    }));
  }
  if (trigger === '@') {
    const today = state.r.today;
    const typed = q ? dateWord(q) : null;
    const days = new Map(typed ? [[typed, capitalize(fmtDate(typed))]] : []);
    const options = [['Сегодня', today], ['Завтра', addDays(today, 1)], ['Послезавтра', addDays(today, 2)],
      ...WEEKDAYS_FULL.map((name, d) => [capitalize(name), nextWeekday(today, d)]), ['Через неделю', addDays(today, 7)]];
    for (const [label, iso] of options) {
      if (days.size >= 6) break;
      if (!days.has(iso) && fits(label, longDate(iso))) days.set(iso, label);
    }
    const list = [...days];
    return [
      ...list.map(([iso, label]) => ({ group: '⏳ Запланировать', icon: '⏳', label, hint: longDate(iso), apply: () => { state.qa.date = iso; } })),
      ...list.map(([iso, label]) => ({ group: '📅 Срок', icon: '📅', label, hint: longDate(iso), apply: () => { state.qa.due = iso; } })),
    ];
  }
  const items = [];
  for (const f of state.data.files) {
    if (f.archived) continue;
    const name = basename(f.path);
    const folder = f.path.split('/').slice(0, -1).join(' / ') || 'Корень';
    if (fits(name, f.path)) items.push({ group: 'Заметка', icon: '📄', label: name, hint: folder, apply: () => { state.qa.target = { path: f.path }; } });
    for (const s of f.sections.length > 1 ? f.sections : []) {
      if (fits(name, s)) items.push({ group: 'Заметка', icon: '§', label: `${name} › ${s}`, hint: folder, apply: () => { state.qa.target = { path: f.path, section: s }; } });
    }
  }
  return items.slice(0, 14);
}

function renderSuggest() {
  const open = suggest.items.length > 0;
  qaText.setAttribute('aria-expanded', open);
  suggestBox.hidden = !open;
  if (!open) return;
  let group;
  suggestBox.innerHTML = suggest.items.map((item, i) => {
    const head = item.group !== group ? `<div class="suggest-group">${esc(item.group)}</div>` : '';
    group = item.group;
    return `${head}
      <div class="suggest-item${i === suggest.index ? ' on' : ''}" role="option" aria-selected="${i === suggest.index}" data-index="${i}">
        <span class="suggest-icon">${item.icon}</span><span>${esc(item.label)}</span><span class="suggest-hint">${esc(item.hint)}</span>
      </div>`;
  }).join('');
  suggestBox.querySelector('.suggest-item.on')?.scrollIntoView({ block: 'nearest' });
}

function updateSuggest() {
  const caret = qaText.selectionStart ?? qaText.value.length;
  const m = qaText.value.slice(0, caret).match(/(?:^|\s)([!@#])([^\s!@#]*)$/u);
  suggest.items = m && state.data ? suggestions(m[1], m[2]) : [];
  suggest.index = 0;
  if (m) Object.assign(suggest, { start: caret - m[2].length - 1, end: caret });
  renderSuggest();
}

function closeSuggest() {
  suggest.items = [];
  renderSuggest();
}

// Выбор подсказки убирает набранное слово из текста и выставляет квадрант, дату или заметку.
function chooseSuggestion(i) {
  const item = suggest.items[i];
  if (!item) return;
  const before = qaText.value.slice(0, suggest.start);
  qaText.value = before + qaText.value.slice(suggest.end).replace(/^\s+/, '');
  item.apply();
  closeSuggest();
  renderQuickAdd();
  qaText.focus();
  qaText.setSelectionRange(before.length, before.length);
}

qaText.addEventListener('input', updateSuggest);
qaText.addEventListener('click', updateSuggest);
qaText.addEventListener('blur', closeSuggest);
qaText.addEventListener('keydown', (e) => {
  if (suggestBox.hidden || e.isComposing) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = suggest.items.length;
    suggest.index = (suggest.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    renderSuggest();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    chooseSuggestion(suggest.index);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeSuggest();
  }
});
suggestBox.addEventListener('mousedown', (e) => {
  const item = e.target.closest('.suggest-item');
  if (!item) return;
  e.preventDefault();
  chooseSuggestion(Number(item.dataset.index));
});

// --- Перетаскивание: в матрице меняет квадрант; на заметку, раздел или другую задачу — переносит.

let dragged = null;

function dropTarget(e) {
  if (!dragged) return null;
  const quad = e.target.closest?.('.quad');
  if (quad) return { el: quad, kind: 'quad' };
  const note = e.target.closest?.('[data-drop-note]');
  if (note) return { el: note, kind: 'note' };
  const row = e.target.closest?.('.tree .task');
  const t = row && state.byKey.get(row.dataset.key);
  if (!t || t.key === dragged.key || ancestors(t).some((a) => a.key === dragged.key)) return null;
  return { el: row, kind: 'after', task: t };
}

const clearDrop = () => {
  for (const el of document.querySelectorAll('.drop, .drop-after')) el.classList.remove('drop', 'drop-after');
};

// Пока задача в руке, список не перерисовывается; отложенное обновление применяется после.
function endDrag() {
  dragged = null;
  clearDrop();
  document.querySelector('.task.dragging')?.classList.remove('dragging');
  document.body.classList.remove('drag-task');
  if (state.pendingReload && !state.editing && !state.addingSub) scheduleReload();
}

document.addEventListener('dragstart', (e) => {
  const row = e.target.closest?.('.task[draggable]');
  if (!row) return;
  dragged = state.byKey.get(row.dataset.key);
  e.dataTransfer.setData('text/plain', row.dataset.key);
  e.dataTransfer.effectAllowed = 'move';
  row.classList.add('dragging');
  document.body.classList.add('drag-task');
});
document.addEventListener('dragend', endDrag);
document.addEventListener('dragover', (e) => {
  const target = dropTarget(e);
  if (!target) return clearDrop();
  e.preventDefault();
  const cls = target.kind === 'after' ? 'drop-after' : 'drop';
  if (target.el.classList.contains(cls)) return;
  clearDrop();
  target.el.classList.add(cls);
});
document.addEventListener('drop', (e) => {
  const target = dropTarget(e);
  const t = dragged;
  endDrag();
  if (!target || !t) return;
  e.preventDefault();
  if (target.kind === 'quad') return setPriority(t, target.el.dataset.drop || null);
  if (target.kind === 'after') {
    return mutate('/api/move', { ...ref(t), to: { path: target.task.path, after: ref(target.task) } },
      `Перенесено после «${shorten(plainText(target.task.description))}»`);
  }
  const { dropNote, section } = target.el.dataset;
  const to = section ? { path: dropNote, section } : { path: dropNote };
  return mutate('/api/move', { ...ref(t), to }, `Перенесено в «${basename(dropNote)}${section ? ` › ${section}` : ''}»`);
});

// --- Живое обновление: заметки поменялись в Obsidian — перечитываем.

let reloadTimer;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    if (state.editing || state.addingSub || dragged) state.pendingReload = true;
    else load().catch((err) => toast(err.message, { error: true }));
  }, 120);
}

// Интерфейс обновили — перезагружаем вкладку, но не посреди правки или ввода.
function reloadPage() {
  const busy = state.editing || state.addingSub || dragged || document.getElementById('qa-text').value.trim();
  if (busy) setTimeout(reloadPage, 3000);
  else location.reload();
}

let pageVersion;
const events = new EventSource('/api/events');
events.addEventListener('change', scheduleReload);
// Версия приходит при каждом подключении. Повторная — значит, сервер перезапускался:
// перечитываем задачи, а если поменялся интерфейс, перезагружаем вкладку.
events.addEventListener('version', ({ data }) => {
  if (pageVersion === undefined) pageVersion = data;
  else if (data !== pageVersion) reloadPage();
  else scheduleReload();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleReload();
});

load().catch((err) => {
  document.getElementById('content').innerHTML = `<div class="empty">Не удалось загрузить задачи: ${esc(err.message)}. Проверь, что сервер запущен.</div>`;
});
