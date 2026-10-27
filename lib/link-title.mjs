// Название страницы для ссылки — как у плагина Auto Link Title в Obsidian:
// заголовок <title>, а для YouTube и X — их oEmbed, потому что страницы
// этих сайтов собираются скриптами и сервер получает пустую оболочку.

import dns from 'node:dns/promises';
import net from 'node:net';
import { UserError } from './vault.mjs';

const TIMEOUT = 6000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 600_000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const NOT_A_TITLE = /^(log ?in|sign ?in|вход|войти|авторизация|access denied|just a moment|attention required)/i;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…' };

const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/giu, (whole, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? whole;
  return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
});
const clean = (s) => s.replace(/\s+/gu, ' ').trim();
const shorten = (s, max) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

// Куда сервер не ходит: сам компьютер, домашняя и внутренние сети.
// IPv4-правила срабатывают и для тех же адресов в виде ::ffff:a.b.c.d.
const PRIVATE = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3]]) PRIVATE.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 127], ['fc00::', 7], ['fe80::', 10]]) PRIVATE.addSubnet(address, prefix, 'ipv6');

export const isPrivateAddress = (address) => PRIVATE.check(address, `ipv${net.isIP(address)}`);

const blocked = () => new UserError('Для этой ссылки название не получить');

// Проверяется адрес, в который превращается имя сайта: имя или редирект
// могут вести на этот компьютер или во внутреннюю сеть.
async function assertPublic(url) {
  if (!['http:', 'https:'].includes(url.protocol)) throw blocked();
  const host = url.hostname.replace(/^\[(.*)\]$/u, '$1');
  let addresses;
  try {
    addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true });
  } catch {
    throw new UserError('Сайт не найден');
  }
  if (addresses.some(({ address }) => isPrivateAddress(address))) throw blocked();
}

export function extractTitle(html) {
  const meta = (name) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'iu'))?.[0]
    .match(/content=["']([^"']*)["']/iu)?.[1];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  return clean(decode(title?.trim() ? title : meta('og:title') ?? meta('twitter:title') ?? ''));
}

async function request(raw, accept) {
  let url = new URL(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublic(url);
    let res;
    try {
      res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept, 'accept-language': 'ru,en;q=0.8' },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch {
      throw new UserError('Сайт не ответил');
    }
    const location = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (!location) {
      if (!res.ok) throw new UserError(`Сайт ответил ${res.status}`);
      return res;
    }
    await res.body?.cancel();
    url = new URL(location, url);
  }
  throw new UserError('Слишком много переадресаций');
}

async function readHtml(url) {
  const res = await request(url, 'text/html,application/xhtml+xml');
  const type = res.headers.get('content-type') ?? '';
  if (!/html|xml/iu.test(type)) throw new UserError('По ссылке не страница');
  // Заголовок лежит в <head>, поэтому хватает начала документа.
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (Buffer.from(value).toString('latin1').includes('</head>')) break;
  }
  await reader.cancel().catch(() => {});
  const bytes = Buffer.concat(chunks);
  const charset = type.match(/charset=([\w-]+)/iu)?.[1]
    ?? bytes.toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/iu)?.[1]
    ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export async function fetchTitle(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new UserError('Некорректная ссылка');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw blocked();

  const host = url.hostname.replace(/^(www|m)\./u, '');
  let title;
  if (['youtube.com', 'youtu.be', 'music.youtube.com'].includes(host)) {
    const data = await (await request(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, 'application/json')).json();
    title = data.title && `${data.title} - YouTube`;
  } else if (host === 'x.com' || host === 'twitter.com') {
    const data = await (await request(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(url)}`, 'application/json')).json();
    const text = clean(decode((data.html?.match(/<p[^>]*>([\s\S]*?)<\/p>/u)?.[1] ?? '').replace(/<[^>]+>/gu, ' ')));
    title = data.author_name && `${data.author_name} on X: "${shorten(text, 120)}" / X`;
  } else {
    title = extractTitle(await readHtml(url));
  }

  title = clean(title ?? '');
  if (!title || NOT_A_TITLE.test(title)) throw new UserError('Название страницы не нашлось');
  return title;
}
