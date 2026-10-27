// Ссылки file:// из заметок. Браузер не даёт странице с localhost открывать локальные
// файлы, поэтому их открывает система, как в Obsidian. Открываются только документы
// и папки: программы и скрипты по ссылке из заметки не запускаются.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UserError } from './vault.mjs';

const OPENER = { darwin: 'open', win32: 'explorer.exe' }[process.platform] ?? 'xdg-open';
const DOCUMENT = /\.(html?|pdf|md|txt|csv|json|png|jpe?g|gif|webp|svg|mp4|mov|mp3|m4a|docx?|xlsx?|pptx?|key|numbers|pages)$/iu;

export function localPath(url) {
  try {
    return fileURLToPath(url);
  } catch {
    throw new UserError('Нужна ссылка вида file:///путь/к/файлу');
  }
}

function launch(file) {
  const child = spawn(OPENER, [file], { detached: true, stdio: 'ignore' });
  child.on('error', (err) => console.error(`Не удалось открыть ${file}: ${err.message}`));
  child.unref();
}

export async function openLocal(url, open = launch) {
  const file = localPath(url);
  const info = await fs.stat(file).catch(() => null);
  if (!info) throw new UserError('Файл не найден');
  const allowed = info.isDirectory() ? !/\.app$/iu.test(file) : DOCUMENT.test(file);
  if (!allowed) throw new UserError('По ссылке открываются только документы и папки');
  open(file);
  return {};
}
