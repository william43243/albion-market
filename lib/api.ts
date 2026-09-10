// Albion Online Data Project API (public market endpoints only).
// https://www.albion-online-data.com/api/

export const SERVERS = {
  americas: 'https://west.albion-online-data.com/api/v2/stats',
  europe: 'https://europe.albion-online-data.com/api/v2/stats',
  asia: 'https://east.albion-online-data.com/api/v2/stats',
} as const;
export type Server = keyof typeof SERVERS;
export const DEFAULT_SERVER: Server = 'americas';

export const CITIES = ['Caerleon', 'Bridgewatch', 'Fort Sterling', 'Lymhurst', 'Thetford', 'Martlock', 'Brecilien'] as const;
export type City = (typeof CITIES)[number];
export type Quality = 1 | 2 | 3 | 4 | 5;
export const QUALITIES: Quality[] = [1, 2, 3, 4, 5];
export const QUALITY_LABELS: Record<Quality, { fr: string; en: string; es: string }> = {
  1: { fr: 'Qualité 1 — Normale', en: 'Quality 1 — Normal', es: 'Calidad 1 — Normal' },
  2: { fr: 'Qualité 2 — Bonne', en: 'Quality 2 — Good', es: 'Calidad 2 — Buena' },
  3: { fr: 'Qualité 3 — Remarquable', en: 'Quality 3 — Outstanding', es: 'Calidad 3 — Sobresaliente' },
  4: { fr: 'Qualité 4 — Excellente', en: 'Quality 4 — Excellent', es: 'Calidad 4 — Excelente' },
  5: { fr: 'Qualité 5 — Chef-d’œuvre', en: 'Quality 5 — Masterpiece', es: 'Calidad 5 — Obra maestra' },
};

export interface PriceData {
  item_id: string; city: string; quality: number;
  sell_price_min: number; sell_price_min_date: string;
  sell_price_max: number; sell_price_max_date: string;
  buy_price_min: number; buy_price_min_date: string;
  buy_price_max: number; buy_price_max_date: string;
}
export interface HistoryDataPoint { item_count: number; avg_price: number; timestamp: string; }
export interface HistoryResponse { location: string; item_id: string; quality: number; data: HistoryDataPoint[]; }

const cache: Record<string, { data: unknown; timestamp: number }> = {};
const CACHE_TTL = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
function pruneCache(now = Date.now()): void {
  for (const [key, entry] of Object.entries(cache)) if (now - entry.timestamp >= CACHE_TTL) delete cache[key];
  const entries = Object.entries(cache);
  entries.sort((a, b) => a[1].timestamp - b[1].timestamp).slice(0, Math.max(0, entries.length - MAX_CACHE_ENTRIES)).forEach(([key]) => delete cache[key]);
}
function cached<T>(key: string): T | null { pruneCache(); const e = cache[key]; return e && Date.now() - e.timestamp < CACHE_TTL ? e.data as T : null; }
function store(key: string, data: unknown): void { cache[key] = { data, timestamp: Date.now() }; pruneCache(); }
function base(server: Server = DEFAULT_SERVER): string { return SERVERS[server]; }
function validQuality(value: number): value is Quality { return Number.isInteger(value) && value >= 1 && value <= 5; }
function validatedCities(cities: City[]): City[] {
  const unique = [...new Set(cities)];
  if (unique.some((city) => !CITIES.includes(city))) throw new Error('Unsupported city');
  return unique;
}
export function isObservedPrice(value: number, date: string): boolean {
  return Number.isFinite(value) && value > 0 && Boolean(date) && date !== '0001-01-01T00:00:00';
}
export function priceObservation(price: PriceData, side: 'buy' | 'sell'): { value: number; timestamp: string } | null {
  const value = side === 'buy' ? price.buy_price_max : price.sell_price_min;
  const timestamp = side === 'buy' ? price.buy_price_max_date : price.sell_price_min_date;
  return isObservedPrice(value, timestamp) ? { value, timestamp } : null;
}

export async function fetchCurrentPrices(itemId: string, cities: City[] = [...CITIES], server: Server = DEFAULT_SERVER, quality: Quality = 1): Promise<PriceData[]> {
  const uniqueCities = [...new Set(cities)];
  const key = `prices:${server}:${itemId}:${quality}:${uniqueCities.join(',')}`;
  const hit = cached<PriceData[]>(key); if (hit) return hit;
  const url = `${base(server)}/prices/${encodeURIComponent(itemId)}.json?locations=${encodeURIComponent(uniqueCities.join(','))}&qualities=${quality}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const raw = await response.json() as PriceData[];
  const data = raw.filter((p) => p.item_id === itemId && uniqueCities.includes(p.city as City) && p.quality === quality);
  store(key, data); return data;
}

export const MAX_AODP_URL_LENGTH = 4096;

function buildPricesUrl(itemIds: string[], cities: City[], server: Server, quality: Quality): string {
  if (!itemIds.length || !cities.length) throw new Error('Live prices require at least one item and city');
  const url = `${base(server)}/prices/${encodeURIComponent(itemIds.join(','))}.json?locations=${encodeURIComponent(cities.join(','))}&qualities=${quality}`;
  if (url.length > MAX_AODP_URL_LENGTH) throw new Error(`AODP URL exceeds ${MAX_AODP_URL_LENGTH} characters`);
  return url;
}

export async function fetchCurrentPricesBatch(itemIds: string[], cities: City[] = [...CITIES], server: Server = DEFAULT_SERVER, quality: Quality = 1): Promise<PriceData[]> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (!ids.length) throw new Error('Batch prices require at least one item');
  const uniqueCities = validatedCities(cities);
  if (!uniqueCities.length) throw new Error('Batch prices require at least one city');
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const id of ids) {
    const candidate = [...current, id].join(',');
    const encoded = encodeURIComponent(candidate);
    if (current.length > 0 && encoded.length > 3500) { chunks.push(current); current = [id]; }
    else current.push(id);
  }
  if (current.length) chunks.push(current);
  const results: PriceData[] = [];
  for (const chunk of chunks) {
    const key = `prices-batch:${server}:${quality}:${chunk.join(',')}:${uniqueCities.join(',')}`;
    const hit = cached<PriceData[]>(key);
    if (hit) { results.push(...hit); continue; }
    const url = buildPricesUrl(chunk, uniqueCities, server, quality);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = (await response.json() as PriceData[]).filter((p) => chunk.includes(p.item_id) && uniqueCities.includes(p.city as City) && p.quality === quality);
    store(key, data); results.push(...data);
  }
  return results;
}

/** Live polling deliberately bypasses the history/current-price cache. */
export async function fetchCurrentPricesLiveBatch(itemIds: string[], cities: City[] = [...CITIES], server: Server = DEFAULT_SERVER, quality: Quality = 1): Promise<PriceData[]> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  const uniqueCities = validatedCities(cities);
  if (!ids.length || !uniqueCities.length) throw new Error('Live prices require at least one item and city');
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const id of ids) {
    const candidate = [...current, id];
    try { buildPricesUrl(candidate, uniqueCities, server, quality); current = candidate; }
    catch (error) {
      if (!current.length) throw error;
      chunks.push(current); current = [id];
      buildPricesUrl(current, uniqueCities, server, quality);
    }
  }
  if (current.length) chunks.push(current);
  const result: PriceData[] = [];
  for (const chunk of chunks) {
    const response = await fetch(buildPricesUrl(chunk, uniqueCities, server, quality));
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const rows = await response.json() as PriceData[];
    result.push(...rows.filter((p) => chunk.includes(p.item_id) && uniqueCities.includes(p.city as City) && p.quality === quality));
  }
  return result;
}
export async function fetchPriceHistory(itemId: string, cities: City[] = [...CITIES], startDate: string, endDate: string, timeScale: 1 | 24 = 24, server: Server = DEFAULT_SERVER, quality: Quality = 1): Promise<HistoryResponse[]> {
  const uniqueCities = validatedCities(cities);
  const key = `history:${server}:${itemId}:${quality}:${uniqueCities.join(',')}:${startDate}:${endDate}:${timeScale}`;
  const hit = cached<HistoryResponse[]>(key); if (hit) return hit;
  const url = `${base(server)}/history/${encodeURIComponent(itemId)}.json?locations=${encodeURIComponent(uniqueCities.join(','))}&date=${startDate}&end_date=${endDate}&time-scale=${timeScale}&qualities=${quality}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const raw = await response.json() as HistoryResponse[];
  const data = raw.filter((h) => h.item_id === itemId && uniqueCities.includes(h.location as City) && h.quality === quality);
  store(key, data); return data;
}

export function formatDateForApi(date: Date): string { return `${date.getMonth() + 1}-${date.getDate()}-${date.getFullYear()}`; }
export function daysAgo(days: number): Date { const d = new Date(); d.setDate(d.getDate() - days); return d; }
export function formatDataAge(dateStr: string, lang: string = 'en'): string {
  if (!dateStr || dateStr === '0001-01-01T00:00:00') return lang === 'fr' ? 'inconnue' : lang === 'es' ? 'desconocida' : 'unknown';
  const date = new Date(dateStr); if (Number.isNaN(date.getTime())) return '?';
  const mins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  const relative = mins < 1 ? '<1min' : mins < 60 ? `${mins}min` : mins < 1440 ? `${Math.floor(mins / 60)}h` : `${Math.floor(mins / 1440)}d`;
  return `${relative} (${date.getDate()}/${date.getMonth() + 1} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')})`;
}
export function getMostRecentPriceDate(price: PriceData): string {
  return [price.sell_price_min_date, price.sell_price_max_date, price.buy_price_min_date, price.buy_price_max_date]
    .filter((d) => d && d !== '0001-01-01T00:00:00').sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || '';
}
