import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Readable } from "node:stream";

import { PreparedDictionary } from "../../src/js/index.js";

async function collect(stream: NodeJS.ReadWriteStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) {
    parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}

async function writeChunksWithDelays(
  stream: NodeJS.WritableStream,
  chunks: readonly Buffer[],
  delaysMs: readonly number[]
): Promise<void> {
  for (let index = 0; index < chunks.length; index += 1) {
    await delay(delaysMs[index] ?? 0);
    const chunk = chunks[index];
    await new Promise<void>((resolve, reject) => {
      stream.write(chunk, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function runInterleavedCompressionRequest(
  dictionary: PreparedDictionary,
  input: Buffer,
  options: { quality: number; checksum?: boolean },
  chunkBoundaries: readonly number[],
  createDelayMs: number,
  writeDelaysMs: readonly number[]
): Promise<Buffer> {
  await delay(createDelayMs);

  const stream = dictionary.createCompressStream(options);
  const compressedPromise = collect(stream);
  const chunks: Buffer[] = [];
  let offset = 0;

  for (const boundary of chunkBoundaries) {
    chunks.push(input.subarray(offset, boundary));
    offset = boundary;
  }

  chunks.push(input.subarray(offset));
  await writeChunksWithDelays(stream, chunks, writeDelaysMs);
  return compressedPromise;
}

test("PreparedDictionary zstd supports streaming compress and decompress", async () => {
  const dictionary = new PreparedDictionary({
    algorithm: "zstd",
    bytes: Buffer.from("streaming zstd dictionary for shared reuse"),
  });

  const input = Buffer.from(
    "streaming zstd dictionary for shared reuse :: payload one :: payload two :: payload three"
  );

  const compressedStream = dictionary.createCompressStream({
    quality: 7,
    checksum: true,
  });
  const compressedPromise = collect(
    Readable.from([input.subarray(0, 18), input.subarray(18)]).pipe(
      compressedStream
    )
  );
  const compressed = await compressedPromise;

  const decompressedStream = dictionary.createDecompressStream();
  const decompressed = await collect(
    Readable.from([compressed.subarray(0, 11), compressed.subarray(11)]).pipe(
      decompressedStream
    )
  );

  assert.deepEqual(decompressed, input);
});

test("PreparedDictionary zstd supports multiple compressor streams from one dictionary", async () => {
  const dictionary = new PreparedDictionary({
    algorithm: "zstd",
    bytes: Buffer.from("streaming zstd dictionary for multiple streams"),
  });

  const firstInput = Buffer.from(
    "streaming zstd dictionary for multiple streams :: first"
  );
  const secondInput = Buffer.from(
    "streaming zstd dictionary for multiple streams :: second"
  );

  const firstCompressed = await collect(
    Readable.from([firstInput]).pipe(
      dictionary.createCompressStream({ quality: 3 })
    )
  );
  const secondCompressed = await collect(
    Readable.from([secondInput.subarray(0, 10), secondInput.subarray(10)]).pipe(
      dictionary.createCompressStream({ quality: 9 })
    )
  );

  const firstRoundTrip = await collect(
    Readable.from([firstCompressed]).pipe(dictionary.createDecompressStream())
  );
  const secondRoundTrip = await collect(
    Readable.from([
      secondCompressed.subarray(0, 5),
      secondCompressed.subarray(5),
    ]).pipe(dictionary.createDecompressStream())
  );

  assert.deepEqual(firstRoundTrip, firstInput);
  assert.deepEqual(secondRoundTrip, secondInput);
});

test("PreparedDictionary zstd supports interleaved writes across multiple compressor streams", async () => {
  const dictionary = new PreparedDictionary({
    algorithm: "zstd",
    bytes: Buffer.from(
      "streaming zstd dictionary for interleaved multi-stream writes"
    ),
  });

  const firstInput = Buffer.from(
    "streaming zstd dictionary for interleaved multi-stream writes :: first payload with several chunks"
  );
  const secondInput = Buffer.from(
    "streaming zstd dictionary for interleaved multi-stream writes :: second payload with several chunks"
  );
  const thirdInput = Buffer.from(
    "streaming zstd dictionary for interleaved multi-stream writes :: third payload with several chunks"
  );

  const [firstCompressed, secondCompressed, thirdCompressed] =
    await Promise.all([
      runInterleavedCompressionRequest(
        dictionary,
        firstInput,
        { quality: 4 },
        [18, 49],
        0,
        [0, 13, 12]
      ),
      runInterleavedCompressionRequest(
        dictionary,
        secondInput,
        { quality: 7, checksum: true },
        [14, 47],
        6,
        [0, 11, 19]
      ),
      runInterleavedCompressionRequest(
        dictionary,
        thirdInput,
        { quality: 9 },
        [12, 43],
        12,
        [0, 8, 10]
      ),
    ]);

  const [firstRoundTrip, secondRoundTrip, thirdRoundTrip] = await Promise.all([
    collect(
      Readable.from([
        firstCompressed.subarray(0, 9),
        firstCompressed.subarray(9),
      ]).pipe(dictionary.createDecompressStream())
    ),
    collect(
      Readable.from([
        secondCompressed.subarray(0, 7),
        secondCompressed.subarray(7),
      ]).pipe(dictionary.createDecompressStream())
    ),
    collect(
      Readable.from([
        thirdCompressed.subarray(0, 11),
        thirdCompressed.subarray(11),
      ]).pipe(dictionary.createDecompressStream())
    ),
  ]);

  assert.deepEqual(firstRoundTrip, firstInput);
  assert.deepEqual(secondRoundTrip, secondInput);
  assert.deepEqual(thirdRoundTrip, thirdInput);
});
