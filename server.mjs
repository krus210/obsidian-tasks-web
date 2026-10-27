#!/usr/bin/env node
// Локальный сервер: отдаёт интерфейс и API задач, следит за заметками и
// сообщает браузеру об изменениях. Слушает только 127.0.0.1.

import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTitle } from './lib/link-title.mjs';
import { Vault } from './lib/vault.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));
// Свои настройки — в config.json; без него берётся пример из репозитория.
const configFile = ['config.json', 'config.example.json'].map((f) => path.join(appDir, f)).find((f) => fs.existsSync(f));
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const vault = new Vault({ ...config, vault: path.resolve(appDir, process.env.VAULT ?? config.vault) });
const port = Number(process.env.PORT ?? config.port);

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/calendar.js': ['calendar.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};

// Страница грузит только свои файлы и шрифт с Google Fonts, а встроить её в чужой сайт нельзя.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "style-src-attr 'unsafe-inline'",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const ACTIONS = {
  '/api/add': (body) => vault.addTask(body),
  '/api/update': (body) => vault.updateTask(body),
  '/api/archive-closed': () => vault.archiveClosed(),
  '/api/move': (body) => vault.moveTask(body),
  '/api/undo': (body) => vault.undo(body),
  '/api/title': async (body) => ({ title: await fetchTitle(body.url) }),
};

// Версия страницы — хэш файлов интерфейса. Открытая вкладка сравнивает её со своей
// и перезагружается, когда интерфейс обновили.
const publicDir = path.join(appDir, 'public');
const pageVersion = () => {
  const hash = crypto.createHash('sha1');
  for (const [file] of Object.values(STATIC)) hash.update(fs.readFileSync(path.join(publicDir, file)));
  return hash.digest('hex').slice(0, 12);
};
let version = pageVersion();

const clients = new Set();
const broadcast = (message) => {
  for (const res of clients) res.write(message);
};
let versionTimer;
fs.watch(publicDir, () => {
  clearTimeout(versionTimer);
  versionTimer = setTimeout(() => {
    try {
      const next = pageVersion();
      if (next === version) return;
      version = next;
      broadcast(`event: version\ndata: ${version}\n\n`);
    } catch {
      // Файл как раз перезаписывается: после записи придёт ещё одно событие.
    }
  }, 300);
});

let notifyTimer;
fs.watch(vault.root, { recursive: true }, (_event, file) => {
  const rel = file?.split(path.sep).join('/');
  if (!rel?.endsWith('.md') || vault.isExcluded(rel)) return;
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => broadcast('event: change\ndata: {}\n\n'), 150);
});
setInterval(() => broadcast(': ping\n\n'), 30_000).unref();

function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw Object.assign(new Error('Слишком большой запрос'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Некорректный JSON'), { status: 400 });
  }
}

// Защита от чужих страниц и DNS rebinding: только свой Host, только JSON с того же Origin.
const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);

const server = http.createServer(async (req, res) => {
  try {
    if (!allowedHosts.has(req.headers.host)) return send(res, 403, { error: 'Неизвестный Host' });
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && STATIC[pathname]) {
      const [file, type] = STATIC[pathname];
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff' });
      return fs.createReadStream(path.join(appDir, 'public', file)).pipe(res);
    }
    if (req.method === 'GET' && pathname === '/api/state') return send(res, 200, await vault.snapshot());
    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      // retry: после перезапуска сервера вкладка переподключится через 2 секунды.
      res.write(`retry: 2000\nevent: version\ndata: ${version}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'POST' && ACTIONS[pathname]) {
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'Нужен JSON' });
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(res, 403, { error: 'Чужой Origin' });
      return send(res, 200, await ACTIONS[pathname](await readJson(req)));
    }
    send(res, 404, { error: 'Не найдено' });
  } catch (err) {
    if (!err.status) console.error(err);
    send(res, err.status ?? 500, { error: err.status ? err.message : 'Ошибка сервера, подробности в терминале' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Задачи: http://localhost:${port}`);
  console.log(`Хранилище: ${vault.root}`);
});
