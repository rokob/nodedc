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

function getTransportEncoding(algorithm: 'brotli' | 'zstd'): 'dcb' | 'dcz' {
  return contentEncodingFor(algorithm, 'transport') as 'dcb' | 'dcz';
}

export function parseAvailableDictionaryHeader(value: string | null | undefined): string | null {
  const tokens = parseCsvTokens(value);
  if (tokens.length !== 1) {
    return null;
  }

  const token = tokens[0]!;
  const trimmed = token.trim();
  if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
    return structuredFieldToHashBytes(trimmed).toString('hex');
  }
  return trimmed.length > 0 ? trimmed : null;
}

export function formatAvailableDictionaryHeader(
  dictionary: Pick<PreparedDictionaryShape, 'hash'>
): string {
  return hashBytesToStructuredField(dictionary.hash);
}

export function negotiateCompression<TDictionary extends PreparedDictionaryShape>(
  input: NegotiationInput,
  candidates: Iterable<TDictionary>,
  options: NegotiationOptions = {}
): NegotiationResult<TDictionary> | null {
  const acceptedEncodings = parseAcceptEncodingHeader(input.acceptEncoding);
  const availableDictionary = parseAvailableDictionaryHeader(input.availableDictionary);
  const candidateList = Array.from(candidates);

  for (const algorithm of getNegotiatedAlgorithms(options)) {
    const transportEncoding = getTransportEncoding(algorithm);
    if (acceptedEncodings.has(transportEncoding)) {
      for (const dictionary of candidateList) {
        if (dictionary.algorithm === algorithm && dictionary.hash === availableDictionary) {
          return {
            dictionary,
            contentEncoding: transportEncoding,
            transport: 'transport'
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
  const availableDictionary = parseAvailableDictionaryHeader(input.availableDictionary);
  const algorithms = getNegotiatedAlgorithms(options);

  if (!availableDictionary) {
    return null;
  }

  for (const algorithm of algorithms) {
    const transportEncoding = getTransportEncoding(algorithm);
    if (acceptedEncodings.has(transportEncoding) && isTransportEncoding(transportEncoding)) {
      const dictionary = store.get(availableDictionary, algorithm);
      if (dictionary) {
        return {
          dictionary,
          contentEncoding: transportEncoding,
          transport: 'transport'
        };
      }
    }
  }

  return null;
}
