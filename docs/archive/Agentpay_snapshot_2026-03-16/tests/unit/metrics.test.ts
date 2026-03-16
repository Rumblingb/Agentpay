/**
 * Unit tests for the metrics service.
 */

import { metrics } from '../../src/services/metrics.js';

describe('MetricsRegistry', () => {
  it('increments counters and serialises to Prometheus text', () => {
    metrics.increment('http_requests_total', { method: 'GET', route: '/', status: '200' });
    metrics.increment('http_requests_total', { method: 'GET', route: '/', status: '200' });

    const text = metrics.toPrometheusText();
    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toContain('http_requests_total{');
  });

  it('observes histogram values', () => {
    metrics.observe('http_request_duration_ms', 42);
    metrics.observe('http_request_duration_ms', 150);

    const text = metrics.toPrometheusText();
    expect(text).toContain('# TYPE http_request_duration_ms histogram');
    expect(text).toContain('http_request_duration_ms_sum');
    expect(text).toContain('http_request_duration_ms_count');
  });

  it('increments risk_engine_flags_total counter', () => {
    metrics.increment('risk_engine_flags_total', { tier: 'HIGH' });

    const text = metrics.toPrometheusText();
    expect(text).toContain('risk_engine_flags_total');
  });

  it('increments escrow_operations_total counter', () => {
    metrics.increment('escrow_operations_total', { operation: 'open', status: 'ok' });

    const text = metrics.toPrometheusText();
    expect(text).toContain('escrow_operations_total');
  });
});
