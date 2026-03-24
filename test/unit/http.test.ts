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
  const first = new PreparedDictionary({ algorithm: 'zstd', bytes: Buffer.from('first') });
  const second = new PreparedDictionary({ algorithm: 'brotli', bytes: Buffer.from('second') });

  assert.equal(
    formatAvailableDictionaryHeader([first, second]),
    `:${Buffer.from(first.hash, 'hex').toString('base64')}:, :${Buffer.from(second.hash, 'hex').toString('base64')}:`
  );
});

test('negotiateCompression prefers transport when the dictionary hash is available', () => {
  const dictionary = new PreparedDictionary({ algorithm: 'zstd', bytes: Buffer.from('dict') });
  const result = negotiateCompression(
    {
      acceptEncoding: 'gzip, dcz',
      availableDictionary: formatAvailableDictionaryHeader([dictionary])
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
      availableDictionary: formatAvailableDictionaryHeader([brotli, zstd])
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
      availableDictionary: formatAvailableDictionaryHeader([brotli, zstd])
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
      availableDictionary: formatAvailableDictionaryHeader([brotli, zstd])
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

test('parseAvailableDictionaryHeader splits CSV values', () => {
  const first = Buffer.alloc(32, 1).toString('base64');
  const second = Buffer.alloc(32, 2).toString('base64');
  assert.deepEqual(
    parseAvailableDictionaryHeader(`:${first}:, :${second}:`),
    [Buffer.alloc(32, 1).toString('hex'), Buffer.alloc(32, 2).toString('hex')]
  );
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
      availableDictionary: formatAvailableDictionaryHeader([zstd])
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
      availableDictionary: formatAvailableDictionaryHeader([brotli, zstd])
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
      availableDictionary: formatAvailableDictionaryHeader([brotli, zstd])
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

test('negotiateCompressionFromStore falls back to raw encodings when no transport dictionary matches', () => {
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

  assert.deepEqual(result, {
    dictionary: brotli,
    contentEncoding: 'br',
    transport: 'raw'
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
      availableDictionary: formatAvailableDictionaryHeader([brotli, zstd])
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
      availableDictionary: formatAvailableDictionaryHeader([brotli, zstd])
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
