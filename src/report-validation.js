export class ReportInputError extends Error {
  constructor(message) { super(message); this.name = 'ReportInputError'; }
}

function calendarDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ReportInputError(`${label} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new ReportInputError(`${label} must be a valid calendar date.`);
  return value;
}

function boundedInteger(value, fallback, min, max, label) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new ReportInputError(`${label} must be a whole number from ${min} to ${max}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new ReportInputError(`${label} must be a whole number from ${min} to ${max}.`);
  return parsed;
}

export function normalizeReportQuery(query = {}) {
  const period = query.period || 'daily';
  if (!['daily', 'weekly', 'monthly', 'custom'].includes(period)) throw new ReportInputError('Period must be daily, weekly, monthly, or custom.');
  const page = boundedInteger(query.page, 1, 1, 1000000, 'Page');
  const pageSize = boundedInteger(query.pageSize, 25, 1, 100, 'Page size');
  if (period !== 'custom') return { period, from: null, to: null, page, pageSize };
  const from = calendarDate(query.from, 'From date');
  const to = calendarDate(query.to, 'To date');
  if (from > to) throw new ReportInputError('From date must not be after to date.');
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (days > 366) throw new ReportInputError('Custom report ranges cannot exceed 366 days.');
  return { period, from, to, page, pageSize };
}
