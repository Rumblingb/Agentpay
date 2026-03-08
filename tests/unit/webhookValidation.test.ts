/**
 * Unit tests for webhooks.validateWebhookUrl — SSRF protection.
 */

import { validateWebhookUrl } from '../../src/services/webhooks';

describe('validateWebhookUrl — SSRF protection', () => {
  describe('valid URLs', () => {
    it('accepts a public HTTPS URL', () => {
      expect(validateWebhookUrl('https://example.com/webhook')).toEqual({ valid: true });
    });

    it('accepts HTTPS URL with port', () => {
      expect(validateWebhookUrl('https://myapp.com:8443/hook')).toEqual({ valid: true });
    });

    it('accepts HTTPS URL with path and query', () => {
      expect(validateWebhookUrl('https://hooks.example.io/agentpay?id=123')).toEqual({ valid: true });
    });
  });

  describe('rejects HTTP (non-HTTPS) for non-localhost', () => {
    it('rejects http:// URLs for public domains', () => {
      const result = validateWebhookUrl('http://example.com/hook');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/HTTPS/i);
    });
  });

  describe('test-mode exemption — http://localhost is allowed', () => {
    // Jest always runs with NODE_ENV=test, so the exemption is active here.
    it('allows http://localhost in test mode', () => {
      expect(validateWebhookUrl('http://localhost:9999/webhook').valid).toBe(true);
    });

    it('allows http://127.0.0.1 in test mode', () => {
      expect(validateWebhookUrl('http://127.0.0.1:9999/webhook').valid).toBe(true);
    });

    it('still rejects http://example.com in test mode (not loopback)', () => {
      expect(validateWebhookUrl('http://example.com/hook').valid).toBe(false);
    });

    it('still rejects https://localhost in test mode (loopback HTTPS is not a real use-case)', () => {
      expect(validateWebhookUrl('https://localhost/hook').valid).toBe(false);
    });
  });

  describe('rejects invalid URLs', () => {
    it('rejects plain strings', () => {
      expect(validateWebhookUrl('not-a-url').valid).toBe(false);
    });

    it('rejects empty string', () => {
      expect(validateWebhookUrl('').valid).toBe(false);
    });
  });

  describe('blocks private/loopback addresses (SSRF)', () => {
    it('rejects https://localhost', () => {
      expect(validateWebhookUrl('https://localhost/hook').valid).toBe(false);
    });

    it('rejects https://127.0.0.1', () => {
      expect(validateWebhookUrl('https://127.0.0.1/hook').valid).toBe(false);
    });

    it('rejects 10.x.x.x', () => {
      expect(validateWebhookUrl('https://10.0.0.1/hook').valid).toBe(false);
    });

    it('rejects 192.168.x.x', () => {
      expect(validateWebhookUrl('https://192.168.1.100/hook').valid).toBe(false);
    });

    it('rejects 172.16.x.x to 172.31.x.x (RFC1918)', () => {
      expect(validateWebhookUrl('https://172.16.0.1/hook').valid).toBe(false);
      expect(validateWebhookUrl('https://172.31.255.255/hook').valid).toBe(false);
    });

    it('rejects 169.254.x.x link-local', () => {
      expect(validateWebhookUrl('https://169.254.169.254/hook').valid).toBe(false);
    });

    it('rejects IPv6 loopback ::1', () => {
      expect(validateWebhookUrl('https://[::1]/hook').valid).toBe(false);
    });
  });
});
