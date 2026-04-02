/**
 * Onboard — premium first-launch experience
 *
 * Five steps:
 *   1. Welcome  — intro to Ace
 *   2. Name     — "What should I call you?"
 *   3. Privacy  — consent to profile storage, biometric protection, location
 *   4. Profile  — travel details (voice-fill or form, biometric-gated save)
 *   5. Finish   — final launch + agent registration
 *
 * On completion: auto-registers as AgentPay agent, saves credentials,
 * routes to converse.
 */

import React, { useState, useRef } from 'react';
import {
  Alert,
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
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';

import { registerAgent } from '../lib/api';
import { clearActiveTrip, saveCredentials, savePrefs } from '../lib/storage';
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
import { requestNotificationPermission } from '../lib/notifications';
import { startRecording, stopRecording, transcribeAudio } from '../lib/speech';
import { speak, stopSpeaking } from '../lib/tts';
import { AceBrain } from '../components/AceBrain';
import type { AppPhase } from '../lib/store';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';
const BRO_KEY = process.env.EXPO_PUBLIC_BRO_KEY ?? '';

function missingBroKeyMessage(): string {
  return 'This Ace build needs an update before it can handle live trips. Please install the latest beta and try again.';
}

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

type Step = 'welcome' | 'name' | 'privacy' | 'profile' | 'finish';

const MARKET_COPY: Record<Nationality, {
  intro: string;
  fallback: string;
  demoPrompt: string;
  setupTagline: string;
}> = {
  uk: {
    intro: "I'm Ace. Your spoken concierge for UK rail.",
    fallback: "Train to London? I'd find the best route, apply your railcard if you have one, quote the fare, and carry the booking through for you.",
    demoPrompt: 'book a train to London tomorrow',
    setupTagline: 'Tell Ace enough once, and UK rail gets cleaner from there: the right railcard, the right route, and booking-ready details when it matters.',
  },
  india: {
    intro: "I'm Ace. Your spoken concierge for Indian rail.",
    fallback: "Need a train in India? I'd check the best option, use your IRCTC details if needed, quote the fare, and carry the booking through with you.",
    demoPrompt: 'book a train from Delhi to Agra tomorrow morning',
    setupTagline: 'Tell Ace enough once, and Indian rail gets smoother from there: IRCTC details, class preferences, and payment-ready journeys when you need them.',
  },
  other: {
    intro: "I'm Ace. Your spoken concierge for movement.",
    fallback: "Need to get somewhere? I'd find the best route, quote the fare, and line the journey up for you.",
    demoPrompt: 'new york to boston tomorrow morning',
    setupTagline: 'Ace works best when it knows enough to move cleanly later: who is travelling, how to reach you, and the kind of trip you prefer.',
  },
};

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
  const [nameHint,       setNameHint]       = useState<string | null>(null);

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
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Demo (welcome step)
  type DemoPhase = 'intro' | 'ready' | 'listening' | 'thinking' | 'done';
  const [demoPhase,    setDemoPhase]    = useState<DemoPhase>('intro');
  const [demoResponse, setDemoResponse] = useState('');
  const demoIntroPlayedRef = useRef(false);
  const demoCompletingRef = useRef(false);
  const nameAutoStartedRef = useRef(false);
  const nameCompletingRef = useRef(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const marketCopy = MARKET_COPY[nationality];

  // Load biometric label on mount
  React.useEffect(() => {
    getBiometricLabel().then(setBioLabel);
  }, []);

  React.useEffect(() => {
    if (step === 'welcome') return;
    void stopSpeaking().catch(() => null);
    void stopRecording().catch(() => null);
  }, [step]);

  React.useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      if (step === 'welcome') return;
      setNameListening(false);
      setNameThinking(false);
      setVoiceFilling(false);
      void stopSpeaking().catch(() => null);
      void stopRecording().catch(() => null);
    });
    return () => sub.remove();
  }, [step]);

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
    setDocExpiry('');

    if (nat !== 'uk') {
      setRailcardType('none');
    }

    if (nat !== 'india') {
      setIndiaClassTier('standard');
      setIrctcId('');
      setIrctcUsername('');
      setIrctcPassword('');
      setShowIrctcPass(false);
      setUpiId('');
    }
  };

  // ── Demo: Ace speaks first on welcome screen ─────────────────────────────

  React.useEffect(() => {
    if (step !== 'welcome' || demoIntroPlayedRef.current) return;
    demoIntroPlayedRef.current = true;
    const t = setTimeout(async () => {
      await speak(marketCopy.intro);
      setDemoPhase('ready');
    }, 600);
    return () => clearTimeout(t);
  }, [marketCopy.intro, step]);

  const completeDemoCapture = React.useCallback(async (uri?: string | null) => {
    if (demoCompletingRef.current) return;
    demoCompletingRef.current = true;
    setDemoPhase('thinking');
    try {
      let transcript = '';
      if (uri) transcript = await transcribeAudio(uri).catch(() => '');
      if (!transcript) transcript = marketCopy.demoPrompt;

      // Small thinking pause — feels real
      await new Promise(r => setTimeout(r, 700));

      const response = getDemoResponse(transcript, nationality);
      setDemoResponse(response);
      setDemoPhase('done');
      await speak(response);
    } catch {
      const fallback = marketCopy.fallback;
      setDemoResponse(fallback);
      setDemoPhase('done');
      await speak(fallback);
    } finally {
      demoCompletingRef.current = false;
    }
  }, [marketCopy.demoPrompt, marketCopy.fallback, nationality]);

  const handleDemoPress = React.useCallback(async () => {
    if (demoPhase === 'ready') {
      await stopSpeaking();
      setDemoPhase('listening');
      await startRecording({
        autoStopOnSilence: true,
        silenceMs: 2400,
        maxDurationMs: 9000,
        onSilence: () => {
          void stopRecording()
            .then((uri) => completeDemoCapture(uri))
            .catch(() => completeDemoCapture(null));
        },
      }).catch(async () => {
        // Mic denied — show scripted demo so user still gets the wow moment
        const fallback = marketCopy.fallback;
        setDemoResponse(fallback);
        setDemoPhase('done');
        await speak(fallback);
      });
      return;
    }

    if (demoPhase === 'listening') {
      const uri = await stopRecording().catch(() => null);
      await completeDemoCapture(uri);
    }
  }, [completeDemoCapture, demoPhase, marketCopy.fallback]);

  const normalizeCapturedName = React.useCallback((rawTranscript: string) => (
    rawTranscript
      .trim()
      .replace(/^(my name is|i'm|i am|call me)\s+/i, '')
      .replace(/[.,!?]+$/, '')
      .trim()
  ), []);

  const completeNameCapture = React.useCallback(async (uri?: string | null) => {
    if (nameCompletingRef.current) return;
    nameCompletingRef.current = true;
    setNameListening(false);
    setNameThinking(true);
    setNameHint('Working it through…');

    try {
      if (uri) {
        const transcript = await transcribeAudio(uri).catch(() => '');
        const name = normalizeCapturedName(transcript);
        if (name) {
          setNameHeard(name);
          setUserName(name);
          setNameHint('Got it.');
        } else {
          setNameHint('Ace did not catch that. Try once more or type your name below.');
        }
      } else {
        setNameHint('Ace did not catch enough audio. Try once more or type your name below.');
      }
    } catch {
      setNameHint('Voice is unavailable right now. You can type your name below.');
    } finally {
      setNameThinking(false);
      nameCompletingRef.current = false;
    }
  }, [normalizeCapturedName]);

  const beginNameCapture = React.useCallback(async () => {
    if (step !== 'name' || nameListening || nameThinking) return;

    await stopSpeaking().catch(() => null);
    setNameListening(true);
    setNameHint('Ace is listening for your name…');
    setNameHeard('');

    await startRecording({
      autoStopOnSilence: true,
      silenceMs: 2600,
      maxDurationMs: 8000,
      onSilence: () => {
        void stopRecording()
          .then((uri) => completeNameCapture(uri))
          .catch(() => completeNameCapture(null));
      },
    }).catch(() => {
      setNameListening(false);
      setNameHint('Ace needs microphone access to hear your name. You can type it below instead.');
    });
  }, [completeNameCapture, nameListening, nameThinking, step]);

  const handleNameOrbPress = React.useCallback(async () => {
    if (nameThinking) return;
    if (!nameListening) {
      await beginNameCapture();
      return;
    }

    const uri = await stopRecording().catch(() => null);
    await completeNameCapture(uri);
  }, [beginNameCapture, completeNameCapture, nameListening, nameThinking]);

  React.useEffect(() => {
    if (step !== 'name') {
      nameAutoStartedRef.current = false;
      return;
    }
    if (
      nameAutoStartedRef.current ||
      nameListening ||
      nameThinking ||
      Boolean(nameHeard.trim()) ||
      Boolean(userName.trim())
    ) {
      return;
    }

    setNameHint('Ace will catch it after a short pause.');
    const timer = setTimeout(() => {
      nameAutoStartedRef.current = true;
      void beginNameCapture();
    }, 650);

    return () => clearTimeout(timer);
  }, [beginNameCapture, nameHeard, nameListening, nameThinking, step, userName]);

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

      if (!BRO_KEY) {
        setVoiceFillHint(missingBroKeyMessage());
        return;
      }

      try {
        const res = await fetchWithTimeout(`${BASE}/api/voice/extract-profile`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(BRO_KEY ? { 'x-bro-key': BRO_KEY } : {}),
          },
          body: JSON.stringify({ transcript }),
        }, 15_000);
        if (res.status === 401 || res.status === 403) {
          setVoiceFillHint(missingBroKeyMessage());
          return;
        }
        if (!res.ok) {
          setVoiceFillHint('Ace could not finish that profile pass. Please type your details below.');
          return;
        }
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
      } catch (e: any) {
        const msg = (e?.message ?? '').toLowerCase();
        setVoiceFillHint(
          msg.includes('abort') || msg.includes('timeout')
            ? 'Ace took too long on that profile pass. Please type your details below.'
            : 'Ace could not reach profile voice right now. Please type your details below.',
        );
      }
    } catch (e: any) {
      // mic permission denied or recording failed
      setVoiceFillHint('Ace needs microphone access for voice setup. Please type your details below.');
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
        railcardType:    nationality === 'uk' && railcardType !== 'none' ? railcardType : undefined,
        indiaClassTier:  nationality === 'india' ? indiaClassTier : undefined,
        irctcId:         nationality === 'india' ? irctcId.trim() || undefined : undefined,
        irctcUsername:   nationality === 'india' ? irctcUsername.trim() || undefined : undefined,
        irctcPassword:   nationality === 'india' ? irctcPassword.trim() || undefined : undefined,
        upiId:           nationality === 'india' ? upiId.trim() || undefined : undefined,
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
    let locationGranted = false;
    let notificationsGranted = false;

    if (locationConsent) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        locationGranted = status === 'granted';
      } catch {
        locationGranted = false;
      }
    }

    if (notifConsent) {
      try {
        notificationsGranted = await requestNotificationPermission();
      } catch {
        notificationsGranted = false;
      }
    }

    await saveConsents({
      profileConsented:        true,
      locationConsented:       locationConsent && locationGranted,
      notificationsConsented:  notifConsent && notificationsGranted,
      consentedAt:             new Date().toISOString(),
    });

    if ((locationConsent && !locationGranted) || (notifConsent && !notificationsGranted)) {
      Alert.alert(
        'Some permissions are still off',
        [
          locationConsent && !locationGranted ? 'Location stayed off, so nearby-station shortcuts will stay disabled.' : null,
          notifConsent && !notificationsGranted ? 'Notifications stayed off, so booking updates will stay inside the app only.' : null,
        ].filter(Boolean).join('\n\n'),
      );
    }

    fadeToNext('profile');
  };

  const handleFinish = async () => {
    const budgetN = 5;
    const name = userName.trim() || 'Traveler';

    setLoading(true);
    setError(null);
    try {
      await stopSpeaking().catch(() => null);
      await stopRecording().catch(() => null);

      const { agentId, agentKey } = await registerAgent({ name });

      await Promise.all([
        saveCredentials({ agentId, agentKey }),
        savePrefs({ userName: name, autoConfirmLimitUsdc: budgetN, onboarded: true }),
        clearActiveTrip(),
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
                <Text style={demoStyles.wordmark}>ACE</Text>

                <View style={demoStyles.marketWrap}>
                  <Text style={demoStyles.marketLabel}>Where should Ace start?</Text>
                  <View style={styles.chipRow}>
                    {(['uk', 'india', 'other'] as Nationality[]).map(nat => (
                      <Pressable
                        key={nat}
                        onPress={() => handleNationality(nat)}
                        style={[styles.chip, nationality === nat && styles.chipActive, demoStyles.marketChip]}
                      >
                        <Text style={[styles.chipText, nationality === nat && styles.chipTextActive]}>
                          {nat === 'uk' ? 'United Kingdom' : nat === 'india' ? 'India' : 'Global'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={demoStyles.marketHint}>{marketCopy.setupTagline}</Text>
                </View>

                {/* Ace demo — calm during intro, voice-first when ready */}
                <View style={demoStyles.orbArea}>
                  <AceBrain
                    phase={demoPhaseTo(demoPhase)}
                    mode="onboarding"
                    onPress={handleDemoPress}
                    disabled={demoPhase === 'intro' || demoPhase === 'thinking'}
                  />
                </View>

                {/* Dynamic label */}
                <Text style={demoStyles.label}>
                  {demoPhase === 'intro'     ? '' :
                   demoPhase === 'ready'     ? 'Tell Ace where you need to go.' :
                   demoPhase === 'listening' ? 'Ace is listening.' :
                   demoPhase === 'thinking'  ? 'Working it through…' :
                   demoResponse}
                </Text>

                {/* CTA — appears after demo */}
                {demoPhase === 'done' && (
                  <View style={demoStyles.ctaArea}>
                    <Text style={demoStyles.demoTagline}>This is how travel should feel.</Text>
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
                  {nameHeard
                    ? `I heard "${nameHeard}" — is that right?`
                    : nameListening
                      ? 'Ace is listening for your name.'
                      : 'Say your name. Ace will catch it.'}
                </Text>
                {nameHint ? <Text style={profileStyles.voiceHint}>{nameHint}</Text> : null}

                {/* Voice object */}
                <View style={nameStyles.orbWrap}>
                  <AceBrain
                    phase={nameThinking ? 'thinking' : nameListening ? 'listening' : nameHeard ? 'done' : 'idle'}
                    mode="onboarding"
                    onPress={handleNameOrbPress}
                  />
                </View>

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
                  <Ionicons name="shield-checkmark" size={40} color="#dcecff" />
                </View>

                <Text style={styles.stepTitle}>Your data.{'\n'}Your advantage.</Text>
                <Text style={styles.stepSub}>
                  Ace needs real booking data to do real booking work. More detail means fewer follow-up questions, fewer failed checkouts, better fares, and faster confirmations. We keep that data locked down and only use it when you want the trip to move.
                </Text>

                <View style={styles.promiseList}>
                  <PromiseRow icon="lock-closed"    text="Encrypted in your phone's secure storage" />
                  <PromiseRow icon="finger-print"   text={`Protected by ${biometricLabel} — only you`} />
                    <PromiseRow icon="person"         text="More profile detail means Ace can stop asking basics on every booking" />
                    <PromiseRow icon="checkmark-done" text="Only the details needed for the journey you approve are shared" />
                  <PromiseRow icon="server"         text="Trip and receipt records may be kept so Ace can reopen your journey" />
                  <PromiseRow icon="trash"          text="Delete everything from Settings anytime" />
                </View>

                <View style={styles.consentToggles}>
                  <ConsentRow
                    label="Allow location for nearby stations"
                      sub="Lets Ace suggest the right nearby station instead of making you type it every time"
                    value={locationConsent}
                    onToggle={setLocationConsent}
                  />
                  <ConsentRow
                    label="Booking updates"
                      sub="Lets Ace warn you about booking progress, delays, and last-minute changes"
                    value={notifConsent}
                    onToggle={setNotifConsent}
                  />
                </View>

                  <PrimaryBtn onPress={handleAcceptPrivacy} label="Continue with these protections" />

                <Text style={styles.legalNote}>
                    Ace asks for meaningful data because it is trying to act, not just chat. By continuing you accept our{' '}
                  <Text style={styles.legalLink} onPress={() => router.push('/legal/terms')}>
                    Terms of Service
                  </Text>
                  {' '}and{' '}
                  <Text style={styles.legalLink} onPress={() => router.push('/legal/privacy')}>
                    Privacy Policy
                  </Text>
                  .
                </Text>
              </View>
            )}

            {/* ── Step 4: Travel Profile ───────────────────────────────── */}
            {step === 'profile' && (
              <View style={styles.stepWrap}>
                <Text style={styles.stepTitle}>Set Ace up properly.</Text>
                <Text style={styles.stepSub}>
                  This is the data that makes Ace useful. The more complete this is, the less back-and-forth you get during booking and the less likely you are to hit fare, identity, or ticket-delivery issues. It stays on this device and is protected with {biometricLabel}.
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
                    color={voiceFilling ? '#a7d5ff' : '#6b7280'}
                  />
                  <Text style={[profileStyles.voiceBtnText, voiceFilling && profileStyles.voiceBtnTextActive]}>
                    {voiceFilling ? 'Ace is listening…' : 'Fill in by voice'}
                  </Text>
                </Pressable>
                {voiceFillHint && (
                  <Text style={profileStyles.voiceHint}>{voiceFillHint}</Text>
                )}

                {/* ── Train essentials (always visible) ─────────────── */}
                  <SectionLabel text="ESSENTIALS FOR REAL BOOKINGS" />
                <TextInput
                  style={styles.input}
                  value={legalName}
                  onChangeText={setLegalName}
                    placeholder="Full name exactly as it should appear on tickets"
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
                        {nat === 'uk' ? 'United Kingdom' : nat === 'india' ? 'India' : 'Global'}
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
                        {RAILCARD_LABELS[railcardType]} — Ace will apply your discount automatically
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
                    Travel document — required for Eurostar and some IRCTC bookings
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

                  <Text style={styles.profileExplainer}>
                    Name and contact details help Ace complete checkout without stopping to ask you again. Travel preferences and railcards help it search better options before it gets to payment.
                  </Text>

                <Pressable
                  onPress={handleSaveProfile}
                  style={[styles.primaryBtn, profileSaving && { opacity: 0.6 }]}
                  disabled={profileSaving}
                >
                  <LinearGradient
                    colors={['#102031', '#1d3448']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.btnGrad}
                  >
                    {profileSaving ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="finger-print" size={20} color="#dcecff" />
                        <Text style={[styles.btnText, { color: '#dcecff' }]}>
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
                      ? "Skip — but Ace will be weaker without an email for ticket delivery"
                      : "Skip for now — but fuller details mean fewer booking interruptions later"}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* ── Step 5: Finish ───────────────────────────────────────── */}
            {step === 'finish' && (
              <View style={styles.stepWrap}>
                <Text style={styles.stepTitle}>
                  Ready{userName.trim() ? `, ${userName.trim()}` : ''}.
                </Text>
                <Text style={styles.stepSub}>
                  Ace is ready for the first booking. You will still approve important moments, and Ace will handle the rest.
                </Text>

                {/* Time saved strip */}
                <View style={finishStyles.savedStrip}>
                  <View style={finishStyles.savedItem}>
                    <Text style={finishStyles.savedNum}>~4 min</Text>
                    <Text style={finishStyles.savedLabel}>saved per booking</Text>
                  </View>
                  <View style={finishStyles.savedDivider} />
                  <View style={finishStyles.savedItem}>
                    <Text style={finishStyles.savedNum}>Less chasing</Text>
                    <Text style={finishStyles.savedLabel}>Ace keeps the trip moving</Text>
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
                    colors={['#102031', '#1d3448']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.btnGrad}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="sparkles-outline" size={20} color="#fff" />
                        <Text style={styles.btnText}>Start with Ace</Text>
                      </>
                    )}
                  </LinearGradient>
                </Pressable>

                <Text style={styles.legalNote}>
                  Secure payments are built in.{'\n'}
                  Ace works best when your profile is complete and your consent choices are clear.
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

/** Map demo-only phase names to AppPhase for the shared Ace brain. */
function demoPhaseTo(dp: string): AppPhase {
  if (dp === 'listening') return 'listening';
  if (dp === 'thinking')  return 'thinking';
  if (dp === 'done')      return 'done';
  return 'idle';
}

/** Generate a convincing scripted mock response based on what the user said */
function getDemoResponse(transcript: string, nationality: Nationality): string {
  const t = transcript.toLowerCase();
  if (nationality === 'india' && t.match(/train|rail|delhi|agra|mumbai|bangalore|bengaluru|chennai|kolkata|pune|hyderabad|irctc|upi|metro/)) {
    return "Found a strong rail option and I can carry it through with your IRCTC details, then hand you off to UPI or fingerprint confirmation.";
  }
  if (t.match(/bus|coach|flixbus|greyhound|megabus|redcoach/)) {
    return "Found a strong coach option with the right departure and fare. In the real app, I'd line it up and carry it through with one confirm.";
  }
  if (t.match(/flight|fly|airport|heathrow|gatwick|stansted|plane|barcelona|rome|paris|new york/)) {
    return "Found the best flight set and I can pair it with the ground leg when the journey needs it.";
  }
  if (t.match(/train|rail|london|manchester|birmingham|derby|euston|paddington|victoria|liverpool|edinburgh|glasgow/)) {
    return "Found an Avanti at 09:45 for around £28. In the real app, that's confirmed with your fingerprint in 3 seconds.";
  }
  if (t.match(/taxi|cab|ride|uber|driver|lift|car/)) {
    return "Ace is strongest on the booked trip and the final leg. Ask for the journey first, then I'll carry you through the rest.";
  }
  if (t.match(/hotel|room|stay|night|accommodation|b&b|inn/)) {
    return "I can work the trip around the stay, but transport is still the strongest part of the product.";
  }
  if (t.match(/food|restaurant|eat|dinner|lunch|table|reservation/)) {
    return "I can add that once the trip is moving. Ask for the journey first and I'll build around it.";
  }
  const preview = transcript.trim().slice(0, 35);
  return `Heard "${preview}…". In the real app, I'd find the best option and book it — fingerprint to confirm.`;
}

// ── Sub-components ────────────────────────────────────────────────────────

function PrimaryBtn({ onPress, label, disabled }: { onPress: () => void; label: string; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.primaryBtn, disabled && { opacity: 0.5 }]}>
      <LinearGradient
        colors={['#102031', '#1d3448']}
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

function PromiseRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={promiseStyles.row}>
      <Ionicons name={icon as any} size={16} color="#cbe8ff" />
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
        trackColor={{ false: '#1f2937', true: '#24384d' }}
        thumbColor={value ? '#dcecff' : '#6b7280'}
      />
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={sectionStyles.label}>{text}</Text>;
}

// ── Styles ─────────────────────────────────────────────────────────────────

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
    shadowColor: '#8dbfe7', shadowOffset: { width: 0, height: 0 },
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
    backgroundColor: '#102031', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(122, 167, 214, 0.18)',
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
  irctcLinkText: { fontSize: 12, color: '#8dbfe7', textDecorationLine: 'underline' },

  prefLabel: { fontSize: 12, color: '#6b7280', marginBottom: 8 },

  // Chips
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1, borderColor: '#1f2937',
    backgroundColor: '#0d0d0d',
  },
  chipActive:     { backgroundColor: '#102031', borderColor: '#335772' },
  chipText:       { fontSize: 14, fontWeight: '500', color: '#6b7280' },
  chipTextActive: { color: '#dcecff' },

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
  profileExplainer: { fontSize: 12, color: '#4b5563', lineHeight: 18, textAlign: 'center', marginBottom: 16, marginTop: -4 },
  legalNote:{ fontSize: 11, color: '#374151', textAlign: 'center', lineHeight: 17, marginTop: 8 },
  legalLink:{ color: '#a9dcff', textDecorationLine: 'underline' },
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
  marketWrap: {
    position: 'absolute',
    top: 78,
    left: 28,
    right: 28,
  },
  marketLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4b5563',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  marketChip: {
    marginBottom: 0,
  },
  marketHint: {
    marginTop: -6,
    marginBottom: 10,
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 19,
  },
  orbArea: {
    marginBottom: 32,
    marginTop: 124,
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
  voiceBtnTextActive: { color: '#cfe5f7' },
  voiceHint:    { fontSize: 12, color: '#a7d5ff', marginBottom: 16, textAlign: 'center' },
  docsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    marginBottom: 8,
  },
  docsToggleText: { fontSize: 13, color: '#4b5563', flex: 1 },
});
