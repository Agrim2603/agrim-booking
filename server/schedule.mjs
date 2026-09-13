export const defaults = {
  hostName: 'Agrim', timeZone: 'Australia/Sydney', duration: 60,
  weekdays: [1, 2, 3, 4, 5],
  times: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'],
  excludedDates: [], leadHours: 2, horizonDays: 21,
};

export function dateParts(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
}

export function localToUTC(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = dateParts(new Date(guess), timeZone);
    const rendered = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    guess += target - rendered;
  }
  const p = dateParts(new Date(guess), timeZone);
  if (`${p.year}-${p.month}-${p.day}` !== date || `${p.hour}:${p.minute}` !== time) return null;
  return new Date(guess).toISOString();
}

export function validateSchedule(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid availability settings.');
  const s = { ...value };
  if (typeof s.hostName !== 'string' || !s.hostName.trim() || s.hostName.length > 80) throw new Error('Enter your name (up to 80 characters).');
  if (typeof s.timeZone !== 'string' || s.timeZone.length > 80) throw new Error('Choose a valid time zone.');
  try { new Intl.DateTimeFormat('en', { timeZone: s.timeZone }).format(); } catch { throw new Error('Choose a valid time zone.'); }
  if (![30, 45, 60, 90].includes(s.duration)) throw new Error('Duration must be 30, 45, 60 or 90 minutes.');
  if (!Array.isArray(s.weekdays) || !s.weekdays.length || s.weekdays.length > 7 || s.weekdays.some(x => !Number.isInteger(x) || x < 0 || x > 6)) throw new Error('Choose at least one weekday.');
  if (!Array.isArray(s.times) || !s.times.length || s.times.length > 48 || s.times.some(x => typeof x !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(x))) throw new Error('Use times like 09:00, 10:00, 14:30.');
  if (!Array.isArray(s.excludedDates) || s.excludedDates.length > 365 || s.excludedDates.some(x => typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x) || !Number.isFinite(Date.parse(x)) || new Date(x).toISOString().slice(0, 10) !== x)) throw new Error('Use valid excluded dates in YYYY-MM-DD format.');
  if (!Number.isInteger(s.leadHours) || s.leadHours < 0 || s.leadHours > 168) throw new Error('Minimum notice must be between 0 and 168 hours.');
  if (!Number.isInteger(s.horizonDays) || s.horizonDays < 1 || s.horizonDays > 90) throw new Error('Booking window must be between 1 and 90 days.');
  return { hostName: s.hostName.trim(), timeZone: s.timeZone, duration: s.duration,
    weekdays: [...new Set(s.weekdays)].sort(), times: [...new Set(s.times)].sort(),
    excludedDates: [...new Set(s.excludedDates)].sort(), leadHours: s.leadHours, horizonDays: s.horizonDays };
}

export function generateSlots(settings, reservations = [], now = new Date()) {
  const p = dateParts(now, settings.timeZone);
  const midnight = Date.UTC(+p.year, +p.month - 1, +p.day);
  const slots = [];
  for (let day = 0; day < settings.horizonDays; day++) {
    const date = new Date(midnight + day * 86400000);
    const key = date.toISOString().slice(0, 10);
    if (!settings.weekdays.includes(date.getUTCDay()) || settings.excludedDates.includes(key)) continue;
    for (const time of settings.times) {
      const start = localToUTC(key, time, settings.timeZone);
      if (!start || Date.parse(start) < now.getTime() + settings.leadHours * 3600000) continue;
      const end = Date.parse(start) + settings.duration * 60000;
      if (reservations.some(r => Date.parse(r.start) < end && Date.parse(r.start) + r.duration * 60000 > Date.parse(start))) continue;
      slots.push(start);
    }
  }
  return slots.sort();
}
