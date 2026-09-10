import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLivePoll, validLiveObservation } from '../lib/liveTracking';
import type { PriceData } from '../lib/api';

const price = (overrides: Partial<PriceData> = {}): PriceData => ({ item_id: 'T4_BAG', city: 'Caerleon', quality: 1, sell_price_min: 100, sell_price_min_date: '2026-09-10T12:00:00Z', sell_price_max: 110, sell_price_max_date: '2026-09-10T12:00:00Z', buy_price_min: 90, buy_price_min_date: '2026-09-10T12:00:00Z', buy_price_max: 95, buy_price_max_date: '2026-09-10T12:00:00Z', ...overrides });

test('valid sell observation preserves real timestamp and series identity', () => { const point = validLiveObservation(price()); assert.equal(point?.value, 100); assert.equal(point?.timestamp, '2026-09-10T12:00:00Z'); assert.equal(point?.key, 'T4_BAG|Caerleon|1'); });
test('zero and sentinel observations are rejected', () => { assert.equal(validLiveObservation(price({ sell_price_min: 0 })), null); assert.equal(validLiveObservation(price({ sell_price_min_date: '0001-01-01T00:00:00' })), null); });
test('poll classification distinguishes new, unchanged and invalid data', () => { const first = classifyLivePoll([price()], new Map()); assert.equal(first.status, 'new-data'); const same = classifyLivePoll([price()], new Map([['T4_BAG|Caerleon|1', '2026-09-10T12:00:00Z']])); assert.equal(same.status, 'no-new-data'); assert.equal(classifyLivePoll([price({ sell_price_min: 0 })], new Map()).status, 'no-data'); });

test('partial live responses explicitly classify omitted expected series as no-data', () => {
  const result = classifyLivePoll([price()], new Map(), new Set(['T4_BAG|Caerleon|1', 'T4_BAG|Bridgewatch|1']));
  assert.deepEqual(result.observedSeries, ['T4_BAG|Caerleon|1']);
  assert.deepEqual(result.noDataSeries, ['T4_BAG|Bridgewatch|1']);
});
