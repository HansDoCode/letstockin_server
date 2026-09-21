import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReportQuery, ReportInputError } from './report-validation.js';

test('report presets normalize pagination', () => {
  assert.deepEqual(normalizeReportQuery({ period: 'weekly', page: '2', pageSize: '10' }), { period: 'weekly', from: null, to: null, page: 2, pageSize: 10 });
});

test('custom reports accept inclusive ranges up to 366 days', () => {
  assert.deepEqual(normalizeReportQuery({ period: 'custom', from: '2024-01-01', to: '2024-12-31' }).from, '2024-01-01');
  assert.throws(() => normalizeReportQuery({ period: 'custom', from: '2024-12-31', to: '2024-01-01' }), ReportInputError);
  assert.throws(() => normalizeReportQuery({ period: 'custom', from: '2023-01-01', to: '2024-01-02' }), /366/);
  assert.throws(() => normalizeReportQuery({ period: 'custom', from: '2024-02-30', to: '2024-03-01' }), /valid calendar/);
});
