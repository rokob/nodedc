# Benchmarks

This directory will hold benchmark cases for:

- repeated one-shot compression with a prepared dictionary
- streaming compression with shared dictionaries
- comparison against Node built-in dictionary support

Current benchmarks:

- `npm run bench:zstd-family`
  compares repeated one-shot Zstd compression using a trained dictionary
- `npm run bench:zstd-stream-reuse`
  compares many Zstd compression streams using a trained dictionary and
  highlights prepared-dictionary reuse versus the built-in stream API
- `npm run bench:zstd-stream-layers`
  compares built-in stream piping, `nodedc` stream piping, and direct native
  async compressor calls to isolate where stream overhead is coming from
