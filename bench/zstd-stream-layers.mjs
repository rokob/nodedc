import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  constants,
  createZstdCompress,
  zstdCompressSync,
  zstdDecompressSync,
} from 'node:zlib';

import {
  PreparedDictionary,
  loadNativeBinding,
  trainZstdDictionary,
} from '../dist/js/index.js';

const QUALITY = Number(process.env.ZSTD_QUALITY ?? 6);
const COUNT = Number(process.env.BENCH_STREAM_COUNT ?? 1000);
const WARMUP_COUNT = Number(process.env.BENCH_WARMUP_STREAMS ?? 128);
const TRAINING_SAMPLE_COUNT = Number(process.env.BENCH_TRAINING_SAMPLES ?? 512);
const DICT_SIZE = Number(process.env.BENCH_DICT_SIZE ?? 8192);
const TARGET_PAYLOAD_BYTES = Number(process.env.BENCH_TARGET_PAYLOAD_BYTES ?? 200000);
const DIRECT_OUTPUT_SIZE = 1 << 16;
const CONTINUE_DIRECTIVE = 0;
const END_DIRECTIVE = 1;

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});

async function main() {
  assertBuiltInDictionarySupport();

  const trainingSamples = makeTrainingPayloadFamily(TRAINING_SAMPLE_COUNT);
  const trained = trainZstdDictionary(trainingSamples, {
    dictSize: DICT_SIZE,
    compressionLevel: QUALITY,
  });
  const dictionaryBytes = trained.dictionary;
  const prepared = new PreparedDictionary({
    algorithm: 'zstd',
    bytes: dictionaryBytes,
  });
  const binding = loadNativeBinding();
  const nativeDictionary = new binding.ZstdPreparedDictionary(dictionaryBytes);
  const builtinOptions = {
    dictionary: dictionaryBytes,
    params: {
      [constants.ZSTD_c_compressionLevel]: QUALITY,
    },
  };

  await verifyRoundTrip(prepared, dictionaryBytes, builtinOptions, nativeDictionary, binding);

  console.log('# Zstd stream layers benchmark');
  console.log(`# Node ${process.version}`);
  console.log(
    `# trained zstd dictionary size=${dictionaryBytes.length} sha256=${prepared.hash} dictId=${trained.dictionaryId ?? 'none'} quality=${QUALITY}`,
  );
  console.log(`# count=${COUNT}`);
  console.log(`# target_payload_bytes=${TARGET_PAYLOAD_BYTES}`);
  console.log('#');
  console.log('# compares built-in stream, nodedc stream, and direct native compressInto loops');
  console.log('# columns: requests duration_ms ops_per_sec input_mb_per_sec ratio');
  console.log('');

  const warmupPayloads = makePayloadFamily(WARMUP_COUNT);
  await warmup('built-in stream + dict', warmupPayloads, (payload) =>
    compressWithBuiltInStream(payload, builtinOptions),
  );
  await warmup('nodedc prepared stream', warmupPayloads, (payload) =>
    compressWithPreparedStream(prepared, payload),
  );
  await warmup('nodedc direct compressInto', warmupPayloads, (payload) =>
    compressWithDirectNative(binding, nativeDictionary, payload),
  );

  const payloads = makePayloadFamily(COUNT);

  const builtIn = await benchmark(payloads, (payload) =>
    compressWithBuiltInStream(payload, builtinOptions),
  );
  const preparedStream = await benchmark(payloads, (payload) =>
    compressWithPreparedStream(prepared, payload),
  );
  const directNative = await benchmark(payloads, (payload) =>
    compressWithDirectNative(binding, nativeDictionary, payload),
  );

  printRow('built-in stream + dict', COUNT, builtIn);
  printRow('nodedc prepared stream', COUNT, preparedStream);
  printRow('nodedc direct compressInto', COUNT, directNative);
}

function assertBuiltInDictionarySupport() {
  try {
    zstdCompressSync(Buffer.from('ok'), { dictionary: Buffer.from('dict') });
  } catch (error) {
    throw new Error(
      `This Node runtime does not support built-in zstd dictionary compression: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function verifyRoundTrip(prepared, dictionaryBytes, builtinOptions, nativeDictionary, binding) {
  const sample = makePayloadFamily(1)[0];

  const builtinCompressed = zstdCompressSync(sample, builtinOptions);
  const builtinRoundTrip = zstdDecompressSync(builtinCompressed, { dictionary: dictionaryBytes });
  if (!builtinRoundTrip.equals(sample)) {
    throw new Error('Built-in zstd dictionary round-trip failed.');
  }

  const preparedCompressed = await prepared.compress(sample, { quality: QUALITY });
  const preparedRoundTrip = await prepared.decompress(preparedCompressed);
  if (!preparedRoundTrip.equals(sample)) {
    throw new Error('nodedc prepared round-trip failed.');
  }

  const directCompressed = compressWithDirectNativeSync(binding, nativeDictionary, sample);
  const directRoundTrip = prepared.decompress(directCompressed);
  if (!(await directRoundTrip).equals(sample)) {
    throw new Error('nodedc direct native round-trip failed.');
  }
}

async function warmup(name, payloads, compress) {
  await benchmark(payloads, compress);
  console.log(`# warmed ${name} with ${payloads.length} requests`);
}

async function benchmark(payloads, compress) {
  let totalInputBytes = 0;
  let totalCompressedBytes = 0;
  const start = process.hrtime.bigint();

  for (const payload of payloads) {
    totalInputBytes += payload.length;
    const compressed = await compress(payload);
    totalCompressedBytes += compressed.length;
  }

  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  const elapsedSeconds = elapsedMs / 1000;

  return {
    elapsedMs,
    opsPerSec: payloads.length / elapsedSeconds,
    inputMbPerSec: totalInputBytes / (1024 * 1024) / elapsedSeconds,
    ratio: totalCompressedBytes / totalInputBytes,
  };
}

async function compressWithBuiltInStream(payload, options = {}) {
  const chunks = [];
  const compressor = createZstdCompress(options);
  compressor.on('data', (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  await pipeline(Readable.from([payload.subarray(0, 24), payload.subarray(24)]), compressor);
  return Buffer.concat(chunks);
}

async function compressWithPreparedStream(prepared, payload) {
  const chunks = [];
  const compressor = prepared.createCompressStream({ quality: QUALITY });
  compressor.on('data', (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  await pipeline(Readable.from([payload.subarray(0, 24), payload.subarray(24)]), compressor);
  return Buffer.concat(chunks);
}

async function compressWithDirectNative(binding, nativeDictionary, payload) {
  return compressWithDirectNativeSync(binding, nativeDictionary, payload);
}

function compressWithDirectNativeSync(binding, nativeDictionary, payload) {
  const compressor = new binding.ZstdCompressor(nativeDictionary, { quality: QUALITY });
  const outputParts = [];

  for (const chunk of [payload.subarray(0, 24), payload.subarray(24)]) {
    let pending = chunk;
    while (pending.length > 0) {
      const output = Buffer.allocUnsafe(DIRECT_OUTPUT_SIZE);
      const [, produced, consumed] = compressor.compressInto(output, pending, CONTINUE_DIRECTIVE);
      if (produced > 0) {
        outputParts.push(Buffer.from(output.subarray(0, produced)));
      }
      pending = pending.subarray(consumed);
    }
  }

  let remaining = 1;
  while (remaining > 0) {
    const output = Buffer.allocUnsafe(DIRECT_OUTPUT_SIZE);
    const [nextRemaining, produced] = compressor.compressInto(output, Buffer.alloc(0), END_DIRECTIVE);
    remaining = nextRemaining;
    if (produced > 0) {
      outputParts.push(Buffer.from(output.subarray(0, produced)));
    }
  }

  return Buffer.concat(outputParts);
}

function printRow(label, count, result) {
  console.log(
    [
      label.padEnd(28),
      String(count).padStart(8),
      result.elapsedMs.toFixed(2).padStart(12),
      result.opsPerSec.toFixed(0).padStart(12),
      result.inputMbPerSec.toFixed(2).padStart(12),
      result.ratio.toFixed(3).padStart(8),
    ].join(' '),
  );
}

function makePayloadFamily(count) {
  const payloads = [];

  for (let i = 0; i < count; i += 1) {
    const section = i % 7;
    const userId = 1000 + (i % 97);
    const plan = ['free', 'pro', 'team', 'enterprise'][i % 4];
    const locale = ['en-US', 'en-GB', 'fr-FR', 'de-DE'][i % 4];
    const city = ['New York', 'Berlin', 'Paris', 'Tokyo', 'Austin', 'Boston'][i % 6];
    const featureFlags = [
      'transport-dictionary',
      'edge-cache',
      'request-coalescing',
      'stream-reuse',
      'regional-rollups',
    ].slice(0, 2 + (i % 4));
    const rows = Array.from(
      { length: 18 + (i % 8) },
      (_, rowIndex) =>
        `<tr><td>2026-03-24T${String(10 + (rowIndex % 10)).padStart(2, '0')}:${String((rowIndex * 7) % 60).padStart(2, '0')}:00Z</td><td>${city}</td><td>${rowIndex % 5 === 0 ? 'warn' : 'ok'}</td><td>${110 + ((i + rowIndex) % 140)}</td></tr>`,
    ).join('');
    const cards = Array.from(
      { length: 10 + (i % 6) },
      (_, cardIndex) =>
        `<li class="card card-${cardIndex}"><h3>Metric ${section}-${cardIndex}</h3><p>User ${userId} ${city} ${locale} ${plan}</p><p>Flags: ${featureFlags.join(', ')}</p><p>Daily active requests ${(userId + cardIndex) * 13}</p></li>`,
    ).join('');
    const activity = Array.from(
      { length: 12 },
      (_, index) =>
        `<article class="activity"><h4>Activity ${index}</h4><p>${city} ${plan} cohort ${section}</p><p>Feature set ${featureFlags.join('|')}</p></article>`,
    ).join('');
    const html = [
      '<!doctype html>',
      '<html lang="en"><head>',
      '<meta charset="utf-8">',
      '<title>nodedc stream layers payload</title>',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<meta name="user-id" content="${userId}">`,
      '</head><body>',
      `<main data-plan="${plan}" data-locale="${locale}" data-city="${city}">`,
      `<header><h1>Dashboard section ${section}</h1><p>Flags: ${featureFlags.join(',')}</p></header>`,
      `<section class="hero"><h2>${city} performance report</h2><p>User ${userId} on plan ${plan} in locale ${locale}</p></section>`,
      `<section><ul>${cards}</ul></section>`,
      `<section class="activity-grid">${activity}</section>`,
      `<section class="events"><table><thead><tr><th>Time</th><th>Region</th><th>Status</th><th>Latency</th></tr></thead><tbody>${rows}</tbody></table></section>`,
      `<script type="application/json">${JSON.stringify({
        userId,
        locale,
        city,
        plan,
        featureFlags,
        section,
        requestId: `req-${String(i).padStart(6, '0')}`,
      })}</script>`,
      '</main></body></html>',
    ].join('');

    payloads.push(expandToTargetSize(Buffer.from(html), TARGET_PAYLOAD_BYTES));
  }

  return payloads;
}

function makeTrainingPayloadFamily(count) {
  return makePayloadFamily(count * 2).map((payload, index) => {
    const suffix = Buffer.from(`\n<!-- training-sample:${index % count} -->`);
    return Buffer.concat([payload, suffix]);
  });
}

function expandToTargetSize(payload, targetBytes) {
  if (targetBytes <= 0 || payload.length >= targetBytes) {
    return payload;
  }

  const spacer = Buffer.from('\n<section class="repeat">repeatable payload block</section>');
  const parts = [payload];
  let total = payload.length;

  while (total < targetBytes) {
    const next = total + spacer.length <= targetBytes ? spacer : spacer.subarray(0, targetBytes - total);
    parts.push(next);
    total += next.length;
  }

  return Buffer.concat(parts);
}
