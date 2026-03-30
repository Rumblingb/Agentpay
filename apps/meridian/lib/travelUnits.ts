import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  units: 'meridian.travelUnits',
  preferredUnitId: 'meridian.preferredTravelUnitId',
} as const;

export type TravelUnitType = 'couple' | 'family' | 'household';
export type TravelUnitMemberRole = 'self' | 'partner' | 'adult' | 'child' | 'infant';
export type TravelUnitMemberState = 'self' | 'linked' | 'pending' | 'guest';

export interface TravelUnitMember {
  id: string;
  name: string;
  role: TravelUnitMemberRole;
  state: TravelUnitMemberState;
  contact?: string;
  linkedAgentId?: string | null;
  inviteToken?: string | null;
  inviteId?: string | null;
}

export interface TravelUnit {
  id: string;
  name: string;
  type: TravelUnitType;
  members: TravelUnitMember[];
  primaryPayerMemberId?: string | null;
  notes?: string;
  remoteUnitId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TravelUnitSummary {
  totalUnits: number;
  totalMembers: number;
  linkedMembers: number;
  pendingMembers: number;
  preferredUnitName?: string | null;
}

function canBePayer(member: TravelUnitMember): boolean {
  return member.role === 'self' || member.role === 'partner' || member.role === 'adult';
}

function normalizeUnit(unit: TravelUnit): TravelUnit {
  const rawMembers: TravelUnitMember[] = (unit.members ?? []).map((member) => ({
    ...member,
    name: member.name.trim(),
    contact: member.contact?.trim() || '',
  }));
  const members = rawMembers.filter((member) => member.name.length > 0);
  const selfIndex = members.findIndex((member) => member.role === 'self');
  const nextMembers: TravelUnitMember[] = members.map((member, index) => {
    const role: TravelUnitMemberRole = member.role === 'self' && index !== selfIndex ? 'partner' : member.role;
    const state: TravelUnitMemberState =
      role === 'self'
        ? 'self'
        : role === 'child' || role === 'infant'
          ? 'guest'
          : member.state === 'self'
            ? 'guest'
            : member.state;
    return {
      ...member,
      role,
      state,
    };
  });
  const withOwner = selfIndex === -1 && nextMembers[0]
    ? [{ ...nextMembers[0], role: 'self' as const, state: 'self' as const }, ...nextMembers.slice(1)]
    : nextMembers;
  const validPayer = withOwner.find((member) => member.id === unit.primaryPayerMemberId && canBePayer(member));
  const fallbackPayer = withOwner.find(canBePayer)?.id ?? null;
  return {
    ...unit,
    name: unit.name.trim(),
    members: withOwner,
    primaryPayerMemberId: validPayer?.id ?? fallbackPayer,
    updatedAt: unit.updatedAt || new Date().toISOString(),
  };
}

export function makeTravelUnitId(): string {
  return `tu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function makeTravelUnitMemberId(): string {
  return `tum_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export async function loadTravelUnits(): Promise<TravelUnit[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.units);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TravelUnit[];
    return parsed.map(normalizeUnit);
  } catch {
    return [];
  }
}

async function persistTravelUnits(units: TravelUnit[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.units, JSON.stringify(units.map(normalizeUnit)));
}

export async function saveTravelUnit(unit: TravelUnit): Promise<void> {
  const units = await loadTravelUnits();
  const normalized = normalizeUnit(unit);
  const next = units.filter((item) => item.id !== normalized.id);
  next.unshift(normalized);
  await persistTravelUnits(next);
}

export async function deleteTravelUnit(id: string): Promise<void> {
  const units = await loadTravelUnits();
  await persistTravelUnits(units.filter((unit) => unit.id !== id));

  const preferredUnitId = await loadPreferredTravelUnitId();
  if (preferredUnitId === id) {
    await clearPreferredTravelUnitId();
  }
}

export async function clearTravelUnits(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(KEYS.units),
    AsyncStorage.removeItem(KEYS.preferredUnitId),
  ]);
}

export async function loadPreferredTravelUnitId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEYS.preferredUnitId);
  } catch {
    return null;
  }
}

export async function savePreferredTravelUnitId(id: string | null): Promise<void> {
  if (!id) {
    await clearPreferredTravelUnitId();
    return;
  }
  await AsyncStorage.setItem(KEYS.preferredUnitId, id);
}

export async function clearPreferredTravelUnitId(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.preferredUnitId);
}

export async function loadTravelUnitSummary(): Promise<TravelUnitSummary> {
  const [units, preferredUnitId] = await Promise.all([
    loadTravelUnits(),
    loadPreferredTravelUnitId(),
  ]);

  const members = units.flatMap((unit) => unit.members);
  return {
    totalUnits: units.length,
    totalMembers: members.length,
    linkedMembers: members.filter((member) => member.state === 'linked').length,
    pendingMembers: members.filter((member) => member.state === 'pending').length,
    preferredUnitName: units.find((unit) => unit.id === preferredUnitId)?.name ?? null,
  };
}

export async function loadPreferredTravelUnit(): Promise<TravelUnit | null> {
  const [units, preferredUnitId] = await Promise.all([
    loadTravelUnits(),
    loadPreferredTravelUnitId(),
  ]);
  if (!preferredUnitId) return null;
  return units.find((unit) => unit.id === preferredUnitId) ?? null;
}
