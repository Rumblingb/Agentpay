import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { C } from '../../lib/theme';
import { loadCredentials } from '../../lib/storage';
import { acceptSharedTravelInvite, createSharedTravelInvite, listSharedTravelUnits, type SharedTravelRemoteUnit } from '../../lib/api';
import {
  type TravelUnit,
  type TravelUnitMember,
  type TravelUnitMemberRole,
  type TravelUnitMemberState,
  type TravelUnitType,
  clearPreferredTravelUnitId,
  deleteTravelUnit,
  loadPreferredTravelUnitId,
  loadTravelUnits,
  makeTravelUnitId,
  makeTravelUnitMemberId,
  savePreferredTravelUnitId,
  saveTravelUnit,
} from '../../lib/travelUnits';

const UNIT_TYPES: { label: string; value: TravelUnitType }[] = [
  { label: 'Couple', value: 'couple' },
  { label: 'Family', value: 'family' },
  { label: 'Household', value: 'household' },
];

const MEMBER_ROLES: { label: string; value: TravelUnitMemberRole }[] = [
  { label: 'You', value: 'self' },
  { label: 'Partner', value: 'partner' },
  { label: 'Adult', value: 'adult' },
  { label: 'Child', value: 'child' },
  { label: 'Infant', value: 'infant' },
];

const MEMBER_STATES: { label: string; value: TravelUnitMemberState }[] = [
  { label: 'Linked Ace user', value: 'linked' },
  { label: 'Invite pending', value: 'pending' },
  { label: 'Guest only', value: 'guest' },
];

function canBePayer(member: TravelUnitMember): boolean {
  return member.role === 'self' || member.role === 'partner' || member.role === 'adult';
}

function makeBlankMember(role: TravelUnitMemberRole = 'partner'): TravelUnitMember {
  return {
    id: makeTravelUnitMemberId(),
    name: '',
    role,
    state: role === 'self' ? 'self' : 'guest',
    contact: '',
  };
}

function makeBlankUnit(): TravelUnit {
  const selfMember = makeBlankMember('self');
  return {
    id: makeTravelUnitId(),
    name: 'Us',
    type: 'couple',
    members: [selfMember, makeBlankMember('partner')],
    primaryPayerMemberId: selfMember.id,
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function summarizeUnit(unit: TravelUnit): string {
  const namedMembers = unit.members.filter((member) => member.name.trim());
  const linked = namedMembers.filter((member) => member.state === 'linked').length;
  const pending = namedMembers.filter((member) => member.state === 'pending').length;
  const count = namedMembers.length || unit.members.length;
  const base = `${count} member${count === 1 ? '' : 's'}`;
  if (linked > 0) return `${base} ready, ${linked} linked`;
  if (pending > 0) return `${base}, ${pending} invite pending`;
  return `${base} ready for shared planning`;
}

function inviteQrUrl(inviteToken: string) {
  const url = Linking.createURL('/(main)/travel-together', { queryParams: { invite: inviteToken } });
  return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(url)}&format=png&margin=2`;
}

export default function TravelTogetherScreen() {
  const params = useLocalSearchParams<{ invite?: string }>();
  const [units, setUnits] = useState<TravelUnit[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preferredId, setPreferredId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [agentCreds, setAgentCreds] = useState<{ agentId: string; agentKey: string } | null>(null);
  const [inviteTokenDraft, setInviteTokenDraft] = useState('');
  const [remoteNotice, setRemoteNotice] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteUnits, setRemoteUnits] = useState<SharedTravelRemoteUnit[]>([]);

  const refresh = useCallback(() => {
    void Promise.all([loadTravelUnits(), loadPreferredTravelUnitId(), loadCredentials()])
      .then(async ([loadedUnits, loadedPreferredId, creds]) => {
        const nextUnits = loadedUnits.length > 0 ? loadedUnits : [makeBlankUnit()];
        setUnits(nextUnits);
        setPreferredId(loadedPreferredId);
        setAgentCreds(creds);
        setSelectedId((current) => current && nextUnits.some((unit) => unit.id === current) ? current : nextUnits[0]?.id ?? null);

        if (creds) {
          const remote = await listSharedTravelUnits(creds).catch(() => ({ units: [] as SharedTravelRemoteUnit[] }));
          setRemoteUnits(remote.units);
        } else {
          setRemoteUnits([]);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const incomingInvite = typeof params.invite === 'string' ? params.invite.trim() : '';
    if (incomingInvite && incomingInvite !== inviteTokenDraft) {
      setInviteTokenDraft(incomingInvite);
      setRemoteNotice('Ace picked up the invite from the link. Accept it below to travel together.');
    }
  }, [inviteTokenDraft, params.invite]);

  const selectedUnit = useMemo(
    () => units.find((unit) => unit.id === selectedId) ?? null,
    [selectedId, units],
  );

  const updateSelectedUnit = useCallback((updater: (current: TravelUnit) => TravelUnit) => {
    setUnits((current) =>
      current.map((unit) => {
        if (unit.id !== selectedId) return unit;
        return updater(unit);
      }),
    );
  }, [selectedId]);

  const replaceSelectedUnit = useCallback((nextUnit: TravelUnit) => {
    setUnits((current) => {
      const exists = current.some((unit) => unit.id === nextUnit.id);
      if (!exists) return [nextUnit, ...current];
      return current.map((unit) => unit.id === nextUnit.id ? nextUnit : unit);
    });
    setSelectedId(nextUnit.id);
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedUnit) return;

    const trimmedName = selectedUnit.name.trim();
    const namedMembers = selectedUnit.members.filter((member) => member.name.trim());
    const ownerCount = selectedUnit.members.filter((member) => member.role === 'self').length;

    if (!trimmedName) {
      Alert.alert('Name this shared group', 'Give this couple or household a name so Ace can recognise it quickly.');
      return;
    }

    if (namedMembers.length < 2) {
      Alert.alert('Add at least two people', 'Ace needs two named members before it can treat this as shared travel.');
      return;
    }

    if (ownerCount !== 1) {
      Alert.alert('Keep one account owner', 'Each shared travel unit should have one `You` member on this device.');
      return;
    }

    if (selectedUnit.type === 'couple' && namedMembers.length > 2) {
      Alert.alert('Keep couple mode to two people', 'Use Family or Household if you want Ace to handle more than two people together.');
      return;
    }

    setSaving(true);
    try {
      const nextUnit: TravelUnit = {
        ...selectedUnit,
        name: trimmedName,
        members: selectedUnit.members.map((member) => ({
          ...member,
          name: member.name.trim(),
          contact: member.contact?.trim() || '',
        })),
        updatedAt: new Date().toISOString(),
      };
      await saveTravelUnit(nextUnit);
      replaceSelectedUnit(nextUnit);
      if (preferredId === nextUnit.id) {
        await savePreferredTravelUnitId(nextUnit.id);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      setRemoteNotice('Saved on this device.');
    } finally {
      setSaving(false);
    }
  }, [preferredId, replaceSelectedUnit, selectedUnit]);

  const handleCreate = useCallback(() => {
    const unit = makeBlankUnit();
    setUnits((current) => [unit, ...current]);
    setSelectedId(unit.id);
  }, []);

  const handleDelete = useCallback(() => {
    if (!selectedUnit) return;
    Alert.alert(
      'Delete shared travel unit',
      `Remove ${selectedUnit.name || 'this group'} from Ace? This will not affect your saved family members.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteTravelUnit(selectedUnit.id);
            refresh();
          },
        },
      ],
    );
  }, [refresh, selectedUnit]);

  const handlePreferredToggle = useCallback(async () => {
    if (!selectedUnit) return;
    const nextPreferredId = preferredId === selectedUnit.id ? null : selectedUnit.id;
    setPreferredId(nextPreferredId);
    if (nextPreferredId) {
      await savePreferredTravelUnitId(nextPreferredId);
      return;
    }
    await clearPreferredTravelUnitId();
  }, [preferredId, selectedUnit]);

  const addMember = useCallback(() => {
    if (selectedUnit?.type === 'couple' && selectedUnit.members.length >= 2) {
      Alert.alert('Couple mode is for two people', 'Switch this unit to Family or Household if you want to add more members.');
      return;
    }
    updateSelectedUnit((current) => ({
      ...current,
      members: [...current.members, makeBlankMember(current.type === 'couple' ? 'partner' : 'adult')],
    }));
  }, [selectedUnit?.members.length, selectedUnit?.type, updateSelectedUnit]);

  const updateMember = useCallback((memberId: string, updater: (member: TravelUnitMember) => TravelUnitMember) => {
    updateSelectedUnit((current) => ({
      ...current,
      members: current.members.map((member) => member.id === memberId ? updater(member) : member),
    }));
  }, [updateSelectedUnit]);

  const removeMember = useCallback((memberId: string) => {
    updateSelectedUnit((current) => {
      const nextMembers = current.members.filter((member) => member.id !== memberId);
      return {
        ...current,
        members: nextMembers,
        primaryPayerMemberId: nextMembers.some((member) => member.id === current.primaryPayerMemberId)
          ? current.primaryPayerMemberId
          : nextMembers[0]?.id ?? null,
      };
    });
  }, [updateSelectedUnit]);

  const handleSendInvite = useCallback(async (member: TravelUnitMember) => {
    if (!selectedUnit || !agentCreds) {
      Alert.alert('Ace account not ready', 'Ace needs this account identity before it can create a shared travel invite.');
      return;
    }
    if (!member.contact?.trim()) {
      Alert.alert('Add a contact first', 'Add the other traveller’s phone number or email so Ace can prepare the invite.');
      return;
    }
    if (member.role === 'child' || member.role === 'infant') {
      Alert.alert('Invite adults directly', 'Children should stay inside the family unit. Link the adult traveller account instead.');
      return;
    }

    setRemoteBusy(true);
    try {
      const result = await createSharedTravelInvite({
        agentId: agentCreds.agentId,
        agentKey: agentCreds.agentKey,
        unitName: selectedUnit.name,
        unitType: selectedUnit.type,
        inviteeContact: member.contact,
        inviteeName: member.name,
        role: member.role === 'partner' ? 'partner' : 'adult',
        notes: selectedUnit.notes,
        primaryPayerAgentId: agentCreds.agentId,
      });

      const nextUnit: TravelUnit = {
        ...selectedUnit,
        remoteUnitId: result.unitId,
        updatedAt: new Date().toISOString(),
        members: selectedUnit.members.map((item) => item.id === member.id ? {
          ...item,
          state: 'pending',
          inviteId: result.inviteId,
          inviteToken: result.inviteToken,
        } : item),
      };
      await saveTravelUnit(nextUnit);
      replaceSelectedUnit(nextUnit);
      setRemoteNotice(`Invite ready for ${member.name}. Show the QR or share the token on their Ace account.`);
    } catch (e: any) {
      Alert.alert('Could not create invite', e?.message ?? 'Please try again in a moment.');
    } finally {
      setRemoteBusy(false);
    }
  }, [agentCreds, replaceSelectedUnit, selectedUnit]);

  const handleAcceptInvite = useCallback(async () => {
    const token = inviteTokenDraft.trim();
    if (!token) {
      Alert.alert('Add the invite token', 'Paste the shared-travel token from the other Ace account.');
      return;
    }
    if (!agentCreds) {
      Alert.alert('Ace account not ready', 'This device needs a registered Ace account before it can accept shared travel invites.');
      return;
    }

    setRemoteBusy(true);
    try {
      const result = await acceptSharedTravelInvite({
        inviteToken: token,
        agentId: agentCreds.agentId,
        agentKey: agentCreds.agentKey,
      });

      const selfMember = makeBlankMember('self');
      selfMember.name = 'You';
      const linkedRole = result.role === 'partner' ? 'partner' : 'adult';
      const linkedMember = makeBlankMember(linkedRole);
      linkedMember.name = result.inviterName?.trim() || 'Linked traveller';
      linkedMember.state = 'linked';
      linkedMember.linkedAgentId = result.inviterAgentId;

      const nextUnit: TravelUnit = {
        id: makeTravelUnitId(),
        name: result.unitName,
        type: result.unitType,
        members: [selfMember, linkedMember],
        primaryPayerMemberId: selfMember.id,
        notes: '',
        remoteUnitId: result.unitId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await saveTravelUnit(nextUnit);
      await savePreferredTravelUnitId(nextUnit.id);
      replaceSelectedUnit(nextUnit);
      setPreferredId(nextUnit.id);
      setInviteTokenDraft('');
      setRemoteNotice(`${result.unitName} is now linked on this device.`);
      refresh();
    } catch (e: any) {
      Alert.alert('Could not accept invite', e?.message ?? 'Please check the token and try again.');
    } finally {
      setRemoteBusy(false);
    }
  }, [agentCreds, inviteTokenDraft, refresh, replaceSelectedUnit]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={C.textMuted} />
          </Pressable>
          <Text style={styles.title}>Couple & Household</Text>
          <Pressable onPress={() => { void handleSave(); }} disabled={saving} hitSlop={12}>
            <Text style={[styles.saveBtn, saved && styles.saveBtnDone]}>
              {saving ? '...' : saved ? 'Saved' : 'Save'}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.subtitle}>
          Give Ace a shared travel unit for the people who move together often. This keeps couple and family travel feeling like one request, not a form every time.
        </Text>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>What this unlocks next</Text>
          <Text style={styles.infoBody}>
            Ace can start reasoning about `us`, preferred payers, and family-safe routes now. Real account linking and mutual approval can plug into this later without changing the experience.
          </Text>
        </View>

        <View style={styles.linkCard}>
          <Text style={styles.linkTitle}>Link another Ace account</Text>
          <Text style={styles.linkBody}>
            Invite the other traveller from a member card below, or accept a token here on the invited device. If both phones are with you, a quick scan is enough.
          </Text>
          <TextInput
            style={styles.input}
            value={inviteTokenDraft}
            onChangeText={setInviteTokenDraft}
            placeholder="Paste shared-travel token"
            placeholderTextColor={C.textMuted}
            autoCapitalize="none"
          />
          <View style={styles.linkActions}>
            <Pressable onPress={() => { void handleAcceptInvite(); }} style={styles.linkPrimaryBtn} disabled={remoteBusy}>
              <Text style={styles.linkPrimaryBtnText}>{remoteBusy ? 'Working...' : 'Accept token'}</Text>
            </Pressable>
            <Pressable onPress={refresh} style={styles.linkSecondaryBtn} disabled={remoteBusy}>
              <Text style={styles.linkSecondaryBtnText}>Sync</Text>
            </Pressable>
          </View>
          {!!remoteNotice && <Text style={styles.linkNotice}>{remoteNotice}</Text>}
          {remoteUnits.length > 0 && (
            <Text style={styles.linkMeta}>
              {remoteUnits.length} linked unit{remoteUnits.length === 1 ? '' : 's'} visible on the backend for this Ace account.
            </Text>
          )}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>Shared units</Text>
          <Pressable onPress={handleCreate} style={styles.addInlineBtn}>
            <Ionicons name="add" size={14} color={C.sky} />
            <Text style={styles.addInlineText}>New</Text>
          </Pressable>
        </View>

        {loading ? (
          <Text style={styles.loadingText}>Loading...</Text>
        ) : (
          units.map((unit) => (
            <Pressable
              key={unit.id}
              onPress={() => setSelectedId(unit.id)}
              style={[styles.unitCard, selectedId === unit.id && styles.unitCardActive]}
            >
              <View style={styles.unitCardHeader}>
                <Text style={styles.unitCardTitle}>{unit.name || 'Untitled unit'}</Text>
                {preferredId === unit.id && (
                  <View style={styles.preferredBadge}>
                    <Text style={styles.preferredBadgeText}>Usual</Text>
                  </View>
                )}
              </View>
              <Text style={styles.unitCardMeta}>{UNIT_TYPES.find((item) => item.value === unit.type)?.label}</Text>
              <Text style={styles.unitCardBody}>{summarizeUnit(unit)}</Text>
            </Pressable>
          ))
        )}

        {selectedUnit ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>Selected unit</Text>
              <Pressable onPress={handleDelete} hitSlop={8}>
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </View>

            <View style={styles.editorCard}>
              <Text style={styles.fieldLabel}>Unit name</Text>
              <TextInput
                style={styles.input}
                value={selectedUnit.name}
                onChangeText={(value) => updateSelectedUnit((current) => ({ ...current, name: value }))}
                placeholder="e.g. Me & Maya"
                placeholderTextColor={C.textMuted}
              />

              <Text style={styles.fieldLabel}>Type</Text>
              <View style={styles.pillRow}>
                {UNIT_TYPES.map((type) => (
                  <Pressable
                    key={type.value}
                    onPress={() => {
                      if (type.value === 'couple' && selectedUnit.members.length > 2) {
                        Alert.alert('Too many people for couple mode', 'Remove extra members or choose Family / Household instead.');
                        return;
                      }
                      updateSelectedUnit((current) => ({ ...current, type: type.value }));
                    }}
                    style={[styles.pill, selectedUnit.type === type.value && styles.pillActive]}
                  >
                    <Text style={[styles.pillText, selectedUnit.type === type.value && styles.pillTextActive]}>
                      {type.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Pressable onPress={() => { void handlePreferredToggle(); }} style={styles.preferredRow}>
                <View style={styles.preferredCopy}>
                  <Text style={styles.preferredTitle}>Make this the usual unit</Text>
                  <Text style={styles.preferredBody}>Ace can default to this when you say `book for us`.</Text>
                </View>
                <Ionicons
                  name={preferredId === selectedUnit.id ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={preferredId === selectedUnit.id ? C.green : C.textMuted}
                />
              </Pressable>

              <Text style={styles.fieldLabel}>Members</Text>
              {selectedUnit.members.map((member) => (
                <View key={member.id} style={styles.memberCard}>
                  <View style={styles.memberHeader}>
                    <Text style={styles.memberTitle}>{member.name.trim() || 'New member'}</Text>
                    {member.role !== 'self' ? (
                      <Pressable onPress={() => removeMember(member.id)} hitSlop={8}>
                        <Ionicons name="trash-outline" size={16} color={C.red} />
                      </Pressable>
                    ) : (
                      <View style={styles.selfBadge}>
                        <Text style={styles.selfBadgeText}>You</Text>
                      </View>
                    )}
                  </View>

                  <TextInput
                    style={styles.input}
                    value={member.name}
                    onChangeText={(value) => updateMember(member.id, (current) => ({ ...current, name: value }))}
                    placeholder={member.role === 'self' ? 'Your name' : 'Name'}
                    placeholderTextColor={C.textMuted}
                    autoCapitalize="words"
                  />

                  <Text style={styles.memberHint}>
                    {member.state === 'linked'
                      ? 'This person is treated as a real Ace account link.'
                      : member.state === 'pending'
                        ? 'Ace will treat this as a shared traveller once the invite is accepted.'
                        : member.state === 'guest'
                          ? 'Good for shared planning now. Mutual approvals can come later.'
                          : 'This stays on this device only.'}
                  </Text>

                  <Text style={styles.fieldLabel}>Role</Text>
                  <View style={styles.pillRow}>
                    {MEMBER_ROLES.map((role) => (
                      <Pressable
                        key={role.value}
                        onPress={() => {
                          if (role.value === 'self') {
                            updateSelectedUnit((current) => ({
                              ...current,
                              members: current.members.map((item) => {
                                if (item.id === member.id) {
                                  return {
                                    ...item,
                                    role: 'self',
                                    state: 'self',
                                  };
                                }
                                if (item.role === 'self') {
                                  return {
                                    ...item,
                                    role: 'adult',
                                    state: 'guest',
                                  };
                                }
                                return item;
                              }),
                            }));
                            return;
                          }

                          updateMember(member.id, (current) => ({
                            ...current,
                            role: role.value,
                            state:
                              role.value === 'child' || role.value === 'infant'
                                ? 'guest'
                                : current.state === 'self'
                                  ? 'guest'
                                  : current.state,
                          }));
                        }}
                        style={[styles.pill, member.role === role.value && styles.pillActive]}
                      >
                        <Text style={[styles.pillText, member.role === role.value && styles.pillTextActive]}>
                          {role.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {member.role !== 'self' ? (
                    <>
                      <Text style={styles.fieldLabel}>State</Text>
                      <View style={styles.pillRow}>
                        {MEMBER_STATES.map((state) => (
                          <Pressable
                            key={state.value}
                            onPress={() => updateMember(member.id, (current) => ({ ...current, state: state.value }))}
                            style={[styles.pill, member.state === state.value && styles.pillActive]}
                          >
                            <Text style={[styles.pillText, member.state === state.value && styles.pillTextActive]}>
                              {state.label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>

                      <Text style={styles.fieldLabel}>Phone or email (optional)</Text>
                      <TextInput
                        style={styles.input}
                        value={member.contact ?? ''}
                        onChangeText={(value) => updateMember(member.id, (current) => ({ ...current, contact: value }))}
                        placeholder="For future invite and linking"
                        placeholderTextColor={C.textMuted}
                        autoCapitalize="none"
                      />

                      <View style={styles.memberActionStack}>
                        <Pressable
                          onPress={() => { void handleSendInvite(member); }}
                          style={styles.memberLinkBtn}
                          disabled={remoteBusy}
                        >
                          <Ionicons name="paper-plane-outline" size={14} color="#f5d0fe" />
                          <Text style={styles.memberLinkBtnText}>
                            {member.state === 'pending' ? 'Refresh invite' : 'Send Ace invite'}
                          </Text>
                        </Pressable>
                        {!!member.inviteToken && (
                          <View style={styles.memberTokenCard}>
                            <Text style={styles.memberTokenLabel}>Invite token</Text>
                            <Text style={styles.memberTokenValue}>{member.inviteToken}</Text>
                            <View style={styles.memberQrWrap}>
                              <Image
                                source={{ uri: inviteQrUrl(member.inviteToken) }}
                                style={styles.memberQr}
                                resizeMode="contain"
                              />
                            </View>
                            <Text style={styles.memberQrHint}>
                              Open Ace on the other phone and scan this QR, or paste the token into the link box above.
                            </Text>
                          </View>
                        )}
                      </View>
                    </>
                  ) : null}

                  <Pressable
                    onPress={() => {
                      if (!canBePayer(member)) {
                        Alert.alert('Choose an adult payer', 'Ace should keep the usual payer on an adult or partner account.');
                        return;
                      }
                      updateSelectedUnit((current) => ({ ...current, primaryPayerMemberId: member.id }));
                    }}
                    style={[
                      styles.payerRow,
                      !canBePayer(member) && styles.payerRowDisabled,
                      selectedUnit.primaryPayerMemberId === member.id && styles.payerRowActive,
                    ]}
                  >
                    <Ionicons
                      name={selectedUnit.primaryPayerMemberId === member.id ? 'card' : 'card-outline'}
                      size={16}
                      color={
                        !canBePayer(member)
                          ? C.textMuted
                          : selectedUnit.primaryPayerMemberId === member.id
                            ? C.amberBright
                            : C.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.payerText,
                        !canBePayer(member) && styles.payerTextDisabled,
                        selectedUnit.primaryPayerMemberId === member.id && styles.payerTextActive,
                      ]}
                    >
                      {!canBePayer(member)
                        ? 'Adult payer required'
                        : selectedUnit.primaryPayerMemberId === member.id
                          ? 'Usual payer'
                          : 'Set as usual payer'}
                    </Text>
                  </Pressable>
                </View>
              ))}

              <Pressable onPress={addMember} style={styles.addMemberBtn}>
                <Ionicons name="add-circle-outline" size={17} color={C.sky} />
                <Text style={styles.addMemberText}>Add member</Text>
              </Pressable>

              <Text style={styles.fieldLabel}>Notes for Ace</Text>
              <TextInput
                style={[styles.input, styles.notesInput]}
                value={selectedUnit.notes ?? ''}
                onChangeText={(value) => updateSelectedUnit((current) => ({ ...current, notes: value }))}
                placeholder="e.g. Keep us together, prefer calmer routes, avoid late changes with children"
                placeholderTextColor={C.textMuted}
                multiline
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  container: { paddingHorizontal: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '600', color: C.textPrimary },
  saveBtn: { fontSize: 15, color: C.sky, fontWeight: '600' },
  saveBtnDone: { color: C.green },
  subtitle: { fontSize: 13, color: C.textSecondary, lineHeight: 20, marginBottom: 16 },
  infoCard: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.borderMd, borderRadius: 14, padding: 14, marginBottom: 18 },
  infoTitle: { fontSize: 13, fontWeight: '700', color: C.textPrimary, marginBottom: 6 },
  infoBody: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },
  linkCard: { backgroundColor: '#120914', borderWidth: 1, borderColor: '#4a1d67', borderRadius: 14, padding: 14, marginBottom: 18 },
  linkTitle: { fontSize: 13, fontWeight: '700', color: '#f5d0fe', marginBottom: 6 },
  linkBody: { fontSize: 12, color: '#e9d5ff', lineHeight: 18, marginBottom: 12 },
  linkActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  linkPrimaryBtn: { flex: 1, borderRadius: 12, backgroundColor: '#a855f7', paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  linkPrimaryBtnText: { fontSize: 13, fontWeight: '700', color: '#faf5ff' },
  linkSecondaryBtn: { paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, borderColor: '#6b21a8', alignItems: 'center', justifyContent: 'center' },
  linkSecondaryBtnText: { fontSize: 13, color: '#e9d5ff', fontWeight: '700' },
  linkNotice: { fontSize: 12, color: '#d8b4fe', lineHeight: 18, marginTop: 10 },
  linkMeta: { fontSize: 11, color: '#c084fc', lineHeight: 17, marginTop: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: C.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' },
  addInlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addInlineText: { color: C.sky, fontSize: 13, fontWeight: '600' },
  loadingText: { color: C.textMuted, paddingVertical: 20 },
  unitCard: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 10 },
  unitCardActive: { borderColor: C.sky, backgroundColor: '#081826' },
  unitCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  unitCardTitle: { fontSize: 15, fontWeight: '700', color: C.textPrimary, flex: 1 },
  unitCardMeta: { fontSize: 11, color: C.sky, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.8 },
  unitCardBody: { fontSize: 12, color: C.textSecondary, lineHeight: 18, marginTop: 6 },
  preferredBadge: { backgroundColor: C.emDim, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  preferredBadgeText: { color: C.emBright, fontSize: 11, fontWeight: '700' },
  editorCard: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderMd, borderRadius: 16, padding: 16 },
  deleteText: { color: C.red, fontSize: 13, fontWeight: '600' },
  fieldLabel: { fontSize: 11, color: C.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: '#0f172a', borderRadius: 10, borderWidth: 1, borderColor: '#1e293b', color: C.textPrimary, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 },
  notesInput: { minHeight: 76, textAlignVertical: 'top' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#1e293b' },
  pillActive: { backgroundColor: '#0c4a6e', borderColor: C.sky },
  pillText: { fontSize: 12, color: C.textSecondary },
  pillTextActive: { color: C.sky, fontWeight: '700' },
  preferredRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: '#091424', borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, marginTop: 14 },
  preferredCopy: { flex: 1 },
  preferredTitle: { fontSize: 13, fontWeight: '700', color: C.textPrimary, marginBottom: 4 },
  preferredBody: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  memberCard: { backgroundColor: '#08111d', borderWidth: 1, borderColor: '#13253c', borderRadius: 14, padding: 12, marginTop: 12 },
  memberHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 12 },
  memberTitle: { fontSize: 14, fontWeight: '700', color: C.textPrimary, flex: 1 },
  memberHint: { fontSize: 12, color: C.textSecondary, lineHeight: 18, marginTop: 8 },
  memberActionStack: { marginTop: 12, gap: 10 },
  memberLinkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, backgroundColor: '#3b0764', borderWidth: 1, borderColor: '#6b21a8', paddingVertical: 10 },
  memberLinkBtnText: { fontSize: 12, color: '#f5d0fe', fontWeight: '700' },
  memberTokenCard: { borderRadius: 10, backgroundColor: '#1b1021', borderWidth: 1, borderColor: '#4a1d67', padding: 10 },
  memberTokenLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, color: '#c084fc', marginBottom: 4, fontWeight: '700' },
  memberTokenValue: { fontSize: 12, color: '#f3e8ff', lineHeight: 18 },
  memberQrWrap: { marginTop: 12, alignItems: 'center' },
  memberQr: { width: 148, height: 148, borderRadius: 16, backgroundColor: '#fff' },
  memberQrHint: { fontSize: 11, color: '#ddd6fe', lineHeight: 17, marginTop: 10, textAlign: 'center' },
  selfBadge: { backgroundColor: C.indigoDim, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  selfBadgeText: { color: C.indigoBright, fontSize: 11, fontWeight: '700' },
  payerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#111827', borderWidth: 1, borderColor: '#1f2937', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 12 },
  payerRowActive: { borderColor: C.amber, backgroundColor: '#22140a' },
  payerRowDisabled: { opacity: 0.6 },
  payerText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' },
  payerTextActive: { color: C.amberBright },
  payerTextDisabled: { color: C.textMuted },
  addMemberBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingVertical: 12, marginTop: 14 },
  addMemberText: { color: C.sky, fontSize: 14, fontWeight: '600' },
});
