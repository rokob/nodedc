import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { NativeBindingUnavailableError } from './errors.js';

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

export interface NativeBinding {
  readonly version: string;
  readonly napiVersion: number;
  readonly BrotliPreparedDictionary: new (bytes: Buffer) => NativeBrotliPreparedDictionary;
  readonly ZstdPreparedDictionary: new (bytes: Buffer) => NativeZstdPreparedDictionary;
  readonly ZstdCompressor: new (
    dictionary: NativeZstdPreparedDictionary,
    options?: NativeZstdCompressOptions
  ) => NativeZstdCompressor;
  readonly ZstdDecompressor: new (dictionary: NativeZstdPreparedDictionary) => NativeZstdDecompressor;
}

export interface NativeBrotliPreparedDictionary {
  readonly algorithm: 'brotli';
  readonly size: number;
  compressSync(input: Buffer, options?: NativeBrotliCompressOptions): Buffer;
  decompressSync(input: Buffer): Buffer;
}

export interface NativeBrotliCompressOptions {
  quality?: number;
  windowBits?: number;
}

export interface NativeZstdPreparedDictionary {
  readonly algorithm: 'zstd';
  readonly size: number;
  compressSync(input: Buffer, options?: NativeZstdCompressOptions): Buffer;
  decompressSync(input: Buffer): Buffer;
}

export interface NativeZstdCompressOptions {
  quality?: number;
  checksum?: boolean;
}

export interface NativeZstdCompressor {
  push(input: Buffer): Buffer;
  end(): Buffer;
}

export interface NativeZstdDecompressor {
  push(input: Buffer): Buffer;
  end(): void;
}

let cachedBinding: NativeBinding | null | undefined;

export function loadNativeBinding(): NativeBinding {
  if (cachedBinding) {
    return cachedBinding;
  }

  if (cachedBinding === null) {
    throw new NativeBindingUnavailableError();
  }

  try {
    const load = require('node-gyp-build') as (path: string) => NativeBinding;
    cachedBinding = load(packageRoot);
    return cachedBinding;
  } catch (error) {
    cachedBinding = null;
    throw new NativeBindingUnavailableError(
      error instanceof Error ? `${error.message}` : 'The nodedc native binding is not available.'
    );
  }
}

export function tryLoadNativeBinding(): NativeBinding | null {
  try {
    return loadNativeBinding();
  } catch {
    return null;
  }
}
