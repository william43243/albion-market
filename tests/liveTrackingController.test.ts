import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveTrackingController, callsPerMinute, LIVE_RETENTION_MAX_POINTS_PER_SERIES, type LiveConfig } from '../lib/liveTrackingController';
import { createLiveChartProjection, projectLiveChartPoint, unionLiveTimestamps } from '../lib/liveChart';
import type { PriceData } from '../lib/api';

const price = (timestamp = '2026-09-10T12:00:00Z'): PriceData => ({ item_id: 'T4_BAG', city: 'Caerleon', quality: 1, sell_price_min: 100, sell_price_min_date: timestamp, sell_price_max: 100, sell_price_max_date: timestamp, buy_price_min: 90, buy_price_min_date: timestamp, buy_price_max: 90, buy_price_max_date: timestamp });
const config: LiveConfig = { itemIds: ['T4_BAG'], cities: ['Caerleon'], server: 'americas', quality: 1 };
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

test('supports 5s, 1m and 5m cadences and defaults to 1m', () => {
  assert.equal(callsPerMinute('5s'), 12); assert.equal(callsPerMinute('1m'), 1); assert.equal(callsPerMinute('5m'), 0.2);
  const controller = createLiveTrackingController({ fetchPrices: async () => [], setTimeout: (() => 0) as unknown as typeof setTimeout, clearTimeout: () => undefined });
  controller.start(config); assert.equal(controller.getConfig()?.cadence, undefined);
});

test('does not overlap a stopped request and polls the restarted generation after it settles', async () => {
  let resolveFirst!: (value: PriceData[]) => void;
  let calls = 0;
  const first = new Promise<PriceData[]>((resolve) => { resolveFirst = resolve; });
  const controller = createLiveTrackingController({ fetchPrices: async () => { calls++; if (calls === 1) return first; return [price()]; } });
  controller.start(config); controller.stop(); controller.start({ ...config, cadence: '5s' });
  assert.equal(calls, 1);
  resolveFirst([]); await flush(); await flush();
  assert.equal(calls, 2);
  controller.stop();
});

test('429 suspends without any automatic timer and resume starts exactly one fresh request', async () => {
  let calls = 0; const states: string[] = []; const timers: (() => void)[] = [];
  const controller = createLiveTrackingController({ fetchPrices: async () => { calls++; if (calls === 1) throw new Error('API error: 429'); return [price()]; }, onUpdate: (s) => states.push(s.state), setTimeout: ((fn: () => void) => { timers.push(fn); return timers.length as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout, clearTimeout: () => undefined });
  controller.start(config); await controller.pollNow();
  assert.equal(calls, 1); assert.equal(controller.getSnapshot().state, 'suspended'); assert.equal(timers.length, 0); assert.equal(controller.getSnapshot().nextRetryAt, undefined);
  controller.resume(); await controller.pollNow();
  assert.equal(calls, 2); assert.equal(controller.getSnapshot().state, 'running'); assert.ok(states.includes('suspended'));
  controller.stop();
});

test('timeout and 5xx retry, while identical timestamps are not new data', async () => {
  let calls = 0; const timers: (() => void)[] = [];
  const controller = createLiveTrackingController({
    fetchPrices: async () => { calls++; if (calls === 1) throw new Error('timeout'); if (calls === 2) throw new Error('API error: 503'); return [price()]; },
    setTimeout: ((fn: () => void) => { timers.push(fn); return timers.length as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout,
    clearTimeout: () => undefined,
  });
  controller.start(config);
  await flush();
  timers.shift()!();
  await flush();
  timers.shift()!();
  await flush();
  assert.equal(calls, 3); assert.equal(controller.getSnapshot().status, 'new-data');
  await flush();
  await controller.pollNow();
  assert.equal(controller.getSnapshot().status, 'no-new-data');
  controller.stop();
});

test('unchanged polls aggregate one dashed segment per series from its latest point', async () => {
  const responses = [[price('2026-09-10T12:00:00Z'), price('2026-09-10T12:01:00Z')], [price('2026-09-10T12:02:00Z')], [price('2026-09-10T12:02:00Z')], [price('2026-09-10T12:02:00Z')]];
  const controller = createLiveTrackingController({ fetchPrices: async () => responses.shift() ?? [], now: () => Date.parse('2026-09-10T12:03:00Z') });
  controller.start({ ...config, cadence: '5m' });
  await flush();
  await controller.pollNow();
  await controller.pollNow();
  await controller.pollNow();
  const segments = controller.getSnapshot().dashedSegments;
  assert.equal(segments.length, 1);
  assert.equal(segments[0].from.timestamp, '2026-09-10T12:02:00Z');
  assert.ok(Date.parse(segments[0].to.timestamp) > Date.parse(segments[0].from.timestamp));
  const projectionTimestamps = unionLiveTimestamps([{ timestamps: [segments[0].from.timestamp, segments[0].to.timestamp] }]);
  const projection = createLiveChartProjection(projectionTimestamps, [segments[0].from.value, segments[0].to.value], 400);
  assert.ok(projectLiveChartPoint(segments[0].to.timestamp, segments[0].to.value, projection).x > projectLiveChartPoint(segments[0].from.timestamp, segments[0].from.value, projection).x);
  assert.equal(segments[0].polls, 2);
  controller.stop();
});

test('partial live response marks an omitted series no-data and never draws its dashed continuation', async () => {
  const responses = [[price('2026-09-10T12:00:00Z'), { ...price('2026-09-10T12:00:00Z'), city: 'Bridgewatch' as const }], [price('2026-09-10T12:01:00Z')]];
  const controller = createLiveTrackingController({ fetchPrices: async () => responses.shift() ?? [], now: () => Date.parse('2026-09-10T12:02:00Z') });
  controller.start({ ...config, cities: ['Caerleon', 'Bridgewatch'] });
  await flush();
  await controller.pollNow();
  const snapshot = controller.getSnapshot();
  assert.deepEqual(snapshot.noDataSeries, ['T4_BAG|Bridgewatch|1']);
  assert.equal(snapshot.dashedSegments.some((segment) => segment.key === 'T4_BAG|Bridgewatch|1'), false);
  assert.equal(snapshot.seriesCount, 2);
  controller.stop();
});

test('100 unchanged polls keep one bounded dashed segment and preserve poll count', async () => {
  const controller = createLiveTrackingController({ fetchPrices: async () => [price('2026-09-10T12:00:00Z')], now: () => Date.parse('2026-09-10T13:40:00Z') });
  controller.start(config);
  await flush();
  for (let index = 0; index < 100; index += 1) await controller.pollNow();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.pollCount, 101);
  assert.equal(snapshot.seriesCount, 1);
  assert.equal(snapshot.dashedSegments.length, 1);
  assert.equal(snapshot.dashedSegments[0].polls, 100);
  controller.stop();
});

test('1000 distinct polls retain a bounded history, the latest point, and the dashed segment', async () => {
  let calls = 0;
  let latestTimestamp = '';
  const controller = createLiveTrackingController({
    fetchPrices: async () => {
      calls += 1;
      if (calls <= 1000) latestTimestamp = new Date(Date.parse('2026-09-10T12:00:00Z') + (calls - 1) * 1_000).toISOString();
      return [price(latestTimestamp)];
    },
    now: () => Date.parse('2026-09-10T13:00:00Z'),
    setTimeout: (() => 0) as unknown as typeof setTimeout,
    clearTimeout: () => undefined,
  });
  controller.start(config);
  await flush();
  for (let index = 1; index < 1000; index += 1) await controller.pollNow();
  const beforeUnchanged = controller.getSnapshot();
  assert.equal(calls, 1000);
  assert.equal(beforeUnchanged.points.length, LIVE_RETENTION_MAX_POINTS_PER_SERIES);
  assert.equal(beforeUnchanged.points.at(-1)?.timestamp, latestTimestamp);
  assert.equal(new Set(beforeUnchanged.points.map((point) => point.timestamp)).size, beforeUnchanged.points.length);

  await controller.pollNow();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.pollCount, 1001);
  assert.equal(snapshot.points.at(-1)?.timestamp, latestTimestamp);
  assert.equal(snapshot.dashedSegments.length, 1);
  assert.equal(snapshot.dashedSegments[0].from.timestamp, latestTimestamp);
  assert.equal(snapshot.dashedSegments[0].polls, 1);
  controller.stop();
});

test('stopping during network backoff cancels the backoff and allows a restart', async () => {
  let calls = 0; const timerIds: number[] = []; const cleared: number[] = [];
  const controller = createLiveTrackingController({
    fetchPrices: async () => { calls++; throw new Error('network timeout'); },
    setTimeout: ((fn: () => void) => { timerIds.push(timerIds.length + 1); return timerIds[timerIds.length - 1] as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout,
    clearTimeout: ((id) => { cleared.push(id as unknown as number); }) as typeof clearTimeout,
  });
  controller.start(config); await flush();
  assert.equal(calls, 1); assert.equal(timerIds.length, 1);
  controller.stop();
  assert.deepEqual(cleared, [1]);
  controller.start({ ...config, cadence: '5m' });
  await flush();
  assert.equal(calls, 2);
  controller.stop();
});
