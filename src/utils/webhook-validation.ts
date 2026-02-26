/**
 * Validates a webhook URL to prevent SSRF attacks.
 * Rejects URLs that resolve to private/loopback networks or cloud metadata endpoints.
 *
 * @returns null on success, or an error message string on failure.
 */
export function validateWebhookUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 'webhookUrl must be a valid URL';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'webhookUrl must use http or https';
  }

  const hostname = parsed.hostname.toLowerCase();
  // Normalize bracket-enclosed IPv6 addresses (e.g. "[::1]" → "::1")
  const normalizedHostname = hostname.replace(/^\[|\]$/g, '');

  // Block loopback / localhost
  if (normalizedHostname === 'localhost' || normalizedHostname === '127.0.0.1' || normalizedHostname === '::1') {
    return 'webhookUrl must not point to a loopback address';
  }

  // Block private IPv4 ranges: RFC 1918 (10.x, 172.16-31.x, 192.168.x)
  // and link-local (169.254.x.x) which covers cloud metadata IPs such as
  // the AWS IMDSv1 endpoint (169.254.169.254) and Azure IMDS (169.254.169.254).
  const privateIpv4 = /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+)$/;
  if (privateIpv4.test(normalizedHostname)) {
    return 'webhookUrl must not point to a private or link-local IP range';
  }

  // Block GCP metadata service hostname (not covered by IP range check)
  if (normalizedHostname === 'metadata.google.internal') {
    return 'webhookUrl must not point to a cloud metadata service';
  }

  return null;
}

export default { validateWebhookUrl };
