import { contentEncodingFor, hashBytesToStructuredField, structuredFieldToHashBytes } from './transport.js';
import { DictionaryStore } from './store.js';

import type {
  NegotiationInput,
  NegotiationOptions,
  NegotiationResult,
  PreparedDictionaryShape
} from './types.js';

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

function getNegotiatedAlgorithms(options: NegotiationOptions): readonly ('brotli' | 'zstd')[] {
  if (options.algorithm) {
    return [options.algorithm];
  }

  if (options.preferredAlgorithm === 'brotli') {
    return ['brotli', 'zstd'];
  }

  return ['zstd', 'brotli'];
}

function getRawEncoding(algorithm: 'brotli' | 'zstd'): 'br' | 'zstd' {
  return contentEncodingFor(algorithm, 'raw') as 'br' | 'zstd';
}

function getTransportEncoding(algorithm: 'brotli' | 'zstd'): 'dcb' | 'dcz' {
  return contentEncodingFor(algorithm, 'transport') as 'dcb' | 'dcz';
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
  candidates: Iterable<TDictionary>,
  options: NegotiationOptions = {}
): NegotiationResult<TDictionary> | null {
  const acceptedEncodings = parseAcceptEncodingHeader(input.acceptEncoding);
  const availableDictionaries = new Set(parseAvailableDictionaryHeader(input.availableDictionary));
  const candidateList = Array.from(candidates);

  for (const algorithm of getNegotiatedAlgorithms(options)) {
    const transportEncoding = getTransportEncoding(algorithm);
    if (acceptedEncodings.has(transportEncoding)) {
      for (const dictionary of candidateList) {
        if (dictionary.algorithm === algorithm && availableDictionaries.has(dictionary.hash)) {
          return {
            dictionary,
            contentEncoding: transportEncoding,
            transport: 'transport'
          };
        }
      }
    }

    const rawEncoding = getRawEncoding(algorithm);
    if (acceptedEncodings.has(rawEncoding)) {
      for (const dictionary of candidateList) {
        if (dictionary.algorithm === algorithm) {
          return {
            dictionary,
            contentEncoding: rawEncoding,
            transport: 'raw'
          };
        }
      }
    }
  }

  return null;
}

export function negotiateCompressionFromStore(
  input: NegotiationInput,
  store: DictionaryStore,
  options: NegotiationOptions = {}
): NegotiationResult | null {
  const acceptedEncodings = parseAcceptEncodingHeader(input.acceptEncoding);
  const availableDictionaries = parseAvailableDictionaryHeader(input.availableDictionary);
  const algorithms = getNegotiatedAlgorithms(options);

  for (const algorithm of algorithms) {
    for (const hash of availableDictionaries) {
      const transportEncoding = getTransportEncoding(algorithm);
      if (acceptedEncodings.has(transportEncoding) && isTransportEncoding(transportEncoding)) {
        const dictionary = store.get(hash, algorithm);
        if (dictionary) {
          return {
            dictionary,
            contentEncoding: transportEncoding,
            transport: 'transport'
          };
        }
      }
    }
  }

  for (const algorithm of algorithms) {
    const rawEncoding = getRawEncoding(algorithm);
    if (!acceptedEncodings.has(rawEncoding) || !isTransportEncoding(rawEncoding)) {
      continue;
    }
    for (const [, dictionary] of store) {
      if (dictionary.algorithm === algorithm) {
        return {
          dictionary,
          contentEncoding: rawEncoding,
          transport: 'raw'
        };
      }
    }
  }

  return null;
}
