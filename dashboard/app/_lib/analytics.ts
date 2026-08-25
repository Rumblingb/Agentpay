export type AgentPayEvent =
  | 'commerce_need_selected'
  | 'commerce_shortlist_compiled'
  | 'commerce_product_selected'
  | 'commerce_approval_started'
  | 'commerce_checkout_reviewed'
  | 'commerce_sandbox_order_completed';

type EventParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    gtag?: (command: 'event', eventName: string, params?: EventParams) => void;
  }
}

/** Sends only allowlisted aggregate product events when the consent-gated GA loader is active. */
export function trackEvent(name: AgentPayEvent, params: EventParams = {}) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', name, params);
}
