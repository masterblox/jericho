import { describe, expect, it } from 'vitest';

import {
  bootstrapUrlFromLine,
  browserOpenArguments,
  redactBridgeOutputLine,
} from '../src/platform/dia-launcher.js';

describe('Dia production launcher', () => {
  const bootstrap = 'http://127.0.0.1:55020/.jericho/bootstrap/one-time-token';
  const line = `[jericho] one-time browser bootstrap ${bootstrap}`;

  it('extracts a loopback bootstrap and redacts it from logs', () => {
    expect(bootstrapUrlFromLine(line)).toBe(bootstrap);
    expect(redactBridgeOutputLine(line)).toBe(
      '[jericho] one-time browser bootstrap [REDACTED]',
    );
    expect(redactBridgeOutputLine('[jericho] listening on http://127.0.0.1:55020'))
      .toBe('[jericho] listening on http://127.0.0.1:55020');
  });

  it.each([
    'https://127.0.0.1:55020/.jericho/bootstrap/token',
    'http://example.com/.jericho/bootstrap/token',
    'http://127.0.0.1:55020/not-bootstrap/token',
    'http://user@127.0.0.1:55020/.jericho/bootstrap/token',
    'not a url',
  ])('rejects a non-private bootstrap: %s', (url) => {
    expect(() => bootstrapUrlFromLine(
      `[jericho] one-time browser bootstrap ${url}`,
    )).toThrow(/bootstrap/iu);
  });

  it('opens Dia through an argument array without a shell', () => {
    expect(browserOpenArguments(' Dia ', bootstrap)).toEqual(['-a', 'Dia', bootstrap]);
    expect(() => browserOpenArguments(' ', bootstrap)).toThrow(/application/iu);
  });
});
