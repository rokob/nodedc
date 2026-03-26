import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { PreparedDictionary, getTransportInfo } from '../../src/js/index.js';

async function collect(stream: NodeJS.ReadWriteStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) {
    parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}

test('getTransportInfo emits RFC 9842-compatible fixed headers', () => {
  const zstd = new PreparedDictionary({ algorithm: 'zstd', bytes: Buffer.from('zstd dict') });
  const brotli = new PreparedDictionary({ algorithm: 'brotli', bytes: Buffer.from('brotli dict') });

  const zstdInfo = zstd.getTransportInfo();
  const brotliInfo = brotli.getTransportInfo();

  assert.equal(zstdInfo.headerBytes.length, 40);
  assert.equal(brotliInfo.headerBytes.length, 36);
  assert.deepEqual(
    [...zstdInfo.headerBytes.subarray(0, 8)],
    [0x5e, 0x2a, 0x4d, 0x18, 0x20, 0x00, 0x00, 0x00],
  );
  assert.deepEqual([...brotliInfo.headerBytes.subarray(0, 4)], [0xff, 0x44, 0x43, 0x42]);
});

test('PreparedDictionary one-shot transport framing round-trips for zstd and brotli', async () => {
  const zstd = new PreparedDictionary({
    algorithm: 'zstd',
    bytes: Buffer.from('zstd transport dict'),
  });
  const brotli = new PreparedDictionary({
    algorithm: 'brotli',
    bytes: Buffer.from('brotli transport dict'),
  });

  const zstdInput = Buffer.from('zstd transport dict :: body');
  const brotliInput = Buffer.from('brotli transport dict :: body');

  const zstdCompressed = await zstd.compressTransport(zstdInput);
  const brotliCompressed = await brotli.compressTransport(brotliInput);

  assert.deepEqual(await zstd.decompress(zstdCompressed, { transport: 'transport' }), zstdInput);
  assert.deepEqual(
    await brotli.decompress(brotliCompressed, { transport: 'transport' }),
    brotliInput,
  );
});

test('PreparedDictionary zstd streaming transport framing round-trips', async () => {
  const dictionary = new PreparedDictionary({
    algorithm: 'zstd',
    bytes: Buffer.from('zstd streaming transport dictionary'),
  });

  const input = Buffer.from('zstd streaming transport dictionary :: payload payload payload');
  const compressed = await collect(
    Readable.from([input.subarray(0, 10), input.subarray(10)]).pipe(
      dictionary.createTransportCompressStream({ quality: 6 }),
    ),
  );

  const decompressed = await collect(
    Readable.from([compressed.subarray(0, 14), compressed.subarray(14)]).pipe(
      dictionary.createDecompressStream({ transport: 'transport' }),
    ),
  );

  assert.deepEqual(decompressed, input);
});

test('PreparedDictionary brotli streaming transport framing round-trips', async () => {
  const dictionary = new PreparedDictionary({
    algorithm: 'brotli',
    bytes: Buffer.from('brotli streaming transport dictionary'),
  });

  const input = Buffer.from('brotli streaming transport dictionary :: payload payload payload');
  const compressed = await collect(
    Readable.from([input.subarray(0, 9), input.subarray(9)]).pipe(
      dictionary.createTransportCompressStream({ quality: 8, windowBits: 20 }),
    ),
  );

  const decompressed = await collect(
    Readable.from([compressed.subarray(0, 11), compressed.subarray(11)]).pipe(
      dictionary.createDecompressStream({ transport: 'transport' }),
    ),
  );
  assert.deepEqual(decompressed, input);
});

test('transport decompression rejects mismatched dictionary headers', async () => {
  const first = new PreparedDictionary({
    algorithm: 'zstd',
    bytes: Buffer.from('first transport dict'),
  });
  const second = new PreparedDictionary({
    algorithm: 'zstd',
    bytes: Buffer.from('second transport dict'),
  });
  const input = Buffer.from('first transport dict :: body');

  const compressed = await first.compressTransport(input);

  await assert.rejects(
    () => second.decompress(compressed, { transport: 'transport' }),
    /Invalid dcz transport header/,
  );
});
