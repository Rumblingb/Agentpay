/**
 * profile.ts — encrypted travel profile (biometric-gated)
 *
 * Storage: expo-secure-store (iOS Keychain / Android Keystore).
 * Access: biometric authentication required to read or write.
 *
 * Profile data is NEVER sent to AgentPay servers at rest.
 * It is shared only with a hired agent, for a specific booking,
 * when the user explicitly confirms the hire.
 */

import * as SecureStore from 'expo-secure-store';
import { authenticateWithBiometrics } from './biometric';

const PROFILE_KEY = 'meridian.travel_profile';
const CONSENTS_KEY = 'meridian.privacy_consents';

// ── Types ─────────────────────────────────────────────────────────────────

export type Nationality = 'uk' | 'india' | 'other';
export type DocumentType = 'passport' | 'aadhaar' | 'driving_licence' | 'national_id';
export type SeatPref = 'window' | 'aisle' | 'no_preference';
export type ClassPref = 'economy' | 'standard' | 'business';

/** UK railcard type — determines discount eligibility (~1/3 off most fares) */
export type RailcardType =
  | '16-25'
  | '26-30'
  | 'senior'
  | 'two-together'
  | 'family'
  | 'network'
  | 'disabled'
  | 'hm-forces'
  | 'none';

/** India class tier — mapped to IRCTC class code based on journey duration */
export type IndiaClassTier = 'budget' | 'standard' | 'premium';

/** A family / travel companion stored on the profile */
export interface FamilyMember {
  id: string;                       // uuid — for edits/deletes
  name: string;                     // First name used in voice (e.g. "Maya")
  relationship: 'adult' | 'child' | 'infant';
  dateOfBirth?: string;             // YYYY-MM-DD — required for child pricing + flights
  railcard?: RailcardType;          // e.g. 'senior' for Dad
  documentNumber?: string;          // passport / ID for international flights
  documentExpiry?: string;          // YYYY-MM-DD
  nationality?: Nationality;
}

export interface TravelProfile {
  // Identity
  legalName: string;
  dateOfBirth: string;       // YYYY-MM-DD
  nationality: Nationality;

  // Contact — for booking confirmation
  phone: string;             // E.164 format: +447… / +91…
  email: string;

  // Travel document
  documentType: DocumentType;
  documentNumber: string;    // encrypted in secure store
  documentExpiry?: string;   // YYYY-MM-DD — for passport validity

  // Travel preferences
  seatPreference: SeatPref;
  classPreference: ClassPref;

  // Region-specific extras (optional)
  railcardType?: RailcardType;   // UK: type of railcard held (~1/3 off most fares)
  indiaClassTier?: IndiaClassTier; // India: preferred class tier (budget/standard/premium)
  irctcId?: string;              // India: IRCTC user ID for faster booking
  upiId?: string;                // India: UPI ID (e.g. name@upi) for payment

  // India Rail credentials (optional — stored encrypted, biometric gated)
  irctcUsername?: string;    // IRCTC login username — used to book ticket under user's account
  irctcPassword?: string;    // IRCTC login password — encrypted in SecureStore, never logged server-side

  // Notification preferences (optional)
  whatsappNumber?: string;   // E.164 format (+447… / +91…) — booking confirmations via WhatsApp

  // Family / travel companions
  familyMembers?: FamilyMember[];

  // Metadata
  savedAt: string;
}

export interface PrivacyConsents {
  profileConsented: boolean;   // accepted the privacy terms
  locationConsented: boolean;  // agreed to "nearby station" location use
  notificationsConsented: boolean;
  consentedAt: string;
}

// ── Profile CRUD ──────────────────────────────────────────────────────────

/**
 * Save profile — requires biometric authentication.
 * Throws if auth fails.
 */
export async function saveProfile(profile: TravelProfile): Promise<void> {
  const authed = await authenticateWithBiometrics(
    'Authenticate to save your travel profile',
  );
  if (!authed) throw new Error('Authentication cancelled.');

  await SecureStore.setItemAsync(
    PROFILE_KEY,
    JSON.stringify({ ...profile, savedAt: new Date().toISOString() }),
  );
}

/**
 * Load profile without authentication.
 * Only call this in internal flows where auth was already done at a higher level.
 */
export async function loadProfileRaw(): Promise<TravelProfile | null> {
  try {
    const raw = await SecureStore.getItemAsync(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as TravelProfile) : null;
  } catch {
    return null;
  }
}

/**
 * Load profile — requires biometric authentication.
 * Returns null if auth fails or no profile stored.
 */
export async function loadProfileAuthenticated(): Promise<TravelProfile | null> {
  const authed = await authenticateWithBiometrics(
    'Confirm booking with your biometric',
  );
  if (!authed) return null;
  return loadProfileRaw();
}

export async function deleteProfile(): Promise<void> {
  await SecureStore.deleteItemAsync(PROFILE_KEY);
}

export async function hasProfile(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(PROFILE_KEY).catch(() => null);
  return !!raw;
}

// ── Privacy consents ──────────────────────────────────────────────────────

export async function saveConsents(consents: PrivacyConsents): Promise<void> {
  await SecureStore.setItemAsync(CONSENTS_KEY, JSON.stringify(consents));
}

export async function loadConsents(): Promise<PrivacyConsents | null> {
  try {
    const raw = await SecureStore.getItemAsync(CONSENTS_KEY);
    return raw ? (JSON.parse(raw) as PrivacyConsents) : null;
  } catch {
    return null;
  }
}

// ── Booking context builder ───────────────────────────────────────────────

export const RAILCARD_LABELS: Record<RailcardType, string> = {
  '16-25':        '16-25 Railcard',
  '26-30':        '26-30 Railcard',
  senior:         'Senior Railcard',
  'two-together': 'Two Together Railcard',
  family:         'Family & Friends Railcard',
  network:        'Network Railcard',
  disabled:       'Disabled Persons Railcard',
  'hm-forces':    'HM Forces Railcard',
  none:           'None',
};

export const INDIA_CLASS_LABELS: Record<IndiaClassTier, string> = {
  budget:   'Budget (SL/2S — non-AC, cheapest)',
  standard: 'Standard (3A/CC — AC, most popular)',
  premium:  'Premium (2A/1A — best AC)',
};

const NATIONALITY_LABELS: Record<Nationality, string> = {
  uk: 'British',
  india: 'Indian',
  other: 'Other',
};

const DOC_LABELS: Record<DocumentType, string> = {
  passport:        'Passport',
  aadhaar:         'Aadhaar Card',
  driving_licence: 'Driving Licence',
  national_id:     'National ID',
};

/**
 * Build a structured booking context string to include in the job description
 * sent to the hired agent. Contains all info the agent needs to complete a booking.
 */
export function buildBookingContext(profile: TravelProfile): string {
  const lines = [
    `TRAVELER PROFILE (shared for this booking only):`,
    `Name: ${profile.legalName}`,
    `Date of birth: ${profile.dateOfBirth}`,
    `Nationality: ${NATIONALITY_LABELS[profile.nationality]}`,
    `Phone: ${profile.phone}`,
    `Email: ${profile.email}`,
    `${DOC_LABELS[profile.documentType]}: ${profile.documentNumber}`,
    profile.documentExpiry ? `Document expiry: ${profile.documentExpiry}` : '',
    `Seat preference: ${profile.seatPreference.replace('_', ' ')}`,
    `Class preference: ${profile.classPreference}`,
    profile.railcardType && profile.railcardType !== 'none' ? `UK Railcard: ${RAILCARD_LABELS[profile.railcardType]}` : '',
    profile.indiaClassTier ? `India class preference: ${profile.indiaClassTier}` : '',
    profile.irctcId ? `IRCTC ID: ${profile.irctcId}` : '',
    profile.upiId ? `UPI ID: ${profile.upiId}` : '',
    `Send confirmation to: ${profile.email} and ${profile.phone}`,
  ].filter(Boolean);

  return lines.join('\n');
}

// ── Minimum-field scoping ─────────────────────────────────────────────────

/**
 * Skill → profile fields it is permitted to receive.
 * Mirrors the server-side `requiredProfileFields` in skills/index.ts.
 * The server enforces this too — this is a defence-in-depth client guard.
 */
const SKILL_PROFILE_FIELDS: Record<string, (keyof TravelProfile)[]> = {
  book_train:          ['legalName', 'email', 'phone', 'whatsappNumber', 'seatPreference', 'classPreference', 'railcardType'],
  book_train_india:    ['legalName', 'email', 'phone', 'whatsappNumber', 'seatPreference', 'classPreference', 'indiaClassTier', 'irctcId', 'irctcUsername', 'upiId'],
  book_taxi:      ['legalName', 'phone'],
  search_flights: ['legalName', 'email', 'phone', 'dateOfBirth', 'nationality', 'documentType', 'documentNumber', 'documentExpiry'],
  research:       [],
};

/**
 * Return only the profile fields the named skill is permitted to receive.
 * Pass this scoped object to the server — never the full profile.
 */
export function scopeProfile(
  toolName: string,
  profile: TravelProfile,
): Partial<TravelProfile> {
  const allowed = SKILL_PROFILE_FIELDS[toolName] ?? [];
  if (allowed.length === 0) return {};
  return Object.fromEntries(
    allowed
      .filter(f => profile[f] !== undefined && profile[f] !== null && profile[f] !== '')
      .map(f => [f, profile[f]]),
  ) as Partial<TravelProfile>;
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function defaultDocumentType(nationality: Nationality): DocumentType {
  if (nationality === 'india') return 'aadhaar';
  return 'passport';
}

export function documentTypeOptions(nationality: Nationality): DocumentType[] {
  if (nationality === 'uk') return ['passport', 'driving_licence'];
  if (nationality === 'india') return ['aadhaar', 'passport'];
  return ['passport', 'national_id'];
}

// ── Family member helpers ─────────────────────────────────────────────────

export function makeFamilyMemberId(): string {
  return `fm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Auto-detect whether Family Railcard applies.
 * UK Family & Friends Railcard: 2 adults + 1–4 children → 1/3 off adults, 60% off children.
 */
export function shouldApplyFamilyRailcard(profile: TravelProfile): boolean {
  const members = profile.familyMembers ?? [];
  const adults   = members.filter(m => m.relationship === 'adult').length + 1; // +1 for self
  const children = members.filter(m => m.relationship === 'child').length;
  return adults >= 2 && children >= 1 && children <= 4;
}

/**
 * Build a compact family context string for Claude's system prompt.
 * Safe to send in Phase 1 — no document numbers, just travel metadata.
 */
export function buildFamilyContext(profile: TravelProfile): string {
  const members = profile.familyMembers;
  if (!members || members.length === 0) return '';
  const lines = members.map(m => {
    const parts = [`${m.name} (${m.relationship}`];
    if (m.dateOfBirth) {
      const age = Math.floor((Date.now() - new Date(m.dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000));
      parts[0] += `, age ${age}`;
    }
    parts[0] += ')';
    if (m.railcard && m.railcard !== 'none') parts.push(`railcard: ${m.railcard}`);
    return parts.join(', ');
  });
  return `User's family / travel companions: ${lines.join('; ')}.`;
}
