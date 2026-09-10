import test from 'node:test';
import assert from 'node:assert/strict';
import { translations } from '../lib/i18n';

test('all supported languages provide the general noData translation', () => {
  for (const language of ['fr', 'en', 'es'] as const) {
    assert.equal(typeof translations[language].noData, 'string');
    assert.ok(translations[language].noData.length > 0);
  }
});
