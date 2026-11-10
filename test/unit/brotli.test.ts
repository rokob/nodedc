import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { PreparedDictionary } from '../../src/js/index.js';

// CVE-2026-111497: a block switch is invalid with only one declared block type.
// Regression input from Node.js test/parallel/test-zlib-invalid-input.js:
// https://github.com/nodejs/node/commit/7ba22c28127e88d7ce5a207af15fff2fbca71d46
const invalidBlockSwitch = Buffer.from('200010414141fcffff07002228f00b60f7f41f000000', 'hex');

test('PreparedDictionary brotli rejects invalid block switches in one-shot decoding', async () => {
  const dictionary = new PreparedDictionary({
    algorithm: 'brotli',
    bytes: Buffer.from('brotli regression dictionary'),
  });

  await assert.rejects(dictionary.decompress(invalidBlockSwitch), /ERROR_FORMAT_BLOCK_SWITCH/);
});

test('PreparedDictionary brotli rejects invalid block switches in byte-wise streaming', async () => {
  const dictionary = new PreparedDictionary({
    algorithm: 'brotli',
    bytes: Buffer.from('brotli regression dictionary'),
  });
  const chunks = Array.from(invalidBlockSwitch, (byte) => Buffer.from([byte]));

  await assert.rejects(
    pipeline(Readable.from(chunks), dictionary.createDecompressStream(), async (source) => {
      for await (const _chunk of source) {
        // Drain output so backpressure cannot mask the format error.
      }
    }),
    /ERROR_FORMAT_BLOCK_SWITCH/,
  );
});

test('PreparedDictionary brotli compresses and decompresses with a prepared dictionary', async () => {
  const dictionary = new PreparedDictionary({
    algorithm: 'brotli',
    bytes: Buffer.from('brotli raw prefix dictionary content'),
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
    bytes: Buffer.from('another brotli raw dictionary'),
  });

  const first = Buffer.from('another brotli raw dictionary :: first');
  const second = Buffer.from('another brotli raw dictionary :: second');

  const compressedFirst = await dictionary.compress(first, { quality: 5 });
  const compressedSecond = await dictionary.compress(second, { quality: 11 });

  assert.deepEqual(await dictionary.decompress(compressedFirst), first);
  assert.deepEqual(await dictionary.decompress(compressedSecond), second);
});
