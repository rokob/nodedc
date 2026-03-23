import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PreparedDictionary,
  formatAvailableDictionaryHeader,
  negotiateCompression,
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

test('parseAvailableDictionaryHeader splits CSV values', () => {
  const first = Buffer.alloc(32, 1).toString('base64');
  const second = Buffer.alloc(32, 2).toString('base64');
  assert.deepEqual(
    parseAvailableDictionaryHeader(`:${first}:, :${second}:`),
    [Buffer.alloc(32, 1).toString('hex'), Buffer.alloc(32, 2).toString('hex')]
  );
});
