import { CITIES, City } from './api';

const LOCATION_PREFIX = /^(?:je\s+suis\s+(?:a|à)\s+|position\s*:\s*|ville\s*:\s*)/i;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/** Parse only explicit, supported Albion city names from a quick command. */
export function parsePlayerCity(input: string): City | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  const candidate = input.trim().replace(LOCATION_PREFIX, '').trim();
  const normalized = normalize(candidate);
  return CITIES.find((city) => normalize(city) === normalized) || null;
}

export function cityLabel(city: City | null): string {
  return city || 'Ville actuelle';
}
