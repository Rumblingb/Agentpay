import type { Env } from '../types';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.google.internal.',
  'metadata.azure.internal',
  '100.100.100.200',
  '169.254.169.254',
  '::1',
]);

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((value) => value < 0 || value > 255)) return false;
  if (octets[0] === 10) return true;
  if (octets[0] === 127) return true;
  if (octets[0] === 0) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
  if (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)) return true;
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb');
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  if (normalized.endsWith('.localhost') || normalized.endsWith('.local') || normalized.endsWith('.internal')) {
    return true;
  }
  if (isPrivateIpv4(normalized) || isPrivateIpv6(normalized)) return true;
  return false;
}

function assertSafeHostname(hostname: string, env: Env) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) throw new Error('CAPABILITY_HOST_INVALID');
  if (env.AGENTPAY_TEST_MODE === 'true' && (normalized === 'localhost' || normalized === '127.0.0.1')) {
    return;
  }
  if (isBlockedHostname(normalized)) {
    throw new Error('CAPABILITY_HOST_BLOCKED');
  }
}

function normalizeHostInput(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed.includes('://')) throw new Error('CAPABILITY_ALLOWED_HOST_INVALID');
  if (trimmed.includes('/') || trimmed.includes('?') || trimmed.includes('#') || trimmed.includes('@')) {
    throw new Error('CAPABILITY_ALLOWED_HOST_INVALID');
  }
  return trimmed.replace(/\.$/, '');
}

export function normalizeAllowedCapabilityHosts(hosts: string[], env: Env): string[] {
  const deduped = new Set<string>();
  for (const value of hosts) {
    const normalized = normalizeHostInput(value);
    if (!normalized) continue;
    assertSafeHostname(normalized.split(':')[0], env);
    deduped.add(normalized);
  }
  return Array.from(deduped);
}

export function normalizeCapabilityBaseUrl(baseUrl: string, env: Env): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('CAPABILITY_BASE_URL_INVALID');
  }
  if (!parsed.hostname) throw new Error('CAPABILITY_BASE_URL_INVALID');
  if (parsed.username || parsed.password) throw new Error('CAPABILITY_BASE_URL_INVALID');
  if (parsed.search || parsed.hash) throw new Error('CAPABILITY_BASE_URL_INVALID');
  const protocol = parsed.protocol.toLowerCase();
  const allowInsecureLocal = env.AGENTPAY_TEST_MODE === 'true'
    && (normalizeHostname(parsed.hostname) === 'localhost' || normalizeHostname(parsed.hostname) === '127.0.0.1');
  if (protocol !== 'https:' && !(allowInsecureLocal && protocol === 'http:')) {
    throw new Error('CAPABILITY_BASE_URL_INSECURE');
  }
  assertSafeHostname(parsed.hostname, env);
  parsed.hostname = normalizeHostname(parsed.hostname);
  return parsed.toString().replace(/\/$/, '');
}

export function assertSafeCapabilityTarget(
  target: URL,
  allowedHosts: string[],
  env: Env,
): void {
  const protocol = target.protocol.toLowerCase();
  const allowInsecureLocal = env.AGENTPAY_TEST_MODE === 'true'
    && (normalizeHostname(target.hostname) === 'localhost' || normalizeHostname(target.hostname) === '127.0.0.1');
  if (protocol !== 'https:' && !(allowInsecureLocal && protocol === 'http:')) {
    throw new Error('CAPABILITY_TARGET_INSECURE');
  }
  if (target.username || target.password) throw new Error('CAPABILITY_TARGET_INVALID');
  assertSafeHostname(target.hostname, env);
  const normalizedAllowedHosts = normalizeAllowedCapabilityHosts(allowedHosts, env);
  if (normalizedAllowedHosts.length && !normalizedAllowedHosts.includes(target.host.toLowerCase()) && !normalizedAllowedHosts.includes(normalizeHostname(target.hostname))) {
    throw new Error('CAPABILITY_HOST_NOT_ALLOWED');
  }
}
