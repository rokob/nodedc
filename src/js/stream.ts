import { Transform } from 'node:stream';

import { NotImplementedPhaseError } from './errors.js';
import { loadNativeBinding } from './native.js';
import { getTransportInfo } from './transport.js';

import type { CompressOptions, DecompressOptions } from './types.js';
import type {
  NativeBrotliCompressor,
  NativeBrotliPreparedDictionary,
  NativeZstdCompressor,
  NativeZstdDecompressor,
  NativeZstdPreparedDictionary
} from './native.js';

class NativeCompressorTransform extends Transform {
  #headerSent = false;

  constructor(
    private readonly nativeStream: NativeBrotliCompressor | NativeZstdCompressor,
    private readonly header?: Buffer
  ) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void
  ): void {
    try {
      const output = this.nativeStream.push(chunk);
      if (!this.#headerSent && this.header) {
        this.#headerSent = true;
        callback(null, Buffer.concat([this.header, output]));
        return;
      }

      callback(null, output.length > 0 ? output : undefined);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  override _flush(callback: (error?: Error | null, data?: Buffer) => void): void {
    try {
      const output = this.nativeStream.end();
      if (!this.#headerSent && this.header) {
        this.#headerSent = true;
        callback(null, Buffer.concat([this.header, output]));
        return;
      }

      callback(null, output.length > 0 ? output : undefined);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

class NativeDecompressorTransform extends Transform {
  #headerBuffer = Buffer.alloc(0);
  #validated = false;

  constructor(
    private readonly nativeStream: NativeZstdDecompressor,
    private readonly header?: Buffer,
    private readonly contentEncoding?: 'dcb' | 'dcz'
  ) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void
  ): void {
    try {
      let payload = chunk;

      if (this.header && !this.#validated) {
        this.#headerBuffer = Buffer.concat([this.#headerBuffer, chunk]);
        if (this.#headerBuffer.length < this.header.length) {
          callback(null);
          return;
        }

        const receivedHeader = this.#headerBuffer.subarray(0, this.header.length);
        if (!receivedHeader.equals(this.header)) {
          throw new Error(`Invalid ${this.contentEncoding} transport header.`);
        }

        this.#validated = true;
        payload = this.#headerBuffer.subarray(this.header.length);
        this.#headerBuffer = Buffer.alloc(0);
      }

      const output = this.nativeStream.push(payload);
      callback(null, output.length > 0 ? output : undefined);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  override _flush(callback: (error?: Error | null) => void): void {
    try {
      if (this.header && !this.#validated) {
        callback(new Error(`Incomplete ${this.contentEncoding} payload: missing transport header bytes.`));
        return;
      }

      this.nativeStream.end();
      callback(null);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export function createCompressStream(
  nativeDictionary: NativeBrotliPreparedDictionary | NativeZstdPreparedDictionary,
  hash: string,
  algorithm: 'brotli' | 'zstd',
  options: CompressOptions = {}
): Transform {
  const binding = loadNativeBinding();
  const header = options.transport === 'transport' ? getTransportInfo(algorithm, hash).headerBytes : undefined;
  if (algorithm === 'zstd') {
    return new NativeCompressorTransform(
      new binding.ZstdCompressor(nativeDictionary as NativeZstdPreparedDictionary, options),
      header
    );
  }

  if (algorithm === 'brotli') {
    return new NativeCompressorTransform(
      new binding.BrotliCompressor(nativeDictionary as NativeBrotliPreparedDictionary, options),
      header
    );
  }

  throw new NotImplementedPhaseError(`Streaming compression for ${algorithm} is not implemented yet.`);
}

export function createDecompressStream(
  nativeDictionary: NativeZstdPreparedDictionary,
  hash: string,
  algorithm: 'brotli' | 'zstd',
  options: DecompressOptions = {}
): Transform {
  if (algorithm !== 'zstd') {
    throw new NotImplementedPhaseError(`Streaming decompression for ${algorithm} is not implemented yet.`);
  }

  const binding = loadNativeBinding();
  const transport = options.transport === 'transport' ? getTransportInfo(algorithm, hash) : undefined;
  return new NativeDecompressorTransform(
    new binding.ZstdDecompressor(nativeDictionary),
    transport?.headerBytes,
    transport?.contentEncoding
  );
}
