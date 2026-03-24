import { brotliCompressSync } from 'node:zlib';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { PreparedDictionary } from '../../src/js/index.js';

test('PreparedDictionary.fromFileSync loads plain dictionary files', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'nodedc-from-file-'));
  try {
    const dictionaryBytes = Buffer.from('plain-dictionary-bytes');
    const filePath = path.join(tempDir, 'plain.dict');
    writeFileSync(filePath, dictionaryBytes);

    const dictionary = PreparedDictionary.fromFileSync(filePath, {
      algorithm: 'brotli',
    });

    assert.equal(dictionary.algorithm, 'brotli');
    assert.deepEqual(dictionary.bytes, dictionaryBytes);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('PreparedDictionary.fromFile loads brotli-compressed dictionary files', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'nodedc-from-file-'));
  try {
    const dictionaryBytes = Buffer.from('brotli-compressed-dictionary-bytes');
    const filePath = path.join(tempDir, 'dictionary.dict.br');
    writeFileSync(filePath, brotliCompressSync(dictionaryBytes));

    const dictionary = await PreparedDictionary.fromFile(filePath, {
      algorithm: 'zstd',
      compression: 'brotli',
    });

    assert.equal(dictionary.algorithm, 'zstd');
    assert.deepEqual(dictionary.bytes, dictionaryBytes);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
