import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePlayerCity } from '../lib/playerLocation';

test('accepts a supported city name from a quick location command', () => {
  assert.equal(parsePlayerCity('Je suis à Martlock'), 'Martlock');
  assert.equal(parsePlayerCity('position: Caerleon'), 'Caerleon');
});

test('rejects unknown or ambiguous locations', () => {
  assert.equal(parsePlayerCity('Je suis à Montréal'), null);
  assert.equal(parsePlayerCity(''), null);
});
