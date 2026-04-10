import type { Env } from '../types';

export interface NpiLookupResult {
  npi: string;
  entityType: 'individual' | 'organization';
  name: string;
  credential: string | null;
  primaryTaxonomy: string | null;
  address: string | null;
  active: boolean;
}

/** Free CMS NPPES registry lookup — no API key required */
export async function lookupNpi(npi: string): Promise<NpiLookupResult | null> {
  const res = await fetch(
    `https://npiregistry.cms.hhs.gov/api/?number=${encodeURIComponent(npi)}&version=2.1`,
    { signal: AbortSignal.timeout(8_000) }
  );
  if (!res.ok) return null;
  const data = await res.json() as any;
  if (!data.result_count || data.result_count === 0) return null;
  const r = data.results[0];
  const basic = r.basic ?? {};
  const name = basic.organization_name
    ? basic.organization_name
    : [basic.first_name, basic.last_name].filter(Boolean).join(' ');
  const taxonomy = (r.taxonomies ?? []).find((t: any) => t.primary);
  const addr = (r.addresses ?? [])[0];
  return {
    npi,
    entityType: r.enumeration_type === 'NPI-1' ? 'individual' : 'organization',
    name: name ?? npi,
    credential: basic.credential ?? null,
    primaryTaxonomy: taxonomy?.desc ?? null,
    address: addr ? [addr.address_1, addr.city, addr.state, addr.postal_code].filter(Boolean).join(', ') : null,
    active: basic.status === 'A',
  };
}

export interface AvailityTokenResponse { access_token: string; expires_in: number }
export interface AvailityEligibilityResult {
  memberId: string;
  payerId: string;
  status: 'active' | 'inactive' | 'unknown';
  coverageType: string | null;
  planName: string | null;
  deductibleRemaining: number | null;
  copay: number | null;
  rawResponse?: unknown;
}

/** Availity Real-Time Eligibility & Benefits — requires AVAILITY_CLIENT_ID + AVAILITY_CLIENT_SECRET */
export async function checkAvailityEligibility(
  env: Env,
  params: { memberId: string; payerId: string; npi: string; dateOfService?: string }
): Promise<AvailityEligibilityResult> {
  if (!env.AVAILITY_CLIENT_ID || !env.AVAILITY_CLIENT_SECRET) {
    throw new Error('Availity credentials not configured');
  }

  // Step 1: Get OAuth2 token
  const tokenRes = await fetch('https://api.availity.com/availity/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.AVAILITY_CLIENT_ID,
      client_secret: env.AVAILITY_CLIENT_SECRET,
      scope: 'hipaa',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) throw new Error(`Availity token error: ${tokenRes.status}`);
  const tokenData = await tokenRes.json() as AvailityTokenResponse;

  // Step 2: Real-time eligibility inquiry (X12 270/271)
  const eligRes = await fetch('https://api.availity.com/availity/v1/eligibility-and-benefits-inquiries', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payerId: params.payerId,
      memberId: params.memberId,
      npi: params.npi,
      serviceTypeCodes: ['30'], // 30 = Health Benefit Plan Coverage
      dateOfService: params.dateOfService ?? new Date().toISOString().split('T')[0],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!eligRes.ok) throw new Error(`Availity eligibility error: ${eligRes.status}`);
  const eligData = await eligRes.json() as Record<string, unknown>;

  // Parse the 271 response (simplified — real parsing is deeply nested X12 structure)
  const benefits = (eligData.benefitsInformation as Array<Record<string, unknown>> | undefined) ?? [];
  const activeBenefit = benefits.find((b) => b.code === '1'); // Code 1 = active coverage

  return {
    memberId: params.memberId,
    payerId: params.payerId,
    status: activeBenefit ? 'active' : 'inactive',
    coverageType: (eligData.serviceType as string) ?? null,
    planName: (eligData.planDescription as string) ?? null,
    deductibleRemaining: null, // requires deeper 271 parsing
    copay: null,
    rawResponse: eligData,
  };
}
