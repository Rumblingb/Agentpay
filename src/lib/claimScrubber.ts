// Server-side claim scrubbing: simple, auditable rules for CPT/ICD + basic validation

const cpt = [
  { code: '99213', desc: 'Office/outpatient visit, established patient' },
  { code: '99214', desc: 'Office/outpatient visit, moderate complexity' },
  { code: '93000', desc: 'Electrocardiogram' },
];

const icd = [
  { code: 'R51', desc: 'Headache' },
  { code: 'I10', desc: 'Essential (primary) hypertension' },
  { code: 'E11.9', desc: 'Type 2 diabetes mellitus without complications' },
];

export type ScrubResult = {
  ok: boolean;
  status: 'clean' | 'unknown_code' | 'invalid' | 'flagged';
  reason?: string;
  normalizedCode?: string;
};

function findCode(code: string | undefined): { type: 'cpt' | 'icd' | null; match?: string } {
  if (!code) return { type: null };
  const raw = String(code).trim().toUpperCase();
  if (!raw) return { type: null };

  const c = cpt.find((x) => raw.startsWith(x.code));
  if (c) return { type: 'cpt', match: c.code };
  const i = icd.find((x) => raw.startsWith(x.code));
  if (i) return { type: 'icd', match: i.code };
  return { type: null };
}

export function scrubClaimServer(input: { patient?: string; amount?: unknown; code?: string | undefined }): ScrubResult {
  const patient = typeof input.patient === 'string' ? input.patient.trim() : '';
  if (!patient || patient.length < 2) return { ok: false, status: 'invalid', reason: 'patient_name_missing' };

  const amount = typeof input.amount === 'number' ? input.amount : typeof input.amount === 'string' && input.amount.trim() !== '' ? Number(input.amount) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, status: 'invalid', reason: 'invalid_amount' };

  const codeCheck = findCode(input.code);
  if (!codeCheck.type) {
    return { ok: true, status: 'unknown_code', reason: 'code_not_in_local_list', normalizedCode: input.code };
  }

  return { ok: true, status: 'clean', normalizedCode: codeCheck.match };
}

export default { scrubClaimServer };
