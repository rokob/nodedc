# nodedc

Native shared-dictionary compression for Node.js web servers.

## Baseline

- Node `22.22.1+`
- ESM only
- C++ addon using N-API

## What it does

- prepares Brotli and Zstandard shared dictionaries once and reuses them across many operations
- supports one-shot and streaming compression
- supports multiple dictionaries in memory at once
- supports RFC 9842 transport encodings (`dcb` and `dcz`)
- exposes offline dictionary training tools for Brotli and Zstandard

## Install

```bash
npm install @rokob/nodedc
```

## Quick start

```js
import { readFile } from 'node:fs/promises';
import { PreparedDictionary } from '@rokob/nodedc';

const bytes = await readFile('./dicts/app.zdict');

const dictionary = new PreparedDictionary({
  algorithm: 'zstd',
  bytes,
});

const compressed = await dictionary.compress(Buffer.from('hello world'), {
  quality: 6,
});

const plain = await dictionary.decompress(compressed);
console.log(plain.toString());
```

## Training dictionaries

The package ships CLIs for offline dictionary generation.

Zstandard:

```bash
npx nodedc-train-zstd \
  --output ./dicts/app.zdict \
  --dict-size 8192 \
  ./samples
```

Brotli:

```bash
npx nodedc-train-brotli \
  --output ./dicts/app.dict \
  --engine dsh \
  --target-dict-len 12288 \
  ./samples
```

Each command writes:

- the dictionary file
- a metadata JSON file next to it by default

The metadata includes the SHA-256 dictionary hash. That hash is the important
identity to use in HTTP negotiation and transport framing.

### Raw vs trained dictionaries

There are two distinct dictionary shapes in practice:

- raw dictionaries: arbitrary bytes, usually a representative HTML, JSON, or text payload
- trained dictionaries: codec-specific training output

For browser Compression Dictionary Transport:

- use raw dictionaries for `dcb` and `dcz`
- do not use trained Zstandard `.zdict` files for browser `dcz`

Why:

- browsers store the dictionary resource as a normal downloaded file
- `Available-Dictionary` is keyed to the SHA-256 of those raw file bytes
- Zstandard training output includes its own binary dictionary header, so it is
  a different artifact than the raw file bytes the browser cached

For non-browser/server-controlled use:

- trained Zstandard dictionaries are valid and often useful
- trained Brotli dictionaries are also valid

Advanced note:

- a trained Zstandard dictionary can be converted into a raw browser dictionary
  if you strip the Zstandard dictionary header and use only the raw content
  bytes
- that conversion is not automated by `@rokob/nodedc` today
- if you do this yourself, the browser-facing dictionary hash must be computed
  from the stripped raw bytes, not from the original `.zdict` file

### Training from JavaScript

```js
import { readFile } from 'node:fs/promises';
import { trainBrotliDictionary, trainZstdDictionary } from '@rokob/nodedc';

const samples = [
  await readFile('./samples/a.html'),
  await readFile('./samples/b.html'),
  await readFile('./samples/c.html'),
];

const zstd = trainZstdDictionary(samples, {
  dictSize: 8192,
  compressionLevel: 6,
});

const brotli = trainBrotliDictionary(samples, {
  engine: 'dsh',
  targetDictLen: 12288,
});

console.log(zstd.sha256, zstd.dictionaryId);
console.log(brotli.sha256);
```

Useful training options:

- Zstandard: `dictSize`, `compressionLevel`, `dictId`, `k`, `d`, `steps`, `accel`
- Brotli: `engine`, `targetDictLen`, `blockLen`, `sliceLen`, `minSlicePop`, `chunkLen`, `overlapLen`

## Loading and storing dictionaries

Use `PreparedDictionary` for one dictionary, or `DictionaryStore` if you need
to keep several dictionaries resident and look them up by hash at request time.

```js
import { readFile } from 'node:fs/promises';
import { DictionaryStore, PreparedDictionary } from '@rokob/nodedc';

const store = new DictionaryStore();

for (const [algorithm, file] of [
  ['zstd', './dicts/app.zdict'],
  ['brotli', './dicts/app.dict'],
]) {
  const dictionary = new PreparedDictionary({
    algorithm,
    bytes: await readFile(file),
  });
  store.add(dictionary);
}

const zstdDictionary = store.get('<sha256 hex>', 'zstd');
```

For browser CDT, construct the dictionary from the exact raw bytes you intend to
serve as the dictionary resource:

```js
const browserDictionary = new PreparedDictionary({
  algorithm: 'zstd',
  bytes: await readFile('./dicts/browser-dictionary.txt'),
});
```

For non-browser Zstandard use, loading a trained `.zdict` file is fine:

```js
const trainedDictionary = new PreparedDictionary({
  algorithm: 'zstd',
  bytes: await readFile('./dicts/app.zdict'),
});
```

If your deployed dictionary file is stored compressed on disk, load and
decompress it in one step:

```js
import { PreparedDictionary } from '@rokob/nodedc';

const dictionary = await PreparedDictionary.fromFile('/app/dicts/app.zdict.br', {
  algorithm: 'zstd',
  compression: 'brotli',
});
```

There is also a synchronous form:

```js
const dictionary = PreparedDictionary.fromFileSync('/app/dicts/app.dict.br', {
  algorithm: 'brotli',
  compression: 'brotli',
});
```

`PreparedDictionary` is immutable. Each stream created from it holds a strong
reference to the underlying native prepared dictionary, so it stays alive until
the stream closes.

## Compressing responses

`transport: 'raw'` means "compress with the prepared dictionary, but do not add
the RFC 9842 transport header". That can be useful for private protocols or
non-HTTP uses. It is not something the HTTP negotiation helpers will select.

One-shot compression:

```js
const body = Buffer.from(JSON.stringify({ ok: true }));

const compressed = await dictionary.compress(body, {
  quality: 6,
  transport: 'raw',
});
```

Streaming compression:

```js
import { pipeline } from 'node:stream/promises';

await pipeline(
  sourceStream,
  dictionary.createCompressStream({
    quality: 6,
    transport: 'raw',
  }),
  response,
);
```

Supported tuning options today:

- Zstandard: `quality`, `checksum`
- Brotli: `quality`, `windowBits`
- both: `transport`

## HTTP request flow

The usual flow is:

1. Train and deploy dictionaries ahead of time.
2. Load them at process start into a `DictionaryStore`.
3. On each request, inspect `Accept-Encoding` and `Available-Dictionary`.
4. Choose the best dictionary and encoding.
5. Set `Content-Encoding`.
6. Compress the response with the selected dictionary.

### Parsing an available dictionary

```js
import { parseAvailableDictionaryHeader } from '@rokob/nodedc';

const hash = parseAvailableDictionaryHeader(req.headers['available-dictionary']);
// hash is a single SHA-256 hex string or null.
```

### Negotiating a response

```js
import { DictionaryStore, negotiateCompressionFromStore } from '@rokob/nodedc';

function selectCompression(req, store) {
  return negotiateCompressionFromStore(
    {
      acceptEncoding: req.headers['accept-encoding'],
      availableDictionary: req.headers['available-dictionary'],
    },
    store,
    { algorithm: 'zstd' },
  );
}
```

`negotiateCompressionFromStore()` prefers transport encoding when:

- the client advertises the dictionary hash in `Available-Dictionary`
- and the client accepts `dcb` or `dcz`

Otherwise it returns `null`.

Pass `{ algorithm: 'brotli' }` to restrict negotiation to the `dcb` / `br`
family, `{ algorithm: 'zstd' }` to restrict negotiation to `dcz` / `zstd`, or
omit the option to let the helper consider either family.

When both families are allowed, negotiation prefers Zstandard first by default.
Pass `{ preferredAlgorithm: 'brotli' }` if you want Brotli first instead.

Unlike the generic iterable helper, the store-based helper does direct hash
lookups for the transport path, which is the better fit for the normal web
server hot path.

The HTTP helpers are transport-only. They never return `br` or `zstd` for a
prepared dictionary, because ordinary HTTP `br` / `zstd` content codings do not
carry shared-dictionary identity.

`Available-Dictionary` is interpreted as a single dictionary hash, matching RFC 9842. If the header is missing or contains multiple values, negotiation returns
`null`.

### End-to-end server sketch

```js
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { DictionaryStore, PreparedDictionary, negotiateCompressionFromStore } from '@rokob/nodedc';

const store = new DictionaryStore();

store.add(
  new PreparedDictionary({
    algorithm: 'zstd',
    bytes: await readFile('./dicts/app.zdict'),
  }),
);

store.add(
  new PreparedDictionary({
    algorithm: 'brotli',
    bytes: await readFile('./dicts/app.dict'),
  }),
);

http
  .createServer(async (req, res) => {
    const match = negotiateCompressionFromStore(
      {
        acceptEncoding: req.headers['accept-encoding'],
        availableDictionary: req.headers['available-dictionary'],
      },
      store,
    );

    if (!match) {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      createReadStream('./samples/index.html').pipe(res);
      return;
    }

    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('content-encoding', match.contentEncoding);

    createReadStream('./samples/index.html')
      .pipe(
        match.dictionary.createCompressStream({
          quality: 6,
          transport: match.transport,
        }),
      )
      .pipe(res);
  })
  .listen(3000);
```

## Transport mode

Set `transport: 'transport'` to emit RFC 9842 framed payloads:

- Brotli uses `dcb`
- Zstandard uses `dcz`

For browser transport:

- the dictionary resource should be a raw dictionary file
- the response serving that dictionary file may itself use normal HTTP content
  encoding such as Brotli
- for `dcz`, the dictionary bytes used by `PreparedDictionary` should match the
  raw bytes of the served dictionary resource exactly

In other words:

- browser `dcb` and browser `dcz` should be built from raw dictionary bytes
- trained Zstandard `.zdict` files are for non-browser use cases

`PreparedDictionary.getTransportInfo()` returns the fixed transport header bytes
and content encoding for a dictionary. Most callers should not need it because
`compress()` and `createCompressStream()` already prepend the required header in
transport mode.

## Development

Build the addon before running tests:

```bash
npm run build
npm test
```

Offline dictionary training is exposed as package CLIs:

```bash
npm run train:zstd -- --output tmp/app.zdict samples/
npm run train:brotli -- --output tmp/app.dict samples/
```

Those commands are backed by a separate native training addon target so the
public CLI does not depend on ad hoc compile-on-first-use scripts.

Prebuild packaging for both native targets can be verified locally with:

```bash
npm run build:prebuilts
npm run verify:prebuilts
```

Run the Zstd same-family one-shot benchmark with:

```bash
npm run build
npm run bench:zstd-family
```

Example result on an Apple `M1 Max` (`arm64`), macOS `26.1`, Node `v23.9.0`,
with an `8192` byte trained dictionary and `100000` responses from the same
payload family:

| implementation         | duration (ms) | ops/sec | input MB/sec | compressed/input ratio |
| ---------------------- | ------------: | ------: | -----------: | ---------------------: |
| built-in one-shot      |       1226.96 |   81502 |        83.32 |                  0.448 |
| nodedc public api      |        723.19 |  138275 |       141.35 |                  0.058 |
| nodedc prepared native |        694.82 |  143922 |       147.13 |                  0.058 |

Interpretation:

- `built-in one-shot` is Node's built-in `zstdCompressSync()` with a dictionary passed on every call
- `nodedc public api` is `PreparedDictionary.compress()`
- `nodedc prepared native` is the same prepared dictionary path with the JS wrapper overhead removed

The important comparison is `built-in one-shot` vs `nodedc public api`: the
prepared-dictionary reuse path avoids paying dictionary setup cost on every
response and is substantially faster on this payload family.

Expect absolute numbers to vary with CPU, Node version, payload shape, and
dictionary size and quality. The benchmark is most useful as a relative
comparison between built-in one-shot dictionary compression and prepared
dictionary reuse.

## Release automation

This repo is wired for:

- `release-please` release PRs and versioning
- matrix prebuild generation for macOS and Linux
- aggregated npm publishing with bundled prebuilts
- Dependabot updates for npm, GitHub Actions, and git submodules

Use Conventional Commits on `main`-bound changes (`feat:`, `fix:`, `chore:`).
`release-please` uses those commit messages to decide whether to cut a release
and what semver bump to make.
