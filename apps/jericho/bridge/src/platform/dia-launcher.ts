const BOOTSTRAP_PREFIX = '[jericho] one-time browser bootstrap ';

/** Extract only the private loopback bootstrap URL emitted by Jericho Core. */
export function bootstrapUrlFromLine(line: string): string | undefined {
  if (!line.startsWith(BOOTSTRAP_PREFIX)) return undefined;
  return validateBootstrapUrl(line.slice(BOOTSTRAP_PREFIX.length).trim());
}

/** Never echo the one-time bearer-like bootstrap token into Conductor logs. */
export function redactBridgeOutputLine(line: string): string {
  return bootstrapUrlFromLine(line) ? `${BOOTSTRAP_PREFIX}[REDACTED]` : line;
}

/** Argument array for macOS `open`; no shell interpolation is involved. */
export function browserOpenArguments(application: string, bootstrapUrl: string): string[] {
  const normalizedApplication = application.trim();
  if (!normalizedApplication || normalizedApplication.includes('\0')) {
    throw new Error('Jericho browser application must be non-empty text');
  }
  return ['-a', normalizedApplication, validateBootstrapUrl(bootstrapUrl)];
}

function validateBootstrapUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Jericho emitted an invalid browser bootstrap URL');
  }
  const loopback = url.hostname === '127.0.0.1'
    || url.hostname === 'localhost'
    || url.hostname === '[::1]';
  if (url.protocol !== 'http:' || !loopback || url.username || url.password
    || !url.pathname.startsWith('/.jericho/bootstrap/')
    || url.pathname === '/.jericho/bootstrap/') {
    throw new Error('Jericho browser bootstrap must be an unauthenticated loopback URL');
  }
  return url.href;
}
