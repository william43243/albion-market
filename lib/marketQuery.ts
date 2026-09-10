import { CITIES, City } from './api';
import { AlbionItem, searchItems } from './items';
import { parsePlayerCity } from './playerLocation';

export interface MarketQuery {
  city: City | null;
  tier: string | null;
  itemQuery: string;
  item: AlbionItem | null;
}

const FRENCH_ITEM_ALIASES: Record<string, string> = {
  travertin: 'travertine',
  pierre: 'stone',
  bois: 'wood',
  minerai: 'ore',
  cuir: 'leather',
  fibre: 'fiber',
};

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findCity(input: string): City | null {
  const normalized = normalize(input);
  return CITIES.find((city) => normalized.includes(normalize(city))) || null;
}

function findTier(input: string): string | null {
  const match = /(?:^|\s)t([3-8])(?=\s|$|[,.;:])/i.exec(input);
  return match ? match[1] : null;
}

function removeLocationTokens(input: string, city: City | null, tier: string | null): string {
  let value = input;
  if (city) value = value.replace(new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
  if (tier) value = value.replace(new RegExp(`\\bt${tier}\\b`, 'ig'), ' ');
  return value.replace(/[,:;|\-]+/g, ' ').replace(/\b(?:je|suis|a|à|que|la|le|les|un|une|dans|où|ou|prix|de|du|des)\b/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** Resolve natural item/city queries such as "travertin T4, Martlock" or "Martlock T4 travertin". */
export function parseMarketQuery(input: string): MarketQuery {
  const raw = typeof input === 'string' ? input.trim() : '';
  const city = findCity(raw) || parsePlayerCity(raw);
  const tier = findTier(raw);
  const rawItemQuery = removeLocationTokens(raw, city, tier);
  const itemQuery = FRENCH_ITEM_ALIASES[normalize(rawItemQuery)] || rawItemQuery;
  const candidates = itemQuery ? searchItems(itemQuery, undefined, tier || undefined, 8) : [];
  const exact = candidates.find((item) => normalize(item.n) === normalize(itemQuery));
  return {
    city,
    tier,
    itemQuery,
    item: exact || (candidates.length === 1 ? candidates[0] : null),
  };
}
