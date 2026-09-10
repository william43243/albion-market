import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCurrentPricesLiveBatch } from '../lib/api';

test('live batch rejects an empty item or city batch before network access', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; throw new Error('unexpected network'); }) as typeof fetch;
  try {
    await assert.rejects(fetchCurrentPricesLiveBatch([], ['Caerleon']), /at least one item/);
    await assert.rejects(fetchCurrentPricesLiveBatch(['T4_BAG'], []), /at least one item and city/);
    assert.equal(called, false);
  } finally { globalThis.fetch = original; }
});

test('live batch builds filtered URL and ignores other items, cities and qualities', async () => {
  const original = globalThis.fetch;
  let url = '';
  globalThis.fetch = (async (input) => {
    url = String(input);
    return new Response(JSON.stringify([
      { item_id: 'T4_BAG', city: 'Caerleon', quality: 2, sell_price_min: 10 },
      { item_id: 'T4_BAG', city: 'Caerleon', quality: 1, sell_price_min: 20 },
      { item_id: 'T5_BAG', city: 'Caerleon', quality: 1, sell_price_min: 30 },
      { item_id: 'T4_BAG', city: 'Bridgewatch', quality: 1, sell_price_min: 40 },
    ]));
  }) as typeof fetch;
  try {
    const result = await fetchCurrentPricesLiveBatch(['T4_BAG'], ['Caerleon'], 'americas', 1);
    assert.match(url, /\/prices\/T4_BAG\.json\?locations=Caerleon&qualities=1/);
    assert.deepEqual(result.map((row) => [row.item_id, row.city, row.quality]), [['T4_BAG', 'Caerleon', 1]]);
  } finally { globalThis.fetch = original; }
});

test('live batch makes two fresh network requests instead of using the regular cache', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify([{ item_id: 'T4_BAG', city: 'Caerleon', quality: 1, sell_price_min: calls }])) }) as typeof fetch;
  try {
    await fetchCurrentPricesLiveBatch(['T4_BAG'], ['Caerleon'], 'americas', 1);
    await fetchCurrentPricesLiveBatch(['T4_BAG'], ['Caerleon'], 'americas', 1);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
