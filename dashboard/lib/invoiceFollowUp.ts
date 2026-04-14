export type FollowUpStage =
  | 'due_today'
  | 'overdue_3d'
  | 'overdue_7d'
  | 'overdue_14d_plus';

export type FollowUpOutcome =
  | 'none'
  | 'reminder_sent'
  | 'promised_to_pay'
  | 'partial_payment'
  | 'disputed';

export type ContactChannel = 'email' | 'sms' | 'phone';

export interface FollowUpInvoice {
  id: string;
  customerName: string;
  amountDue: number;
  currency: string;
  dueDate: string;
  contactChannel: ContactChannel;
  contactTarget: string;
  invoiceRef: string;
  lastContactedAt: string | null;
  lastOutcome: FollowUpOutcome;
  promisedPaymentDate: string | null;
  notes?: string;
}

export interface ReminderDraft {
  subject: string;
  body: string;
}

export interface RankedFollowUpInvoice extends FollowUpInvoice {
  daysOverdue: number;
  stage: FollowUpStage;
  urgencyScore: number;
  nextFollowUpAt: string;
  nextActionLabel: string;
  reminderDraft: ReminderDraft;
}

export interface FollowUpQueueSummary {
  totalInvoices: number;
  overdueCount: number;
  overdueAmount: number;
  topPriority: RankedFollowUpInvoice | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function startOfUtcDay(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(value: string | Date, days: number): string {
  const base = startOfUtcDay(value);
  return isoDate(new Date(base.getTime() + days * DAY_MS));
}

export function getDaysOverdue(dueDate: string, now = new Date()): number {
  const due = startOfUtcDay(dueDate);
  const today = startOfUtcDay(now);
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / DAY_MS));
}

export function getFollowUpStage(daysOverdue: number): FollowUpStage {
  if (daysOverdue >= 14) return 'overdue_14d_plus';
  if (daysOverdue >= 7) return 'overdue_7d';
  if (daysOverdue >= 3) return 'overdue_3d';
  return 'due_today';
}

function nextActionLabel(stage: FollowUpStage): string {
  switch (stage) {
    case 'overdue_14d_plus':
      return 'Escalate and call today';
    case 'overdue_7d':
      return 'Send final reminder';
    case 'overdue_3d':
      return 'Send reminder today';
    default:
      return 'Pre-due check-in';
  }
}

function promisedPaymentRisk(invoice: FollowUpInvoice, now: Date): number {
  if (!invoice.promisedPaymentDate) return 0;
  const promised = startOfUtcDay(invoice.promisedPaymentDate);
  const today = startOfUtcDay(now);
  return promised.getTime() < today.getTime() ? 30 : 0;
}

export function scoreInvoiceForFollowUp(invoice: FollowUpInvoice, now = new Date()): number {
  const daysOverdue = getDaysOverdue(invoice.dueDate, now);
  const contactPenalty = invoice.lastContactedAt ? 0 : 12;
  const disputePenalty = invoice.lastOutcome === 'disputed' ? -25 : 0;
  const partialPaymentPenalty = invoice.lastOutcome === 'partial_payment' ? 8 : 0;
  const overdueWeight = Math.min(daysOverdue, 30) * 4;
  const amountWeight = Math.round(invoice.amountDue / 50);
  const promisedRisk = promisedPaymentRisk(invoice, now);
  return overdueWeight + amountWeight + contactPenalty + partialPaymentPenalty + promisedRisk + disputePenalty;
}

export function buildReminderDraft(
  invoice: FollowUpInvoice,
  daysOverdue = getDaysOverdue(invoice.dueDate),
): ReminderDraft {
  const stage = getFollowUpStage(daysOverdue);
  const subjectPrefix =
    stage === 'overdue_14d_plus'
      ? 'Urgent'
      : stage === 'overdue_7d'
      ? 'Final reminder'
      : stage === 'overdue_3d'
      ? 'Reminder'
      : 'Invoice due';
  const subject = `${subjectPrefix}: ${invoice.invoiceRef} for ${invoice.customerName}`;

  const opening =
    stage === 'overdue_14d_plus'
      ? `Hi ${invoice.customerName}, this invoice is now ${daysOverdue} days overdue.`
      : stage === 'overdue_7d'
      ? `Hi ${invoice.customerName}, this is the final reminder before we move this invoice into manual follow-up.`
      : stage === 'overdue_3d'
      ? `Hi ${invoice.customerName}, a quick reminder that this invoice is ${daysOverdue} days overdue.`
      : `Hi ${invoice.customerName}, this is a quick heads-up that invoice ${invoice.invoiceRef} is now due.`;

  const body = [
    opening,
    '',
    `Invoice: ${invoice.invoiceRef}`,
    `Amount due: ${invoice.amountDue.toFixed(2)} ${invoice.currency}`,
    `Original due date: ${invoice.dueDate}`,
    '',
    'Please reply with a payment date if the transfer is already in progress, or let us know if anything needs to be corrected.',
    '',
    'Thanks,',
    'ACE Collections',
  ].join('\n');

  return { subject, body };
}

export function rankInvoicesForFollowUp(
  invoices: FollowUpInvoice[],
  now = new Date(),
): RankedFollowUpInvoice[] {
  return [...invoices]
    .map((invoice) => {
      const daysOverdue = getDaysOverdue(invoice.dueDate, now);
      const stage = getFollowUpStage(daysOverdue);
      return {
        ...invoice,
        daysOverdue,
        stage,
        urgencyScore: scoreInvoiceForFollowUp(invoice, now),
        nextFollowUpAt: addDays(now, stage === 'overdue_14d_plus' ? 0 : 1),
        nextActionLabel: nextActionLabel(stage),
        reminderDraft: buildReminderDraft(invoice, daysOverdue),
      };
    })
    .sort((a, b) => {
      if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
      if (b.amountDue !== a.amountDue) return b.amountDue - a.amountDue;
      return a.customerName.localeCompare(b.customerName);
    });
}

export function summarizeFollowUpQueue(
  invoices: FollowUpInvoice[],
  now = new Date(),
): FollowUpQueueSummary {
  const ranked = rankInvoicesForFollowUp(invoices, now);
  return {
    totalInvoices: ranked.length,
    overdueCount: ranked.filter((item) => item.daysOverdue > 0).length,
    overdueAmount: ranked.reduce((sum, item) => sum + item.amountDue, 0),
    topPriority: ranked[0] ?? null,
  };
}

export const SAMPLE_FOLLOW_UP_INVOICES: FollowUpInvoice[] = [
  {
    id: 'inv-follow-001',
    customerName: 'Riverside Dental',
    amountDue: 1840,
    currency: 'USD',
    dueDate: '2026-04-01',
    contactChannel: 'email',
    contactTarget: 'billing@riversidedental.com',
    invoiceRef: 'ACE-2048',
    lastContactedAt: '2026-04-09',
    lastOutcome: 'promised_to_pay',
    promisedPaymentDate: '2026-04-12',
    notes: 'Promised ACH by Monday, not received.',
  },
  {
    id: 'inv-follow-002',
    customerName: 'North Clinic PT',
    amountDue: 620,
    currency: 'USD',
    dueDate: '2026-04-07',
    contactChannel: 'sms',
    contactTarget: '+1 415 555 0102',
    invoiceRef: 'ACE-2059',
    lastContactedAt: null,
    lastOutcome: 'none',
    promisedPaymentDate: null,
    notes: 'No outreach sent yet.',
  },
  {
    id: 'inv-follow-003',
    customerName: 'Harbor Wellness',
    amountDue: 2460,
    currency: 'USD',
    dueDate: '2026-03-29',
    contactChannel: 'phone',
    contactTarget: '+1 415 555 0144',
    invoiceRef: 'ACE-2039',
    lastContactedAt: '2026-04-11',
    lastOutcome: 'partial_payment',
    promisedPaymentDate: '2026-04-15',
    notes: 'Partial payment landed, balance still open.',
  },
];
