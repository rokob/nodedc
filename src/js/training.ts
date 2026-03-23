import { createHash } from 'node:crypto';

import { loadNativeTrainBinding } from './native.js';
import type { TrainBrotliDictionaryOptions, TrainZstdDictionaryOptions } from './types.js';

export interface TrainedDictionary {
  readonly dictionary: Buffer;
  readonly size: number;
  readonly sha256: string;
  readonly dictionaryId?: number;
}

function toBuffers(samples: readonly (Buffer | Uint8Array)[]): Buffer[] {
  if (samples.length === 0) {
    throw new TypeError('At least one sample is required.');
  }
  return samples.map((sample) => Buffer.isBuffer(sample) ? sample : Buffer.from(sample));
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function trainZstdDictionary(
  samples: readonly (Buffer | Uint8Array)[],
  options: TrainZstdDictionaryOptions = {}
): TrainedDictionary {
  const result = loadNativeTrainBinding().trainZstdSync(toBuffers(samples), options);
  return {
    dictionary: result.dictionary,
    size: result.size,
    sha256: sha256(result.dictionary),
    ...(result.dictionaryId !== 0 ? { dictionaryId: result.dictionaryId } : {}),
  };
}

export function hasBrotliTrainer(): boolean {
  return loadNativeTrainBinding().hasBrotliTrainer;
}

export function trainBrotliDictionary(
  samples: readonly (Buffer | Uint8Array)[],
  options: TrainBrotliDictionaryOptions = {}
): TrainedDictionary {
  const result = loadNativeTrainBinding().trainBrotliSync(toBuffers(samples), options);
  return {
    dictionary: result.dictionary,
    size: result.size,
    sha256: sha256(result.dictionary),
  };
}
