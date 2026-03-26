import type { Transform } from 'node:stream';

export type Algorithm = 'brotli' | 'zstd';
export type TransportMode = 'raw' | 'transport';
export type FileCompression = 'none' | 'brotli' | 'zstd';

export interface PreparedDictionaryInit {
  algorithm: Algorithm;
  bytes: Buffer | Uint8Array;
  hash?: string;
  metadata?: Record<string, string>;
}

export interface PreparedDictionaryFromFileOptions {
  algorithm: Algorithm;
  compression?: FileCompression;
  hash?: string;
  metadata?: Record<string, string>;
}

export interface CompressOptions {
  quality?: number;
  windowBits?: number;
  checksum?: boolean;
  params?: Record<number, number>;
}

export interface DecompressOptions {
  transport?: TransportMode;
  params?: Record<number, number>;
}

export interface TrainZstdDictionaryOptions {
  dictSize?: number;
  compressionLevel?: number;
  notificationLevel?: number;
  dictId?: number;
  k?: number;
  d?: number;
  steps?: number;
  f?: number;
  accel?: number;
  splitPoint?: number;
  shrink?: number;
  shrinkMaxRegression?: number;
}

export interface TrainBrotliDictionaryOptions {
  engine?: 'dm' | 'dsh' | 'sieve';
  blockLen?: number;
  sliceLen?: number;
  targetDictLen?: number;
  minSlicePop?: number;
  chunkLen?: number;
  overlapLen?: number;
}

export interface PreparedDictionaryShape {
  readonly algorithm: Algorithm;
  readonly hash: string;
  readonly size: number;
  readonly metadata: Readonly<Record<string, string>>;
  createCompressStream(options?: CompressOptions): Transform;
  createTransportCompressStream(options?: CompressOptions): Transform;
  createDecompressStream(options?: DecompressOptions): Transform;
  compress(input: Buffer | Uint8Array, options?: CompressOptions): Promise<Buffer>;
  compressTransport(input: Buffer | Uint8Array, options?: CompressOptions): Promise<Buffer>;
  decompress(input: Buffer | Uint8Array, options?: DecompressOptions): Promise<Buffer>;
}

export interface NegotiationInput {
  acceptEncoding?: string | null;
  availableDictionary?: string | null;
}

export interface NegotiationOptions {
  algorithm?: Algorithm;
  preferredAlgorithm?: Algorithm;
}

export interface HttpNegotiationResult<
  TDictionary extends PreparedDictionaryShape = PreparedDictionaryShape,
> {
  dictionary: TDictionary;
  contentEncoding: 'dcb' | 'dcz';
}

export type NegotiationResult<
  TDictionary extends PreparedDictionaryShape = PreparedDictionaryShape,
> = HttpNegotiationResult<TDictionary>;
