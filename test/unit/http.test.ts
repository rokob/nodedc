import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DictionaryStore,
  PreparedDictionary,
  formatAvailableDictionaryHeader,
  negotiateCompression,
  negotiateCompressionFromStore,
  parseAcceptEncodingHeader,
  parseAvailableDictionaryHeader
} from '../../src/js/index.js';

test('parseAcceptEncodingHeader lowercases and strips parameters', () => {
  const parsed = parseAcceptEncodingHeader('gzip, dcz;q=1.0, br;q=0.8');
  assert.deepEqual([...parsed], ['gzip', 'dcz', 'br']);
});

test('formatAvailableDictionaryHeader joins hashes', () => {
  const dictionary = new PreparedDictionary({ algorithm: 'zstd', bytes: Buffer.from('first') });

  assert.equal(
    formatAvailableDictionaryHeader(dictionary),
    `:${Buffer.from(dictionary.hash, 'hex').toString('base64')}:`
  );
});

test('negotiateCompression prefers transport when the dictionary hash is available', () => {
  const dictionary = new PreparedDictionary({ algorithm: 'zstd', bytes: Buffer.from('dict') });
  const result = negotiateCompression(
    {
      acceptEncoding: 'gzip, dcz',
      availableDictionary: formatAvailableDictionaryHeader(dictionary)
    },
    [dictionary]
  );

  assert.deepEqual(result, {
    dictionary,
    contentEncoding: 'dcz',
    transport: 'transport'
  });
});

test('negotiateCompression can restrict negotiation to a single algorithm family', () => {
  const brotli = new PreparedDictionary({ algorithm: 'brotli', bytes: Buffer.from('brotli-dict') });
  const zstd = new PreparedDictionary({ algorithm: 'zstd', bytes: Buffer.from('zstd-dict') });
  const result = negotiateCompression(
    {
      acceptEncoding: 'dcb, dcz, br, zstd',
      availableDictionary: formatAvailableDictionaryHeader(zstd)
    },
    [brotli, zstd],
    { algorithm: 'zstd' }
  );

  assert.deepEqual(result, {
    dictionary: zstd,
    contentEncoding: 'dcz',
    transport: 'transport'
  });
});

test('negotiateCompression prefers zstd before brotli by default', () => {
  const brotli = new PreparedDictionary({ algorithm: 'brotli', bytes: Buffer.from('brotli-dict') });
  const zstd = new PreparedDictionary({ algorithm: 'zstd', bytes: Buffer.from('zstd-dict') });
  const result = negotiateCompression(
    {
      acceptEncoding: 'dcb, dcz, br, zstd',
      availableDictionary: formatAvailableDictionaryHeader(zstd)
    },
    [brotli, zstd]
  );

  assert.deepEqual(result, {
    dictionary: zstd,
    contentEncoding: 'dcz',
    transport: 'transport'
  });
});

test('negotiateCompression can prefer brotli before zstd', () => {
  const brotli = new PreparedDictionary({ algorithm: 'brotli', bytes: Buffer.from('brotli-dict') });
  const zstd = new PreparedDictionary({ algorithm: 'zstd', bytes: Buffer.from('zstd-dict') });
  const result = negotiateCompression(
    {
      acceptEncoding: 'dcb, dcz, br, zstd',
      availableDictionary: formatAvailableDictionaryHeader(brotli)
    },
    [zstd, brotli],
    { preferredAlgorithm: 'brotli' }
  );

  assert.deepEqual(result, {
    dictionary: brotli,
    contentEncoding: 'dcb',
    transport: 'transport'
  });
});

test('negotiateCompression returns null without available dictionary transport support', () => {
  const brotli = new PreparedDictionary({ algorithm: 'brotli', bytes: Buffer.from('brotli-dict') });
  const zstd = new PreparedDictionary({ algorithm: 'zstd', bytes: Buffer.from('zstd-dict') });
  const result = negotiateCompression(
    {
      acceptEncoding: 'dcb, dcz, br, zstd',
      availableDictionary: null
    },
    [brotli, zstd]
  );

  assert.equal(result, null);
});

test('parseAvailableDictionaryHeader parses a single structured field hash', () => {
  const hash = Buffer.alloc(32, 1).toString('base64');
  assert.deepEqual(
    parseAvailableDictionaryHeader(`:${hash}:`),
    Buffer.alloc(32, 1).toString('hex')
  );
});

test('parseAvailableDictionaryHeader rejects multiple values', () => {
  const first = Buffer.alloc(32, 1).toString('base64');
  const second = Buffer.alloc(32, 2).toString('base64');
  assert.equal(parseAvailableDictionaryHeader(`:${first}:, :${second}:`), null);
});

test('negotiateCompressionFromStore does direct transport lookup by dictionary hash', () => {
  const store = new DictionaryStore();
  const brotli = new PreparedDictionary({ algorithm: 'brotli', bytes: Buffer.from('brotli-dict') });
  const zstd = new PreparedDictionary({ algorithm: 'zstd', bytes: Buffer.from('zstd-dict') });
  store.add(brotli);
  store.add(zstd);

  const result = negotiateCompressionFromStore(
    {
      acceptEncoding: 'gzip, dcz, dcb',
      availableDictionary: formatAvailableDictionaryHeader(zstd)
    },
    store
  );

  assert.deepEqual(result, {
    dictionary: zstd,
    contentEncoding: 'dcz',
    transport: 'transport'
  });
});

test('negotiateCompressionFromStore prefers zstd before brotli by default', () => {
  const store = new DictionaryStore();
  const brotli = new PreparedDictionary({ algorithm: 'brotli', bytes: Buffer.from('brotli-dict') });
  const zstd = new PreparedDictionary({ algorithm: 'zstd', bytes: Buffer.from('zstd-dict') });
  store.add(brotli);
  store.add(zstd);

  const result = negotiateCompressionFromStore(
    {
      acceptEncoding: 'dcb, dcz, br, zstd',
      availableDictionary: formatAvailableDictionaryHeader(zstd)
    },
    store
  );

  assert.deepEqual(result, {
    dictionary: zstd,
    contentEncoding: 'dcz',
    transport: 'transport'
  });
});

test('negotiateCompressionFromStore can prefer brotli before zstd', () => {
  const store = new DictionaryStore();
  const brotli = new PreparedDictionary({ algorithm: 'brotli', bytes: Buffer.from('brotli-dict') });
  const zstd = new PreparedDictionary({ algorithm: 'zstd', bytes: Buffer.from('zstd-dict') });
  store.add(brotli);
  store.add(zstd);

  const result = negotiateCompressionFromStore(
    {
      acceptEncoding: 'dcb, dcz, br, zstd',
      availableDictionary: formatAvailableDictionaryHeader(brotli)
    },
    store,
    { preferredAlgorithm: 'brotli' }
  );

  assert.deepEqual(result, {
    dictionary: brotli,
    contentEncoding: 'dcb',
    transport: 'transport'
  });
});

test('negotiateCompressionFromStore returns null when no transport dictionary match is available', () => {
  const store = new DictionaryStore();
  const brotli = new PreparedDictionary({ algorithm: 'brotli', bytes: Buffer.from('brotli-dict') });
  store.add(brotli);

  const result = negotiateCompressionFromStore(
    {
      acceptEncoding: 'gzip, br',
      availableDictionary: null
    },
    store
  );

  assert.equal(result, null);
});

test('negotiateCompressionFromStore returns null for gzip, deflate, br, zstd without available dictionaries', () => {
  const store = new DictionaryStore();
  const brotli = new PreparedDictionary({ algorithm: 'brotli', bytes: Buffer.from('brotli-dict') });
  const zstd = new PreparedDictionary({ algorithm: 'zstd', bytes: Buffer.from('zstd-dict') });
  store.add(brotli);
  store.add(zstd);

  const result = negotiateCompressionFromStore(
    {
      acceptEncoding: 'gzip, deflate, br, zstd',
      availableDictionary: null
    },
    store
  );

  assert.equal(result, null);
});

test('negotiateCompressionFromStore picks the matching brotli dictionary from multiple store candidates', () => {
  const store = new DictionaryStore();
  const brotliA = new PreparedDictionary({ algorithm: 'brotli', bytes: Buffer.from('brotli-dict-a') });
  const brotliB = new PreparedDictionary({ algorithm: 'brotli', bytes: Buffer.from('brotli-dict-b') });
  const brotliC = new PreparedDictionary({ algorithm: 'brotli', bytes: Buffer.from('brotli-dict-c') });
  store.add(brotliA);
  store.add(brotliB);
  store.add(brotliC);

  const result = negotiateCompressionFromStore(
    {
      acceptEncoding: 'gzip, dcb',
      availableDictionary: formatAvailableDictionaryHeader(brotliC)
    },
    store,
    { algorithm: 'brotli' }
  );

  assert.deepEqual(result, {
    dictionary: brotliC,
    contentEncoding: 'dcb',
    transport: 'transport'
  });
});

test('negotiateCompressionFromStore can restrict negotiation to brotli or zstd', () => {
  const store = new DictionaryStore();
  const brotli = new PreparedDictionary({ algorithm: 'brotli', bytes: Buffer.from('brotli-dict') });
  const zstd = new PreparedDictionary({ algorithm: 'zstd', bytes: Buffer.from('zstd-dict') });
  store.add(brotli);
  store.add(zstd);

  const zstdResult = negotiateCompressionFromStore(
    {
      acceptEncoding: 'dcb, dcz, br, zstd',
      availableDictionary: formatAvailableDictionaryHeader(zstd)
    },
    store,
    { algorithm: 'zstd' }
  );

  assert.deepEqual(zstdResult, {
    dictionary: zstd,
    contentEncoding: 'dcz',
    transport: 'transport'
  });

  const brotliResult = negotiateCompressionFromStore(
    {
      acceptEncoding: 'dcb, dcz, br, zstd',
      availableDictionary: formatAvailableDictionaryHeader(brotli)
    },
    store,
    { algorithm: 'brotli' }
  );

  assert.deepEqual(brotliResult, {
    dictionary: brotli,
    contentEncoding: 'dcb',
    transport: 'transport'
  });
});
