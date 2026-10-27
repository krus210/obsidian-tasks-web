import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openLocal } from '../lib/local-file.mjs';

test('открываются документы и папки, но не программы и не чужие ссылки', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-web-files-'));
  const page = path.join(dir, 'итоги видео.html');
  const script = path.join(dir, 'run.sh');
  await fs.writeFile(page, '<title>x</title>');
  await fs.writeFile(script, 'echo hi');
  await fs.mkdir(path.join(dir, 'Calculator.app'));

  const opened = [];
  const open = (file) => opened.push(file);
  await openLocal(pathToFileURL(page).href, open);
  await openLocal(pathToFileURL(dir).href, open);
  assert.deepEqual(opened, [page, dir]);

  await assert.rejects(openLocal(pathToFileURL(script).href, open), { status: 422, message: /только документы/ });
  await assert.rejects(openLocal(pathToFileURL(path.join(dir, 'Calculator.app')).href, open), { status: 422 });
  await assert.rejects(openLocal(pathToFileURL(path.join(dir, 'нет.html')).href, open), { status: 422, message: /не найден/ });
  await assert.rejects(openLocal('https://example.com/a.html', open), { status: 422 });
  assert.equal(opened.length, 2);
});
