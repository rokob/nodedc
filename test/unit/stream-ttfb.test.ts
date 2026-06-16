import test from 'node:test';
import assert from 'node:assert/strict';
import type { Transform } from 'node:stream';

import { PreparedDictionary } from '../../src/js/index.js';
import { getTransportInfo } from '../../src/js/transport.js';

type Algorithm = 'zstd' | 'brotli';

const algorithms: readonly Algorithm[] = ['zstd', 'brotli'];

function makeDictionary(algorithm: Algorithm): PreparedDictionary {
  return new PreparedDictionary({
    algorithm,
    bytes: Buffer.from(`${algorithm} streaming ttfb dictionary`),
  });
}

/**
 * Resolve with the first chunk the stream emits, using the `data` event itself
 * as the synchronization barrier — no timers, so the assertion is deterministic
 * regardless of how fast the worker thread runs.
 */
function firstEmittedChunk(stream: Transform): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    stream.once('data', (chunk: Buffer) => resolve(chunk));
    stream.once('error', reject);
    stream.once('end', () => reject(new Error('stream ended before emitting any data')));
  });
}

// The transport header is a constant the client needs before it can decode. It
// must be the very first thing emitted, not concatenated onto — and gated
// behind — the first compressed output produced on a worker thread.
for (const algorithm of algorithms) {
  test(`${algorithm} transport stream emits the header as its first chunk`, async () => {
    const dictionary = makeDictionary(algorithm);
    const header = getTransportInfo(algorithm, dictionary.hash).headerBytes;

    const stream = dictionary.createTransportCompressStream({ quality: 6 });
    const firstChunkPromise = firstEmittedChunk(stream);

    // Write one chunk; do not end yet. The first emitted chunk must be exactly
    // the header and nothing else, proving it is decoupled from the body.
    stream.write(Buffer.from('first body chunk'));

    const first = await firstChunkPromise;
    assert.deepEqual(first, header);
  });
}

// Stronger guarantee that pins the actual TTFB fix: the header is emitted
// synchronously from _transform via this.push(), so it lands before the native
// compression worker can resolve. We race the first `data` event against a
// setImmediate scheduled right after write(). The worker callback is a later
// macrotask, so if the header were still gated behind it, setImmediate would
// win. The header winning proves it is no longer behind the worker round-trip.
for (const algorithm of algorithms) {
  test(`${algorithm} transport header is emitted before the compression worker resolves`, async () => {
    const dictionary = makeDictionary(algorithm);
    const header = getTransportInfo(algorithm, dictionary.hash).headerBytes;

    const stream = dictionary.createTransportCompressStream({ quality: 6 });

    const order: string[] = [];
    const settled = new Promise<void>((resolve, reject) => {
      stream.once('data', (chunk: Buffer) => {
        order.push('data');
        try {
          assert.deepEqual(chunk, header);
        } catch (error) {
          reject(error);
          return;
        }
        resolve();
      });
      stream.once('error', reject);
    });

    stream.write(Buffer.from('first body chunk'));
    setImmediate(() => order.push('immediate'));

    await settled;
    assert.deepEqual(
      order[0],
      'data',
      'header data event should fire before the post-write setImmediate',
    );
  });
}

// Per-chunk flush guarantee: a written chunk must yield compressed output before
// the stream is ended. Under buffering (zstd e_continue / brotli PROCESS) a
// small chunk can emit zero bytes until finish, which is the TTFB regression.
for (const algorithm of algorithms) {
  test(`${algorithm} stream flushes compressed output per chunk before end`, async () => {
    const dictionary = makeDictionary(algorithm);

    // Plain (non-transport) stream so the first emitted chunk is body bytes, not
    // the header — this isolates the native flush behavior.
    const stream = dictionary.createCompressStream({ quality: 6 });

    const emittedBeforeEnd: Buffer[] = [];
    const sawBodyBeforeEnd = new Promise<void>((resolve, reject) => {
      stream.once('data', (chunk: Buffer) => {
        emittedBeforeEnd.push(chunk);
        resolve();
      });
      stream.once('error', reject);
      stream.once('end', () => reject(new Error('stream ended before emitting any data')));
    });

    stream.write(Buffer.from('a reasonably sized first chunk of payload data to flush'));

    // Barrier: wait until the first chunk has been emitted, then assert it
    // happened before we ever called end().
    await sawBodyBeforeEnd;
    const bytesBeforeEnd = emittedBeforeEnd.reduce((total, buf) => total + buf.length, 0);
    assert.ok(
      bytesBeforeEnd > 0,
      `expected compressed bytes to be flushed before end, got ${bytesBeforeEnd}`,
    );

    // Drain and end cleanly so the stream does not leak.
    stream.resume();
    await new Promise<void>((resolve, reject) => {
      stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
  });
}

// Round-trip across many small chunks: flushing per chunk must still produce a
// fully decodable stream end to end.
for (const algorithm of algorithms) {
  test(`${algorithm} per-chunk flushed stream round-trips across many small writes`, async () => {
    const dictionary = makeDictionary(algorithm);
    const input = Buffer.from(
      `${algorithm} streaming ttfb dictionary :: payload segment`.repeat(40),
    );

    const compressStream = dictionary.createCompressStream({ quality: 6 });
    const compressedParts: Buffer[] = [];
    compressStream.on('data', (chunk: Buffer) => compressedParts.push(chunk));
    const compressedDone = new Promise<void>((resolve, reject) => {
      compressStream.once('end', resolve);
      compressStream.once('error', reject);
    });

    // Drive many tiny writes so the per-chunk flush path runs repeatedly.
    for (let offset = 0; offset < input.length; offset += 5) {
      compressStream.write(input.subarray(offset, offset + 5));
    }
    compressStream.end();
    await compressedDone;

    const compressed = Buffer.concat(compressedParts);
    assert.ok(compressedParts.length > 1, 'expected output to be emitted incrementally');

    const decompressStream = dictionary.createDecompressStream();
    const decompressedParts: Buffer[] = [];
    decompressStream.on('data', (chunk: Buffer) => decompressedParts.push(chunk));
    const decompressedDone = new Promise<void>((resolve, reject) => {
      decompressStream.once('end', resolve);
      decompressStream.once('error', reject);
    });
    decompressStream.end(compressed);
    await decompressedDone;

    assert.deepEqual(Buffer.concat(decompressedParts), input);
  });
}
