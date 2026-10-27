import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { localToday } from '../lib/task-line.mjs';
import { Vault } from '../lib/vault.mjs';

const today = localToday();
let root;
let vault;

const write = (rel, text) => fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true })
  .then(() => fs.writeFile(path.join(root, rel), text));
const read = (rel) => fs.readFile(path.join(root, rel), 'utf8');
const findTask = async (rel, description) => (await vault.snapshot()).tasks.find((t) => t.path === rel && t.description === description);

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'task-web-'));
  vault = new Vault({ vault: root, inbox: '00 INBOX/INBOX.md', exclude: ['60 DOCS'], archiveFolders: ['99 ARCHIVE'] });
  await write('00 INBOX/INBOX.md', '- [ ] первая ➕ 2026-10-01\n\n\n## ARCHIVE \n\n- [x] старая ✅ 2026-10-13\n');
  await write('30 PERSONAL/30 TRY.md', [
    '',
    '- [ ] книга ⏫ ➕ 2026-09-22',
    '\t- [ ] шаг один',
    '\t- [x] шаг два ✅ 2026-10-01',
    '- [ ] другая ⏫',
    '',
    '---',
    '',
    '## ARHIVE',
    '',
    '- [x] сделано ⏫ ✅ 2026-09-23',
    '',
  ].join('\n'));
  await write('30 PERSONAL/40 CREATE.md', [
    '## WEEKLY',
    '',
    '- [ ] Дайджест ⏫ 🔁 every week on Monday ➕ 2026-10-25 ⏳ 2026-10-26',
    '',
    '---',
    '## ALL',
    '',
    '- [x] статьи ⏫ ✅ 2026-10-26',
    '',
  ].join('\n'));
  await write('30 PERSONAL/50 DAILY.md', '\n\n---\n\n## ARCHIVE\n\n- [x] позвонить ✅ 2026-09-21\n');
  await write('20 WORK/note.md', 'Epic [X-1](https://jr/x)\n');
  await write('60 DOCS/checklist.md', '- [ ] не задача\n');
});

test('снимок: задачи, родители, архив и исключения', async () => {
  const snap = await vault.snapshot();
  assert.ok(!snap.tasks.some((t) => t.path.startsWith('60 DOCS')));
  const step = snap.tasks.find((t) => t.description === 'шаг один');
  assert.equal(step.parent, 1);
  assert.equal(snap.tasks.find((t) => t.description === 'сделано').archived, true);
  assert.equal(snap.tasks.find((t) => t.description === 'Дайджест').section, 'WEEKLY');
  assert.deepEqual(snap.files.find((f) => f.path === '30 PERSONAL/40 CREATE.md').sections, ['WEEKLY', 'ALL']);
});

test('добавление в INBOX встаёт после последней открытой задачи', async () => {
  await vault.addTask({ text: 'новая ⏫ ⏳ 2026-10-27' });
  const lines = (await read('00 INBOX/INBOX.md')).split('\n');
  assert.equal(lines[1], `- [ ] новая ⏫ ➕ ${today} ⏳ 2026-10-27`);
  assert.equal(lines[4], '## ARCHIVE ');
});

test('добавление в пустую заметку с архивом и в раздел', async () => {
  await vault.addTask({ path: '30 PERSONAL/50 DAILY.md', text: 'купить' });
  assert.match(await read('30 PERSONAL/50 DAILY.md'), new RegExp(`^- \\[ \\] купить ➕ ${today}\\n\\n\\n---\\n\\n## ARCHIVE`));

  await vault.addTask({ path: '30 PERSONAL/40 CREATE.md', section: 'WEEKLY', text: 'пост' });
  const create = (await read('30 PERSONAL/40 CREATE.md')).split('\n');
  assert.equal(create[3], `- [ ] пост ➕ ${today}`);

  await vault.addTask({ path: '20 WORK/note.md', text: 'шаг' });
  assert.equal(await read('20 WORK/note.md'), `Epic [X-1](https://jr/x)\n\n- [ ] шаг ➕ ${today}\n`);
});

test('подзадача добавляется в конец блока с тем же отступом', async () => {
  const parent = await findTask('30 PERSONAL/30 TRY.md', 'книга');
  await vault.addTask({ path: parent.path, text: 'шаг три', parent: { line: parent.line, raw: parent.raw } });
  const lines = (await read('30 PERSONAL/30 TRY.md')).split('\n');
  assert.equal(lines[4], `\t- [ ] шаг три ➕ ${today}`);
  assert.equal(lines[5], '- [ ] другая ⏫');
});

test('выполненная повторяющаяся задача уходит в архив, новая копия остаётся на её месте', async () => {
  const t = await findTask('30 PERSONAL/40 CREATE.md', 'Дайджест');
  await vault.updateTask({ path: t.path, line: t.line, raw: t.raw, changes: { status: 'x' } });
  const text = await read('30 PERSONAL/40 CREATE.md');
  assert.equal(text.split('\n')[2], `- [ ] Дайджест ⏫ 🔁 every week on Monday ➕ ${today} ⏳ 2026-11-02`);
  assert.ok(text.endsWith(`## ARCHIVE\n\n- [x] Дайджест ⏫ 🔁 every week on Monday ➕ 2026-10-25 ⏳ 2026-10-26 ✅ ${today}\n`), text);
});

test('выполненная задача уходит с подзадачами в конец ARCHIVE; отмена возвращает', async () => {
  const t = await findTask('30 PERSONAL/30 TRY.md', 'книга');
  const { opId } = await vault.updateTask({ path: t.path, line: t.line, raw: t.raw, changes: { status: 'x' } });
  assert.equal(await read('30 PERSONAL/30 TRY.md'), [
    '',
    '- [ ] другая ⏫',
    '',
    '---',
    '',
    '## ARHIVE',
    '',
    '- [x] сделано ⏫ ✅ 2026-09-23',
    `- [x] книга ⏫ ➕ 2026-09-22 ✅ ${today}`,
    `\t- [x] шаг один ✅ ${today}`,
    '\t- [x] шаг два ✅ 2026-10-01',
    '',
  ].join('\n'));

  await vault.undo({ opId });
  assert.match(await read('30 PERSONAL/30 TRY.md'), /^\n- \[ \] книга ⏫ ➕ 2026-09-22\n\t- \[ \] шаг один\n/);
});

test('снятая галочка возвращает задачу из архива и открывает подзадачи, закрытые с ней', async () => {
  const t = await findTask('30 PERSONAL/30 TRY.md', 'книга');
  await vault.updateTask({ path: t.path, line: t.line, raw: t.raw, changes: { status: 'x' } });
  const archived = await findTask('30 PERSONAL/30 TRY.md', 'книга');
  assert.equal(archived.inArchive, true);
  await vault.updateTask({ path: archived.path, line: archived.line, raw: archived.raw, changes: { status: ' ' } });
  assert.equal(await read('30 PERSONAL/30 TRY.md'), [
    '',
    '- [ ] другая ⏫',
    '- [ ] книга ⏫ ➕ 2026-09-22',
    '\t- [ ] шаг один',
    '\t- [x] шаг два ✅ 2026-10-01',
    '',
    '---',
    '',
    '## ARHIVE',
    '',
    '- [x] сделано ⏫ ✅ 2026-09-23',
    '',
  ].join('\n'));
});

test('подзадача отмечается на месте, а задача без раздела архива создаёт его', async () => {
  await write('20 WORK/p.md', 'Epic\n\n- [ ] задача\n\t- [ ] подзадача ⏫\n');
  const sub = await findTask('20 WORK/p.md', 'подзадача');
  await vault.updateTask({ path: sub.path, line: sub.line, raw: sub.raw, changes: { status: '-' } });
  assert.equal(await read('20 WORK/p.md'), `Epic\n\n- [ ] задача\n\t- [-] подзадача ⏫ ❌ ${today}\n`);

  const t = await findTask('20 WORK/p.md', 'задача');
  await vault.updateTask({ path: t.path, line: t.line, raw: t.raw, changes: { status: 'x' } });
  assert.equal(await read('20 WORK/p.md'), `Epic\n\n---\n\n## ARCHIVE\n\n- [x] задача ✅ ${today}\n\t- [-] подзадача ⏫ ❌ ${today}\n`);
});

test('уборка переносит выполненные задачи над архивом в ARCHIVE по порядку', async () => {
  await write('20 WORK/s.md', '- [x] первая ✅ 2026-10-20\n- [ ] открытая\n- [-] вторая ❌ 2026-10-21\n\t- [ ] шаг\n\n## ARCHIVE\n\n- [x] старая ✅ 2026-09-01\n');
  const { count, opId } = await vault.archiveClosed();
  assert.equal(count, 3, 'две из s.md и «статьи» из 40 CREATE.md');
  assert.equal(await read('20 WORK/s.md'), `- [ ] открытая\n\n## ARCHIVE\n\n- [x] старая ✅ 2026-09-01\n- [x] первая ✅ 2026-10-20\n- [-] вторая ❌ 2026-10-21\n\t- [-] шаг ❌ ${today}\n`);
  assert.ok((await read('30 PERSONAL/40 CREATE.md')).endsWith('## ARCHIVE\n\n- [x] статьи ⏫ ✅ 2026-10-26\n'));
  await assert.rejects(vault.archiveClosed(), { status: 422 });

  await vault.undo({ opId });
  assert.match(await read('20 WORK/s.md'), /^- \[x\] первая/);
  assert.match(await read('30 PERSONAL/40 CREATE.md'), /## ALL\n\n- \[x\] статьи/);
});

test('перенос в другую заметку вместе с подзадачами; отмена возвращает обе', async () => {
  const t = await findTask('30 PERSONAL/30 TRY.md', 'книга');
  const tryBefore = await read('30 PERSONAL/30 TRY.md');
  const inboxBefore = await read('00 INBOX/INBOX.md');
  const { opId, path: dest, line } = await vault.moveTask({ path: t.path, line: t.line, raw: t.raw, to: { path: '00 INBOX/INBOX.md' } });
  assert.equal(dest, '00 INBOX/INBOX.md');
  assert.equal(line, 1);
  assert.match(await read('00 INBOX/INBOX.md'), /^- \[ \] первая ➕ 2026-10-01\n- \[ \] книга ⏫ ➕ 2026-09-22\n\t- \[ \] шаг один\n\t- \[x\] шаг два ✅ 2026-10-01\n\n/);
  assert.doesNotMatch(await read('30 PERSONAL/30 TRY.md'), /книга|шаг/);

  await vault.undo({ opId });
  assert.equal(await read('30 PERSONAL/30 TRY.md'), tryBefore);
  assert.equal(await read('00 INBOX/INBOX.md'), inboxBefore);
});

test('перенос сразу после задачи встаёт на её уровень', async () => {
  const t = await findTask('30 PERSONAL/30 TRY.md', 'другая');
  const after = await findTask('30 PERSONAL/30 TRY.md', 'шаг один');
  await vault.moveTask({ path: t.path, line: t.line, raw: t.raw, to: { after: { line: after.line, raw: after.raw } } });
  const lines = (await read('30 PERSONAL/30 TRY.md')).split('\n');
  assert.deepEqual(lines.slice(1, 5), ['- [ ] книга ⏫ ➕ 2026-09-22', '\t- [ ] шаг один', '\t- [ ] другая ⏫', '\t- [x] шаг два ✅ 2026-10-01']);

  const sub = await findTask('30 PERSONAL/30 TRY.md', 'другая');
  await vault.moveTask({ path: sub.path, line: sub.line, raw: sub.raw, to: { path: '30 PERSONAL/40 CREATE.md', section: 'WEEKLY' } });
  assert.equal((await read('30 PERSONAL/40 CREATE.md')).split('\n')[3], '- [ ] другая ⏫');
});

test('задачу нельзя перенести внутрь неё самой', async () => {
  const t = await findTask('30 PERSONAL/30 TRY.md', 'книга');
  const child = await findTask('30 PERSONAL/30 TRY.md', 'шаг один');
  await assert.rejects(vault.moveTask({ path: t.path, line: t.line, raw: t.raw, to: { after: { line: child.line, raw: child.raw } } }), { status: 422 });
});

test('конфликт, если строка изменилась в Obsidian', async () => {
  const t = await findTask('30 PERSONAL/30 TRY.md', 'другая');
  await write('30 PERSONAL/30 TRY.md', (await read('30 PERSONAL/30 TRY.md')).replace('- [ ] другая ⏫', '- [ ] другая 🔺'));
  await assert.rejects(vault.updateTask({ path: t.path, line: t.line, raw: t.raw, changes: { status: 'x' } }), { status: 409 });
});

test('строка, сдвинутая другими правками, находится по тексту', async () => {
  const t = await findTask('30 PERSONAL/30 TRY.md', 'другая');
  await write('30 PERSONAL/30 TRY.md', `- [ ] сверху\n${await read('30 PERSONAL/30 TRY.md')}`);
  await vault.updateTask({ path: t.path, line: t.line, raw: t.raw, changes: { priority: 'highest', scheduled: '2026-10-30' } });
  assert.match(await read('30 PERSONAL/30 TRY.md'), /\n- \[ \] другая 🔺 ⏳ 2026-10-30\n/);
});

test('отмена не срабатывает, если заметку уже поменяли', async () => {
  const t = await findTask('30 PERSONAL/30 TRY.md', 'другая');
  const { opId } = await vault.updateTask({ path: t.path, line: t.line, raw: t.raw, changes: { priority: null } });
  await write('30 PERSONAL/30 TRY.md', `${await read('30 PERSONAL/30 TRY.md')}x\n`);
  await assert.rejects(vault.undo({ opId }), { status: 409 });
});

test('пути вне хранилища и исключённые папки отклоняются', async () => {
  await assert.rejects(vault.addTask({ path: '../evil.md', text: 'x' }), { status: 422 });
  await assert.rejects(vault.addTask({ path: '60 DOCS/checklist.md', text: 'x' }), { status: 422 });
  await assert.rejects(vault.addTask({ path: '.obsidian/a.md', text: 'x' }), { status: 422 });
});
