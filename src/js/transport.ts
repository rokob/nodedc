import type { Algorithm } from './types.js';

export interface TransportInfo {
  algorithm: Algorithm;
  hash: string;
  contentEncoding: 'dcb' | 'dcz';
  headerBytes: Buffer;
}

const DCB_MAGIC = Buffer.from([0xff, 0x44, 0x43, 0x42]);
const DCZ_MAGIC = Buffer.from([0x5e, 0x2a, 0x4d, 0x18, 0x20, 0x00, 0x00, 0x00]);

export function contentEncodingFor(algorithm: Algorithm, transport: 'raw' | 'transport'): string {
  if (transport === 'raw') {
    return algorithm === 'brotli' ? 'br' : 'zstd';
  }

  return algorithm === 'brotli' ? 'dcb' : 'dcz';
}

export function hashHexToBytes(hash: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new TypeError(`Expected a 64-character SHA-256 hex hash, got: ${hash}`);
  }

  return Buffer.from(hash, 'hex');
}

export function hashBytesToStructuredField(hash: string): string {
  return `:${hashHexToBytes(hash).toString('base64')}:`;
}

export function structuredFieldToHashBytes(value: string): Buffer {
  if (value.length < 3 || value[0] !== ':' || value[value.length - 1] !== ':') {
    throw new TypeError(`Invalid Structured Field byte sequence: ${value}`);
  }

  const bytes = Buffer.from(value.slice(1, -1), 'base64');
  if (bytes.length !== 32) {
    throw new TypeError(`Expected 32-byte dictionary digest, got ${bytes.length} bytes.`);
  }

  return bytes;
}

export function getTransportInfo(algorithm: Algorithm, hash: string): TransportInfo {
  const hashBytes = hashHexToBytes(hash);
  const magic = algorithm === 'brotli' ? DCB_MAGIC : DCZ_MAGIC;
  const headerBytes = Buffer.concat([magic, hashBytes]);

  return {
    algorithm,
    hash,
    contentEncoding: algorithm === 'brotli' ? 'dcb' : 'dcz',
    headerBytes,
  };
}

export function prependTransportFrame(
  algorithm: Algorithm,
  hash: string,
  payload: Buffer | Uint8Array,
): Buffer {
  const { headerBytes } = getTransportInfo(algorithm, hash);
  const normalizedPayload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  return Buffer.concat([headerBytes, normalizedPayload]);
}

export function stripTransportFrame(
  algorithm: Algorithm,
  hash: string,
  payload: Buffer | Uint8Array,
): Buffer {
  const normalizedPayload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const { headerBytes, contentEncoding } = getTransportInfo(algorithm, hash);

  if (normalizedPayload.length < headerBytes.length) {
    throw new Error(`Incomplete ${contentEncoding} payload: missing transport header bytes.`);
  }

  const receivedHeader = normalizedPayload.subarray(0, headerBytes.length);
  if (!receivedHeader.equals(headerBytes)) {
    throw new Error(`Invalid ${contentEncoding} transport header for dictionary ${hash}.`);
  }

  return normalizedPayload.subarray(headerBytes.length);
}
