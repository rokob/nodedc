import path from 'node:path';

import { trainZstdDictionary } from '../training.js';
import { fail, parseInteger, sampleBuffers, walkSamples, writeOutput } from './common.js';

function main(argv: readonly string[]): void {
  let output: string | null = null;
  let metadata: string | null = null;
  const options: Parameters<typeof trainZstdDictionary>[1] = {};
  const inputs: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--output') {
      output = path.resolve(argv[++i] ?? '');
    } else if (arg === '--metadata') {
      metadata = path.resolve(argv[++i] ?? '');
    } else if (arg === '--dict-size') {
      options.dictSize = parseInteger(argv[++i], '--dict-size');
    } else if (arg === '--compression-level') {
      options.compressionLevel = parseInteger(argv[++i], '--compression-level');
    } else if (arg === '--notification-level') {
      options.notificationLevel = parseInteger(argv[++i], '--notification-level');
    } else if (arg === '--dict-id') {
      options.dictId = parseInteger(argv[++i], '--dict-id');
    } else if (arg === '--k') {
      options.k = parseInteger(argv[++i], '--k');
    } else if (arg === '--d') {
      options.d = parseInteger(argv[++i], '--d');
    } else if (arg === '--steps') {
      options.steps = parseInteger(argv[++i], '--steps');
    } else if (arg === '--f') {
      options.f = parseInteger(argv[++i], '--f');
    } else if (arg === '--accel') {
      options.accel = parseInteger(argv[++i], '--accel');
    } else if (arg === '--split-point') {
      const value = argv[++i];
      if (!value) {
        fail('Missing value for --split-point.');
      }
      options.splitPoint = Number(value);
    } else if (arg === '--shrink') {
      options.shrink = parseInteger(argv[++i], '--shrink');
    } else if (arg === '--shrink-max-regression') {
      options.shrinkMaxRegression = parseInteger(argv[++i], '--shrink-max-regression');
    } else if (arg.startsWith('--')) {
      fail(`Unknown option: ${arg}`);
    } else {
      inputs.push(arg);
    }
  }

  if (!output) {
    fail('The --output option is required.');
  }
  if (inputs.length === 0) {
    fail('At least one sample file or directory is required.');
  }

  metadata ??= `${output}.json`;

  const samples = walkSamples(inputs);
  const result = trainZstdDictionary(sampleBuffers(samples), options);
  const sampleBytes = samples.reduce((sum, sample) => sum + sample.size, 0);

  writeOutput(output, result.dictionary, metadata, {
    algorithm: 'zstd',
    format: 'zstd-dictionary',
    hashAlgorithm: 'sha256',
    hash: result.sha256,
    size: result.size,
    dictionaryId: result.dictionaryId ?? null,
    createdAt: new Date().toISOString(),
    outputPath: output,
    sampleCount: samples.length,
    sampleBytes,
    training: {
      tool: 'nodedc-train-zstd',
      options,
    },
  });

  console.log(`wrote ${output}`);
  console.log(`wrote ${metadata}`);
}

main(process.argv.slice(2));
