# nodedc Implementation Plan

## Goal

Build an ESM-only Node.js library for high-performance shared-dictionary compression in web servers.

The library should:

- Reuse prepared dictionary state across many independent compression operations.
- Support Brotli and Zstandard.
- Support streaming compression for HTTP responses.
- Support multiple dictionaries resident in memory at once.
- Support RFC 9842 dictionary-compressed transport output (`dcb` and `dcz`).
- Include offline dictionary training tooling for Zstandard and Brotli.
- Ship native prebuilts for macOS and Linux (glibc).
- Include decompression support for tests, tooling, and debugging.

## Scope Decisions

- Language: C++ for the addon layer.
- Node binding layer: N-API via `node-addon-api`.
- Packaging: ESM only.
- Minimum Node version: `22.22.1`.
- Platforms:
  - macOS x64
  - macOS arm64
  - Linux x64 glibc
  - Linux arm64 glibc
- Training tools:
  - CLI tools included in the repo and runnable in CI.
  - No JS training API in v1.
- HTTP support:
  - Provide lightweight request/response negotiation helpers.
  - Do not build a full web framework integration layer in v1.

## Why C++ + N-API

This project needs stable native distribution more than it needs the most ergonomic native development experience.

N-API is the right fit because:

- It provides ABI stability across supported Node releases.
- It reduces prebuild churn compared to V8- or Node-version-specific bindings.
- It integrates cleanly with a traditional Node addon toolchain.
- It allows a thin, explicit wrapper around vendored Brotli and Zstandard code.

Rust remains viable later, but it adds another toolchain and packaging surface. For a greenfield addon that vendors C libraries and wants broad prebuilt support, C++ is the simpler first implementation.

## Codec Facts

- Zstandard is a C library, not C++.
- Brotli is also a C library.
- Both codec libraries expose APIs that allow a dictionary to be prepared once and attached to many independent encoder or decoder states.
- Node's built-in `node:zlib` dictionary support is one-shot from the application perspective and does not expose reusable prepared dictionary objects.

## External Standards and Compatibility

The transport framing target is RFC 9842, Compression Dictionary Transport.

Relevant content encodings:

- `dcb`: dictionary-compressed Brotli
- `dcz`: dictionary-compressed Zstandard

The library should emit RFC 9842-compatible framed output by prepending the required fixed header and the SHA-256 hash of the dictionary used.

The library should also expose enough metadata and helper functions to support:

- `Available-Dictionary`
- `Use-As-Dictionary`
- `Content-Encoding`
- `Accept-Encoding`

The initial helper layer should be low-level and composable rather than opinionated around any single HTTP framework.

## High-Level Architecture

The system should be split into four layers:

1. Native codec core
2. JS/TS runtime API
3. HTTP negotiation and transport helpers
4. Offline training CLIs

### 1. Native codec core

Native code owns:

- Prepared dictionary objects
- Stream encoder objects
- Stream decoder objects
- Codec-specific parameter translation
- RFC 9842 framing for streamed output

Native code should be thin and explicit. It should not contain HTTP policy or framework logic.

### 2. JS/TS runtime API

JS owns:

- User-facing classes and option validation
- Dictionary registry/store utilities
- Stream construction ergonomics
- Content-encoding negotiation helpers
- Metadata serialization

### 3. HTTP helpers

Helpers should:

- Parse request headers needed for dictionary-aware compression
- Match a request against available dictionaries
- Pick the correct content encoding
- Expose transport header values

Helpers should not:

- Hide all negotiation complexity
- Automatically mutate framework response objects
- Invent cache policy

### 4. Offline training CLIs

These tools should:

- Invoke vendored Zstandard dictionary training
- Invoke vendored Brotli research/shared dictionary generation tooling
- Produce dictionary bytes
- Produce metadata JSON alongside the dictionary

## Public API Shape

The core abstraction is an immutable prepared dictionary object.

### Prepared dictionary

```ts
export type Algorithm = 'brotli' | 'zstd';
export type TransportMode = 'raw' | 'transport';

export interface PreparedDictionaryInit {
  algorithm: Algorithm;
  bytes: Buffer | Uint8Array;
  hash?: string;
  metadata?: Record<string, string>;
}

export interface CompressOptions {
  quality?: number;
  windowBits?: number;
  checksum?: boolean;
  transport?: TransportMode;
  params?: Record<number, number>;
}

export interface DecompressOptions {
  params?: Record<number, number>;
}

export class PreparedDictionary {
  readonly algorithm: Algorithm;
  readonly hash: string;
  readonly size: number;
  readonly metadata: Readonly<Record<string, string>>;

  constructor(init: PreparedDictionaryInit);

  createCompressStream(options?: CompressOptions): Transform;
  createDecompressStream(options?: DecompressOptions): Transform;

  compress(input: Buffer | Uint8Array, options?: CompressOptions): Promise<Buffer>;
  decompress(input: Buffer | Uint8Array, options?: DecompressOptions): Promise<Buffer>;
}
```

This gives one-shot and streaming support without exposing mutable native codec state directly.

### Dictionary store

The library should include an optional in-memory registry.

```ts
export class DictionaryStore {
  add(dictionary: PreparedDictionary): void;
  get(hash: string, algorithm?: Algorithm): PreparedDictionary | undefined;
  has(hash: string, algorithm?: Algorithm): boolean;
  delete(hash: string, algorithm?: Algorithm): boolean;
  clear(): void;
  entries(): Iterable<[string, PreparedDictionary]>;
}
```

This is intended for servers that may keep several dictionaries alive at once for different request paths, clients, or content families.

### Transport metadata

```ts
export interface TransportInfo {
  algorithm: Algorithm;
  hash: string;
  contentEncoding: 'dcb' | 'dcz';
  headerBytes: Buffer;
}

export function getTransportInfo(dictionary: PreparedDictionary): TransportInfo;
```

The native stream should write `headerBytes` automatically in transport mode. Exposing the metadata still helps in tests and debugging.

### HTTP negotiation helpers

```ts
export interface NegotiationInput {
  acceptEncoding?: string | null;
  availableDictionary?: string | null;
}

export interface NegotiationResult {
  dictionary: PreparedDictionary;
  contentEncoding: 'br' | 'zstd' | 'dcb' | 'dcz';
  transport: TransportMode;
}

export function negotiateCompression(
  input: NegotiationInput,
  candidates: Iterable<PreparedDictionary>
): NegotiationResult | null;

export function formatAvailableDictionaryHeader(
  dictionaries: Iterable<PreparedDictionary>
): string;

export function parseAvailableDictionaryHeader(value: string): string[];
```

These helpers should stay small. They should help a server make the right choice, not force a particular server architecture.

## Native Object Model

The native layer should have explicit ownership boundaries.

### Native classes

- `PreparedDictionaryWrap`
- `CompressorWrap`
- `DecompressorWrap`
- `Codec` interface
- `ZstdCodec`
- `BrotliCodec`

### Ownership rules

- A prepared dictionary owns its codec-prepared dictionary state.
- A compressor or decompressor holds a strong reference to the prepared dictionary that created it.
- Stream instances are independent and single-use.
- Prepared dictionaries are immutable after construction.
- Multiple stream instances can share one prepared dictionary concurrently.

### Threading

Initial implementation should assume:

- Compression work is driven on the main Node event loop thread through stream writes.
- Native objects are not shared across threads.
- Worker thread support is not a v1 feature.

If background execution becomes necessary later, it can be added with explicit worker-safe wrappers.

## Streaming Model

Streaming support is a core requirement.

Each call to `createCompressStream()` or `createDecompressStream()` should create a fresh codec state.

Compression stream requirements:

- Accept arbitrary chunk boundaries.
- Support backpressure correctly.
- Support flush and finalization.
- Support transport framing for `dcb` and `dcz`.
- Support multiple simultaneous streams using one prepared dictionary.

Decompression stream requirements:

- Decode raw dictionary-compressed Brotli and Zstandard streams when the caller supplies the correct prepared dictionary.
- Support transport-framed `dcb` and `dcz` streams for tests and debugging.
- Validate transport framing against the supplied dictionary hash in transport mode.

## Transport Framing

Two output modes are required:

- `raw`
- `transport`

In `raw` mode, the library emits the codec stream only.

In `transport` mode:

- Brotli emits `dcb`
- Zstandard emits `dcz`

The transport wrapper should be implemented in the native stream so the header is always coupled to the actual dictionary used. This avoids accidental mismatches from JS.

Decompression helpers should:

- Parse and validate the transport prefix
- Confirm the dictionary hash matches
- Feed the payload to the codec decoder

## Parameter Handling

The API should make common tuning easy while still allowing advanced control.

### Common options

- `quality`
- `windowBits`
- `checksum` for Zstandard
- `transport`

### Advanced options

- `params: Record<number, number>`

The implementation should validate parameters conservatively:

- Reject unknown types
- Reject values outside documented codec ranges where practical
- Avoid silently ignoring invalid options

The native layer should translate the high-level options to codec-specific parameters.

## Vendoring Strategy

Both codec libraries should be vendored into the repo.

### Why vendor

- Reproducible builds
- No system dependency drift
- Easier CI and prebuild generation
- Stable training CLI behavior

### Expected layout

```text
vendor/
  brotli/
  zstd/
```

Vendoring should include:

- source code
- license files
- any required training utilities or source components

Vendored versions should be pinned and recorded in documentation.

## Build System

Recommended initial build stack:

- `node-gyp`
- `binding.gyp`
- `node-addon-api`
- TypeScript for JS surface

Why this stack:

- Lowest-risk path for a Node native addon
- Works well with vendored C/C code
- Plays well with N-API and prebuild tooling
- Easy for contributors to understand

CMake is not ruled out forever, but it should not be the starting point.

## Prebuild Distribution

Recommended initial prebuild strategy:

- N-API-targeted addon
- `prebuildify` for building artifacts
- GitHub Actions for matrix builds

Expected matrix:

- macOS x64
- macOS arm64
- Linux x64 glibc
- Linux arm64 glibc

The package should prefer a local prebuilt and fall back to source build only when necessary.

## Repository Layout

Planned repo structure:

```text
docs/
  implementation-plan.md
src/
  js/
    index.ts
    dictionary.ts
    store.ts
    stream.ts
    http.ts
    transport.ts
  native/
    addon.cc
    prepared_dictionary.h
    prepared_dictionary.cc
    compressor.h
    compressor.cc
    decompressor.h
    decompressor.cc
    codec.h
    zstd_codec.h
    zstd_codec.cc
    brotli_codec.h
    brotli_codec.cc
tools/
  train-zstd.cc
  train-brotli.cc
test/
  unit/
  integration/
  fixtures/
bench/
vendor/
  brotli/
  zstd/
```

This layout keeps runtime code, native bindings, tooling, and benchmarks cleanly separated.

## Training Tooling

Training is an offline concern in v1.

The repository should include CI-runnable tools for:

- Zstandard dictionary training
- Brotli research/shared dictionary generation

Expected outputs:

- dictionary bytes file
- metadata JSON file

Example metadata shape:

```json
{
  "algorithm": "zstd",
  "hash": "sha256-hex",
  "size": 65536,
  "createdAt": "2026-03-22T00:00:00.000Z",
  "parameters": {
    "maxDictSize": 65536
  }
}
```

### Why metadata matters

- It helps map runtime requests to resident dictionaries.
- It gives a stable identifier for transport framing and HTTP negotiation.
- It keeps CI artifacts self-describing.

## Testing Strategy

Testing should be layered.

### Unit tests

- Option validation
- Dictionary hash calculation
- Header formatting and parsing
- Negotiation helper behavior

### Native integration tests

- Prepare dictionary once, compress many times
- Multiple simultaneous streams sharing one dictionary
- Multiple different dictionaries resident at once
- Correct finalization semantics
- Correct error reporting on invalid dictionaries or parameters

### Cross-compatibility tests

- Zstandard output decompresses correctly with Node `node:zlib` when supported
- Zstandard transport wrapper round-trips through library tooling
- Brotli raw round-trip through library decoder
- Brotli transport wrapper round-trips through library decoder

### Stress tests

- Many short response bodies using one prepared dictionary
- Many dictionaries stored concurrently
- Chunked writes with unusual boundaries

### Fixture tests

Maintain fixed dictionaries and fixed payloads so transport framing and hash outputs are stable across refactors.

## Benchmark Plan

Benchmarks should target the actual value proposition rather than just large-file throughput.

Primary cases:

- Short and medium HTTP-like text responses
- Repeated independent compressions with the same dictionary
- Streaming responses with many chunk boundaries

Comparisons:

- Node built-in one-shot dictionary compression
- Native prepared dictionary one-shot compression
- Native prepared dictionary streaming compression

Metrics:

- throughput
- latency per response
- memory overhead
- initialization overhead avoided by dictionary reuse

## Safety and Failure Modes

The library should make the common case safe.

Safety principles:

- Prepared dictionaries are immutable.
- Streams are single-use.
- Transport headers are generated internally, not manually assembled by callers.
- Dictionary hash mismatches fail early during transport decode.
- Parameter validation should prefer explicit errors over surprising fallback behavior.

Known failure modes to cover:

- Wrong dictionary selected for decode
- Wrong hash in transport header
- Stream finalization on invalid or truncated input
- Invalid codec parameters
- Oversized or malformed dictionary input

## Documentation Plan

The project should ship with:

- a concise README
- API reference
- an HTTP server example
- a training example
- a benchmark methodology note

The HTTP example should show:

- storing several dictionaries in memory
- selecting by request headers
- setting `Content-Encoding`
- setting `Use-As-Dictionary` or `Available-Dictionary` where appropriate

## Delivery Phases

### Phase 0: project scaffold

- Set up package metadata
- Set up TypeScript and linting
- Set up `node-gyp`
- Add vendored sources
- Add CI skeleton

### Phase 1: Zstandard core

- Implement prepared dictionary object
- Implement one-shot compression
- Implement one-shot decompression
- Add unit and integration tests

### Phase 2: Zstandard streaming

- Implement stream compressor
- Implement stream decompressor
- Add concurrency and backpressure tests

### Phase 3: Brotli core

- Implement prepared/shared dictionary object
- Implement one-shot compression
- Implement one-shot decompression for tooling and tests

### Phase 4: Brotli streaming

- Implement stream compressor
- Implement stream decompressor
- Add compatibility and edge-case tests

### Phase 5: transport framing

- Implement `dcb` and `dcz`
- Add decode-side framing validation
- Add negotiation helpers

### Phase 6: training tooling

- Add Zstandard training CLI
- Add Brotli training CLI
- Emit metadata JSON
- Add CI examples

### Phase 7: packaging and prebuilds

- Add prebuild generation
- Add install-time resolution
- Publish smoke tests for all supported platforms

### Phase 8: docs and benchmarks

- Add README and examples
- Add benchmark suite
- Validate value proposition against Node built-ins

## Open Items

These do not block implementation start, but should be revisited during execution:

- Exact Brotli dictionary generation path and which vendored generator sources to include
- Final shape of HTTP header helper APIs once real examples are written
- Whether to expose synchronous one-shot APIs in addition to promise-based ones
- Whether to add framework adapters later for Node core `http`, Fastify, or Express

## Recommended Next Step

Start implementation with a minimal but production-shaped scaffold:

1. package and build configuration
2. vendored codec sources
3. N-API addon skeleton
4. TypeScript API shell
5. Zstandard prepared dictionary path first

Zstandard should be the first codec implemented because its prepared dictionary APIs are mature and it is the fastest path to validating the core architecture.
