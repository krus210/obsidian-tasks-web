import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarUrl } from '../public/calendar.js';

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
