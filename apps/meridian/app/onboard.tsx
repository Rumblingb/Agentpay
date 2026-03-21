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
  Linking,
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
  RAILCARD_LABELS,
  INDIA_CLASS_LABELS,
  type TravelProfile,
  type Nationality,
  type DocumentType,
  type SeatPref,
  type ClassPref,
  type RailcardType,
  type IndiaClassTier,
} from '../lib/profile';
import { getBiometricLabel } from '../lib/biometric';
import { startRecording, stopRecording, transcribeAudio } from '../lib/speech';
import { speak, stopSpeaking } from '../lib/tts';
import { OrbAnimation } from '../components/OrbAnimation';
import type { AppPhase } from '../lib/store';

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
  const [userName,       setUserName]       = useState('');
  const [nameListening,  setNameListening]  = useState(false);
  const [nameThinking,   setNameThinking]   = useState(false);
  const [nameHeard,      setNameHeard]      = useState('');

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
  const [seatPref,       setSeatPref]       = useState<SeatPref>('no_preference');
  const [classPref,      setClassPref]      = useState<ClassPref>('standard');
  const [railcardType,   setRailcardType]   = useState<RailcardType>('none');
  const [indiaClassTier, setIndiaClassTier] = useState<IndiaClassTier>('standard');
  const [irctcId,       setIrctcId]       = useState('');
  const [irctcUsername, setIrctcUsername] = useState('');
  const [irctcPassword, setIrctcPassword] = useState('');
  const [showIrctcPass, setShowIrctcPass] = useState(false);
  const [upiId,         setUpiId]         = useState('');
  const [whatsapp,      setWhatsapp]      = useState('');
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

  // Demo (welcome step)
  type DemoPhase = 'intro' | 'ready' | 'listening' | 'thinking' | 'done';
  const [demoPhase,    setDemoPhase]    = useState<DemoPhase>('intro');
  const [demoResponse, setDemoResponse] = useState('');
  const demoIntroPlayedRef = useRef(false);

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

  // ── Demo: Bro speaks first on welcome screen ─────────────────────────────

  React.useEffect(() => {
    if (step !== 'welcome' || demoIntroPlayedRef.current) return;
    demoIntroPlayedRef.current = true;
    const t = setTimeout(async () => {
      await speak("Hey. I book trains — all by voice. Hold the orb and try me.");
      setDemoPhase('ready');
    }, 600);
    return () => clearTimeout(t);
  }, [step]);

  const handleDemoPressIn = React.useCallback(async () => {
    if (demoPhase !== 'ready') return;
    await stopSpeaking();
    setDemoPhase('listening');
    await startRecording().catch(async () => {
      // Mic denied — show scripted demo so user still gets the wow moment
      const fallback = "Train to London? I'd find the best route, quote the price, and book it with your fingerprint.";
      setDemoResponse(fallback);
      setDemoPhase('done');
      await speak(fallback);
    });
  }, [demoPhase]);

  const handleDemoPressOut = React.useCallback(async () => {
    if (demoPhase !== 'listening') return;
    setDemoPhase('thinking');
    try {
      const uri = await stopRecording();
      let transcript = '';
      if (uri) transcript = await transcribeAudio(uri).catch(() => '');
      if (!transcript) transcript = 'book a train to London tomorrow';

      // Small thinking pause — feels real
      await new Promise(r => setTimeout(r, 700));

      const response = getDemoResponse(transcript);
      setDemoResponse(response);
      setDemoPhase('done');
      await speak(response);
    } catch {
      const fallback = "Heard you. In the real app, I'd find the best option and book it — just like that.";
      setDemoResponse(fallback);
      setDemoPhase('done');
      await speak(fallback);
    }
  }, [demoPhase]);

  const handleVoiceFill = async () => {
    setVoiceFilling(true);
    setVoiceFillHint('Listening…');
    try {
      await startRecording();
      // Give user 6 seconds to speak their details
      await new Promise(r => setTimeout(r, 6000));
      const uri = await stopRecording();
      if (!uri) {
        setVoiceFillHint('No audio captured — mic may be blocked. Try tapping again or type your details below.');
        return;
      }

      setVoiceFillHint('Thinking…');
      let transcript = '';
      try {
        transcript = await transcribeAudio(uri);
      } catch {
        setVoiceFillHint('Could not reach voice service — please type your details below.');
        return;
      }
      if (!transcript.trim()) {
        setVoiceFillHint('Could not hear you — please try again or type below.');
        return;
      }

      try {
        const res = await fetch(`${BASE}/api/voice/extract-profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript }),
        });
        const data = await res.json() as { fields?: Record<string, string> };
        const f = data.fields ?? {};

        if (f.legalName)       setLegalName(f.legalName);
        if (f.email)           setEmail(f.email);
        if (f.phone)           setPhone(f.phone);
        if (f.railcardType && ['16-25','26-30','senior','two-together','family','network','disabled','hm-forces'].includes(f.railcardType)) {
          setRailcardType(f.railcardType as RailcardType);
        }
        if (f.irctcUsername)   setIrctcUsername(f.irctcUsername);
        if (f.whatsappNumber)  setWhatsapp(f.whatsappNumber);
        if (f.nationality && ['uk', 'india', 'other'].includes(f.nationality)) {
          handleNationality(f.nationality as Nationality);
        }

        const filled = Object.keys(f).length;
        setVoiceFillHint(filled > 0 ? `Got it — ${filled} field${filled > 1 ? 's' : ''} filled. Check and save.` : 'Could not extract details — please type them in.');
      } catch {
        setVoiceFillHint('Offline? Could not reach server — please type your details below.');
      }
    } catch (e: any) {
      // mic permission denied or recording failed
      setVoiceFillHint('Microphone access needed — please type your details below.');
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
        seatPreference:  seatPref,
        classPreference: classPref,
        railcardType:    railcardType !== 'none' ? railcardType : undefined,
        indiaClassTier:  nationality === 'india' ? indiaClassTier : undefined,
        irctcId:         irctcId.trim()        || undefined,
        irctcUsername:   irctcUsername.trim()  || undefined,
        irctcPassword:   irctcPassword.trim()  || undefined,
        upiId:           upiId.trim()          || undefined,
        whatsappNumber:  whatsapp.trim()        || undefined,
        savedAt:         new Date().toISOString(),
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

            {/* ── Step 1: Welcome — interactive demo ───────────────── */}
            {step === 'welcome' && (
              <View style={demoStyles.wrap}>
                <LinearGradient colors={['#0c0a1e', '#080808']} style={StyleSheet.absoluteFill} />

                {/* Wordmark */}
                <Text style={demoStyles.wordmark}>bro</Text>

                {/* Orb — passive during intro, interactive when ready */}
                <View style={demoStyles.orbArea}>
                  <OrbAnimation
                    phase={demoPhaseTo(demoPhase)}
                    onPressIn={handleDemoPressIn}
                    onPressOut={handleDemoPressOut}
                    disabled={demoPhase === 'intro' || demoPhase === 'thinking'}
                  />
                </View>

                {/* Dynamic label */}
                <Text style={demoStyles.label}>
                  {demoPhase === 'intro'     ? '' :
                   demoPhase === 'ready'     ? 'Hold to talk' :
                   demoPhase === 'listening' ? 'Listening…' :
                   demoPhase === 'thinking'  ? 'On it…' :
                   demoResponse}
                </Text>

                {/* CTA — appears after demo */}
                {demoPhase === 'done' && (
                  <View style={demoStyles.ctaArea}>
                    <Text style={demoStyles.demoTagline}>That's what I do — every time.</Text>
                    <PrimaryBtn onPress={() => fadeToNext('name')} label="Let's get you set up" />
                  </View>
                )}

                {/* Skip — subtle, for returning testers */}
                {(demoPhase === 'intro' || demoPhase === 'ready') && (
                  <Pressable onPress={() => fadeToNext('name')} style={demoStyles.skip}>
                    <Text style={demoStyles.skipText}>Skip intro</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* ── Step 2: Name ─────────────────────────────────────────── */}
            {step === 'name' && (
              <View style={styles.stepWrap}>
                <Text style={styles.stepTitle}>What should I call you?</Text>
                <Text style={styles.stepSub}>
                  {nameHeard ? `I heard "${nameHeard}" — is that right?` : 'Hold the orb and say your name.'}
                </Text>

                {/* Voice orb */}
                <Pressable
                  onPressIn={async () => {
                    if (nameListening || nameThinking) return;
                    setNameListening(true);
                    setNameHeard('');
                    await startRecording().catch(() => { setNameListening(false); });
                  }}
                  onPressOut={async () => {
                    if (!nameListening) return;
                    setNameListening(false);
                    setNameThinking(true);
                    try {
                      const uri = await stopRecording();
                      if (uri) {
                        const t = await transcribeAudio(uri).catch(() => '');
                        const name = t.trim().replace(/^(my name is|i'm|i am|call me)\s+/i, '').replace(/[.,!?]+$/, '').trim();
                        if (name) { setNameHeard(name); setUserName(name); }
                      }
                    } catch {}
                    setNameThinking(false);
                  }}
                  style={nameStyles.orbWrap}
                >
                  <LinearGradient
                    colors={nameListening ? ['#1e1b4b', '#312e81'] : ['#111', '#1a1a1a']}
                    style={nameStyles.orb}
                  >
                    {nameThinking
                      ? <ActivityIndicator color="#818cf8" />
                      : <Ionicons name={nameListening ? 'mic' : 'mic-outline'} size={32} color={nameListening ? '#818cf8' : '#4b5563'} />
                    }
                  </LinearGradient>
                </Pressable>

                {/* Text fallback */}
                <TextInput
                  style={[styles.input, { marginTop: 16 }]}
                  value={userName}
                  onChangeText={(t) => { setUserName(t); setNameHeard(t); }}
                  placeholder="Or type your name"
                  placeholderTextColor="#374151"
                  autoCapitalize="words"
                  returnKeyType="next"
                  onSubmitEditing={() => { if (userName.trim()) fadeToNext('privacy'); }}
                />

                <PrimaryBtn
                  onPress={() => fadeToNext('privacy')}
                  label={userName.trim() ? `That's me — let's go` : 'Continue'}
                  disabled={nameListening || nameThinking}
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
                    label="Booking updates"
                    sub="Notifications when your booking request is submitted"
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
                <TextInput
                  style={styles.input}
                  value={whatsapp}
                  onChangeText={setWhatsapp}
                  placeholder="WhatsApp number (optional — for instant confirmation)"
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

                {/* Railcard — UK chip picker */}
                {nationality === 'uk' && (
                  <>
                    <SectionLabel text="RAILCARD (OPTIONAL)" />
                    <Text style={styles.prefLabel}>~1/3 off most fares if you have one</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
                      {(['none', '16-25', '26-30', 'senior', 'two-together', 'family', 'network', 'disabled', 'hm-forces'] as RailcardType[]).map(rt => (
                        <Pressable
                          key={rt}
                          onPress={() => setRailcardType(rt)}
                          style={[styles.chip, railcardType === rt && styles.chipActive, { marginBottom: 0 }]}
                        >
                          <Text style={[styles.chipText, railcardType === rt && styles.chipTextActive]}>
                            {rt === 'none' ? 'None' :
                             rt === '16-25' ? '16–25' :
                             rt === '26-30' ? '26–30' :
                             rt === 'senior' ? 'Senior' :
                             rt === 'two-together' ? 'Two Together' :
                             rt === 'family' ? 'Family' :
                             rt === 'network' ? 'Network' :
                             rt === 'disabled' ? 'Disabled' : 'HM Forces'}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                    {railcardType !== 'none' && (
                      <Text style={profileStyles.voiceHint} numberOfLines={1}>
                        {RAILCARD_LABELS[railcardType]} — Bro will apply your discount automatically
                      </Text>
                    )}
                  </>
                )}

                {/* India class tier + IRCTC */}
                {nationality === 'india' && (
                  <>
                    <SectionLabel text="PREFERRED CLASS" />
                    <View style={styles.chipRow}>
                      {(['budget', 'standard', 'premium'] as IndiaClassTier[]).map(tier => (
                        <Pressable
                          key={tier}
                          onPress={() => setIndiaClassTier(tier)}
                          style={[styles.chip, indiaClassTier === tier && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, indiaClassTier === tier && styles.chipTextActive]}>
                            {tier === 'budget' ? 'Budget' : tier === 'standard' ? 'Standard' : 'Premium'}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text style={styles.prefLabel}>
                      {indiaClassTier === 'budget' ? 'SL/2S — non-AC, most affordable' :
                       indiaClassTier === 'standard' ? '3A/CC — AC, most popular' :
                       '2A/1A — premium AC, widest berths'}
                    </Text>
                  </>
                )}

                {nationality === 'india' && (
                  <>
                    <SectionLabel text="INDIA RAIL" />
                    <View style={styles.irctcInfoBox}>
                      <Ionicons name="lock-closed" size={13} color="#6b7280" style={{ marginTop: 1 }} />
                      <Text style={styles.irctcInfoText}>
                        Stored encrypted on your device only. Used to book Indian rail on your behalf. Never shared beyond IRCTC.
                      </Text>
                    </View>
                    <TextInput
                      style={styles.input}
                      value={irctcUsername}
                      onChangeText={setIrctcUsername}
                      placeholder="IRCTC username"
                      placeholderTextColor="#374151"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <View style={styles.passwordRow}>
                      <TextInput
                        style={[styles.input, { flex: 1, marginBottom: 0 }]}
                        value={irctcPassword}
                        onChangeText={setIrctcPassword}
                        placeholder="IRCTC password"
                        placeholderTextColor="#374151"
                        secureTextEntry={!showIrctcPass}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <Pressable onPress={() => setShowIrctcPass(v => !v)} style={styles.eyeBtn} hitSlop={8}>
                        <Ionicons name={showIrctcPass ? 'eye-off-outline' : 'eye-outline'} size={18} color="#4b5563" />
                      </Pressable>
                    </View>
                    <Pressable onPress={() => Linking.openURL('https://www.irctc.co.in/nget/train-search')} style={styles.irctcLink}>
                      <Text style={styles.irctcLinkText}>Don't have an IRCTC account? Create one free →</Text>
                    </Pressable>
                    <TextInput
                      style={styles.input}
                      value={irctcId}
                      onChangeText={setIrctcId}
                      placeholder="IRCTC user ID (if different from username)"
                      placeholderTextColor="#374151"
                      autoCapitalize="none"
                    />
                    <TextInput
                      style={styles.input}
                      value={upiId}
                      onChangeText={setUpiId}
                      placeholder="UPI ID — for instant payment (e.g. name@upi)"
                      placeholderTextColor="#374151"
                      autoCapitalize="none"
                      keyboardType="email-address"
                    />
                  </>
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

                {/* Time saved strip */}
                <View style={finishStyles.savedStrip}>
                  <View style={finishStyles.savedItem}>
                    <Text style={finishStyles.savedNum}>~4 min</Text>
                    <Text style={finishStyles.savedLabel}>saved per booking</Text>
                  </View>
                  <View style={finishStyles.savedDivider} />
                  <View style={finishStyles.savedItem}>
                    <Text style={finishStyles.savedNum}>0</Text>
                    <Text style={finishStyles.savedLabel}>hold music. ever.</Text>
                  </View>
                  <View style={finishStyles.savedDivider} />
                  <View style={finishStyles.savedItem}>
                    <Text style={finishStyles.savedNum}>1 tap</Text>
                    <Text style={finishStyles.savedLabel}>to confirm anything</Text>
                  </View>
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

// ── Demo helpers ──────────────────────────────────────────────────────────

/** Map demo-only phase names to AppPhase for OrbAnimation */
function demoPhaseTo(dp: string): AppPhase {
  if (dp === 'listening') return 'listening';
  if (dp === 'thinking')  return 'thinking';
  if (dp === 'done')      return 'done';
  return 'idle';
}

/** Generate a convincing scripted mock response based on what the user said */
function getDemoResponse(transcript: string): string {
  const t = transcript.toLowerCase();
  if (t.match(/train|rail|london|manchester|birmingham|derby|euston|paddington|victoria|liverpool|edinburgh|glasgow/)) {
    return "Found an Avanti at 09:45 for around £28. In the real app, that's confirmed with your fingerprint in 3 seconds.";
  }
  if (t.match(/taxi|cab|ride|uber|driver|lift|car/)) {
    return "Cabs and hotels are coming soon — trains I can sort right now. Try asking for a train journey.";
  }
  if (t.match(/hotel|room|stay|night|accommodation|b&b|inn|flight|fly|airport|heathrow|gatwick|stansted|plane/)) {
    return "Hotels and flights are coming soon — trains I can sort right now. Try asking for a train journey.";
  }
  if (t.match(/food|restaurant|eat|dinner|lunch|table|reservation/)) {
    return "Table booked at a highly-rated spot nearby. I'm not just for travel — whatever you need, just ask.";
  }
  const preview = transcript.trim().slice(0, 35);
  return `Heard "${preview}…". In the real app, I'd find the best option and book it — fingerprint to confirm.`;
}

// ── Sub-components ────────────────────────────────────────────────────────

function PrimaryBtn({ onPress, label, disabled }: { onPress: () => void; label: string; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.primaryBtn, disabled && { opacity: 0.5 }]}>
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

  // IRCTC credential fields
  irctcInfoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#0d0d0d', borderWidth: 1, borderColor: '#1f2937',
    borderRadius: 10, padding: 12, marginBottom: 12,
  },
  irctcInfoText: { flex: 1, fontSize: 12, color: '#6b7280', lineHeight: 17 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  eyeBtn: {
    width: 44, height: 50, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#111111', borderWidth: 1, borderColor: '#1f2937', borderRadius: 12,
  },
  irctcLink: { marginBottom: 12 },
  irctcLinkText: { fontSize: 12, color: '#4f46e5', textDecorationLine: 'underline' },

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

// ── Demo screen styles ────────────────────────────────────────────────────

const demoStyles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  wordmark: {
    position: 'absolute',
    top: 32,
    fontSize: 16,
    fontWeight: '700',
    color: '#4b5563',
    letterSpacing: 5,
    textTransform: 'lowercase',
  },
  orbArea: {
    marginBottom: 32,
  },
  label: {
    fontSize: 17,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 26,
    minHeight: 80,
    paddingHorizontal: 12,
  },
  demoTagline: {
    fontSize: 14,
    color: '#4b5563',
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 0.2,
  },
  ctaArea: {
    width: '100%',
    marginTop: 8,
  },
  skip: {
    position: 'absolute',
    bottom: 28,
  },
  skipText: {
    fontSize: 13,
    color: '#2d3748',
  },
});

// ── Finish screen styles ──────────────────────────────────────────────────

const finishStyles = StyleSheet.create({
  savedStrip: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
    width: '100%',
  },
  savedItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  savedDivider: {
    width: 1,
    backgroundColor: '#1f2937',
    marginHorizontal: 4,
  },
  savedNum: {
    fontSize: 18,
    fontWeight: '700',
    color: '#818cf8',
    letterSpacing: -0.5,
  },
  savedLabel: {
    fontSize: 10,
    color: '#4b5563',
    textAlign: 'center',
    lineHeight: 14,
  },
});

const nameStyles = StyleSheet.create({
  orbWrap: { alignSelf: 'center', marginVertical: 24 },
  orb: {
    width: 100, height: 100, borderRadius: 50,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#6366f1', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6, shadowRadius: 30, elevation: 16,
  },
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
