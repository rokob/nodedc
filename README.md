# nodedc

Native shared-dictionary compression for Node.js web servers.

## Status

Core runtime, training, and prebuild plumbing are implemented.

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

Prebuild packaging for both native targets can be verified locally with:

```bash
npm run build:prebuilts
npm run verify:prebuilts
```

## Release automation

This repo is wired for:

- `release-please` release PRs and versioning
- matrix prebuild generation for macOS and Linux
- aggregated npm publishing with bundled prebuilts
- Dependabot updates for npm, GitHub Actions, and git submodules

Use Conventional Commits on `main`-bound changes (`feat:`, `fix:`, `chore:`).
`release-please` uses those commit messages to decide whether to cut a release
and what semver bump to make.
