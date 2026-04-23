import {
  buildReminderDraft,
  getDaysOverdue,
  getFollowUpStage,
  rankInvoicesForFollowUp,
  scoreInvoiceForFollowUp,
  summarizeFollowUpQueue,
  type FollowUpInvoice,
} from '../../dashboard/lib/invoiceFollowUp';

describe('invoiceFollowUp', () => {
  const now = new Date('2026-04-14T00:00:00.000Z');

  const baseInvoice: FollowUpInvoice = {
    id: 'inv-1',
    customerName: 'Atlas Rehab',
    amountDue: 1000,
    currency: 'USD',
    dueDate: '2026-04-10',
    contactChannel: 'email',
    contactTarget: 'ops@atlasrehab.example',
    invoiceRef: 'ACE-3001',
    lastContactedAt: null,
    lastOutcome: 'none',
    promisedPaymentDate: null,
  };

  it('computes days overdue from the due date', () => {
    expect(getDaysOverdue('2026-04-14', now)).toBe(0);
    expect(getDaysOverdue('2026-04-11', now)).toBe(3);
    expect(getDaysOverdue('2026-03-31', now)).toBe(14);
  });

  it('maps overdue age into the correct follow-up stage', () => {
    expect(getFollowUpStage(0)).toBe('due_today');
    expect(getFollowUpStage(3)).toBe('overdue_3d');
    expect(getFollowUpStage(7)).toBe('overdue_7d');
    expect(getFollowUpStage(14)).toBe('overdue_14d_plus');
  });

  it('boosts urgency when a promised payment date is missed', () => {
    const promised = {
      ...baseInvoice,
      promisedPaymentDate: '2026-04-12',
      lastOutcome: 'promised_to_pay' as const,
    };
    expect(scoreInvoiceForFollowUp(promised, now)).toBeGreaterThan(
      scoreInvoiceForFollowUp(baseInvoice, now),
    );
  });

  it('generates a stage-specific reminder draft', () => {
    const draft = buildReminderDraft(
      {
        ...baseInvoice,
        dueDate: '2026-03-29',
      },
      16,
    );

    expect(draft.subject).toContain('Urgent');
    expect(draft.body).toContain('16 days overdue');
    expect(draft.body).toContain('ACE-3001');
  });

  it('ranks invoices by urgency score and amount', () => {
    const ranked = rankInvoicesForFollowUp(
      [
        baseInvoice,
        {
          ...baseInvoice,
          id: 'inv-2',
          customerName: 'Beacon Physio',
          amountDue: 1500,
          dueDate: '2026-04-01',
          promisedPaymentDate: '2026-04-11',
          lastOutcome: 'promised_to_pay',
          lastContactedAt: '2026-04-10',
        },
      ],
      now,
    );

    expect(ranked[0].id).toBe('inv-2');
    expect(ranked[0].stage).toBe('overdue_7d');
    expect(ranked[1].id).toBe('inv-1');
  });

  it('summarizes the queue with top priority and overdue total', () => {
    const summary = summarizeFollowUpQueue(
      [
        baseInvoice,
        {
          ...baseInvoice,
          id: 'inv-3',
          customerName: 'Cedar Care',
          amountDue: 400,
          dueDate: '2026-04-14',
        },
      ],
      now,
    );

    expect(summary.totalInvoices).toBe(2);
    expect(summary.overdueCount).toBe(1);
    expect(summary.overdueAmount).toBe(1400);
    expect(summary.topPriority?.id).toBe('inv-1');
  });
});
