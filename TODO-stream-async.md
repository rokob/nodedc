# Stream Async Follow-Up

Current async streaming compression uses a per-compressor mutex around native
codec state (`ZSTD_CCtx` / Brotli encoder state) so worker-thread jobs cannot
enter the same compressor concurrently.

That is correct, but it is mainly a defensive safeguard. In normal stream use,
each compressor is tied to one `Transform` instance, and writes for that stream
should already be serialized.

## Cleaner follow-up

Replace mutex-based protection with explicit per-compressor sequencing:

- ensure only one async compression job can be in flight per compressor
- queue later writes/end operations behind the active job
- preserve strict write / flush / end ordering for each stream
- keep concurrency across different compressor instances unchanged

## Why

- avoids relying on lock-based exclusion in the normal path
- avoids holding a mutex while running a full native compression loop
- makes the intended ownership model explicit: one mutable codec context per
  stream, used sequentially
- reduces the chance of wasting libuv worker threads on lock waiting if a
  same-compressor overlap bug is introduced later

## Constraints

- still allow many compressor instances from the same prepared dictionary to run
  concurrently
- preserve stream backpressure semantics
- preserve transport header ordering
- preserve error and destroy handling
