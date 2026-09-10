import assert from 'node:assert/strict';
import test from 'node:test';
import { Quality, PriceData } from '../lib/api';
import { evaluateAllStrategies, rankOpportunities } from '../lib/marketOpportunity';

const price = (city: string, sell: number, buy: number, quality: Quality = 4): PriceData => ({
  item_id: 'T4_BAG', city, quality, sell_price_min: sell, sell_price_min_date: sell ? '2026-09-07T10:00:00Z' : '0001-01-01T00:00:00',
  sell_price_max: 0, sell_price_max_date: '0001-01-01T00:00:00', buy_price_min: 0, buy_price_min_date: '0001-01-01T00:00:00',
  buy_price_max: buy, buy_price_max_date: buy ? '2026-09-07T10:01:00Z' : '0001-01-01T00:00:00',
});

test('keeps quality and server/item identity isolated', () => {
  const inputs = [
    { identity: { server: 'americas' as const, itemId: 'T4_BAG', quality: 4 as const }, buy: price('Caerleon', 100, 80, 4), sell: price('Caerleon', 100, 80, 4), isPremium: true },
    { identity: { server: 'americas' as const, itemId: 'T4_BAG', quality: 5 as const }, buy: price('Martlock', 10, 500, 5), sell: price('Martlock', 10, 500, 5), isPremium: true },
  ];
  assert.equal(rankOpportunities(inputs).length, 0);
});

test('examines valid alternatives instead of trusting one invalid extreme', () => {
  const mk = (city: string, sell: number, buy: number) => ({ identity: { server: 'americas' as const, itemId: 'T4_BAG', quality: 4 as const }, buy: price(city, sell, buy, 4), sell: price(city, sell, buy, 4), isPremium: true });
  const results = rankOpportunities([mk('Caerleon', 0, 1000), mk('Martlock', 100, 150), mk('Bridgewatch', 200, 250)]);
  assert.ok(results.some((r) => r.buyCity === 'Martlock' && r.sellCity === 'Bridgewatch'));
});

test('evaluates all four order strategies with distinct fees', () => {
  const result = evaluateAllStrategies({ identity: { server: 'americas', itemId: 'T4_BAG', quality: 4 }, buy: price('Martlock', 100, 80, 4), sell: price('Caerleon', 100, 200, 4), isPremium: true, quantity: 10 });
  assert.equal(result.length, 4);
  assert.equal(result.find((r) => r.mode === 'instant-instant')?.setupFeeBuy, 0);
  assert.ok((result.find((r) => r.mode === 'order-order')?.totalFees ?? 0) > 0);
});
