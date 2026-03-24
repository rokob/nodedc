import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { NativeBindingUnavailableError } from './errors.js';

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const runtime = process.versions.electron ? 'electron' : 'node';
const arch = process.env.npm_config_arch || os.arch();
const platform = process.env.npm_config_platform || os.platform();
const libc =
  process.env.LIBC ||
  (platform === 'linux' && existsSync('/etc/alpine-release') ? 'musl' : 'glibc');
const armVersion = (process.config.variables as { arm_version?: string | number }).arm_version;
const armv = process.env.ARM_VERSION || (arch === 'arm64' ? '8' : `${armVersion ?? ''}`) || '';
const uv = (process.versions.uv || '').split('.')[0];

export interface NativeBinding {
  readonly version: string;
  readonly napiVersion: number;
  readonly BrotliPreparedDictionary: new (bytes: Buffer) => NativeBrotliPreparedDictionary;
  readonly BrotliCompressor: new (
    dictionary: NativeBrotliPreparedDictionary,
    options?: NativeBrotliCompressOptions,
  ) => NativeBrotliCompressor;
  readonly ZstdPreparedDictionary: new (bytes: Buffer) => NativeZstdPreparedDictionary;
  readonly ZstdCompressor: new (
    dictionary: NativeZstdPreparedDictionary,
    options?: NativeZstdCompressOptions,
  ) => NativeZstdCompressor;
  readonly ZstdDecompressor: new (
    dictionary: NativeZstdPreparedDictionary,
  ) => NativeZstdDecompressor;
}

export interface NativeTrainBinding {
  readonly version: string;
  readonly napiVersion: number;
  readonly hasBrotliTrainer: boolean;
  trainZstdSync(
    samples: Buffer[],
    options?: NativeZstdTrainOptions,
  ): {
    readonly dictionary: Buffer;
    readonly size: number;
    readonly dictionaryId: number;
  };
  trainBrotliSync(
    samples: Buffer[],
    options?: NativeBrotliTrainOptions,
  ): {
    readonly dictionary: Buffer;
    readonly size: number;
  };
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

export interface NativeBrotliCompressor {
  push(input: Buffer): Buffer;
  end(): Buffer;
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

export interface NativeZstdTrainOptions {
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

export interface NativeBrotliTrainOptions {
  engine?: 'dm' | 'dsh' | 'sieve';
  blockLen?: number;
  sliceLen?: number;
  targetDictLen?: number;
  minSlicePop?: number;
  chunkLen?: number;
  overlapLen?: number;
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
let cachedTrainBinding: NativeTrainBinding | null | undefined;

function parseTuple(name: string) {
  const parts = name.split('-');
  if (parts.length !== 2) {
    return null;
  }
  const tuplePlatform = parts[0];
  const architectures = parts[1]?.split('+') ?? [];
  if (
    !tuplePlatform ||
    architectures.length === 0 ||
    architectures.some((value) => value.length === 0)
  ) {
    return null;
  }
  return { name, platform: tuplePlatform, architectures };
}

function parseTags(targetName: string, file: string) {
  if (!file.endsWith('.node')) {
    return null;
  }
  if (!(file === `${targetName}.node` || file.startsWith(`${targetName}.`))) {
    return null;
  }
  const tagSection =
    file === `${targetName}.node` ? '' : file.slice(targetName.length + 1, -'.node'.length);
  const parts = tagSection.length === 0 ? [] : tagSection.split('.');
  const tags: {
    file: string;
    runtime?: string;
    napi?: boolean;
    abi?: string;
    uv?: string;
    armv?: string;
    libc?: string;
    specificity: number;
  } = { file, specificity: 0 };

  for (const tag of parts) {
    if (tag === 'node' || tag === 'electron' || tag === 'node-webkit') {
      tags.runtime = tag;
    } else if (tag === 'napi') {
      tags.napi = true;
    } else if (tag.startsWith('abi')) {
      tags.abi = tag.slice(3);
    } else if (tag.startsWith('uv')) {
      tags.uv = tag.slice(2);
    } else if (tag.startsWith('armv')) {
      tags.armv = tag.slice(4);
    } else if (tag === 'glibc' || tag === 'musl') {
      tags.libc = tag;
    } else {
      continue;
    }
    tags.specificity += 1;
  }

  return tags;
}

function matchTags(tags: NonNullable<ReturnType<typeof parseTags>>) {
  if (tags.runtime && tags.runtime !== runtime && !(tags.runtime === 'node' && tags.napi)) {
    return false;
  }
  if (tags.abi && tags.abi !== process.versions.modules && !tags.napi) {
    return false;
  }
  if (tags.uv && tags.uv !== uv) {
    return false;
  }
  if (tags.armv && tags.armv !== armv) {
    return false;
  }
  if (tags.libc && tags.libc !== libc) {
    return false;
  }
  return true;
}

function compareTags(
  a: NonNullable<ReturnType<typeof parseTags>>,
  b: NonNullable<ReturnType<typeof parseTags>>,
) {
  if (a.runtime !== b.runtime) {
    return a.runtime === runtime ? -1 : 1;
  }
  if (a.abi !== b.abi) {
    return a.abi ? -1 : 1;
  }
  if (a.specificity !== b.specificity) {
    return a.specificity > b.specificity ? -1 : 1;
  }
  return 0;
}

function resolveNamedBinding(targetName: string): string {
  for (const directory of [
    path.join(packageRoot, 'build', 'Release'),
    path.join(packageRoot, 'build', 'Debug'),
  ]) {
    const candidate = path.join(directory, `${targetName}.node`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const prebuildsRoot = path.join(packageRoot, 'prebuilds');
  if (existsSync(prebuildsRoot)) {
    const tuple = readdirSync(prebuildsRoot)
      .map(parseTuple)
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .filter((value) => value.platform === platform && value.architectures.includes(arch))
      .sort((a, b) => a.architectures.length - b.architectures.length)[0];

    if (tuple) {
      const prebuildDir = path.join(prebuildsRoot, tuple.name);
      const winner = readdirSync(prebuildDir)
        .map((file) => parseTags(targetName, file))
        .filter((value): value is NonNullable<typeof value> => value !== null)
        .filter(matchTags)
        .sort(compareTags)[0];

      if (winner) {
        return path.join(prebuildDir, winner.file);
      }
    }
  }

  throw new Error(
    `No native build was found for target=${targetName} platform=${platform} arch=${arch} runtime=${runtime} abi=${process.versions.modules} uv=${uv} armv=${armv} libc=${libc} node=${process.versions.node}\n    loaded from: ${packageRoot}\n`,
  );
}

export function loadNativeBinding(): NativeBinding {
  if (cachedBinding) {
    return cachedBinding;
  }

  if (cachedBinding === null) {
    throw new NativeBindingUnavailableError();
  }

  try {
    cachedBinding = require(resolveNamedBinding('nodedc')) as NativeBinding;
    return cachedBinding;
  } catch (error) {
    cachedBinding = null;
    throw new NativeBindingUnavailableError(
      error instanceof Error ? `${error.message}` : 'The nodedc native binding is not available.',
    );
  }
}

export function loadNativeTrainBinding(): NativeTrainBinding {
  if (cachedTrainBinding) {
    return cachedTrainBinding;
  }

  if (cachedTrainBinding === null) {
    throw new NativeBindingUnavailableError();
  }

  try {
    cachedTrainBinding = require(resolveNamedBinding('nodedc_train')) as NativeTrainBinding;
    return cachedTrainBinding;
  } catch (error) {
    cachedTrainBinding = null;
    throw new NativeBindingUnavailableError(
      error instanceof Error
        ? `${error.message}`
        : 'The nodedc training native binding is not available.',
    );
  }
}

export function tryLoadNativeTrainBinding(): NativeTrainBinding | null {
  try {
    return loadNativeTrainBinding();
  } catch {
    return null;
  }
}

export function tryLoadNativeBinding(): NativeBinding | null {
  try {
    return loadNativeBinding();
  } catch {
    return null;
  }
}
