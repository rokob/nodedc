import test from 'node:test';
import assert from 'node:assert/strict';

import { DictionaryStore, PreparedDictionary } from '../../src/js/index.js';

test('DictionaryStore indexes dictionaries by algorithm and hash', () => {
  const store = new DictionaryStore();
  const brotli = new PreparedDictionary({
    algorithm: 'brotli',
    bytes: Buffer.from('brotli-dict')
  });
  const zstd = new PreparedDictionary({
    algorithm: 'zstd',
    bytes: Buffer.from('zstd-dict')
  });

  store.add(brotli);
  store.add(zstd);

  assert.equal(store.get(brotli.hash, 'brotli'), brotli);
  assert.equal(store.get(zstd.hash, 'zstd'), zstd);
  assert.equal(store.has('missing'), false);
});

