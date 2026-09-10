import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveChartProjection, decimateLiveTimestamps, projectLiveChartPoint, unionLiveTimestamps, splitLiveChartLineSegments } from '../lib/liveChart';
import type { LiveChartSeries } from '../lib/liveChart';

test('live chart uses a stable union axis and explicit null holes', () => {
  const a = ['2026-09-10T00:00:00Z', '2026-09-10T02:00:00Z'];
  const b = ['2026-09-10T01:00:00Z', '2026-09-10T02:00:00Z'];
  assert.deepEqual(unionLiveTimestamps([{ timestamps: a }, { timestamps: b }]), [a[0], b[0], a[1]]);
  assert.deepEqual([10, undefined, 12].map((v) => v ?? null), [10, null, 12]);
});

test('chart decimation is shared by labels, values and projection', () => {
  const timestamps = decimateLiveTimestamps(['2026-09-10T00:00:00Z', '2026-09-10T01:00:00Z', '2026-09-10T02:00:00Z', '2026-09-10T03:00:00Z', '2026-09-10T04:00:00Z', '2026-09-10T05:00:00Z'], 5);
  const projection = createLiveChartProjection(timestamps, [100, 200, 300, 400, 500], 600);
  const first = projectLiveChartPoint(timestamps[0], 100, projection);
  const last = projectLiveChartPoint(timestamps.at(-1)!, 500, projection);
  assert.equal(first.x, projection.left);
  assert.equal(first.y, projection.bottom);
  assert.equal(last.x, projection.right);
  assert.equal(last.y, projection.top);
});

test('projection uses chart-kit padding and index/value formulas exactly', () => {
  const timestamps = ['a', 'b', 'c'];
  const projection = createLiveChartProjection(timestamps, [100, 200], 400, 220);
  assert.deepEqual(projectLiveChartPoint('b', 150, projection), { x: 176, y: 98.5 });
  assert.equal(projection.left, 64);
  assert.equal(projection.right, 288);
});

test('projection clamps overlay points to the same chart bounds', () => {
  const timestamps = ['2026-09-10T00:00:00Z', '2026-09-10T01:00:00Z'];
  const projection = createLiveChartProjection(timestamps, [100, 200], 400);
  const point = projectLiveChartPoint(timestamps[1], 999, projection);
  assert.deepEqual(point, { x: projection.right, y: projection.top });
});

test('dashed segment poll endpoint is projected to a later x position', () => {
  const from = '2026-09-10T12:00:00Z';
  const to = '2026-09-10T12:05:00Z';
  const timestamps = unionLiveTimestamps([{ timestamps: [from] }, { timestamps: [to] }]);
  const projection = createLiveChartProjection(timestamps, [100, 100], 400);
  assert.ok(projectLiveChartPoint(to, 100, projection).x > projectLiveChartPoint(from, 100, projection).x);
});

test('sparse series become separate render segments around null timestamps', () => {
  const timestamps = ['a', 'b', 'c', 'd'];
  const points = (['a', 'b', 'd'] as const).map((timestamp, i) => ({ key: 'k', itemId: 'T4_BAG', city: 'Caerleon' as const, quality: 1 as const, timestamp, value: i + 1 }));
  const series: LiveChartSeries[] = [{ key: 'k', city: 'Caerleon', color: '#fff', points, dashedSegments: [] }];
  assert.deepEqual(splitLiveChartLineSegments(series, timestamps).map((segment) => segment.points.map((point) => point.timestamp)), [['a', 'b']]);
});
