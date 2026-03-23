# nodedc

Native shared-dictionary compression for Node.js web servers.

## Status

This repository is in the design and planning stage.

The implementation plan lives here:

- [docs/implementation-plan.md](/Users/dragonbear/code/nodedc/docs/implementation-plan.md)

## Intended features

- Reusable prepared dictionaries for Brotli and Zstandard
- Streaming compression for web server responses
- Multiple resident dictionaries keyed by hash
- RFC 9842 transport support (`dcb` and `dcz`)
- Offline dictionary training tools
- Native prebuilts for macOS and Linux

## Planned baseline

- Node `22.22.1+`
- ESM only
- C++ addon using N-API

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

The current tree still needs vendored `vendor/divsufsort` and `vendor/esaxx`
before Brotli training itself can be enabled.
