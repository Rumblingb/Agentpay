/**
 * Onboard — premium first-launch experience
 *
 * Five steps:
 *   1. Welcome  — intro to Bro
 *   2. Name     — "What should I call you?"
 *   3. Privacy  — consent to profile storage, biometric protection, location
 *   4. Profile  — travel details (voice-fill or form, biometric-gated save)
 *   5. Finish   — auto-confirm budget + agent registration
 *
 * On completion: auto-registers as AgentPay agent, saves credentials,
 * routes to converse.
 */

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Animated,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { registerAgent } from '../lib/api';
import { saveCredentials, savePrefs } from '../lib/storage';
import { useStore } from '../lib/store';
import {
  saveProfile,
  saveConsents,
  defaultDocumentType,
  documentTypeOptions,
  type TravelProfile,
  type Nationality,
  type DocumentType,
  type SeatPref,
  type ClassPref,
} from '../lib/profile';
import { getBiometricLabel } from '../lib/biometric';
import { startRecording, stopRecording, transcribeAudio } from '../lib/speech';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';

type Step = 'welcome' | 'name' | 'privacy' | 'profile' | 'finish';

export default function OnboardScreen() {
  const { hydrate } = useStore();
  const params = useLocalSearchParams<{ step?: string }>();
  const [step, setStep]               = useState<Step>(
    params.step === 'profile' ? 'profile' : 'welcome',
  );
  const [biometricLabel, setBioLabel] = useState('Face ID');

  // Step 2 — name
  const [userName, setUserName] = useState('');

  // Step 3 — privacy consents
  const [locationConsent, setLocationConsent]   = useState(false);
  const [notifConsent,    setNotifConsent]       = useState(true);

  // Step 4 — travel profile
  const [legalName,     setLegalName]     = useState('');
  const [dob,           setDob]           = useState('');          // YYYY-MM-DD
  const [nationality,   setNationality]   = useState<Nationality>('uk');
  const [phone,         setPhone]         = useState('');
  const [email,         setEmail]         = useState('');
  const [docType,       setDocType]       = useState<DocumentType>('passport');
  const [docNumber,     setDocNumber]     = useState('');
  const [docExpiry,     setDocExpiry]     = useState('');
  const [seatPref,      setSeatPref]      = useState<SeatPref>('no_preference');
  const [classPref,     setClassPref]     = useState<ClassPref>('standard');
  const [railcard,      setRailcard]      = useState('');
  const [irctcId,       setIrctcId]       = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError,  setProfileError]  = useState<string | null>(null);

  // Profile — voice fill
  const [voiceFilling, setVoiceFilling]     = useState(false);
  const [voiceFillHint, setVoiceFillHint]   = useState<string | null>(null);
  // Document section collapsed by default (only needed for flights/Eurostar)
  const [showDocs, setShowDocs]             = useState(false);

  // Step 5 — finish
  const [budget,  setBudget]  = useState('5');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Load biometric label on mount
  React.useEffect(() => {
    getBiometricLabel().then(setBioLabel);
  }, []);

  const fadeToNext = (next: Step) => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      // When entering profile step, prefill legal name from userName
      if (next === 'profile' && !legalName) setLegalName(userName.trim());
      setStep(next);
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    });
  };

  // When nationality changes, reset docType to the default for that region
  const handleNationality = (nat: Nationality) => {
    setNationality(nat);
    setDocType(defaultDocumentType(nat));
    setDocNumber('');
  };

  const handleVoiceFill = async () => {
    setVoiceFilling(true);
    setVoiceFillHint('Listening…');
    try {
      await startRecording();
      // Give user 6 seconds to speak their details
      await new Promise(r => setTimeout(r, 6000));
      const uri = await stopRecording();
      if (!uri) throw new Error('No audio captured.');

      setVoiceFillHint('Thinking…');
      const transcript = await transcribeAudio(uri);

      const res = await fetch(`${BASE}/api/voice/extract-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const data = await res.json() as { fields?: Record<string, string> };
      const f = data.fields ?? {};

      if (f.legalName)      setLegalName(f.legalName);
      if (f.email)          setEmail(f.email);
      if (f.phone)          setPhone(f.phone);
      if (f.railcardNumber) setRailcard(f.railcardNumber);
      if (f.nationality && ['uk', 'india', 'other'].includes(f.nationality)) {
        handleNationality(f.nationality as Nationality);
      }

      const filled = Object.keys(f).length;
      setVoiceFillHint(filled > 0 ? `Got it — ${filled} field${filled > 1 ? 's' : ''} filled. Check and save.` : 'Could not extract details — please type them in.');
    } catch (e: any) {
      setVoiceFillHint(e.message ?? 'Voice fill failed — please type your details.');
    } finally {
      setVoiceFilling(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!legalName.trim()) { setProfileError('Legal name is required.'); return; }
    if (!email.trim()) { setProfileError('Email is required for your e-ticket.'); return; }

    setProfileSaving(true);
    setProfileError(null);
    try {
      const profile: TravelProfile = {
        legalName:      legalName.trim(),
        dateOfBirth:    dob.trim() || '1990-01-01',
        nationality,
        phone:          phone.trim(),
        email:          email.trim(),
        documentType:   docType,
        documentNumber: docNumber.trim(),
        documentExpiry: docExpiry.trim() || undefined,
        seatPreference: seatPref,
        classPreference: classPref,
        railcardNumber: railcard.trim() || undefined,
        irctcId:        irctcId.trim() || undefined,
        savedAt:        new Date().toISOString(),
      };
      await saveProfile(profile);
      // If deep-linked from settings, go back; otherwise continue onboarding
      if (params.step === 'profile') {
        router.back();
      } else {
        fadeToNext('finish');
      }
    } catch (e: any) {
      setProfileError(e.message ?? 'Profile save failed.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleAcceptPrivacy = async () => {
    await saveConsents({
      profileConsented:        true,
      locationConsented:       locationConsent,
      notificationsConsented:  notifConsent,
      consentedAt:             new Date().toISOString(),
    });
    fadeToNext('profile');
  };

  const handleFinish = async () => {
    const budgetN = parseFloat(budget) || 5;
    const name = userName.trim() || 'Traveler';

    setLoading(true);
    setError(null);
    try {
      const { agentId, agentKey } = await registerAgent({ name });

      await Promise.all([
        saveCredentials({ agentId, agentKey }),
        savePrefs({ userName: name, autoConfirmLimitUsdc: budgetN, onboarded: true }),
      ]);

      hydrate({
        agentId,
        agentKey,
        userName:  name,
        autoConfirmLimitUsdc: budgetN,
        onboarded: true,
        turns: [],
      });

      router.replace('/(main)/converse');
    } catch (e: any) {
      setError(e.message ?? 'Setup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[styles.content, { opacity: fadeAnim }]}>

            {/* ── Step 1: Welcome ──────────────────────────────────────── */}
            {step === 'welcome' && (
              <View style={styles.stepWrap}>
                <LinearGradient colors={['#1e1b4b', '#080808']} style={styles.heroBg} />
                <View style={styles.orbWrap}>
                  <LinearGradient colors={['#4338ca', '#7c3aed']} style={styles.orb}>
                    <Ionicons name="mic" size={44} color="#fff" />
                  </LinearGradient>
                </View>
                <Text style={styles.heroTitle}>Bro</Text>
                <Text style={styles.heroSub}>
                  Your personal AI concierge.{'\n'}Speak. I handle the rest.
                </Text>
                <View style={styles.features}>
                  <Feature icon="train"             text="Book trains by voice — UK, Europe, India" />
                  <Feature icon="flash"             text="Agents hired and paid automatically" />
                  <Feature icon="shield-checkmark"  text="Your profile stays on your device only" />
                </View>
                <PrimaryBtn onPress={() => fadeToNext('name')} label="Get Started" />
              </View>
            )}

            {/* ── Step 2: Name ─────────────────────────────────────────── */}
            {step === 'name' && (
              <View style={styles.stepWrap}>
                <Text style={styles.stepTitle}>What should I call you?</Text>
                <Text style={styles.stepSub}>I'll use your name when we talk.</Text>
                <TextInput
                  style={styles.input}
                  value={userName}
                  onChangeText={setUserName}
                  placeholder="Your name"
                  placeholderTextColor="#374151"
                  autoFocus
                  autoCapitalize="words"
                  returnKeyType="next"
                  onSubmitEditing={() => fadeToNext('privacy')}
                />
                <PrimaryBtn
                  onPress={() => fadeToNext('privacy')}
                  label={userName.trim() ? `Nice to meet you, ${userName.trim()}` : 'Continue'}
                />
              </View>
            )}

            {/* ── Step 3: Privacy Consent ──────────────────────────────── */}
            {step === 'privacy' && (
              <View style={styles.stepWrap}>
                <View style={styles.shieldBadge}>
                  <Ionicons name="shield-checkmark" size={40} color="#4ade80" />
                </View>

                <Text style={styles.stepTitle}>Your privacy.{'\n'}Our promise.</Text>
                <Text style={styles.stepSub}>
                  Safety is our priority. No one can access your information without your permission.
                </Text>

                <View style={styles.promiseList}>
                  <PromiseRow icon="lock-closed"    text="Encrypted in your phone's secure storage" />
                  <PromiseRow icon="finger-print"   text={`Protected by ${biometricLabel} — only you`} />
                  <PromiseRow icon="person"         text="Shared only when you choose to book" />
                  <PromiseRow icon="checkmark-done" text="Shared only with the agent you select" />
                  <PromiseRow icon="server"         text="Never stored on our servers" />
                  <PromiseRow icon="trash"          text="Delete everything from Settings anytime" />
                </View>

                <View style={styles.consentToggles}>
                  <ConsentRow
                    label="Allow location for nearby stations"
                    sub="Used only when you ask — never in background"
                    value={locationConsent}
                    onToggle={setLocationConsent}
                  />
                  <ConsentRow
                    label="Booking confirmations"
                    sub="Notifications when your booking is confirmed"
                    value={notifConsent}
                    onToggle={setNotifConsent}
                  />
                </View>

                <PrimaryBtn onPress={handleAcceptPrivacy} label="I understand — continue" />

                <Text style={styles.legalNote}>
                  By continuing you accept our Terms of Service and Privacy Policy at agentpay.so
                </Text>
              </View>
            )}

            {/* ── Step 4: Travel Profile ───────────────────────────────── */}
            {step === 'profile' && (
              <View style={styles.stepWrap}>
                <Text style={styles.stepTitle}>Your booking details.</Text>
                <Text style={styles.stepSub}>
                  Stays on this device. {biometricLabel} protected.{'\n'}
                  I need these to book and send your e-ticket.
                </Text>

                {/* ── Voice fill ─────────────────────────────────────── */}
                <Pressable
                  onPress={handleVoiceFill}
                  disabled={voiceFilling}
                  style={[profileStyles.voiceBtn, voiceFilling && { opacity: 0.6 }]}
                >
                  <Ionicons
                    name={voiceFilling ? 'mic' : 'mic-outline'}
                    size={18}
                    color={voiceFilling ? '#818cf8' : '#6b7280'}
                  />
                  <Text style={profileStyles.voiceBtnText}>
                    {voiceFilling ? 'Listening…' : 'Fill in by voice'}
                  </Text>
                </Pressable>
                {voiceFillHint && (
                  <Text style={profileStyles.voiceHint}>{voiceFillHint}</Text>
                )}

                {/* ── Train essentials (always visible) ─────────────── */}
                <SectionLabel text="FOR BOOKING CONFIRMATION" />
                <TextInput
                  style={styles.input}
                  value={legalName}
                  onChangeText={setLegalName}
                  placeholder="Full name (as you want it on the ticket)"
                  placeholderTextColor="#374151"
                  autoCapitalize="words"
                />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email — your e-ticket arrives here"
                  placeholderTextColor="#374151"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder={nationality === 'uk' ? '+44 7xxx xxxxxx' : '+91 98xxx xxxxx'}
                  placeholderTextColor="#374151"
                  keyboardType="phone-pad"
                />

                {/* Nationality */}
                <SectionLabel text="YOUR COUNTRY" />
                <View style={styles.chipRow}>
                  {(['uk', 'india', 'other'] as Nationality[]).map(nat => (
                    <Pressable
                      key={nat}
                      onPress={() => handleNationality(nat)}
                      style={[styles.chip, nationality === nat && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, nationality === nat && styles.chipTextActive]}>
                        {nat === 'uk' ? '🇬🇧 UK' : nat === 'india' ? '🇮🇳 India' : '🌍 Other'}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Railcard / IRCTC — region extras */}
                {nationality === 'uk' && (
                  <TextInput
                    style={styles.input}
                    value={railcard}
                    onChangeText={setRailcard}
                    placeholder="Railcard (optional — 16-25, Senior, Network…)"
                    placeholderTextColor="#374151"
                    autoCapitalize="characters"
                  />
                )}
                {nationality === 'india' && (
                  <TextInput
                    style={styles.input}
                    value={irctcId}
                    onChangeText={setIrctcId}
                    placeholder="IRCTC user ID (optional)"
                    placeholderTextColor="#374151"
                    autoCapitalize="none"
                  />
                )}

                {/* Preferences */}
                <SectionLabel text="SEAT PREFERENCE" />
                <View style={styles.chipRow}>
                  {(['window', 'aisle', 'no_preference'] as SeatPref[]).map(s => (
                    <Pressable
                      key={s}
                      onPress={() => setSeatPref(s)}
                      style={[styles.chip, seatPref === s && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, seatPref === s && styles.chipTextActive]}>
                        {s === 'window' ? 'Window' : s === 'aisle' ? 'Aisle' : 'No pref'}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* ── Document section — collapsed by default ──────────
                    Only needed for Eurostar, flights, and IRCTC tatkal. */}
                <Pressable
                  onPress={() => setShowDocs(d => !d)}
                  style={profileStyles.docsToggle}
                >
                  <Ionicons
                    name={showDocs ? 'chevron-down' : 'chevron-forward'}
                    size={14}
                    color="#4b5563"
                  />
                  <Text style={profileStyles.docsToggleText}>
                    Travel document — required for Eurostar & flights only
                  </Text>
                </Pressable>

                {showDocs && (
                  <>
                    <TextInput
                      style={styles.input}
                      value={dob}
                      onChangeText={setDob}
                      placeholder="Date of birth (YYYY-MM-DD)"
                      placeholderTextColor="#374151"
                      keyboardType="numbers-and-punctuation"
                    />
                    <View style={[styles.chipRow, { marginTop: 4 }]}>
                      {documentTypeOptions(nationality).map(dt => (
                        <Pressable
                          key={dt}
                          onPress={() => setDocType(dt)}
                          style={[styles.chip, docType === dt && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, docType === dt && styles.chipTextActive]}>
                            {dt === 'passport' ? 'Passport' :
                             dt === 'aadhaar'  ? 'Aadhaar' :
                             dt === 'driving_licence' ? 'Driving Lic.' : 'National ID'}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <TextInput
                      style={styles.input}
                      value={docNumber}
                      onChangeText={setDocNumber}
                      placeholder={
                        docType === 'aadhaar' ? 'Aadhaar number (12 digits)' :
                        docType === 'passport' ? 'Passport number' : 'Document number'
                      }
                      placeholderTextColor="#374151"
                      secureTextEntry
                      autoCapitalize="characters"
                    />
                    {docType === 'passport' && (
                      <TextInput
                        style={styles.input}
                        value={docExpiry}
                        onChangeText={setDocExpiry}
                        placeholder="Passport expiry (YYYY-MM-DD)"
                        placeholderTextColor="#374151"
                        keyboardType="numbers-and-punctuation"
                      />
                    )}
                  </>
                )}

                {profileError && <Text style={styles.error}>{profileError}</Text>}

                <Pressable
                  onPress={handleSaveProfile}
                  style={[styles.primaryBtn, profileSaving && { opacity: 0.6 }]}
                  disabled={profileSaving}
                >
                  <LinearGradient
                    colors={['#065f46', '#14532d']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.btnGrad}
                  >
                    {profileSaving ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="finger-print" size={20} color="#4ade80" />
                        <Text style={[styles.btnText, { color: '#4ade80' }]}>
                          Save with {biometricLabel}
                        </Text>
                      </>
                    )}
                  </LinearGradient>
                </Pressable>

                <Pressable
                  onPress={() => params.step === 'profile' ? router.back() : fadeToNext('finish')}
                  style={styles.skipBtn}
                >
                  <Text style={styles.skipText}>
                    {!email.trim()
                      ? "Skip — I won't be able to send your e-ticket without an email"
                      : "Skip for now — edit anytime in Settings"}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* ── Step 5: Finish ───────────────────────────────────────── */}
            {step === 'finish' && (
              <View style={styles.stepWrap}>
                <Text style={styles.stepTitle}>
                  Almost there{userName.trim() ? `, ${userName.trim()}` : ''}.
                </Text>
                <Text style={styles.stepSub}>
                  Set your auto-approve limit. Below this amount, I'll act without asking.
                  Above it, I'll confirm with you first.
                </Text>

                <FieldLabel
                  text="Auto-approve limit (USDC)"
                  hint="I'll hire agents automatically up to this amount."
                />
                <View style={styles.chipRow}>
                  {['2', '5', '10', '25'].map((v) => (
                    <Pressable
                      key={v}
                      onPress={() => setBudget(v)}
                      style={[styles.chip, budget === v && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, budget === v && styles.chipTextActive]}>
                        ${v}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {error && <Text style={styles.error}>{error}</Text>}

                <Pressable
                  onPress={handleFinish}
                  style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
                  disabled={loading}
                >
                  <LinearGradient
                    colors={['#4338ca', '#6366f1']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.btnGrad}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="mic" size={20} color="#fff" />
                        <Text style={styles.btnText}>Launch Bro</Text>
                      </>
                    )}
                  </LinearGradient>
                </Pressable>

                <Text style={styles.legalNote}>
                  Payments powered by AgentPay · agentpay.so{'\n'}
                  Your agent identity is created automatically.
                </Text>
              </View>
            )}

          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function PrimaryBtn({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} style={styles.primaryBtn}>
      <LinearGradient
        colors={['#4338ca', '#6366f1']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.btnGrad}
      >
        <Text style={styles.btnText}>{label}</Text>
        <Ionicons name="arrow-forward" size={18} color="#fff" />
      </LinearGradient>
    </Pressable>
  );
}

function Feature({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={featStyles.row}>
      <View style={featStyles.iconWrap}>
        <Ionicons name={icon as any} size={18} color="#818cf8" />
      </View>
      <Text style={featStyles.text}>{text}</Text>
    </View>
  );
}

function PromiseRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={promiseStyles.row}>
      <Ionicons name={icon as any} size={16} color="#4ade80" />
      <Text style={promiseStyles.text}>{text}</Text>
    </View>
  );
}

function ConsentRow({
  label, sub, value, onToggle,
}: {
  label: string; sub: string; value: boolean; onToggle: (v: boolean) => void;
}) {
  return (
    <View style={consentStyles.row}>
      <View style={{ flex: 1 }}>
        <Text style={consentStyles.label}>{label}</Text>
        <Text style={consentStyles.sub}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: '#1f2937', true: '#4338ca' }}
        thumbColor={value ? '#818cf8' : '#6b7280'}
      />
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={sectionStyles.label}>{text}</Text>;
}

function FieldLabel({ text, hint }: { text: string; hint?: string }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={fieldStyles.label}>{text}</Text>
      {hint && <Text style={fieldStyles.hint}>{hint}</Text>}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const featStyles = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#1e1b4b', alignItems: 'center', justifyContent: 'center' },
  text:     { flex: 1, fontSize: 15, color: '#d1d5db', lineHeight: 21 },
});

const promiseStyles = StyleSheet.create({
  row:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  text: { flex: 1, fontSize: 14, color: '#9ca3af', lineHeight: 20 },
});

const consentStyles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1f2937' },
  label: { fontSize: 14, color: '#d1d5db', fontWeight: '500', marginBottom: 2 },
  sub:   { fontSize: 12, color: '#4b5563', lineHeight: 17 },
});

const sectionStyles = StyleSheet.create({
  label: { fontSize: 11, fontWeight: '700', color: '#4b5563', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10, marginTop: 20 },
});

const fieldStyles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: '#9ca3af', marginBottom: 4 },
  hint:  { fontSize: 12, color: '#4b5563', lineHeight: 17 },
});

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#080808' },
  scroll:  { flexGrow: 1 },
  content: { flex: 1 },

  stepWrap: { flex: 1, padding: 28, paddingTop: 32 },

  // Welcome
  heroBg: { ...StyleSheet.absoluteFillObject, opacity: 0.6 },
  orbWrap: { alignItems: 'center', marginBottom: 28, marginTop: 20 },
  orb: {
    width: 100, height: 100, borderRadius: 50,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#6366f1', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8, shadowRadius: 40, elevation: 20,
  },
  heroTitle: {
    fontSize: 38, fontWeight: '800', color: '#f9fafb',
    textAlign: 'center', letterSpacing: -1, marginBottom: 12,
  },
  heroSub: {
    fontSize: 17, color: '#9ca3af', textAlign: 'center',
    lineHeight: 26, marginBottom: 40,
  },
  features: { marginBottom: 40 },

  // Privacy
  shieldBadge: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: '#052e16', alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
  },
  promiseList:    { marginBottom: 24 },
  consentToggles: { marginBottom: 28, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1f2937' },

  // Steps
  stepTitle: { fontSize: 28, fontWeight: '700', color: '#f9fafb', marginBottom: 10, letterSpacing: -0.5 },
  stepSub:   { fontSize: 15, color: '#6b7280', lineHeight: 22, marginBottom: 32 },

  // Inputs
  input: {
    backgroundColor: '#111111', borderWidth: 1, borderColor: '#1f2937',
    borderRadius: 12, padding: 15, fontSize: 16, color: '#f9fafb', marginBottom: 12,
  },
  prefLabel: { fontSize: 12, color: '#6b7280', marginBottom: 8 },

  // Chips
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1, borderColor: '#1f2937',
    backgroundColor: '#0d0d0d',
  },
  chipActive:     { backgroundColor: '#1e1b4b', borderColor: '#4338ca' },
  chipText:       { fontSize: 14, fontWeight: '500', color: '#6b7280' },
  chipTextActive: { color: '#818cf8' },

  // Button
  primaryBtn: { borderRadius: 14, overflow: 'hidden', marginBottom: 16 },
  btnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 16, paddingHorizontal: 24,
  },
  btnText: { fontSize: 17, fontWeight: '700', color: '#fff' },

  // Skip
  skipBtn: { alignItems: 'center', paddingVertical: 12 },
  skipText: { fontSize: 13, color: '#374151', textAlign: 'center' },

  error:    { fontSize: 13, color: '#f87171', marginBottom: 16, textAlign: 'center' },
  legalNote:{ fontSize: 11, color: '#374151', textAlign: 'center', lineHeight: 17, marginTop: 8 },
});

const profileStyles = StyleSheet.create({
  voiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
  },
  voiceBtnText: { fontSize: 14, color: '#6b7280' },
  voiceHint:    { fontSize: 12, color: '#818cf8', marginBottom: 16, textAlign: 'center' },
  docsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    marginBottom: 8,
  },
  docsToggleText: { fontSize: 13, color: '#4b5563', flex: 1 },
});
