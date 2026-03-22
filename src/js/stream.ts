import { Transform } from 'node:stream';

import { NotImplementedPhaseError } from './errors.js';
import { loadNativeBinding } from './native.js';

import type { CompressOptions, DecompressOptions } from './types.js';
import type {
  NativeZstdCompressor,
  NativeZstdDecompressor,
  NativeZstdPreparedDictionary
} from './native.js';

class NativeCompressorTransform extends Transform {
  constructor(private readonly nativeStream: NativeZstdCompressor) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void
  ): void {
    try {
      const output = this.nativeStream.push(chunk);
      callback(null, output.length > 0 ? output : undefined);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  override _flush(callback: (error?: Error | null, data?: Buffer) => void): void {
    try {
      const output = this.nativeStream.end();
      callback(null, output.length > 0 ? output : undefined);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

class NativeDecompressorTransform extends Transform {
  constructor(private readonly nativeStream: NativeZstdDecompressor) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void
  ): void {
    try {
      const output = this.nativeStream.push(chunk);
      callback(null, output.length > 0 ? output : undefined);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  override _flush(callback: (error?: Error | null) => void): void {
    try {
      this.nativeStream.end();
      callback(null);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export function createCompressStream(
  nativeDictionary: NativeZstdPreparedDictionary,
  algorithm: 'brotli' | 'zstd',
  options: CompressOptions = {}
): Transform {
  if (options.transport === 'transport') {
    throw new NotImplementedPhaseError(`Transport-framed ${algorithm} streaming compression is not implemented yet.`);
  }

  if (algorithm !== 'zstd') {
    throw new NotImplementedPhaseError(`Streaming compression for ${algorithm} is not implemented yet.`);
  }

  const binding = loadNativeBinding();
  return new NativeCompressorTransform(new binding.ZstdCompressor(nativeDictionary, options));
}

export function createDecompressStream(
  nativeDictionary: NativeZstdPreparedDictionary,
  algorithm: 'brotli' | 'zstd',
  options: DecompressOptions = {}
): Transform {
  if (options.transport === 'transport') {
    throw new NotImplementedPhaseError(
      `Transport-framed ${algorithm} streaming decompression is not implemented yet.`
    );
  }

  if (algorithm !== 'zstd') {
    throw new NotImplementedPhaseError(`Streaming decompression for ${algorithm} is not implemented yet.`);
  }

  const binding = loadNativeBinding();
  return new NativeDecompressorTransform(new binding.ZstdDecompressor(nativeDictionary));
}

