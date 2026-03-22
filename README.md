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
