import { parseDurationMs } from './token-expiry.util';

describe('parseDurationMs', () => {
  it.each([
    ['15m', 15 * 60 * 1000],
    ['7d', 7 * 24 * 60 * 60 * 1000],
    ['30s', 30 * 1000],
    ['2h', 2 * 60 * 60 * 1000],
  ])('parses %s', (input, expected) => {
    expect(parseDurationMs(input)).toBe(expected);
  });

  it('throws on an invalid format', () => {
    expect(() => parseDurationMs('bogus')).toThrow();
  });
});
