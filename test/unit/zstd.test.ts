import test from 'node:test';
import assert from 'node:assert/strict';

import { PreparedDictionary } from '../../src/js/index.js';

test('PreparedDictionary zstd compresses and decompresses with a reused dictionary', async () => {
  const dictionary = new PreparedDictionary({
    algorithm: 'zstd',
    bytes: Buffer.from('sample dictionary data for zstd reuse')
  });

  const input = Buffer.from('sample dictionary data for zstd reuse :: payload payload payload');
  const compressed = await dictionary.compress(input, { quality: 5, checksum: true });
  const decompressed = await dictionary.decompress(compressed);

  assert.notDeepEqual(compressed, input);
  assert.deepEqual(decompressed, input);
});

test('PreparedDictionary zstd can reuse one prepared dictionary across compression calls', async () => {
  const dictionary = new PreparedDictionary({
    algorithm: 'zstd',
    bytes: Buffer.from('another zstd dictionary for repeated compression')
  });

  const first = Buffer.from('another zstd dictionary for repeated compression :: first');
  const second = Buffer.from('another zstd dictionary for repeated compression :: second');

  const compressedFirst = await dictionary.compress(first, { quality: 3 });
  const compressedSecond = await dictionary.compress(second, { quality: 9 });

  assert.deepEqual(await dictionary.decompress(compressedFirst), first);
  assert.deepEqual(await dictionary.decompress(compressedSecond), second);
});
