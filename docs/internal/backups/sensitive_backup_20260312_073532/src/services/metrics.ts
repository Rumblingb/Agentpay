/**
 * Prometheus-compatible metrics service.
 *
 * Exposes lightweight in-process counters / histograms that are serialised as
 * Prometheus text format on GET /metrics.  No external library is required —
 * we keep the implementation dependency-free so it never adds CVE surface.
 *
 * Instrumented signals:
 *   http_requests_total{method,route,status}
 *   http_request_duration_ms (histogram buckets)
 *   db_query_duration_ms     (histogram buckets)
 *   escrow_operations_total{operation,status}
 *   reconciliation_drift_total
 *   risk_engine_flags_total{tier}
 *
 * Usage:
 *   import { metrics } from './metrics.js';
 *   metrics.increment('escrow_operations_total', { operation: 'open', status: 'ok' });
 *   metrics.observe('http_request_duration_ms', durationMs);
 */

export interface Labels {
  [key: string]: string | number;
}

interface Counter {
  type: 'counter';
  help: string;
  values: Map<string, number>;
}

interface Histogram {
  type: 'histogram';
  help: string;
  buckets: number[]; // upper bounds in ms
  counts: number[];  // counts per bucket
  sum: number;
  totalCount: number;
}

type Metric = Counter | Histogram;

class MetricsRegistry {
  private registry = new Map<string, Metric>();

  /** Register (or return existing) counter. */
  counter(name: string, help: string): void {
    if (!this.registry.has(name)) {
      this.registry.set(name, { type: 'counter', help, values: new Map() });
    }
  }

  /** Register (or return existing) histogram. */
  histogram(
    name: string,
    help: string,
    buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  ): void {
    if (!this.registry.has(name)) {
      this.registry.set(name, {
        type: 'histogram',
        help,
        buckets,
        counts: new Array(buckets.length).fill(0),
        sum: 0,
        totalCount: 0,
      });
    }
  }

  /** Increment a counter by 1 (or by `amount`). */
  increment(name: string, labels: Labels = {}, amount = 1): void {
    const metric = this.registry.get(name);
    if (!metric || metric.type !== 'counter') return;
    const key = labelsToKey(labels);
    metric.values.set(key, (metric.values.get(key) ?? 0) + amount);
  }

  /** Observe a value for a histogram metric. */
  observe(name: string, value: number): void {
    const metric = this.registry.get(name);
    if (!metric || metric.type !== 'histogram') return;
    metric.sum += value;
    metric.totalCount++;
    for (let i = 0; i < metric.buckets.length; i++) {
      if (value <= metric.buckets[i]) {
        metric.counts[i]++;
      }
    }
  }

  /** Serialise all metrics to Prometheus text format. */
  toPrometheusText(): string {
    const lines: string[] = [];

    for (const [name, metric] of this.registry) {
      if (metric.type === 'counter') {
        lines.push(`# HELP ${name} ${metric.help}`);
        lines.push(`# TYPE ${name} counter`);
        for (const [labelKey, value] of metric.values) {
          lines.push(labelKey ? `${name}{${labelKey}} ${value}` : `${name} ${value}`);
        }
      } else {
        lines.push(`# HELP ${name} ${metric.help}`);
        lines.push(`# TYPE ${name} histogram`);
        let cumCount = 0;
        for (let i = 0; i < metric.buckets.length; i++) {
          cumCount += metric.counts[i];
          lines.push(`${name}_bucket{le="${metric.buckets[i]}"} ${cumCount}`);
        }
        lines.push(`${name}_bucket{le="+Inf"} ${metric.totalCount}`);
        lines.push(`${name}_sum ${metric.sum}`);
        lines.push(`${name}_count ${metric.totalCount}`);
      }
    }

    return lines.join('\n') + '\n';
  }
}

function labelsToKey(labels: Labels): string {
  return Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
}

// Singleton registry
export const metrics = new MetricsRegistry();

// ---------------------------------------------------------------------------
// Pre-register all known metrics
// ---------------------------------------------------------------------------
metrics.counter(
  'http_requests_total',
  'Total HTTP requests by method, route, and status code',
);
metrics.histogram(
  'http_request_duration_ms',
  'HTTP request duration in milliseconds',
);
metrics.histogram(
  'db_query_duration_ms',
  'Database query duration in milliseconds',
);
metrics.counter(
  'escrow_operations_total',
  'Total escrow operations by type and outcome',
);
metrics.counter(
  'reconciliation_drift_total',
  'Number of reconciliation drift events detected',
);
metrics.counter(
  'risk_engine_flags_total',
  'Risk engine flag events by tier',
);
metrics.counter(
  'kyc_submissions_total',
  'KYC submissions by status',
);
metrics.counter(
  'webhook_deliveries_total',
  'Webhook delivery attempts by event type and outcome',
);
