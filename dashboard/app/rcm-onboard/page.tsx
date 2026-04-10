'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

// ── Types ────────────────────────────────────────────────────────────────────

type Step = 0 | 1 | 2 | 3 | 4 | 5;

interface OnboardState {
  specialty: string;
  volume: string;
  mainPayer: string;
  mainProblem: string;
  npi: string;
}

const SPECIALTY_GROUPS = [
  {
    group: 'Physician practices',
    items: ['Primary care', 'Cardiology', 'Orthopedics', 'Neurology', 'Dermatology', 'OB/GYN', 'Mental health', 'Urgent care'],
  },
  {
    group: 'Hospital & facility',
    items: ['Acute Care Hospital', 'Critical Access Hospital', 'Ambulatory Surgery Center', 'Skilled Nursing Facility', 'Inpatient Rehabilitation', 'Behavioral Health (Inpatient)', 'Long-Term Acute Care'],
  },
];

const HOSPITAL_SPECIALTIES = new Set(SPECIALTY_GROUPS[1].items);

const VOLUMES = ['Under 50 claims or encounters/month', '50–200 claims or encounters/month', '200–500 claims or encounters/month', '500+ claims or encounters/month'];
const PAYERS = ['Medicare', 'Medicaid', 'Blue Cross Blue Shield', 'United Healthcare', 'Aetna', 'Cigna', 'Humana', 'Other'];
const PROBLEMS = [
  { key: 'eligibility', label: 'Eligibility verification takes too long' },
  { key: 'denials', label: 'Too many denied claims to keep up with' },
  { key: 'prior-auth', label: 'Prior authorizations are eating our time' },
  { key: 'ar', label: 'Aging AR / slow collections' },
  { key: 'drg', label: 'DRG denials / coding disputes' },
  { key: 'charge-capture', label: 'Charge capture / late charges' },
  { key: 'all', label: 'All of the above' },
];

// ── Step config ───────────────────────────────────────────────────────────────

function getSteps(answers: OnboardState): { field: keyof OnboardState | null; question: string; hint: string }[] {
  const specialtyHint = answers.specialty
    ? `For ${answers.specialty.toLowerCase()} practices, denials usually concentrate around a few specific payers.`
    : "Ace will focus its denial intelligence on this payer first.";

  const volumePayer = [
    answers.volume ? `With ${answers.volume.toLowerCase()},` : null,
    answers.mainPayer ? `especially from ${answers.mainPayer},` : null,
  ].filter(Boolean).join(' ');
  const problemHint = volumePayer
    ? `${volumePayer} Ace will activate the right automation lanes for your specific challenge.`
    : "Ace will activate the right lanes for your specific problem.";

  return [
    { field: null, question: "Hi, I'm Ace. Let me get your authorization set up — this takes about 5 minutes.", hint: "I need a few things to start working on your behalf." },
    { field: 'specialty', question: "What's your practice specialty?", hint: "This helps Ace apply the right payer rules and denial patterns." },
    { field: 'volume', question: "How many claims do you submit each month?", hint: "Volume helps Ace prioritize your queue correctly." },
    { field: 'mainPayer', question: "Which payer gives you the most trouble?", hint: specialtyHint },
    { field: 'mainProblem', question: "What's your biggest billing challenge right now?", hint: problemHint },
    {
      field: 'npi',
      question: "Authorize Ace to act on your behalf",
      hint: HOSPITAL_SPECIALTIES.has(answers.specialty)
        ? "Your billing NPI identifies your facility with payers. Some payers also require your CCN (CMS Certification Number)."
        : "Your NPI is how Ace identifies your practice with payers. Required to submit and verify claims.",
    },
  ];
}

// ── TTS hook ──────────────────────────────────────────────────────────────────

function useTts() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const browserSpeak = useCallback((text: string, onEnd?: () => void) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) { onEnd?.(); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.91; utter.pitch = 0.87;
    const loadVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find(v => v.lang === 'en-GB') || voices.find(v => v.lang.startsWith('en'));
      if (v) utter.voice = v;
    };
    loadVoice();
    if (window.speechSynthesis.getVoices().length === 0) window.speechSynthesis.onvoiceschanged = loadVoice;
    utter.onend = () => { setSpeaking(false); onEnd?.(); };
    utter.onerror = () => { setSpeaking(false); onEnd?.(); };
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  }, []);

  const speak = useCallback(async (text: string, onEnd?: () => void) => {
    const muted = typeof localStorage !== 'undefined' && localStorage.getItem('ace_onboard_muted') === '1';
    if (muted) { onEnd?.(); return; }

    try {
      const res = await fetch('/api/tts-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('non-ok');
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        // fallback signal
        const d = await res.json() as { fallback?: boolean };
        if (d.fallback) { browserSpeak(text, onEnd); return; }
        throw new Error('unexpected json');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setSpeaking(true);
      audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); onEnd?.(); };
      audio.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url); onEnd?.(); };
      await audio.play();
    } catch {
      browserSpeak(text, onEnd);
    }
  }, [browserSpeak]);

  const stop = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { speak, stop, speaking };
}

// ── Pill button ───────────────────────────────────────────────────────────────

function PillButton({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
        cursor: 'pointer', transition: 'all 0.15s', border: 'none',
        background: selected ? '#10b981' : hovered ? '#111' : '#0d0d0d',
        color: selected ? '#000' : '#ededef',
        outline: selected ? 'none' : `1px solid #2a2a2a`,
      }}
    >
      {selected && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 6l3 3 5-5" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
      {label}
    </button>
  );
}

// ── Ace waveform ──────────────────────────────────────────────────────────────

function AceWaveform() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 18 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          className="wave-bar"
          style={{
            width: 3, height: 14, borderRadius: 2,
            background: '#10b981',
            animationDelay: `${(i - 1) * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RcmOnboardPage() {
  const router = useRouter();
  const { speak, stop, speaking } = useTts();
  const [step, setStep] = useState<Step>(0);
  const [answers, setAnswers] = useState<OnboardState>({ specialty: '', volume: '', mainPayer: '', mainProblem: '', npi: '' });
  const [npiInput, setNpiInput] = useState('');
  const [npiOpen, setNpiOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');
  const [muted, setMuted] = useState(false);
  const spokenRef = useRef<Set<number>>(new Set());
  const npiRef = useRef<HTMLInputElement>(null);

  const STEPS = getSteps(answers);
  const currentStep = STEPS[step];

  // Sync muted from localStorage
  useEffect(() => {
    const stored = typeof localStorage !== 'undefined' && localStorage.getItem('ace_onboard_muted') === '1';
    setMuted(stored);
  }, []);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (typeof localStorage !== 'undefined') localStorage.setItem('ace_onboard_muted', next ? '1' : '0');
    if (next) stop();
  }

  // Ace speaks each question once
  useEffect(() => {
    if (spokenRef.current.has(step)) return;
    spokenRef.current.add(step);
    const text = step === 0
      ? currentStep.question + ' ' + currentStep.hint
      : currentStep.question;
    const t = setTimeout(() => speak(text), 300);
    return () => clearTimeout(t);
  }, [step, currentStep, speak]);

  // Autofocus NPI input on step 5
  useEffect(() => {
    if (step === 5) setTimeout(() => npiRef.current?.focus(), 100);
  }, [step]);

  function select(field: keyof OnboardState, value: string) {
    setAnswers(a => ({ ...a, [field]: value }));
    setTimeout(() => setStep(s => (s + 1) as Step), 350);
  }

  async function finishOnboarding() {
    const npi = npiInput.trim();
    if (!npi || !/^\d{10}$/.test(npi)) {
      setError('NPI must be exactly 10 digits.');
      return;
    }
    setAnswers(a => ({ ...a, npi }));
    setLoading(true);
    setError('');

    try {
      const profileRes = await fetch('/api/me');
      const profile = profileRes.ok ? await profileRes.json() as { name?: string } : {};
      const practiceName = profile.name ?? 'My Practice';

      const res = await fetch('/api/rcm/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practiceName,
          specialty: answers.specialty,
          workspaceType: HOSPITAL_SPECIALTIES.has(answers.specialty) ? 'institutional' : 'professional_rcm',
          claimsPerMonth: answers.volume,
          mainPayer: answers.mainPayer,
          mainProblem: answers.mainProblem,
          npi,
        }),
      });
      if (!res.ok && res.status !== 404) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        if (d.error && !d.error.includes('not found')) {
          setWorkspaceError(d.error);
          setLoading(false);
          // Non-blocking — continue to dashboard after 3s
          try {
            localStorage.setItem('ace_rcm_onboard', JSON.stringify({ ...answers, npi, completedAt: Date.now() }));
          } catch {}
          speak("Your agent is now active. Let me show you your dashboard.");
          setTimeout(() => router.push('/rcm'), 3000);
          return;
        }
      }
    } catch (err) {
      console.warn('[rcm-onboard] workspace creation network error:', err);
      // Non-fatal — continue to dashboard
    }

    try {
      localStorage.setItem('ace_rcm_onboard', JSON.stringify({ ...answers, npi, completedAt: Date.now() }));
    } catch {}

    speak("Your agent is now active. Let me show you your dashboard.");
    setTimeout(() => router.push('/rcm'), 1800);
  }

  const progress = (step / 5) * 100;

  return (
    <div style={{ background: '#050505', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Progress */}
      <div className="fade-up" style={{ width: '100%', maxWidth: 520, marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: '#555', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {step === 0 ? 'Welcome' : `${step}/5`}
          </span>
          <span style={{ fontSize: 11, color: '#555' }}>{Math.round(progress)}% complete</span>
        </div>
        <div style={{ height: 2, background: '#141414', borderRadius: 2, overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ height: '100%', width: `${progress}%`, background: '#10b981', transition: 'width 0.4s ease', borderRadius: 2 }} />
        </div>
        {/* Step dots */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
          {[1, 2, 3, 4, 5].map(n => (
            <div key={n} style={{
              width: n === step ? 16 : 6, height: 6, borderRadius: 3,
              background: n < step ? '#10b981' : n === step ? '#10b981' : '#1c1c1c',
              transition: 'all 0.2s',
              border: n === step ? 'none' : n < step ? 'none' : '1px solid #2a2a2a',
            }} />
          ))}
        </div>
      </div>

      {/* Card */}
      <div className="fade-up" style={{ width: '100%', maxWidth: 520, background: '#080808', border: '1px solid #141414', borderRadius: 16, padding: '36px 32px' }}>

        {/* Ace header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              onClick={toggleMute}
              title={muted ? 'Unmute Ace' : 'Mute Ace'}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <div className={speaking && !muted ? 'ace-pulse' : undefined} style={{
                width: 44, height: 44, borderRadius: '50%',
                background: muted
                  ? 'linear-gradient(135deg, #1c1c1c, #2a2a2a)'
                  : 'linear-gradient(135deg, #059669, #10b981)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: muted ? 'none' : '0 0 20px rgba(16,185,129,0.2)',
                transition: 'all 0.2s',
                flexShrink: 0,
              }}>
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2L14 5v6l-6 3L2 11V5l6-3z" fill={muted ? '#555' : 'black'} fillOpacity={0.85}/>
                </svg>
              </div>
            </button>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#ededef', display: 'flex', alignItems: 'center', gap: 8 }}>
                Ace
                {speaking && !muted && <AceWaveform />}
                {muted && <span style={{ fontSize: 10, color: '#444', fontWeight: 500 }}>muted</span>}
              </div>
              <div style={{ fontSize: 11, color: '#555' }}>Setting up your workspace</div>
            </div>
          </div>
        </div>

        {/* Animated step content */}
        <div key={step} className="step-slide">
          {/* Question */}
          <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: '#ededef', margin: '0 0 8px', lineHeight: 1.3 }}>
            {currentStep.question}
          </h2>
          <p style={{ fontSize: 13, color: '#666', margin: '0 0 28px', lineHeight: 1.6 }}>
            {currentStep.hint}
          </p>

          {/* Step 0: Welcome */}
          {step === 0 && (
            <button
              onClick={() => setStep(1)}
              style={{
                width: '100%', padding: '14px', background: '#10b981', border: 'none',
                borderRadius: 10, fontSize: 15, fontWeight: 700, color: '#000', cursor: 'pointer',
                letterSpacing: '-0.01em',
              }}
            >
              {"Let's get started \u2192"}
            </button>
          )}

          {/* Step 1: Specialty */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {SPECIALTY_GROUPS.map(group => (
                <div key={group.group}>
                  <div style={{ fontSize: 10, color: '#555', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                    {group.group}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {group.items.map(s => (
                      <PillButton key={s} label={s} selected={answers.specialty === s} onClick={() => select('specialty', s)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Step 2: Volume */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {VOLUMES.map(v => (
                <PillButton key={v} label={v} selected={answers.volume === v} onClick={() => select('volume', v)} />
              ))}
            </div>
          )}

          {/* Step 3: Main payer */}
          {step === 3 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {PAYERS.map(p => (
                <PillButton key={p} label={p} selected={answers.mainPayer === p} onClick={() => select('mainPayer', p)} />
              ))}
            </div>
          )}

          {/* Step 4: Main problem */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {PROBLEMS.map(p => (
                <PillButton key={p.key} label={p.label} selected={answers.mainProblem === p.key} onClick={() => select('mainProblem', p.key)} />
              ))}
            </div>
          )}

          {/* Step 5: NPI */}
          {step === 5 && (
            <div>
              <input
                ref={npiRef}
                type="text"
                inputMode="numeric"
                maxLength={10}
                value={npiInput}
                onChange={e => { setNpiInput(e.target.value.replace(/\D/g, '')); setError(''); }}
                placeholder="1234567890"
                style={{
                  width: '100%', background: '#0d0d0d',
                  border: `1px solid ${error ? 'rgba(244,63,94,0.35)' : '#1c1c1c'}`,
                  borderRadius: 10, color: '#ededef', fontSize: 16, fontFamily: 'monospace',
                  letterSpacing: '0.1em', padding: '13px 14px', outline: 'none',
                  boxSizing: 'border-box', marginBottom: error ? 8 : 16,
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => (e.target.style.borderColor = 'rgba(16,185,129,0.35)')}
                onBlur={e => (e.target.style.borderColor = error ? 'rgba(244,63,94,0.35)' : '#1c1c1c')}
                onKeyDown={e => { if (e.key === 'Enter') finishOnboarding(); }}
              />
              {error && <div style={{ fontSize: 12, color: '#fb7185', marginBottom: 14 }}>{error}</div>}

              {/* NPI explainer toggle */}
              <div style={{ marginBottom: 20 }}>
                <button
                  type="button"
                  onClick={() => setNpiOpen(o => !o)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <span style={{ fontSize: 11, color: '#555', letterSpacing: '0.04em' }}>What is an NPI?</span>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: npiOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                    <path d="M2 3.5l3 3 3-3" stroke="#555" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {npiOpen && (
                  <div style={{ marginTop: 10, padding: '12px 14px', background: '#0d0d0d', border: '1px solid #1c1c1c', borderRadius: 8, fontSize: 12, color: '#737373', lineHeight: 1.6 }}>
                    Your National Provider Identifier — a 10-digit number assigned to every healthcare provider in the US. {"You'll"} find it on your insurance provider forms or at <span style={{ color: '#34d399', fontFamily: 'monospace' }}>nppes.cms.hhs.gov</span>.
                  </div>
                )}
              </div>

              <button
                onClick={finishOnboarding}
                disabled={loading}
                style={{
                  width: '100%', padding: '14px',
                  background: loading ? '#059669' : '#10b981',
                  border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700,
                  color: '#000', cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.85 : 1, letterSpacing: '-0.01em',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'opacity 0.15s',
                }}
              >
                {loading && (
                  <svg className="spin" width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="rgba(0,0,0,0.3)" strokeWidth="2"/>
                    <path d="M8 2a6 6 0 0 1 6 6" stroke="#000" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                )}
                {loading ? 'Setting up your workspace\u2026' : 'Finish setup \u2192'}
              </button>

              {workspaceError && (
                <div style={{
                  marginTop: 14, padding: '12px 14px',
                  background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
                  borderRadius: 8, fontSize: 12, color: '#fbbf24', lineHeight: 1.6,
                }}>
                  Workspace setup had an issue — don&apos;t worry, you can complete it from your dashboard.
                  <span style={{ display: 'block', marginTop: 4, color: '#a16207', fontSize: 11 }}>{workspaceError}</span>
                </div>
              )}

              <p style={{ fontSize: 11, color: '#444', marginTop: 14, lineHeight: 1.6 }}>
                Your NPI is used only for eligibility verification and claim submission. Stored encrypted and never shared.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Skip — hidden on step 5 */}
      {step > 0 && step < 5 && (
        <button
          onClick={() => setStep(s => (s + 1) as Step)}
          style={{ marginTop: 18, background: 'none', border: 'none', fontSize: 12, color: '#444', cursor: 'pointer', letterSpacing: '0.02em' }}
        >
          Skip this question
        </button>
      )}

    </div>
  );
}
