import path from 'node:path';

import { hasBrotliTrainer, trainBrotliDictionary } from '../training.js';
import { fail, parseInteger, sampleBuffers, walkSamples, writeOutput } from './common.js';

function main(argv: readonly string[]): void {
  let output: string | null = null;
  let metadata: string | null = null;
  const options: Parameters<typeof trainBrotliDictionary>[1] = {};
  const inputs: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--output') {
      output = path.resolve(argv[++i] ?? '');
    } else if (arg === '--metadata') {
      metadata = path.resolve(argv[++i] ?? '');
    } else if (arg === '--engine') {
      const engine = argv[++i];
      if (engine !== 'dm' && engine !== 'dsh' && engine !== 'sieve') {
        fail('The --engine option must be one of: dm, dsh, sieve.');
      }
      options.engine = engine;
    } else if (arg === '--block-len') {
      options.blockLen = parseInteger(argv[++i], '--block-len');
    } else if (arg === '--slice-len') {
      options.sliceLen = parseInteger(argv[++i], '--slice-len');
    } else if (arg === '--target-dict-len') {
      options.targetDictLen = parseInteger(argv[++i], '--target-dict-len');
    } else if (arg === '--min-slice-pop') {
      options.minSlicePop = parseInteger(argv[++i], '--min-slice-pop');
    } else if (arg === '--chunk-len') {
      options.chunkLen = parseInteger(argv[++i], '--chunk-len');
    } else if (arg === '--overlap-len') {
      options.overlapLen = parseInteger(argv[++i], '--overlap-len');
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
  if (!hasBrotliTrainer()) {
    fail('Brotli training is not available in this build. Vendor vendor/divsufsort and vendor/esaxx and rebuild/prebuild the training addon.');
  }

  metadata ??= `${output}.json`;
  const samples = walkSamples(inputs);
  const result = trainBrotliDictionary(sampleBuffers(samples), options);
  const sampleBytes = samples.reduce((sum, sample) => sum + sample.size, 0);

  writeOutput(output, result.dictionary, metadata, {
    algorithm: 'brotli',
    format: 'brotli-raw-shared-dictionary',
    hashAlgorithm: 'sha256',
    hash: result.sha256,
    size: result.size,
    createdAt: new Date().toISOString(),
    outputPath: output,
    sampleCount: samples.length,
    sampleBytes,
    training: {
      tool: 'nodedc-train-brotli',
      options,
    },
  });

  console.log(`wrote ${output}`);
  console.log(`wrote ${metadata}`);
}

main(process.argv.slice(2));
