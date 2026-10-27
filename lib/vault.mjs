// Хранилище Obsidian как список задач: чтение заметок и точечные правки строк.
// Каждая правка перечитывает файл и проверяет, что строка задачи не изменилась
// с момента показа, поэтому параллельная работа в Obsidian ничего не затирает.

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { formatTaskLine, localToday, nextRecurrence, parseBody, parseTaskLine } from './task-line.mjs';

const ARCHIVE_HEADING = /^(archive|arhive|архив)$/iu;
const HEADING = /^(#{1,6})\s+(.*?)\s*$/u;
const FENCE = /^\s*(```|~~~)/u;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/u;
const PRIORITIES = new Set(['highest', 'high', 'medium', 'low', 'lowest']);
const STATUSES = new Set([' ', '/', 'x', '-']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export class UserError extends Error {
  status = 422;
}

export class ConflictError extends Error {
  status = 409;
}

const leading = (line) => line.match(/^[\s>]*/u)[0];
const indentWidth = (line) => [...leading(line)].reduce((w, ch) => w + (ch === '\t' ? 4 : 1), 0);

// Структура заметки: задачи с родителями, заголовки и раздел архива.
export function analyze(lines) {
  const tasks = [];
  const headings = [];
  const stack = [];
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end > 0) start = end + 1;
  }

  let fence = false;
  let archiveLevel = 0;
  let section = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) fence = !fence;
    if (fence || FENCE.test(line) || !line.trim()) continue;

    const h = line.match(HEADING);
    if (h) {
      const level = h[1].length;
      if (archiveLevel && level <= archiveLevel) archiveLevel = 0;
      if (!archiveLevel && ARCHIVE_HEADING.test(h[2])) archiveLevel = level;
      headings.push({ line: i, level, text: h[2], archive: archiveLevel > 0 });
      section = archiveLevel ? null : h[2];
      stack.length = 0;
      continue;
    }

    const width = indentWidth(line);
    while (stack.length && stack.at(-1).width >= width) stack.pop();
    const task = parseTaskLine(line);
    if (!task) continue;
    const entry = { ...task, line: i, raw: line, width, parent: stack.at(-1)?.line ?? null, section, inArchive: archiveLevel > 0 };
    tasks.push(entry);
    stack.push(entry);
  }

  const archiveIdx = headings.findIndex((h) => ARCHIVE_HEADING.test(h.text));
  let archive = null;
  if (archiveIdx >= 0) {
    const head = headings[archiveIdx];
    const next = headings.slice(archiveIdx + 1).find((h) => h.level <= head.level);
    archive = { heading: head.line, end: next?.line ?? lines.length };
  }
  return { start, tasks, headings, archive };
}

// Конец блока задачи: все следующие строки с бо́льшим отступом (подзадачи, заметки).
export function blockEnd(lines, start) {
  const width = indentWidth(lines[start]);
  let end = start + 1;
  for (let j = start + 1; j < lines.length; j++) {
    if (!lines[j].trim()) continue;
    if (indentWidth(lines[j]) <= width) break;
    end = j + 1;
  }
  return end;
}

// Блок задачи с новым отступом: первая строка получает indent, вложенные сохраняют разницу.
function reindent(block, indent) {
  const base = leading(block[0]);
  return block.map((l) => {
    if (!l.trim()) return l;
    return l.startsWith(base) ? indent + l.slice(base.length) : indent + l.trimStart();
  });
}

function locate(lines, line, raw) {
  if (lines[line] === raw) return line;
  const hits = lines.flatMap((l, i) => (l === raw ? [i] : []));
  if (hits.length === 1) return hits[0];
  throw new ConflictError('Задача изменилась в файле. Список обновлён, повтори действие.');
}

// Меняет статус так же, как Tasks: даты ✅/❌ и новая копия для повторяющейся задачи.
function applyStatus(task, status, today) {
  let next = null;
  if (status === 'x' && task.status !== 'x') {
    if (task.onCompletion === 'delete') throw new UserError('Задачу с 🏁 delete отметь в Obsidian.');
    if (task.recurrence) {
      const dates = nextRecurrence(task, today);
      if (!dates) throw new UserError(`Не умею повторять «🔁 ${task.recurrence}». Отметь эту задачу в Obsidian.`);
      next = formatTaskLine({ ...task, ...dates, status: ' ', created: today, done: undefined, cancelled: undefined });
    }
  }
  if (status !== 'x') task.done = undefined;
  else if (task.status !== 'x') task.done = today;
  if (status !== '-') task.cancelled = undefined;
  else if (task.status !== '-') task.cancelled = today;
  task.status = status;
  return next;
}

function cleanText(text) {
  if (typeof text !== 'string') throw new UserError('Нужен текст задачи');
  return text.replace(/\s*[\r\n]+\s*/gu, ' ').trim();
}

function insertionPoint(lines, section) {
  const info = analyze(lines);
  let from = info.start;
  let to = info.archive?.heading ?? lines.length;
  const head = section && info.headings.find((h) => h.text === section && !h.archive);
  if (head) {
    from = head.line + 1;
    to = info.headings.find((h) => h.line > head.line && (h.level <= head.level || h.archive))?.line ?? to;
  }

  const roots = info.tasks.filter((t) => t.parent === null && !t.inArchive && t.line >= from && t.line < to);
  if (roots.length) return { at: blockEnd(lines, roots.at(-1).line) };
  if (head) return { at: from };

  let at = to;
  const skipBlank = () => {
    while (at > from && !lines[at - 1].trim()) at--;
  };
  skipBlank();
  if (info.archive && at > from && RULE.test(lines[at - 1])) {
    at--;
    skipBlank();
  }
  return { at, gapBefore: at > from && Boolean(lines[at - 1].trim()), gapAfter: Boolean(lines[at]?.trim()) };
}

function insertIntoArchive(lines, block) {
  const { archive } = analyze(lines);
  if (!archive) {
    let at = lines.length;
    while (at > 0 && !lines[at - 1].trim()) at--;
    const head = at > 0 ? ['', '---', '', '## ARCHIVE', ''] : ['## ARCHIVE', ''];
    lines.splice(at, 0, ...head, ...block);
    if (at + head.length + block.length === lines.length) lines.push('');
    return;
  }
  let at = archive.end;
  while (at > archive.heading + 1 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, ...(at === archive.heading + 1 ? [''] : []), ...block);
}

export class Vault {
  constructor({ vault, inbox, exclude = [], archiveFolders = [] }) {
    this.root = path.resolve(vault);
    this.name = path.basename(this.root);
    this.inbox = inbox;
    this.exclude = exclude;
    this.archiveFolders = archiveFolders;
    this.history = [];
    this.queue = Promise.resolve();
  }

  isExcluded(rel) {
    const inside = (folder) => rel === folder || rel.startsWith(`${folder}/`);
    return rel.split('/').some((part) => part.startsWith('.')) || this.exclude.some(inside);
  }

  isArchived(rel) {
    return this.archiveFolders.some((folder) => rel.startsWith(`${folder}/`));
  }

  notePath(rel) {
    if (typeof rel !== 'string' || !rel.endsWith('.md')) throw new UserError('Нужен путь к .md-заметке');
    const abs = path.resolve(this.root, rel);
    const norm = path.relative(this.root, abs).split(path.sep).join('/');
    if (!abs.startsWith(this.root + path.sep) || this.isExcluded(norm)) throw new UserError('Заметка вне списка задач');
    return abs;
  }

  async listNotes(dir = '') {
    const entries = await fs.readdir(path.join(this.root, dir), { withFileTypes: true });
    const notes = [];
    for (const entry of entries) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (this.isExcluded(rel)) continue;
      if (entry.isDirectory()) notes.push(...(await this.listNotes(rel)));
      else if (entry.name.endsWith('.md')) notes.push(rel);
    }
    return notes.sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  }

  async snapshot() {
    const files = [];
    const tasks = [];
    for (const rel of await this.listNotes()) {
      const text = await fs.readFile(path.join(this.root, rel), 'utf8').catch((err) => {
        if (err.code === 'ENOENT') return '';
        throw err;
      });
      const info = analyze(text.split(/\r?\n/u));
      const archived = this.isArchived(rel);
      files.push({ path: rel, archived, sections: info.headings.filter((h) => !h.archive).map((h) => h.text) });
      for (const { prefix, width, inArchive, ...task } of info.tasks) {
        tasks.push({ ...task, path: rel, archived: archived || inArchive });
      }
    }
    if (!files.some((f) => f.path === this.inbox)) files.unshift({ path: this.inbox, archived: false, sections: [] });
    return { today: localToday(), vault: this.name, inbox: this.inbox, files, tasks };
  }

  // Правки идут строго по очереди. Каждая сохраняется для отмены вместе со всеми
  // затронутыми заметками; файлы пишутся в порядке paths.
  mutate(paths, label, change, { create = [], record = true } = {}) {
    const run = async () => {
      const docs = {};
      for (const rel of new Set(paths)) {
        const abs = this.notePath(rel);
        let before = '';
        try {
          before = await fs.readFile(abs, 'utf8');
        } catch (err) {
          if (err.code !== 'ENOENT' || !create.includes(rel)) throw err;
          await fs.mkdir(path.dirname(abs), { recursive: true });
        }
        docs[rel] = { abs, before, eol: before.includes('\r\n') ? '\r\n' : '\n', lines: before.split(/\r?\n/u) };
      }
      const result = change(docs, localToday()) ?? {};
      const files = Object.entries(docs)
        .map(([rel, doc]) => ({ path: rel, abs: doc.abs, before: doc.before, after: doc.lines.join(doc.eol) }))
        .filter((f) => f.after !== f.before);
      if (!files.length) return result;
      for (const f of files) await fs.writeFile(f.abs, f.after);
      if (!record) return { ...result, label };
      const op = { id: randomUUID(), label, files: files.map(({ abs, ...f }) => f) };
      this.history = [...this.history.slice(-49), op];
      return { ...result, opId: op.id, label };
    };
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }

  edit(rel, label, change, { create = false } = {}) {
    return this.mutate([rel], label, (docs, today) => change(docs[rel].lines, today), { create: create ? [rel] : [] });
  }

  addTask({ path: rel = this.inbox, section, text, parent }) {
    const body = parseBody(cleanText(text));
    if (!body.description) throw new UserError('Пустая задача');
    return this.edit(rel, 'Задача добавлена', (lines, today) => {
      const task = { ...body, created: body.created ?? today, status: ' ' };
      if (parent) {
        const p = locate(lines, parent.line, parent.raw);
        const end = blockEnd(lines, p);
        const child = lines.slice(p + 1, end).find((l) => l.trim());
        const indent = child ? leading(child) : `${leading(lines[p])}\t`;
        lines.splice(end, 0, formatTaskLine({ ...task, prefix: `${indent}- ` }));
        return { line: end };
      }
      const { at, gapBefore, gapAfter } = insertionPoint(lines, section);
      lines.splice(at, 0, ...(gapBefore ? [''] : []), formatTaskLine({ ...task, prefix: '- ' }), ...(gapAfter ? [''] : []));
      return { line: at + (gapBefore ? 1 : 0) };
    }, { create: rel === this.inbox });
  }

  updateTask({ path: rel, line, raw, changes = {} }) {
    return this.edit(rel, 'Задача изменена', (lines, today) => {
      const i = locate(lines, line, raw);
      const task = parseTaskLine(lines[i]);
      if ('description' in changes) {
        const body = parseBody(cleanText(changes.description));
        if (!body.description) throw new UserError('Пустая задача');
        Object.assign(task, body);
      }
      if ('priority' in changes) {
        if (changes.priority !== null && !PRIORITIES.has(changes.priority)) throw new UserError('Неизвестный приоритет');
        task.priority = changes.priority ?? undefined;
      }
      for (const field of ['start', 'scheduled', 'due']) {
        if (!(field in changes)) continue;
        if (changes[field] !== null && !ISO_DATE.test(changes[field])) throw new UserError('Дата в формате ГГГГ-ММ-ДД');
        task[field] = changes[field] ?? undefined;
      }
      let next = null;
      if ('status' in changes && changes.status !== task.status) {
        if (!STATUSES.has(changes.status)) throw new UserError('Неизвестный статус');
        next = applyStatus(task, changes.status, today);
      }
      lines[i] = formatTaskLine(task);
      if (next) lines.splice(i, 0, next);
    });
  }

  // Перенос задачи с подзадачами: в конец другой заметки или раздела либо сразу после
  // другой задачи на её уровне. Сначала пишется заметка-получатель, потом источник,
  // чтобы при сбое задача задвоилась, а не потерялась.
  moveTask({ path: from, line, raw, to = {} }) {
    const dest = to.path ?? from;
    return this.mutate([dest, from], 'Задача перенесена', (docs) => {
      const source = docs[from].lines;
      const start = locate(source, line, raw);
      const end = blockEnd(source, start);
      if (to.after && dest === from) {
        const target = locate(source, to.after.line, to.after.raw);
        if (target >= start && target < end) throw new UserError('Задачу нельзя перенести внутрь неё самой');
      }
      const block = source.splice(start, end - start);
      const lines = docs[dest].lines;
      if (to.after) {
        const shift = dest === from && to.after.line > start ? end - start : 0;
        const target = locate(lines, to.after.line - shift, to.after.raw);
        const at = blockEnd(lines, target);
        lines.splice(at, 0, ...reindent(block, leading(lines[target])));
        return { path: dest, line: at };
      }
      const { at, gapBefore, gapAfter } = insertionPoint(lines, to.section);
      lines.splice(at, 0, ...(gapBefore ? [''] : []), ...reindent(block, ''), ...(gapAfter ? [''] : []));
      return { path: dest, line: at + (gapBefore ? 1 : 0) };
    });
  }

  // Архив: задача с подзадачами выполняется и переезжает в конец раздела ARCHIVE той же заметки.
  archiveTask({ path: rel, line, raw }) {
    return this.edit(rel, 'Задача в архиве', (lines, today) => {
      const start = locate(lines, line, raw);
      if (analyze(lines).tasks.find((t) => t.line === start)?.inArchive) throw new UserError('Задача уже в архиве');
      const end = blockEnd(lines, start);
      const block = lines.slice(start, end);
      let next = null;
      block.forEach((text, k) => {
        const task = parseTaskLine(text);
        if (!task || !task.description || task.status === 'x' || task.status === '-') return;
        if (k > 0 && task.recurrence) throw new UserError('Повторяющуюся подзадачу отметь в Obsidian');
        const created = applyStatus(task, 'x', today);
        if (k === 0) next = created;
        block[k] = formatTaskLine(task);
      });
      lines.splice(start, end - start, ...(next ? [next] : []));
      insertIntoArchive(lines, reindent(block, ''));
    });
  }

  undo({ opId }) {
    const op = this.history.at(-1);
    if (!op || op.id !== opId) return Promise.reject(new UserError('Отменить можно только последнее действие'));
    return this.mutate(op.files.map((f) => f.path), 'Отменено', (docs) => {
      if (op.files.some((f) => docs[f.path].before !== f.after)) {
        throw new ConflictError('Заметка изменилась после действия, отмена небезопасна');
      }
      for (const f of op.files) docs[f.path].lines = f.before.split(/\r?\n/u);
      this.history.pop();
    }, { record: false });
  }
}
