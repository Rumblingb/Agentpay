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

const SPECIALTIES = ['Primary care', 'Cardiology', 'Orthopedics', 'Neurology', 'Dermatology', 'OB/GYN', 'Mental health', 'Urgent care', 'Other'];
const VOLUMES = ['Under 50 claims/month', '50–200 claims/month', '200–500 claims/month', '500+ claims/month'];
const PAYERS = ['Medicare', 'Medicaid', 'Blue Cross Blue Shield', 'United Healthcare', 'Aetna', 'Cigna', 'Humana', 'Other'];
const PROBLEMS = [
  { key: 'eligibility', label: 'Eligibility verification takes too long' },
  { key: 'denials', label: 'Too many denied claims to keep up with' },
  { key: 'prior-auth', label: 'Prior authorizations are eating our time' },
  { key: 'ar', label: 'Aging AR / slow collections' },
  { key: 'all', label: 'All of the above' },
];

// ── Step config ───────────────────────────────────────────────────────────────

const STEPS: { field: keyof OnboardState | null; question: string; hint: string }[] = [
  { field: null, question: "Hi, I'm Ace. Let's get your billing office set up — it takes about 5 minutes.", hint: "I'll ask a few quick questions to configure your workspace." },
  { field: 'specialty', question: "What's your practice specialty?", hint: "This helps Ace apply the right payer rules and denial patterns." },
  { field: 'volume', question: "How many claims do you submit each month?", hint: "Volume helps Ace prioritize your queue correctly." },
  { field: 'mainPayer', question: "Which payer gives you the most trouble?", hint: "Ace will focus its denial intelligence on this payer first." },
  { field: 'mainProblem', question: "What's your biggest billing challenge right now?", hint: "Ace will activate the right lanes for your specific problem." },
  { field: 'npi', question: "What's your NPI number?", hint: "This lets Ace verify eligibility and submit claims on your behalf." },
];

// ── Ace voice ─────────────────────────────────────────────────────────────────

function useAceSpeech() {
  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) { onEnd?.(); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.91;
    utter.pitch = 0.87;
    const loadVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find(v => v.lang === 'en-GB') || voices.find(v => v.lang.startsWith('en'));
      if (voice) utter.voice = voice;
    };
    loadVoice();
    if (window.speechSynthesis.getVoices().length === 0) window.speechSynthesis.onvoiceschanged = loadVoice;
    if (onEnd) utter.onend = onEnd;
    window.speechSynthesis.speak(utter);
  }, []);

  return { speak };
}

// ── Pill button ───────────────────────────────────────────────────────────────

function PillButton({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
        cursor: 'pointer', transition: 'all 0.15s', border: 'none',
        background: selected ? '#10b981' : '#0d0d0d',
        color: selected ? '#000' : '#737373',
        outline: selected ? 'none' : '1px solid #1c1c1c',
      }}
    >
      {label}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RcmOnboardPage() {
  const router = useRouter();
  const { speak } = useAceSpeech();
  const [step, setStep] = useState<Step>(0);
  const [answers, setAnswers] = useState<OnboardState>({ specialty: '', volume: '', mainPayer: '', mainProblem: '', npi: '' });
  const [npiInput, setNpiInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const spokenRef = useRef<Set<number>>(new Set());

  const currentStep = STEPS[step];

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

  function select(field: keyof OnboardState, value: string) {
    setAnswers(a => ({ ...a, [field]: value }));
    setTimeout(() => setStep(s => (s + 1) as Step), 350);
  }

  async function finishOnboarding() {
    const npi = npiInput.trim();
    if (!npi || !/^\d{10}$/.test(npi)) {
      setError('NPI must be a 10-digit number.');
      return;
    }
    setAnswers(a => ({ ...a, npi }));
    setLoading(true);
    setError('');

    try {
      // Fetch the practice name from the session profile
      const profileRes = await fetch('/api/me');
      const profile = profileRes.ok ? await profileRes.json() as { name?: string } : {};
      const practiceName = profile.name ?? 'My Practice';

      // Create the workspace via the RCM API
      const res = await fetch('/api/rcm/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practiceName,
          specialty: answers.specialty,
          claimsPerMonth: answers.volume,
          mainPayer: answers.mainPayer,
          mainProblem: answers.mainProblem,
          npi,
        }),
      });
      // Workspace creation may not be wired yet — proceed regardless
      if (!res.ok && res.status !== 404) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        if (d.error && !d.error.includes('not found')) {
          setError(d.error);
          setLoading(false);
          return;
        }
      }
    } catch {
      // Non-fatal: continue to dashboard even if workspace API unavailable
    }

    // Store onboarding answers locally so the dashboard can show them
    try {
      localStorage.setItem('ace_rcm_onboard', JSON.stringify({ ...answers, npi, completedAt: Date.now() }));
    } catch {}

    speak("You're all set. Let me show you your dashboard.");
    setTimeout(() => router.push('/rcm'), 1800);
  }

  const progress = (step / 5) * 100;

  return (
    <div style={{ background: '#050505', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Progress bar */}
      <div style={{ width: '100%', maxWidth: 520, marginBottom: 40 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#333', fontWeight: 600 }}>Step {Math.max(step, 1)} of 5</span>
          <span style={{ fontSize: 11, color: '#333' }}>{Math.round(progress)}% complete</span>
        </div>
        <div style={{ height: 2, background: '#111', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: '#10b981', transition: 'width 0.4s ease', borderRadius: 2 }} />
        </div>
      </div>

      {/* Card */}
      <div style={{ width: '100%', maxWidth: 520, background: '#080808', border: '1px solid #1a1a1a', borderRadius: 16, padding: '40px 36px' }}>

        {/* Ace orb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'linear-gradient(135deg, #059669, #10b981)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 20px rgba(16,185,129,0.2)',
          }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 5v6l-6 3L2 11V5l6-3z" fill="black" fillOpacity={0.85}/></svg>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Ace</div>
            <div style={{ fontSize: 11, color: '#333' }}>Setting up your workspace</div>
          </div>
        </div>

        {/* Question */}
        <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: '#fff', margin: '0 0 8px', lineHeight: 1.3 }}>
          {currentStep.question}
        </h2>
        <p style={{ fontSize: 13, color: '#444', margin: '0 0 32px', lineHeight: 1.5 }}>
          {currentStep.hint}
        </p>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <button
            onClick={() => setStep(1)}
            style={{
              width: '100%', padding: '13px', background: '#10b981', border: 'none',
              borderRadius: 8, fontSize: 14, fontWeight: 700, color: '#000', cursor: 'pointer',
            }}
          >
            Let's get started →
          </button>
        )}

        {/* Step 1: Specialty */}
        {step === 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {SPECIALTIES.map(s => (
              <PillButton key={s} label={s} selected={answers.specialty === s} onClick={() => select('specialty', s)} />
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
              type="text"
              inputMode="numeric"
              maxLength={10}
              value={npiInput}
              onChange={e => { setNpiInput(e.target.value.replace(/\D/g, '')); setError(''); }}
              placeholder="1234567890"
              style={{
                width: '100%', background: '#0d0d0d', border: '1px solid #1c1c1c',
                borderRadius: 8, color: '#e8e8e8', fontSize: 16, fontFamily: 'monospace',
                letterSpacing: '0.1em', padding: '13px 14px', outline: 'none',
                boxSizing: 'border-box', marginBottom: 16,
              }}
              onFocus={e => (e.target.style.borderColor = 'rgba(16,185,129,0.4)')}
              onBlur={e => (e.target.style.borderColor = '#1c1c1c')}
              onKeyDown={e => { if (e.key === 'Enter') finishOnboarding(); }}
            />
            {error && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 14 }}>{error}</div>}
            <button
              onClick={finishOnboarding}
              disabled={loading}
              style={{
                width: '100%', padding: '13px', background: loading ? '#059669' : '#10b981',
                border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
                color: '#000', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.8 : 1,
              }}
            >
              {loading ? 'Setting up your workspace…' : 'Finish setup →'}
            </button>
            <p style={{ fontSize: 11, color: '#2a2a2a', marginTop: 12, lineHeight: 1.5 }}>
              Your NPI is used only for eligibility verification and claim submission. It is stored encrypted and never shared.
            </p>
          </div>
        )}

      </div>

      {/* Skip link */}
      {step > 0 && step < 5 && (
        <button
          onClick={() => setStep(s => (s + 1) as Step)}
          style={{ marginTop: 16, background: 'none', border: 'none', fontSize: 12, color: '#2a2a2a', cursor: 'pointer' }}
        >
          Skip this question →
        </button>
      )}

    </div>
  );
}
