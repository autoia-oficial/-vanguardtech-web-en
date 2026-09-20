import { lookup } from 'node:dns/promises';
import net from 'node:net';

/**
 * The auditor fetches whatever URL is on a lead, and stores part of the
 * response as evidence. Without a guard that is a server-side request forgery
 * hole: a lead pointed at cloud metadata or an internal host would have that
 * content retrieved by the server and written into the audit.
 *
 * So every hostname is resolved and every resulting address is checked against
 * the ranges that are never a customer's public website.
 *
 * Loopback is allowed only when AUDIT_ALLOW_PRIVATE_HOSTS is set, which the
 * test suite does so it can audit fixture pages served on 127.0.0.1.
 */

export function privateHostsAllowed(): boolean {
  return process.env.AUDIT_ALLOW_PRIVATE_HOSTS === '1';
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

const IPV4_BLOCKED: Array<[string, number, string]> = [
  ['0.0.0.0', 8, 'this network'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'carrier-grade NAT'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local / cloud metadata'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'IETF protocol assignments'],
  ['192.0.2.0', 24, 'documentation'],
  ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'benchmarking'],
  ['198.51.100.0', 24, 'documentation'],
  ['203.0.113.0', 24, 'documentation'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'],
];

/** Returns the reason an address is not fetchable, or null when it is fine. */
export function blockedReasonForAddress(address: string): string | null {
  if (net.isIPv4(address)) {
    const value = ipv4ToInt(address);
    if (value === null) return 'unparseable IPv4 address';
    for (const [base, bits, label] of IPV4_BLOCKED) {
      const baseValue = ipv4ToInt(base);
      if (baseValue === null) continue;
      const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
      if ((value & mask) === (baseValue & mask)) return label;
    }
    return null;
  }

  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return 'loopback';
    // Unique local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(lower)) return 'unique local';
    if (/^fe[89ab]/.test(lower)) return 'link-local';
    // IPv4-mapped addresses carry the v4 rules with them.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blockedReasonForAddress(mapped[1]);
    return null;
  }

  return 'not an IP address';
}

export interface HostCheck {
  allowed: boolean;
  reason?: string;
  addresses?: string[];
}

/**
 * Resolves a hostname and rejects it when any resolved address is one the
 * server must not be made to fetch. All addresses are checked, so a name that
 * resolves to both a public and a private address is still refused.
 */
export async function checkHostname(hostname: string): Promise<HostCheck> {
  const allowPrivate = privateHostsAllowed();

  // A bare IP in the URL skips DNS entirely.
  if (net.isIP(hostname)) {
    const reason = blockedReasonForAddress(hostname);
    if (reason && !allowPrivate) {
      return { allowed: false, reason: `refuses ${hostname} (${reason})`, addresses: [hostname] };
    }
    return { allowed: true, addresses: [hostname] };
  }

  let resolved: Array<{ address: string }>;
  try {
    resolved = await lookup(hostname, { all: true });
  } catch (err) {
    return {
      allowed: false,
      reason: `could not resolve ${hostname}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (resolved.length === 0) {
    return { allowed: false, reason: `${hostname} resolved to no addresses` };
  }

  const addresses = resolved.map((r) => r.address);
  if (allowPrivate) return { allowed: true, addresses };

  for (const address of addresses) {
    const reason = blockedReasonForAddress(address);
    if (reason) {
      return {
        allowed: false,
        reason: `refuses ${hostname} — it resolves to ${address} (${reason})`,
        addresses,
      };
    }
  }

  return { allowed: true, addresses };
}
