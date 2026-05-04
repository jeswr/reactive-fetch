import { afterEach, describe, expect, test, vi } from 'vitest';
import { promptDriver } from '../src/index.js';

describe('promptDriver', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns the trimmed string the user entered', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('https://alice.example/profile#me');
    const driver = promptDriver();
    expect(driver({ allowLocalhost: false })).toBe('https://alice.example/profile#me');
  });

  test('returns null when the user cancels', () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    expect(promptDriver()({ allowLocalhost: false })).toBeNull();
  });

  test('coerces undefined (jsdom) to null', () => {
    vi.spyOn(window, 'prompt').mockReturnValue(undefined as unknown as string);
    expect(promptDriver()({ allowLocalhost: false })).toBeNull();
  });

  test('passes the configured message to window.prompt', () => {
    const spy = vi.spyOn(window, 'prompt').mockReturnValue('https://x.example/#me');
    promptDriver({ message: 'Custom prompt' })({ allowLocalhost: false });
    expect(spy).toHaveBeenCalledWith('Custom prompt');
  });

  test('uses the default message when none is provided', () => {
    const spy = vi.spyOn(window, 'prompt').mockReturnValue('https://x.example/#me');
    promptDriver()({ allowLocalhost: false });
    expect(spy).toHaveBeenCalledWith('Enter your WebID URL');
  });
});
