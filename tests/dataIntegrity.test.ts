import assert from 'node:assert/strict';
import test from 'node:test';
import { alignHistoryByTimestamp, historyActivity, weightedAverage } from '../lib/aodpTime';
import { formatDataAge } from '../lib/api';
import { parseUserNumber } from '../lib/numberParsing';

test('parses French decimal and keeps ambiguous integer invalid', () => {
  assert.equal(parseUserNumber('1 234,50').value, 1234.5);
  assert.equal(parseUserNumber('12,5', true).valid, false);
  assert.equal(parseUserNumber('1.234').value, 1234);
});

test('aligns sparse history by timestamp without zeros or repeated values', () => {
  const a = { item_id: 'T4', location: 'Caerleon', quality: 1, data: [{ timestamp: '2026-01-01T00:00:00Z', avg_price: 10, item_count: 2 }, { timestamp: '2026-01-03T00:00:00Z', avg_price: 30, item_count: 1 }] };
  const b = { item_id: 'T4', location: 'Martlock', quality: 1, data: [{ timestamp: '2026-01-02T00:00:00Z', avg_price: 20, item_count: 1 }] };
  const aligned = alignHistoryByTimestamp([a, b]);
  assert.deepEqual(aligned.timestamps, ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z']);
  assert.deepEqual(aligned.series['T4:Caerleon:q1'], [10, null, 30]);
  assert.equal(weightedAverage(a.data), (10 * 2 + 30) / 3);
  assert.equal(historyActivity({ ...a, data: [] }).status, 'unknown');
});

test('formats changing data age from an injected current time', () => {
  const timestamp = '2026-09-09T00:00:00Z';
  const dayAfter = Date.parse('2026-09-10T00:00:00Z');
  const twoDaysAfter = Date.parse('2026-09-11T00:00:00Z');
  assert.equal(formatDataAge(timestamp, 'fr', dayAfter), '1d (9/9 00:00)');
  assert.equal(formatDataAge(timestamp, 'fr', twoDaysAfter), '2d (9/9 00:00)');
});
