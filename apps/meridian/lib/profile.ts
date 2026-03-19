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
  railcardNumber?: string;   // UK: 16-25, Senior, Network railcard
  irctcId?: string;          // India: IRCTC user ID for faster booking

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
    profile.railcardNumber ? `UK Railcard: ${profile.railcardNumber}` : '',
    profile.irctcId ? `IRCTC ID: ${profile.irctcId}` : '',
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
  book_train:     ['legalName', 'email', 'phone', 'seatPreference', 'classPreference', 'railcardNumber'],
  book_hotel:     ['legalName', 'email', 'phone'],
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
