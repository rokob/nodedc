import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { NativeBindingUnavailableError } from './errors.js';

const require = createRequire(import.meta.url);

// Candidate roots to search for the compiled/prebuilt native addon, in priority
// order. Bundlers (rollup, esbuild, webpack, ...) rewrite `import.meta.url` to
// point at the consumer's bundle rather than this file inside the installed
// package, which breaks a single relative `../../` lookup. To stay robust we
// collect several anchors and try each one.
const packageRoots: string[] = (() => {
  const roots: string[] = [];
  const add = (root: string | undefined | null) => {
    if (root && !roots.includes(root)) {
      roots.push(path.resolve(root));
    }
  };

  // 1. Explicit override. When automatic resolution can't win (hoisted or
  //    symlinked monorepo layouts, custom bundler output paths, pnpm's nested
  //    node_modules, ...), a consumer can point NODEDC_PACKAGE_ROOT directly at
  //    the package root (the directory containing build/ and/or prebuilds/).
  add(process.env.NODEDC_PACKAGE_ROOT);

  // 2. Resolve the package's own package.json. This points at the real install
  //    location regardless of where any bundle that imported us ended up. It
  //    relies on the "./package.json" entry in this package's exports map.
  try {
    add(path.dirname(require.resolve('@rokob/nodedc/package.json')));
  } catch {
    // Not resolvable (e.g. running from source, or the consumer aliased the
    // package). Fall through to the relative anchors below.
  }

  // 3. The original anchor: this file lives at <root>/dist/js/native.js, so the
  //    package root is two directories up. Correct when we are not bundled.
  try {
    add(fileURLToPath(new URL('../../', import.meta.url)));
  } catch {
    // import.meta.url may be a non-file URL under some bundlers.
  }

  // 4. Additional walk-up anchors for unusual bundle layouts where the bundle
  //    sits one directory shallower or deeper than expected.
  try {
    add(fileURLToPath(new URL('../', import.meta.url)));
    add(fileURLToPath(new URL('../../../', import.meta.url)));
  } catch {
    // Ignore non-file URLs.
  }

  return roots;
})();

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
  readonly BrotliDecompressor: new (
    dictionary: NativeBrotliPreparedDictionary,
  ) => NativeBrotliDecompressor;
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
  compress(input: Buffer, options?: NativeBrotliCompressOptions): Promise<Buffer>;
  decompress(input: Buffer): Promise<Buffer>;
}

export interface NativeBrotliCompressOptions {
  quality?: number;
  windowBits?: number;
}

export interface NativeBrotliCompressor {
  push(input: Buffer): Buffer;
  pushAsync(input: Buffer): Promise<Buffer>;
  end(): Buffer;
  endAsync(): Promise<Buffer>;
}

export interface NativeBrotliDecompressor {
  push(input: Buffer): Buffer;
  end(): void;
}

export interface NativeZstdPreparedDictionary {
  readonly algorithm: 'zstd';
  readonly size: number;
  compress(input: Buffer, options?: NativeZstdCompressOptions): Promise<Buffer>;
  decompress(input: Buffer): Promise<Buffer>;
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
  pushAsync(input: Buffer): Promise<Buffer>;
  end(): Buffer;
  endAsync(): Promise<Buffer>;
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

function resolveNamedBindingInRoot(packageRoot: string, targetName: string): string | null {
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

  return null;
}

function resolveNamedBinding(targetName: string): string {
  for (const packageRoot of packageRoots) {
    const resolved = resolveNamedBindingInRoot(packageRoot, targetName);
    if (resolved) {
      return resolved;
    }
  }

  throw new Error(
    `No native build was found for target=${targetName} platform=${platform} arch=${arch} runtime=${runtime} abi=${process.versions.modules} uv=${uv} armv=${armv} libc=${libc} node=${process.versions.node}\n    searched roots: ${packageRoots.join(', ') || '(none)'}\n`,
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
