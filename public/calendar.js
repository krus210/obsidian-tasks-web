// События для Google Календаря без API: ссылка на одно событие с заполненными полями
// и файл .ics на несколько событий, который Календарь импортирует разом.

const pad = (n) => String(n).padStart(2, '0');
const dateStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const localStamp = (d) => `${dateStamp(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const utcStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Начало и конец события в локальном времени; конец может уйти на следующий день.
function span({ date, time = '00:00', minutes = 0 }) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return { start: new Date(y, m - 1, d, hh, mm), end: new Date(y, m - 1, d, hh, mm + minutes) };
}

// Google открывает форму события: остаётся проверить время и нажать «Сохранить».
// Время локальное, часовой пояс передаётся отдельно (ctz).
export function calendarUrl({ title, details, date, time, minutes, timeZone }) {
  const { start, end } = span({ date, time, minutes });
  const params = { action: 'TEMPLATE', text: title, dates: `${localStamp(start)}/${localStamp(end)}`, details, ctz: timeZone };
  const query = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `https://calendar.google.com/calendar/render?${query}`;
}

// --- Файл .ics (RFC 5545). Время пишется в UTC, поэтому описание часового пояса не нужно.

const escapeText = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const encoder = new TextEncoder();

// Строка длиннее 75 байт продолжается на следующей, начинающейся с пробела.
function fold(line) {
  let out = '';
  let size = 0;
  for (const ch of line) {
    const bytes = encoder.encode(ch).length;
    if (size + bytes > 75) {
      out += '\r\n ';
      size = 1;
    }
    out += ch;
    size += bytes;
  }
  return out;
}

// UID зависит только от задачи и дня: Календарь узнаёт событие при повторном импорте.
function uid(id) {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (const ch of id) {
    const c = ch.codePointAt(0);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}@obsidian-tasks-web`;
}

// События с временем идут на указанный срок, без времени — на весь день.
export function icsCalendar(events, now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//obsidian-tasks-web//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const event of events) {
    lines.push('BEGIN:VEVENT', `UID:${uid(event.id)}`, `DTSTAMP:${utcStamp(now)}`);
    if (event.time) {
      const { start, end } = span(event);
      lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`);
    } else {
      const { start, end } = span({ date: event.date, minutes: 24 * 60 });
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(start)}`, `DTEND;VALUE=DATE:${dateStamp(end)}`);
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.details) lines.push(`DESCRIPTION:${escapeText(event.details)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
