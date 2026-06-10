/**
 * SSRF guard for server-side fetches of user-supplied URLs.
 *
 * Blocks requests that could reach internal infrastructure: non-http(s)
 * schemes, non-default ports, localhost-style hostnames, and IP literals or
 * DNS results in private / loopback / link-local / metadata ranges.
 */

/** Returns true if the IPv4/IPv6 address is private, loopback, link-local, or otherwise non-public. */
export function isPrivateAddress(addr: string): boolean {
  const ip = addr.trim().toLowerCase();

  // IPv6 (including IPv4-mapped)
  if (ip.includes(':')) {
    if (ip === '::' || ip === '::1') return true;
    if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    // Not a valid IPv4 literal — treat as "not an IP" (caller handles hostnames)
    return false;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function looksLikeIpLiteral(hostname: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':');
}

/**
 * Validate that a URL is safe to fetch server-side.
 * Returns null if OK, or a human-readable rejection reason.
 */
export async function validatePublicUrl(rawUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'Invalid URL';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Only http(s) URLs are allowed';
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    return 'Non-standard ports are not allowed';
  }
  if (url.username || url.password) {
    return 'URLs with credentials are not allowed';
  }

  // Strip IPv6 brackets for address checks
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (
    hostname === 'localhost' ||
    !hostname.includes('.') || // single-label internal names (and bracketless edge cases)
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localhost')
  ) {
    // IPv6 literals contain ':' but no '.', so re-check before rejecting
    if (!hostname.includes(':')) return 'Internal hostnames are not allowed';
  }

  if (looksLikeIpLiteral(hostname)) {
    if (isPrivateAddress(hostname)) return 'Private IP addresses are not allowed';
    return null;
  }

  // Resolve DNS and verify every address is public. Degrade gracefully in
  // runtimes without node:dns (the literal/hostname checks above still apply).
  try {
    const dns = await import('node:dns/promises');
    const results = await dns.lookup(hostname, { all: true });
    for (const r of results) {
      if (isPrivateAddress(r.address)) return 'Hostname resolves to a private address';
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Hostname does not resolve';
    // dns module unavailable or transient failure — fall through
  }

  return null;
}
