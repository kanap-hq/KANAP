import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// The jest-dom matchers (`toBeInTheDocument`, `toHaveStyle`, ...) registered by `setup.ts`, typed on
// vitest's `Matchers` (its `Assertion` takes the result type first, then the received value).
declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends TestingLibraryMatchers<unknown, R> {}
}
