import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Europe/Moscow';
const { calendarUrl, icsCalendar } = await import('../public/calendar.js');

test('ссылка на событие: название, время, длительность и часовой пояс', () => {
  const url = new URL(calendarUrl({
    title: 'Прочитать [статью] & заметки',
    details: 'https://x.y/a?b=1',
    date: '2026-10-28',
    time: '10:00',
    minutes: 30,
    timeZone: 'Europe/Moscow',
  }));
  assert.equal(`${url.origin}${url.pathname}`, 'https://calendar.google.com/calendar/render');
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('text'), 'Прочитать [статью] & заметки');
  assert.equal(url.searchParams.get('dates'), '20261028T100000/20261028T103000');
  assert.equal(url.searchParams.get('details'), 'https://x.y/a?b=1');
  assert.equal(url.searchParams.get('ctz'), 'Europe/Moscow');
});

test('событие через полночь переходит на следующий день и месяц', () => {
  const url = new URL(calendarUrl({ title: 'x', date: '2026-10-31', time: '23:30', minutes: 90 }));
  assert.equal(url.searchParams.get('dates'), '20261031T233000/20261101T010000');
  assert.equal(url.searchParams.has('details'), false);
  assert.equal(url.searchParams.has('ctz'), false);
});

const unfold = (ics) => ics.replace(/\r\n /g, '');

test('файл .ics: время в UTC, событие на весь день и экранирование', () => {
  const ics = icsCalendar([
    { id: 'a', title: 'Созвон, план; итоги', details: 'https://x.y\nЗаметка: 20 WORK/a.md', date: '2026-10-28', time: '10:00', minutes: 30 },
    { id: 'b', title: 'C:\\путь', date: '2026-10-31' },
  ], new Date('2026-10-27T12:00:00Z'));
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'строки разделены CRLF');
  const lines = unfold(ics).split('\r\n');
  assert.deepEqual(lines.slice(0, 5), ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//obsidian-tasks-web//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']);
  assert.ok(lines.includes('DTSTAMP:20261027T120000Z'));
  assert.ok(lines.includes('DTSTART:20261028T070000Z'));
  assert.ok(lines.includes('DTEND:20261028T073000Z'));
  assert.ok(lines.includes('SUMMARY:Созвон\\, план\\; итоги'));
  assert.ok(lines.includes('DESCRIPTION:https://x.y\\nЗаметка: 20 WORK/a.md'));
  assert.ok(lines.includes('DTSTART;VALUE=DATE:20261031'));
  assert.ok(lines.includes('DTEND;VALUE=DATE:20261101'));
  assert.ok(lines.includes('SUMMARY:C:\\\\путь'));
  assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 2);
  assert.equal(lines.at(-2), 'END:VCALENDAR');
});

test('длинные строки переносятся по 75 байт, UID постоянный для задачи и дня', () => {
  const title = 'Прочитать большую статью про архитектуру платёжных систем и записать выводы';
  const ics = icsCalendar([{ id: 'note.md::задача|2026-10-28', title, date: '2026-10-28' }]);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.ok(unfold(ics).includes(`SUMMARY:${title}`));
  const uid = (s) => s.match(/UID:(.+)/)[1];
  assert.equal(uid(ics), uid(icsCalendar([{ id: 'note.md::задача|2026-10-28', title: 'другое', date: '2026-10-28' }])));
  assert.notEqual(uid(ics), uid(icsCalendar([{ id: 'note.md::задача|2026-10-29', title, date: '2026-10-29' }])));
});
