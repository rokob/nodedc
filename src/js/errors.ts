export class NativeBindingUnavailableError extends Error {
  constructor(message = 'The nodedc native binding is not available. Build the addon first.') {
    super(message);
    this.name = 'NativeBindingUnavailableError';
  }
}

export class NotImplementedPhaseError extends Error {
  constructor(message = 'This feature is planned but not implemented yet.') {
    super(message);
    this.name = 'NotImplementedPhaseError';
  }
}

