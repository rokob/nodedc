import test from 'node:test';
import assert from 'node:assert/strict';

import { PreparedDictionary } from '../../src/js/index.js';

test('PreparedDictionary brotli compresses and decompresses with a prepared dictionary', async () => {
  const dictionary = new PreparedDictionary({
    algorithm: 'brotli',
    bytes: Buffer.from('brotli raw prefix dictionary content')
  });

  const input = Buffer.from('brotli raw prefix dictionary content :: payload payload payload');
  const compressed = await dictionary.compress(input, { quality: 9, windowBits: 20 });
  const decompressed = await dictionary.decompress(compressed);

  assert.notDeepEqual(compressed, input);
  assert.deepEqual(decompressed, input);
});

test('PreparedDictionary brotli can be reused across independent one-shot operations', async () => {
  const dictionary = new PreparedDictionary({
    algorithm: 'brotli',
    bytes: Buffer.from('another brotli raw dictionary')
  });

  const first = Buffer.from('another brotli raw dictionary :: first');
  const second = Buffer.from('another brotli raw dictionary :: second');

  const compressedFirst = await dictionary.compress(first, { quality: 5 });
  const compressedSecond = await dictionary.compress(second, { quality: 11 });

  assert.deepEqual(await dictionary.decompress(compressedFirst), first);
  assert.deepEqual(await dictionary.decompress(compressedSecond), second);
});
