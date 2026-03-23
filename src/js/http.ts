import { contentEncodingFor, hashBytesToStructuredField, structuredFieldToHashBytes } from './transport.js';
import { DictionaryStore } from './store.js';

import type { NegotiationInput, NegotiationResult, PreparedDictionaryShape } from './types.js';

function parseCsvTokens(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function parseAcceptEncodingHeader(value: string | null | undefined): Set<string> {
  return new Set(
    parseCsvTokens(value)
      .map((token) => token.split(';', 1)[0])
      .filter((encoding): encoding is string => encoding !== undefined)
      .map((encoding) => encoding.toLowerCase())
  );
}

function isTransportEncoding(value: string): value is 'br' | 'zstd' | 'dcb' | 'dcz' {
  return value === 'br' || value === 'zstd' || value === 'dcb' || value === 'dcz';
}

export function parseAvailableDictionaryHeader(value: string | null | undefined): string[] {
  return parseCsvTokens(value).map((item) => {
    const [dictionaryId] = item.split(';', 1);
    const trimmed = (dictionaryId ?? '').trim();
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
      return structuredFieldToHashBytes(trimmed).toString('hex');
    }
    return trimmed;
  });
}

export function formatAvailableDictionaryHeader(
  dictionaries: Iterable<Pick<PreparedDictionaryShape, 'hash'>>
): string {
  return Array.from(dictionaries, (dictionary) => hashBytesToStructuredField(dictionary.hash)).join(', ');
}

export function negotiateCompression<TDictionary extends PreparedDictionaryShape>(
  input: NegotiationInput,
  candidates: Iterable<TDictionary>
): NegotiationResult<TDictionary> | null {
  const acceptedEncodings = parseAcceptEncodingHeader(input.acceptEncoding);
  const availableDictionaries = new Set(parseAvailableDictionaryHeader(input.availableDictionary));

  for (const dictionary of candidates) {
    const rawEncoding = contentEncodingFor(dictionary.algorithm, 'raw');
    const transportEncoding = contentEncodingFor(dictionary.algorithm, 'transport');
    const canUseTransport =
      availableDictionaries.has(dictionary.hash) && acceptedEncodings.has(transportEncoding);

    if (canUseTransport && isTransportEncoding(transportEncoding)) {
      return {
        dictionary,
        contentEncoding: transportEncoding,
        transport: 'transport'
      };
    }

    if (acceptedEncodings.has(rawEncoding) && isTransportEncoding(rawEncoding)) {
      return {
        dictionary,
        contentEncoding: rawEncoding,
        transport: 'raw'
      };
    }
  }

  return null;
}

export function negotiateCompressionFromStore(
  input: NegotiationInput,
  store: DictionaryStore
): NegotiationResult | null {
  const acceptedEncodings = parseAcceptEncodingHeader(input.acceptEncoding);
  const availableDictionaries = parseAvailableDictionaryHeader(input.availableDictionary);

  for (const hash of availableDictionaries) {
    if (acceptedEncodings.has('dcb')) {
      const brotli = store.get(hash, 'brotli');
      if (brotli) {
        return {
          dictionary: brotli,
          contentEncoding: 'dcb',
          transport: 'transport'
        };
      }
    }

    if (acceptedEncodings.has('dcz')) {
      const zstd = store.get(hash, 'zstd');
      if (zstd) {
        return {
          dictionary: zstd,
          contentEncoding: 'dcz',
          transport: 'transport'
        };
      }
    }
  }

  if (acceptedEncodings.has('br')) {
    for (const [, dictionary] of store) {
      if (dictionary.algorithm === 'brotli') {
        return {
          dictionary,
          contentEncoding: 'br',
          transport: 'raw'
        };
      }
    }
  }

  if (acceptedEncodings.has('zstd')) {
    for (const [, dictionary] of store) {
      if (dictionary.algorithm === 'zstd') {
        return {
          dictionary,
          contentEncoding: 'zstd',
          transport: 'raw'
        };
      }
    }
  }

  return null;
}
