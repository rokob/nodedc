import { promisify } from 'node:util';
import { constants, zstdCompress, zstdCompressSync } from 'node:zlib';

import { PreparedDictionary, loadNativeBinding, trainZstdDictionary } from '../dist/js/index.js';

const COUNTS = [1_000, 10_000, 100_000];
const QUALITY = 6;
const TRAINING_SAMPLE_COUNT = 512;
const DICT_SIZE = 8_192;
const zstdCompressAsync = promisify(zstdCompress);

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});

async function main() {
  assertBuiltInDictionarySupport();

  const trainingSamples = makePayloadFamily(TRAINING_SAMPLE_COUNT);
  const trained = trainZstdDictionary(trainingSamples, {
    dictSize: DICT_SIZE,
    compressionLevel: QUALITY,
  });

  const prepared = new PreparedDictionary({
    algorithm: 'zstd',
    bytes: trained.dictionary,
  });
  const nativeBinding = loadNativeBinding();
  const nativePrepared = new nativeBinding.ZstdPreparedDictionary(trained.dictionary);
  const builtinOptions = {
    dictionary: trained.dictionary,
    params: {
      [constants.ZSTD_c_compressionLevel]: QUALITY,
    },
  };
  const nativeOptions = { quality: QUALITY };

  console.log('# Zstd prepared-dictionary benchmark');
  console.log(`# Node ${process.version}`);
  console.log(
    `# trained dictionary size=${trained.size} dictId=${trained.dictionaryId ?? 'none'} sha256=${trained.sha256}`,
  );
  console.log('#');
  console.log(
    '# payload family: HTML-like responses with shared structure and per-request variations',
  );
  console.log('# columns: responses duration_ms ops_per_sec input_mb_per_sec ratio');
  console.log('');

  const warmupPayloads = makePayloadFamily(512);
  await warmup('built-in one-shot async', warmupPayloads, (payload) =>
    zstdCompressAsync(payload, builtinOptions),
  );
  await warmup('nodedc public api', warmupPayloads, (payload) =>
    prepared.compress(payload, nativeOptions),
  );
  await warmup('nodedc prepared native', warmupPayloads, (payload) =>
    nativePrepared.compress(payload, nativeOptions),
  );

  for (const count of COUNTS) {
    const payloads = makePayloadFamily(count);
    console.log(`responses=${count}`);

    const builtIn = await benchmark(payloads, (payload) => zstdCompressAsync(payload, builtinOptions));
    const publicApi = await benchmark(payloads, (payload) =>
      prepared.compress(payload, nativeOptions),
    );
    const nativePreparedResult = await benchmark(payloads, (payload) =>
      nativePrepared.compress(payload, nativeOptions),
    );

    printRow('built-in one-shot async', count, builtIn);
    printRow('nodedc public api', count, publicApi);
    printRow('nodedc prepared native', count, nativePreparedResult);
    console.log('');
  }
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

async function warmup(name, payloads, compress) {
  await benchmark(payloads, compress);
  console.log(`# warmed ${name} with ${payloads.length} responses`);
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

function printRow(label, count, result) {
  console.log(
    [
      label.padEnd(22),
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
      'search-v2',
      'transport-dictionary',
      'edge-cache',
      'request-coalescing',
      'brotli-training',
    ].slice(0, 2 + (i % 4));
    const cards = Array.from(
      { length: 4 + (i % 3) },
      (_, cardIndex) =>
        `<li class="card card-${cardIndex}"><h3>Metric ${section}-${cardIndex}</h3><p>User ${userId} ${city} ${locale} ${plan}</p></li>`,
    ).join('');
    const html = [
      '<!doctype html>',
      '<html lang="en"><head>',
      '<meta charset="utf-8">',
      '<title>nodedc benchmark payload</title>',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<meta name="user-id" content="${userId}">`,
      '</head><body>',
      `<main data-plan="${plan}" data-locale="${locale}" data-city="${city}">`,
      `<header><h1>Dashboard section ${section}</h1><p>Flags: ${featureFlags.join(',')}</p></header>`,
      `<section><ul>${cards}</ul></section>`,
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

    payloads.push(Buffer.from(html));
  }

  return payloads;
}
