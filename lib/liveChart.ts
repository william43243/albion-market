import type { LivePoint } from './liveTracking';
import type { HistoryResponse } from './api';

export interface LiveChartSegment { key: string; city: string; color: string; from: LivePoint; to: LivePoint; style: 'solid' | 'dashed'; polls: number; }
export interface LiveChartSeries { key: string; city: string; color: string; points: LivePoint[]; dashedSegments: LiveChartSegment[]; }
export interface LiveChartProjection { timestamps: string[]; minValue: number; maxValue: number; width: number; height: number; paddingRight: number; paddingTop: number; left: number; right: number; top: number; bottom: number; }
export interface LiveChartLineSegment { key: string; city: string; color: string; points: LivePoint[]; }

export function buildLiveChartSeries(points: LivePoint[], colors: Record<string, string>, dashedSegments: LiveChartSegment[] = []): LiveChartSeries[] {
  const groups = new Map<string, LivePoint[]>();
  for (const point of points) { const list = groups.get(point.key) ?? []; if (!list.some(p => p.timestamp === point.timestamp)) list.push(point); groups.set(point.key, list); }
  return [...groups].map(([key, values]) => { const sorted = values.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)); const city = sorted[0].city; return { key, city, color: colors[city] ?? '#FFFFFF', points: sorted, dashedSegments: dashedSegments.filter((segment) => segment.key === key) }; });
}

/** A stable union axis: missing observations remain holes, never synthetic zeroes. */
export function unionLiveTimestamps(series: Array<{ timestamps: Iterable<string> }>): string[] {
  return [...new Set(series.flatMap((entry) => [...entry.timestamps]))]
    .filter((timestamp) => Number.isFinite(Date.parse(timestamp)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
}

export function decimateLiveTimestamps(timestamps: string[], maxLabels = 5): string[] {
  if (timestamps.length <= maxLabels) return [...timestamps];
  const step = Math.ceil(timestamps.length / maxLabels);
  return timestamps.filter((_, index) => index % step === 0);
}

/** These are react-native-chart-kit's LineChart defaults in v6.12.0. */
export const LIVE_CHART_PADDING_RIGHT = 64;
export const LIVE_CHART_PADDING_TOP = 16;

/** Projection shared by chart and SVG overlay, using LineChart's real index/value formulas. */
export function createLiveChartProjection(timestamps: string[], values: number[], width: number, height = 220): LiveChartProjection {
  const finiteValues = values.filter((value) => Number.isFinite(value) && value > 0);
  const paddingRight = LIVE_CHART_PADDING_RIGHT;
  const paddingTop = LIVE_CHART_PADDING_TOP;
  const bottom = ((height - height) / 4) * 3 + paddingTop + height * 0.75;
  const left = paddingRight;
  const right = paddingRight + (Math.max(0, timestamps.length - 1) * (width - paddingRight)) / Math.max(1, timestamps.length);
  return {
    timestamps: [...timestamps], minValue: finiteValues.length ? Math.min(...finiteValues) : 0, maxValue: finiteValues.length ? Math.max(...finiteValues) : 1,
    width, height, paddingRight, paddingTop, left, right, top: paddingTop, bottom,
  };
}

export function projectLiveChartPoint(timestamp: string, value: number, projection: LiveChartProjection): { x: number; y: number } {
  const exactIndex = projection.timestamps.indexOf(timestamp);
  let index = exactIndex;
  if (index < 0) {
    const target = Date.parse(timestamp);
    const axis = projection.timestamps.map(Date.parse);
    if (!Number.isFinite(target) || !axis.some(Number.isFinite)) index = 0;
    else if (target <= axis[0]) index = 0;
    else if (target >= axis[axis.length - 1]) index = axis.length - 1;
    else {
      const upper = axis.findIndex((time) => time >= target);
      const lower = upper - 1;
      index = lower + (target - axis[lower]) / Math.max(1, axis[upper] - axis[lower]);
    }
  }
  index = Math.max(0, Math.min(projection.timestamps.length - 1, index));
  const x = projection.paddingRight + (index * (projection.width - projection.paddingRight)) / Math.max(1, projection.timestamps.length);
  const range = projection.maxValue - projection.minValue || 1;
  const boundedValue = Math.min(projection.maxValue, Math.max(projection.minValue, value));
  const chartHeight = projection.height * ((boundedValue - projection.minValue) / range);
  return { x, y: ((projection.height - chartHeight) / 4) * 3 + projection.paddingTop };
}

/** Split sparse observations so no renderer can connect across a missing timestamp. */
export function splitLiveChartLineSegments(series: LiveChartSeries[], timestamps: string[]): LiveChartLineSegment[] {
  return series.flatMap((entry) => {
    const byTimestamp = new Map(entry.points.map((point) => [point.timestamp, point]));
    const segments: LiveChartLineSegment[] = [];
    let current: LivePoint[] = [];
    for (const timestamp of timestamps) {
      const point = byTimestamp.get(timestamp);
      if (point) current.push(point);
      else if (current.length) { segments.push({ key: entry.key, city: entry.city, color: entry.color, points: current }); current = []; }
    }
    if (current.length) segments.push({ key: entry.key, city: entry.city, color: entry.color, points: current });
    return segments.filter((segment) => segment.points.length >= 2);
  });
}

/** Returns history plus live observations, preserving every real timestamp. */
export function mergeLivePointsIntoHistory(history: HistoryResponse[], points: LivePoint[]): HistoryResponse[] {
  const merged = history.map((entry) => ({ ...entry, data: [...entry.data] }));
  for (const point of points) {
    const entry = merged.find((candidate) => candidate.item_id === point.itemId && candidate.location === point.city && candidate.quality === point.quality);
    if (entry && !entry.data.some((sample) => sample.timestamp === point.timestamp)) entry.data.push({ timestamp: point.timestamp, avg_price: point.value, item_count: 1 });
  }
  return merged;
}
export function addNoChangeSegment(series: LiveChartSeries, at: number, polls = 1): LiveChartSeries {
  const last = series.points.at(-1); if (!last) return series;
  const to = { ...last, timestamp: new Date(at).toISOString() };
  return { ...series, dashedSegments: [...series.dashedSegments, { key: series.key, city: series.city, color: series.color, from: last, to, style: 'dashed', polls }] };
}
