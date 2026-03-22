import type { Algorithm } from './types.js';

import { PreparedDictionary } from './dictionary.js';

function makeKey(hash: string, algorithm: Algorithm): string {
  return `${algorithm}:${hash}`;
}

export class DictionaryStore {
  readonly #entries = new Map<string, PreparedDictionary>();

  add(dictionary: PreparedDictionary): void {
    this.#entries.set(makeKey(dictionary.hash, dictionary.algorithm), dictionary);
  }

  get(hash: string, algorithm?: Algorithm): PreparedDictionary | undefined {
    if (algorithm) {
      return this.#entries.get(makeKey(hash, algorithm));
    }

    return this.#entries.get(makeKey(hash, 'brotli')) ?? this.#entries.get(makeKey(hash, 'zstd'));
  }

  has(hash: string, algorithm?: Algorithm): boolean {
    return this.get(hash, algorithm) !== undefined;
  }

  delete(hash: string, algorithm?: Algorithm): boolean {
    if (algorithm) {
      return this.#entries.delete(makeKey(hash, algorithm));
    }

    const deletedBrotli = this.#entries.delete(makeKey(hash, 'brotli'));
    const deletedZstd = this.#entries.delete(makeKey(hash, 'zstd'));
    return deletedBrotli || deletedZstd;
  }

  clear(): void {
    this.#entries.clear();
  }

  *entries(): IterableIterator<[string, PreparedDictionary]> {
    yield* this.#entries.entries();
  }

  [Symbol.iterator](): IterableIterator<[string, PreparedDictionary]> {
    return this.entries();
  }
}

