import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Quality, Server } from '../lib/api';

export interface WatchlistEntry { itemId: string; itemName: string; quality: Quality; }
type StoredWatchlist = Record<Server, WatchlistEntry[]>;
const KEY = 'albion_market_watchlist_v1';
const empty = (): StoredWatchlist => ({ americas: [], europe: [], asia: [] });
async function read(): Promise<StoredWatchlist> {
  const raw = Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : await AsyncStorage.getItem(KEY);
  if (!raw) return empty();
  try { const parsed = JSON.parse(raw) as Partial<StoredWatchlist>; return { ...empty(), ...parsed }; } catch { return empty(); }
}
async function write(value: StoredWatchlist): Promise<void> {
  const raw = JSON.stringify(value);
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') localStorage.setItem(KEY, raw);
  else await AsyncStorage.setItem(KEY, raw);
}
export function useWatchlist(server: Server) {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { let active = true; setLoaded(false); read().then((all) => { if (active) { setEntries(all[server] || []); setLoaded(true); } }); return () => { active = false; }; }, [server]);
  const update = useCallback(async (next: WatchlistEntry[]) => { setEntries(next); const all = await read(); all[server] = next; await write(all); }, [server]);
  const add = useCallback((entry: WatchlistEntry) => update(entries.some((e) => e.itemId === entry.itemId && e.quality === entry.quality) ? entries : [...entries, entry].slice(0, 50)), [entries, update]);
  const remove = useCallback((entry: Pick<WatchlistEntry, 'itemId' | 'quality'>) => update(entries.filter((e) => !(e.itemId === entry.itemId && e.quality === entry.quality))), [entries, update]);
  return { entries, loaded, add, remove };
}
