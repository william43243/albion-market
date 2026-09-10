import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarketQuery } from '../lib/marketQuery';

test('resolves item then city', () => {
  const query = parseMarketQuery('travertin T4, Martlock');
  assert.equal(query.city, 'Martlock');
  assert.equal(query.tier, '4');
  assert.equal(query.item?.n, 'Travertine');
});

test('resolves city then item', () => {
  const query = parseMarketQuery('Martlock T4 Travertine');
  assert.equal(query.city, 'Martlock');
  assert.equal(query.item?.n, 'Travertine');
});

test('ignores conversational French filler words', () => {
  const query = parseMarketQuery('La travertin T4, Martlock que je suis');
  assert.equal(query.city, 'Martlock');
  assert.equal(query.item?.n, 'Travertine');
});
