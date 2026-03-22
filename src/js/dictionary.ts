import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';

import { NotImplementedPhaseError } from './errors.js';
import { loadNativeBinding } from './native.js';
import { createCompressStream, createDecompressStream } from './stream.js';
import { contentEncodingFor, getTransportInfo } from './transport.js';

import type {
  CompressOptions,
  DecompressOptions,
  PreparedDictionaryInit,
  PreparedDictionaryShape
} from './types.js';
import type { NativeBrotliPreparedDictionary, NativeZstdPreparedDictionary } from './native.js';

class UnimplementedDictionaryStream extends Transform {
  constructor(private readonly action: 'compress' | 'decompress') {
    super();
  }

  override _transform(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void
  ): void {
    callback(
      new NotImplementedPhaseError(`Streaming ${this.action} is not implemented in the scaffold phase.`)
    );
  }
}

function normalizeBytes(bytes: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? Buffer.from(bytes) : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class PreparedDictionary implements PreparedDictionaryShape {
  readonly algorithm;
  readonly hash;
  readonly size;
  readonly metadata;

  readonly #bytes: Buffer;
  #nativeBrotli?: NativeBrotliPreparedDictionary;
  #nativeZstd?: NativeZstdPreparedDictionary;

  constructor(init: PreparedDictionaryInit) {
    this.algorithm = init.algorithm;
    this.#bytes = normalizeBytes(init.bytes);
    this.hash = init.hash ?? sha256Hex(this.#bytes);
    this.size = this.#bytes.byteLength;
    this.metadata = Object.freeze({ ...(init.metadata ?? {}) });

    if (this.algorithm !== 'brotli' && this.algorithm !== 'zstd') {
      throw new TypeError(`Unsupported algorithm: ${String(this.algorithm)}`);
    }
  }

  get bytes(): Buffer {
    return Buffer.from(this.#bytes);
  }

  createCompressStream(_options: CompressOptions = {}): Transform {
    if (this.algorithm === 'zstd') {
      return createCompressStream(this.#getNativeZstd(), this.algorithm, _options);
    }

    return new UnimplementedDictionaryStream('compress');
  }

  createDecompressStream(_options: DecompressOptions = {}): Transform {
    if (this.algorithm === 'zstd') {
      return createDecompressStream(this.#getNativeZstd(), this.algorithm, _options);
    }

    return new UnimplementedDictionaryStream('decompress');
  }

  async compress(input: Buffer | Uint8Array, options: CompressOptions = {}): Promise<Buffer> {
    const normalizedInput = normalizeBytes(input);

    if (options.transport === 'transport') {
      throw new NotImplementedPhaseError(
        `Transport-framed ${this.algorithm} compression is not implemented yet.`
      );
    }

    if (this.algorithm === 'zstd') {
      const nativeOptions: { quality?: number; checksum?: boolean } = {};
      if (options.quality !== undefined) {
        nativeOptions.quality = options.quality;
      }
      if (options.checksum !== undefined) {
        nativeOptions.checksum = options.checksum;
      }

      return this.#getNativeZstd().compressSync(normalizedInput, nativeOptions);
    }

    if (this.algorithm === 'brotli') {
      const nativeOptions: { quality?: number; windowBits?: number } = {};
      if (options.quality !== undefined) {
        nativeOptions.quality = options.quality;
      }
      if (options.windowBits !== undefined) {
        nativeOptions.windowBits = options.windowBits;
      }

      return this.#getNativeBrotli().compressSync(normalizedInput, nativeOptions);
    }

    throw new NotImplementedPhaseError(
      `Prepared ${this.algorithm} dictionary compression is not implemented yet.`
    );
  }

  async decompress(input: Buffer | Uint8Array, options: DecompressOptions = {}): Promise<Buffer> {
    if (options.transport === 'transport') {
      throw new NotImplementedPhaseError(
        `Transport-framed ${this.algorithm} decompression is not implemented yet.`
      );
    }

    if (this.algorithm === 'zstd') {
      return this.#getNativeZstd().decompressSync(normalizeBytes(input));
    }

    if (this.algorithm === 'brotli') {
      return this.#getNativeBrotli().decompressSync(normalizeBytes(input));
    }

    throw new NotImplementedPhaseError(
      `Prepared ${this.algorithm} dictionary decompression is not implemented yet.`
    );
  }

  getTransportInfo() {
    return getTransportInfo(this.algorithm, this.hash);
  }

  getContentEncoding(transport: 'raw' | 'transport' = 'raw'): string {
    return contentEncodingFor(this.algorithm, transport);
  }

  #getNativeZstd(): NativeZstdPreparedDictionary {
    if (this.algorithm !== 'zstd') {
      throw new NotImplementedPhaseError(`Native ${this.algorithm} support is not implemented yet.`);
    }

    if (!this.#nativeZstd) {
      const binding = loadNativeBinding();
      this.#nativeZstd = new binding.ZstdPreparedDictionary(this.#bytes);
    }

    return this.#nativeZstd;
  }

  #getNativeBrotli(): NativeBrotliPreparedDictionary {
    if (this.algorithm !== 'brotli') {
      throw new NotImplementedPhaseError(`Native ${this.algorithm} support is not implemented yet.`);
    }

    if (!this.#nativeBrotli) {
      const binding = loadNativeBinding();
      this.#nativeBrotli = new binding.BrotliPreparedDictionary(this.#bytes);
    }

    return this.#nativeBrotli;
  }
}
