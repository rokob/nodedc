import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { PreparedDictionary } from '../../src/js/index.js';

async function collect(stream: NodeJS.ReadWriteStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) {
    parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}

test('PreparedDictionary zstd supports streaming compress and decompress', async () => {
  const dictionary = new PreparedDictionary({
    algorithm: 'zstd',
    bytes: Buffer.from('streaming zstd dictionary for shared reuse')
  });

  const input = Buffer.from(
    'streaming zstd dictionary for shared reuse :: payload one :: payload two :: payload three'
  );

  const compressedStream = dictionary.createCompressStream({ quality: 7, checksum: true });
  const compressedPromise = collect(Readable.from([input.subarray(0, 18), input.subarray(18)]).pipe(compressedStream));
  const compressed = await compressedPromise;

  const decompressedStream = dictionary.createDecompressStream();
  const decompressed = await collect(
    Readable.from([compressed.subarray(0, 11), compressed.subarray(11)]).pipe(decompressedStream)
  );

  assert.deepEqual(decompressed, input);
});

test('PreparedDictionary zstd supports multiple compressor streams from one dictionary', async () => {
  const dictionary = new PreparedDictionary({
    algorithm: 'zstd',
    bytes: Buffer.from('streaming zstd dictionary for multiple streams')
  });

  const firstInput = Buffer.from('streaming zstd dictionary for multiple streams :: first');
  const secondInput = Buffer.from('streaming zstd dictionary for multiple streams :: second');

  const firstCompressed = await collect(Readable.from([firstInput]).pipe(dictionary.createCompressStream({ quality: 3 })));
  const secondCompressed = await collect(
    Readable.from([secondInput.subarray(0, 10), secondInput.subarray(10)]).pipe(
      dictionary.createCompressStream({ quality: 9 })
    )
  );

  const firstRoundTrip = await collect(Readable.from([firstCompressed]).pipe(dictionary.createDecompressStream()));
  const secondRoundTrip = await collect(
    Readable.from([secondCompressed.subarray(0, 5), secondCompressed.subarray(5)]).pipe(
      dictionary.createDecompressStream()
    )
  );

  assert.deepEqual(firstRoundTrip, firstInput);
  assert.deepEqual(secondRoundTrip, secondInput);
});
