import { describe, it, expect } from 'vitest';
import { blockedReasonForAddress, checkHostname } from './ssrf';
import { normalizeUrl, fetchPage } from './fetcher';

describe('blockedReasonForAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.53.1.9', 'loopback'],
    ['169.254.169.254', 'link-local / cloud metadata'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.254', 'private'],
    ['192.168.1.1', 'private'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['0.0.0.0', 'this network'],
    ['224.0.0.1', 'multicast'],
  ])('blocks %s', (ip, label) => {
    expect(blockedReasonForAddress(ip)).toBe(label);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1'])(
    'allows public address %s',
    (ip) => {
      expect(blockedReasonForAddress(ip)).toBeNull();
    },
  );

  it('blocks IPv6 loopback, unique local and link-local', () => {
    expect(blockedReasonForAddress('::1')).toBe('loopback');
    expect(blockedReasonForAddress('fd00::1')).toBe('unique local');
    expect(blockedReasonForAddress('fe80::1')).toBe('link-local');
  });

  it('applies the v4 rules to IPv4-mapped v6 addresses', () => {
    expect(blockedReasonForAddress('::ffff:169.254.169.254')).toBe('link-local / cloud metadata');
    expect(blockedReasonForAddress('::ffff:8.8.8.8')).toBeNull();
  });

  it('allows a public IPv6 address', () => {
    expect(blockedReasonForAddress('2606:4700:4700::1111')).toBeNull();
  });
});

describe('checkHostname with the test allowance off', () => {
  const withoutAllowance = async <T>(fn: () => Promise<T>): Promise<T> => {
    const previous = process.env.AUDIT_ALLOW_PRIVATE_HOSTS;
    delete process.env.AUDIT_ALLOW_PRIVATE_HOSTS;
    try {
      return await fn();
    } finally {
      if (previous !== undefined) process.env.AUDIT_ALLOW_PRIVATE_HOSTS = previous;
    }
  };

  it('refuses a literal metadata address', async () => {
    const result = await withoutAllowance(() => checkHostname('169.254.169.254'));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('cloud metadata');
  });

  it('refuses loopback by name', async () => {
    const result = await withoutAllowance(() => checkHostname('localhost'));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('loopback');
  });

  it('refuses a private literal', async () => {
    const result = await withoutAllowance(() => checkHostname('192.168.1.1'));
    expect(result.allowed).toBe(false);
  });

  it('reports a name that does not resolve rather than allowing it', async () => {
    const result = await withoutAllowance(() => checkHostname('nope.invalid'));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('could not resolve');
  });

  it('refuses the fetch outright, with the reason as the error', async () => {
    const outcome = await withoutAllowance(() => fetchPage('http://169.254.169.254/latest/meta-data/'));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.error).toContain('Refused for safety');
  });
});

describe('normalizeUrl', () => {
  it('assumes https when no scheme is given', () => {
    expect(normalizeUrl('atlas.example')).toBe('https://atlas.example/');
  });

  it('rejects non-http schemes', () => {
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeUrl('data:text/html,<h1>x</h1>')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects empty and malformed input', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl('http://')).toBeNull();
  });
});
