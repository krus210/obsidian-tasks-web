import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTaskLine, nextRecurrence, parseTaskLine } from '../lib/task-line.mjs';

test('читает поля Tasks с конца строки', () => {
  const t = parseTaskLine('- [ ] проверить гипотезу [пр](https://x.y/a#b) 🔼 ➕ 2026-10-15 ⏳ 2026-10-26 📅 2026-10-30');
  assert.equal(t.description, 'проверить гипотезу [пр](https://x.y/a#b)');
  assert.equal(t.priority, 'medium');
  assert.equal(t.created, '2026-10-15');
  assert.equal(t.scheduled, '2026-10-26');
  assert.equal(t.due, '2026-10-30');
  assert.equal(t.status, ' ');
});

test('повтор, id и зависимости', () => {
  const t = parseTaskLine('- [x] Собрать отчёт ⛔ tl3zo8 🔺 🔁 every week on Monday ➕ 2026-10-05 ✅ 2026-10-06');
  assert.deepEqual(t.dependsOn, ['tl3zo8']);
  assert.equal(t.priority, 'highest');
  assert.equal(t.recurrence, 'every week on Monday');
  assert.equal(t.done, '2026-10-06');
  assert.equal(t.description, 'Собрать отчёт');
});

test('нестандартный порядок и поле без пробела', () => {
  const t = parseTaskLine('- [ ] Лекция [Доклад](https://y.t/w?v=1)➕ 2026-10-11 ⏫ ');
  assert.equal(t.description, 'Лекция [Доклад](https://y.t/w?v=1)');
  assert.equal(t.priority, 'high');
  assert.equal(formatTaskLine(t), '- [ ] Лекция [Доклад](https://y.t/w?v=1) ⏫ ➕ 2026-10-11');
});

test('эмодзи внутри описания остаётся описанием', () => {
  const t = parseTaskLine('\t- [ ] сделать ⏫ потом #tag');
  assert.equal(t.description, 'сделать ⏫ потом #tag');
  assert.equal(t.priority, undefined);
  assert.equal(t.prefix, '\t- ');
});

test('строка в каноническом порядке не меняется', () => {
  const line = '- [x] Создать документ 🆔 tl3zo8 🔼 ➕ 2026-10-05 ⏳ 2026-10-07 ✅ 2026-10-07';
  assert.equal(formatTaskLine(parseTaskLine(line)), line);
});

test('не задача', () => {
  assert.equal(parseTaskLine('- обычный пункт'), null);
  assert.equal(parseTaskLine('текст [ ] в строке'), null);
});

test('следующий повтор', () => {
  const at = (recurrence, dates, today = '2026-10-26') => nextRecurrence({ recurrence, ...dates }, today);
  assert.deepEqual(at('every week on Monday', { scheduled: '2026-10-26' }), { scheduled: '2026-11-02' });
  assert.deepEqual(at('every week on Tuesday', { scheduled: '2026-10-27' }), { scheduled: '2026-11-03' });
  assert.deepEqual(at('every 2 days', { scheduled: '2026-10-26', due: '2026-10-28' }), { scheduled: '2026-10-28', due: '2026-10-30' });
  assert.deepEqual(at('every weekday', { due: '2026-10-30' }), { due: '2026-11-02' });
  assert.deepEqual(at('every month', { due: '2026-01-31' }), { due: '2026-02-28' });
  assert.deepEqual(at('every month on the 31st', { due: '2026-01-31' }), { due: '2026-03-31' });
  assert.deepEqual(at('every week on monday, thursday', { scheduled: '2026-10-26' }), { scheduled: '2026-10-29' });
  assert.deepEqual(at('every 2 weeks on Monday', { scheduled: '2026-10-26' }), { scheduled: '2026-11-09' });
  assert.deepEqual(at('every day when done', { scheduled: '2026-10-01' }), { scheduled: '2026-10-27' });
  assert.deepEqual(at('every week', {}), {});
  assert.equal(at('every month on the last Friday', { due: '2026-10-30' }), null);
});
