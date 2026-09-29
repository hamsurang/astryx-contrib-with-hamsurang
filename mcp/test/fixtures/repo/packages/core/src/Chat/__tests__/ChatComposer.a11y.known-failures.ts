import type {KnownFailure} from '@astryxdesign/a11y-spec';

export const KNOWN: ReadonlyArray<KnownFailure> = [
  {
    expectation: 'text-input.name',
    binding: 'ChatComposer',
    state: 'busy',
  },
];
