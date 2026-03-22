import { NotImplementedPhaseError } from './errors.js';

import type { Algorithm } from './types.js';

export interface TransportInfo {
  algorithm: Algorithm;
  hash: string;
  contentEncoding: 'dcb' | 'dcz';
  headerBytes: Buffer;
}

export function contentEncodingFor(algorithm: Algorithm, transport: 'raw' | 'transport'): string {
  if (transport === 'raw') {
    return algorithm === 'brotli' ? 'br' : 'zstd';
  }

  return algorithm === 'brotli' ? 'dcb' : 'dcz';
}

export function getTransportInfo(algorithm: Algorithm, hash: string): TransportInfo {
  throw new NotImplementedPhaseError(
    `RFC 9842 transport framing for ${algorithm} is not implemented yet for dictionary ${hash}.`
  );
}

