/**
 * mockAgents.ts — Demo rail booking agents (no real booking API)
 *
 * Mounted at /api/mock/*
 *
 * POST /api/mock/train-booking
 *   Receives a hire dispatch from the marketplace, simulates a train booking,
 *   completes the job with a booking reference, then sends a confirmation email.
 *
 * This endpoint IS the agent. It behaves like any third-party agent would:
 *   1. Receive job payload from AgentPay marketplace hire
 *   2. Process the job (mock: parse route + generate booking ref)
 *   3. Call back to /api/marketplace/hire/:jobId/complete
 *   4. Email the traveler via Resend
 *
 * In production this endpoint would be replaced by the real Trainline / IRCTC
 * agent running on its own infrastructure.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate an agent-specific booking reference.
 * TrainFinder → TF-2026-DRBLON-042
 * RailSearch  → RS-2026-DRB-042
 * Eurostar    → EUR-2026-042
 * Default     → TRN-A3F2K1
 */
function genBookingRef(agentName: string, from: string, to: string): string {
  const year = new Date().getFullYear();
  const num  = String(Math.floor(Math.random() * 900) + 100).padStart(3, '0');
  const frm  = from.replace(/\s+/g, '').slice(0, 3).toUpperCase();
  const t    = to.replace(/\s+/g, '').slice(0, 3).toUpperCase();
  const name = agentName.toLowerCase();

  if (name.includes('trainfinder') || name.includes('train finder')) {
    return `TF-${year}-${frm}${t}-${num}`;
  }
  if (name.includes('railsearch') || name.includes('rail search')) {
    return `RS-${year}-${frm}-${num}`;
  }
  if (name.includes('eurostar') || name.includes('concierge')) {
    return `EUR-${year}-${num}`;
  }
  // fallback: legacy random ref
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = 'TRN-';
  for (let i = 0; i < 6; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref;
}

/** Pick a realistic departure time for the route */
function pickDepartureTime(from: string, to: string): string {
  // Common UK departure minutes to make times feel real
  const times = [
    '06:52', '07:14', '07:38', '07:52', '08:05', '08:23', '08:47', '09:15',
    '09:32', '09:47', '10:04', '10:22', '10:51', '11:05', '11:28', '11:48',
    '12:03', '12:30', '13:00', '13:15', '13:48', '14:00', '14:22', '14:45',
    '15:00', '15:30', '16:05', '16:29', '16:52', '17:08', '17:23', '17:47',
    '18:00', '18:22', '18:47', '19:05', '19:15', '19:52', '20:01', '20:30',
  ];
  // Seed by route so the same request always gets the same departure
  const seed = (from + to).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return times[seed % times.length];
}

/** Pick a realistic platform number */
function pickPlatform(from: string): string {
  const f = from.toLowerCase();
  // London St Pancras / Eurostar → high platforms
  if (f.includes('pancras') || f.includes('eurostar'))  return String(Math.floor(Math.random() * 6) + 7);
  // Most regional stations: 1–6
  return String(Math.floor(Math.random() * 6) + 1);
}

/** Detect the most likely train operator from the route */
function detectOperator(from: string, to: string): string {
  const route = `${from} ${to}`.toLowerCase();
  if (/derby|nottingham|leicester|lincoln|sheffield/.test(route)) return 'East Midlands Railway';
  if (/edinburgh|leeds|newcastle|york|hull/.test(route))           return 'LNER';
  if (/manchester|liverpool|glasgow|birmingham|avanti/.test(route)) return 'Avanti West Coast';
  if (/brighton|gatwick|bedford|luton/.test(route))                return 'Thameslink';
  if (/cambridge|norwich|ipswich/.test(route))                     return 'Greater Anglia';
  if (/paris|brussels|amsterdam|eurostar/.test(route))             return 'Eurostar International';
  if (/cardiff|swansea|bristol/.test(route))                       return 'Great Western Railway';
  return 'National Rail';
}

/** Parse a field from buildBookingContext() output: "Label: value\n" */
function parseField(text: string, label: string): string | null {
  const match = text.match(new RegExp(`${label}:\\s*([^\\n]+)`, 'i'));
  return match?.[1]?.trim() ?? null;
}

/** Extract route from raw user intent: "train from Derby to London" */
function parseRoute(text: string): { from: string; to: string } {
  // Try "from X to Y"
  const fromTo = text.match(/from\s+([\w\s]+?)\s+to\s+([\w\s]+?)(?:\s+tomorrow|\s+on\s|\s+at\s|$|\n)/i);
  if (fromTo) {
    return { from: fromTo[1].trim(), to: fromTo[2].trim() };
  }
  // Try just "to Y" or "to Y tomorrow"
  const toOnly = text.match(/\bto\s+([\w\s]+?)(?:\s+tomorrow|\s+on\s|\s+at\s|$|\n)/i);
  if (toOnly) {
    return { from: 'Your location', to: toOnly[1].trim() };
  }
  return { from: 'Origin', to: 'Destination' };
}

/** Parse the departure date hint from intent */
function parseDeparture(text: string): string {
  if (/tomorrow/i.test(text)) return 'Tomorrow';
  if (/tonight|this evening/i.test(text)) return 'Today (evening)';
  if (/today|now/i.test(text)) return 'Today';
  const dateMatch = text.match(/\b(\d{1,2}(?:st|nd|rd|th)?\s+\w+|\w+\s+\d{1,2}(?:st|nd|rd|th)?)\b/);
  if (dateMatch) return dateMatch[1];
  return 'Tomorrow';
}

/** Send booking confirmation email via Resend */
async function sendConfirmationEmail(opts: {
  resendKey: string;
  to: string;
  name: string;
  bookingRef: string;
  from: string;
  to_station: string;
  departure: string;
  departureTime: string;
  platform: string;
  operator: string;
  class_: string;
  agentName: string;
  priceUsdc: number;
}): Promise<void> {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#080808;color:#f9fafb;font-family:system-ui,-apple-system,sans-serif;margin:0;padding:0;">
  <div style="max-width:560px;margin:40px auto;padding:32px;background:#0d0d0d;border-radius:16px;border:1px solid #1f2937;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:32px;">
      <div style="width:40px;height:40px;background:#052e16;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;">🚂</div>
      <div>
        <div style="font-size:18px;font-weight:700;color:#4ade80;">Booking Confirmed</div>
        <div style="font-size:12px;color:#4b5563;">via Bro · Powered by AgentPay</div>
      </div>
    </div>

    <div style="background:#111;border-radius:12px;padding:20px;margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;color:#4b5563;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:16px;">Booking Reference</div>
      <div style="font-size:28px;font-weight:700;color:#f9fafb;letter-spacing:2px;font-family:monospace;">${opts.bookingRef}</div>
    </div>

    <div style="background:#111;border-radius:12px;padding:20px;margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;color:#4b5563;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:16px;">Journey Details</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Passenger</td><td style="padding:8px 0;color:#f9fafb;font-size:13px;text-align:right;">${opts.name}</td></tr>
        <tr style="border-top:1px solid #1f2937;"><td style="padding:8px 0;color:#6b7280;font-size:13px;">From</td><td style="padding:8px 0;color:#f9fafb;font-size:13px;text-align:right;">${opts.from}</td></tr>
        <tr style="border-top:1px solid #1f2937;"><td style="padding:8px 0;color:#6b7280;font-size:13px;">To</td><td style="padding:8px 0;color:#f9fafb;font-size:13px;text-align:right;">${opts.to_station}</td></tr>
        <tr style="border-top:1px solid #1f2937;"><td style="padding:8px 0;color:#6b7280;font-size:13px;">Date</td><td style="padding:8px 0;color:#f9fafb;font-size:13px;text-align:right;">${opts.departure}</td></tr>
        <tr style="border-top:1px solid #1f2937;"><td style="padding:8px 0;color:#6b7280;font-size:13px;">Departs</td><td style="padding:8px 0;color:#4ade80;font-size:14px;font-weight:700;text-align:right;">${opts.departureTime}</td></tr>
        <tr style="border-top:1px solid #1f2937;"><td style="padding:8px 0;color:#6b7280;font-size:13px;">Platform</td><td style="padding:8px 0;color:#f9fafb;font-size:13px;text-align:right;">${opts.platform}</td></tr>
        <tr style="border-top:1px solid #1f2937;"><td style="padding:8px 0;color:#6b7280;font-size:13px;">Operator</td><td style="padding:8px 0;color:#f9fafb;font-size:13px;text-align:right;">${opts.operator}</td></tr>
        <tr style="border-top:1px solid #1f2937;"><td style="padding:8px 0;color:#6b7280;font-size:13px;">Class</td><td style="padding:8px 0;color:#f9fafb;font-size:13px;text-align:right;">${opts.class_}</td></tr>
        <tr style="border-top:1px solid #1f2937;"><td style="padding:8px 0;color:#6b7280;font-size:13px;">Agent</td><td style="padding:8px 0;color:#818cf8;font-size:13px;text-align:right;">${opts.agentName}</td></tr>
        <tr style="border-top:1px solid #1f2937;"><td style="padding:8px 0;color:#6b7280;font-size:13px;">Amount paid</td><td style="padding:8px 0;color:#4ade80;font-size:13px;font-weight:700;text-align:right;">$${opts.priceUsdc.toFixed(2)} USDC</td></tr>
      </table>
    </div>

    <div style="font-size:12px;color:#374151;text-align:center;line-height:18px;">
      Booked by Bro on your behalf · agentpay.so<br>
      Your payment was held in escrow and released on delivery.
    </div>
  </div>
</body>
</html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Bro <bookings@agentpay.so>',
      to: [opts.to],
      subject: `${opts.bookingRef} — Train from ${opts.from} to ${opts.to_station}`,
      html,
    }),
  });
}

// ---------------------------------------------------------------------------
// POST /api/mock/train-booking
// ---------------------------------------------------------------------------

router.post('/train-booking', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { jobId, hirerId, jobDescription = '', agreedPriceUsdc = 0, agentName = 'TrainAgent' } = body;

  if (!jobId || !hirerId) {
    return c.json({ error: 'jobId and hirerId required' }, 400);
  }

  // ── Parse traveler profile from buildBookingContext output ────────────────
  const email     = parseField(jobDescription, 'Email');
  const name      = parseField(jobDescription, 'Name') ?? 'Traveler';
  const seatPref  = parseField(jobDescription, 'Seat preference') ?? 'no preference';
  const classPref = parseField(jobDescription, 'Class preference') ?? 'Standard';

  // ── Parse route from the raw user intent (first line before profile block) ─
  const intentText = jobDescription.split('TRAVELER PROFILE')[0].trim();
  const { from: fromStation, to: toStation } = parseRoute(intentText || jobDescription);
  const departure = parseDeparture(intentText || jobDescription);

  // ── Simulate processing (rail inventory check, seat reservation, etc.) ────
  await new Promise(r => setTimeout(r, 2000));

  // ── Generate rich booking data ────────────────────────────────────────────
  const bookingRef    = genBookingRef(agentName, fromStation, toStation);
  const departureTime = pickDepartureTime(fromStation, toStation);
  const platform      = pickPlatform(fromStation);
  const operator      = detectOperator(fromStation, toStation);

  const completionProof = {
    bookingRef,
    fromStation,
    toStation,
    departureTime,
    platform,
    operator,
    passengerName:  name,
    passengerEmail: email,
    departureDate:  departure,
    classPreference: classPref,
    seatPreference:  seatPref,
    agentName,
    payout: {
      agentPayout:  parseFloat((agreedPriceUsdc * 0.95).toFixed(6)),
      platformFee:  parseFloat((agreedPriceUsdc * 0.05).toFixed(6)),
      currency:     'USDC',
    },
    bookedAt:       new Date().toISOString(),
    agentPayJobId:  jobId,
  };

  // ── Complete the job (mark escrow → completed) ────────────────────────────
  try {
    await fetch(`${c.env.API_BASE_URL}/api/marketplace/hire/${jobId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hirerId, completionProof }),
    });
    console.info('[mock/train-booking] job completed', { jobId, bookingRef });
  } catch (e) {
    console.error('[mock/train-booking] complete failed', e instanceof Error ? e.message : e);
  }

  // ── Send confirmation email (fire-and-forget) ─────────────────────────────
  if (email && c.env.RESEND_API_KEY) {
    c.executionCtx.waitUntil(
      sendConfirmationEmail({
        resendKey:     c.env.RESEND_API_KEY,
        to:            email,
        name,
        bookingRef,
        from:          fromStation,
        to_station:    toStation,
        departure,
        departureTime,
        platform,
        operator,
        class_:        classPref,
        agentName,
        priceUsdc:     agreedPriceUsdc,
      }).catch((e) => console.error('[mock/train-booking] email failed', e instanceof Error ? e.message : e)),
    );
  }

  return c.json({
    success:       true,
    bookingRef,
    fromStation,
    toStation,
    departureTime,
    platform,
    operator,
    departure,
    passengerName: name,
    status:        'booked',
  });
});

// ---------------------------------------------------------------------------
// POST /api/notifications/booking-confirmation
// Direct email send — callable from Bro app as fallback
// ---------------------------------------------------------------------------

router.post('/booking-email', async (c) => {
  if (!c.env.RESEND_API_KEY) {
    return c.json({ error: 'Email not configured' }, 503);
  }

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { to, name, bookingRef, fromStation, toStation, departure, classPref, agentName, priceUsdc } = body;
  if (!to || !bookingRef) {
    return c.json({ error: 'to and bookingRef required' }, 400);
  }

  try {
    await sendConfirmationEmail({
      resendKey:  c.env.RESEND_API_KEY,
      to,
      name:       name ?? 'Traveler',
      bookingRef,
      from:       fromStation ?? 'Origin',
      to_station: toStation ?? 'Destination',
      departure:  departure ?? 'Tomorrow',
      class_:     classPref ?? 'Standard',
      agentName:  agentName ?? 'TrainAgent',
      priceUsdc:  priceUsdc ?? 0,
    });
    return c.json({ success: true });
  } catch (e: any) {
    console.error('[booking-email] send failed', e.message);
    return c.json({ error: 'Email send failed' }, 500);
  }
});

export { router as mockAgentsRouter };
