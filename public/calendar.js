// Ссылка на новое событие Google Календаря с заполненными полями: Google открывает
// форму события, остаётся проверить время и нажать «Сохранить». Время локальное,
// часовой пояс передаётся отдельно (ctz).

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

export function calendarUrl({ title, details, date, time, minutes, timeZone }) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const start = new Date(y, m - 1, d, hh, mm);
  const end = new Date(y, m - 1, d, hh, mm + minutes);
  const params = { action: 'TEMPLATE', text: title, dates: `${stamp(start)}/${stamp(end)}`, details, ctz: timeZone };
  const query = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `https://calendar.google.com/calendar/render?${query}`;
}
