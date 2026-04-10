'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

// ── Types ────────────────────────────────────────────────────────────────────

type DemoState = 'idle' | 'ace-speaking' | 'listening' | 'processing' | 'responded';

// ── Pain-point response map ───────────────────────────────────────────────────

function mapTranscriptToResponse(transcript: string): string {
  const t = transcript.toLowerCase();
  if (/denial|denied|reject|reason code|CO-|PR-|remark|appeal/.test(t)) {
    return 'Most denial patterns are predictable — CO-97, CO-4, PR-96. Ace identifies the pattern, maps the exact fix protocol, and queues the corrected resubmission for one-click approval. You stop touching the same denial twice.';
  }
  if (/eligib|verify|coverage|active|patient|benefit|deductible|copay/.test(t)) {
    return 'With 20-30 patients a day, eligibility checks eat two to three hours every morning. Ace runs them all overnight across every payer and flags any coverage issues before the patient walks through the door.';
  }
  if (/prior auth|preauth|authorization|precert|approval/.test(t)) {
    return 'Prior auth is brutal — some specialties spend 40 hours a week just on hold. Ace tracks every outstanding authorization, follows up automatically with the payer, and only escalates when a human decision is genuinely required.';
  }
  if (/AR|aging|collection|write.off|90 day|outstanding|unpaid/.test(t)) {
    return "Ace watches every claim in your AR. At 30 days it follows up automatically. At 60 it escalates. Nothing reaches 90-day write-off territory without you seeing it first.";
  }
  if (/Medicare|Medicaid|CMS|government/.test(t)) {
    return 'Medicare and Medicaid are Ace\'s most-used lanes. Government payer timely filing windows, NPI validation, and ERA 835 remittance codes are all handled automatically.';
  }
  if (/time|slow|hours|manual|behind|overwhelmed|staff|short/.test(t)) {
    return 'Billing managers lose an average of 14 hours a week on mechanical tasks. Ace handles the routine work. You only see the exceptions that genuinely need a human decision.';
  }
  return 'Whatever is slowing you down — eligibility, denials, AR, prior auth — Ace handles it automatically. You set it up once, then only see what genuinely needs you.';
}

// ── Voice demo hook ───────────────────────────────────────────────────────────

function useVoiceDemo() {
  const [state, setState] = useState<DemoState>('idle');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) setSupported(false);
    }
  }, []);

  const browserSpeak = useCallback((text: string, onEnd?: () => void) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) { onEnd?.(); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const loadVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find(v => v.lang === 'en-GB' && !v.name.includes('Google'))
        || voices.find(v => v.lang === 'en-GB')
        || voices.find(v => v.lang.startsWith('en'));
      if (voice) utter.voice = voice;
    };
    loadVoice();
    if (window.speechSynthesis.getVoices().length === 0) window.speechSynthesis.onvoiceschanged = loadVoice;
    utter.rate = 0.92;
    utter.pitch = 0.88;
    utter.volume = 1;
    utter.onend = () => onEnd?.();
    window.speechSynthesis.speak(utter);
  }, []);

  const aceSpeak = useCallback(async (text: string, onEnd?: () => void) => {
    // Stop any currently playing audio
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    window.speechSynthesis?.cancel();

    try {
      const res = await fetch('/api/tts-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      // 503 with fallback:true means key not configured — use browser TTS
      if (res.status === 503) {
        browserSpeak(text, onEnd);
        return;
      }
      if (!res.ok) throw new Error('tts failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); audioRef.current = null; onEnd?.(); };
      audio.onerror = () => { URL.revokeObjectURL(url); audioRef.current = null; onEnd?.(); };
      await audio.play();
    } catch {
      browserSpeak(text, onEnd);
    }
  }, [browserSpeak]);

  const startDemo = useCallback(() => {
    setState('ace-speaking');
    aceSpeak("Tell me what's happening with your billing. Denials, eligibility, prior auth — whatever's slowing you down.", () => {
      setState('listening');
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) { setState('idle'); return; }
      const rec = new SR();
      rec.lang = 'en-US';
      rec.continuous = false;
      rec.interimResults = false;
      rec.onresult = (e: any) => {
        const text = e.results[0]?.[0]?.transcript ?? '';
        setTranscript(text);
        setState('processing');
        setTimeout(() => {
          const r = mapTranscriptToResponse(text);
          setResponse(r);
          setState('responded');
          aceSpeak(r);
        }, 600);
      };
      rec.onerror = () => setState('idle');
      rec.onend = () => { if (state === 'listening') setState('idle'); };
      recognitionRef.current = rec;
      rec.start();
    });
  }, [aceSpeak, state]);

  const reset = useCallback(() => {
    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setState('idle');
    setTranscript('');
    setResponse('');
  }, []);

  return { state, transcript, response, supported, startDemo, reset };
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ value, label, detail }: { value: string; label: string; detail: string }) {
  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '24px 20px' }}>
      <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.04em', color: '#10b981', marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#e8e8e8', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 12, color: '#525252', lineHeight: 1.5 }}>{detail}</div>
    </div>
  );
}

// ── Feature row ───────────────────────────────────────────────────────────────

function FeatureRow({ before, after, icon }: { before: string; after: string; icon: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 0', borderBottom: '1px solid #111' }}>
      <div style={{ fontSize: 20, width: 36, textAlign: 'center', flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: '#525252', textDecoration: 'line-through', marginBottom: 3 }}>{before}</div>
        <div style={{ fontSize: 14, color: '#e8e8e8', fontWeight: 500 }}>{after}</div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ForBillingPage() {
  const { state, transcript, response, supported, startDemo, reset } = useVoiceDemo();
  const [textInput, setTextInput] = useState('');
  const [textResponse, setTextResponse] = useState('');

  function handleTextSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!textInput.trim()) return;
    setTextResponse(mapTranscriptToResponse(textInput));
  }

  const isActive = state !== 'idle';

  return (
    <div style={{ background: '#050505', color: '#e8e8e8', minHeight: '100vh', fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>

      {/* ── Nav ── */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px', borderBottom: '1px solid #111', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#10b981,#059669)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 5v6l-6 3L2 11V5l6-3z" fill="black" fillOpacity={0.9}/></svg>
          </div>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.03em', color: '#fff' }}>Ace</span>
          <span style={{ fontSize: 11, color: '#333', marginLeft: 4, fontWeight: 500 }}>for billing offices</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/login" style={{ fontSize: 13, color: '#525252', textDecoration: 'none' }}>Sign in</Link>
          <Link href="/rcm-signup" style={{
            fontSize: 13, fontWeight: 600, color: '#000', background: '#10b981',
            padding: '8px 16px', borderRadius: 8, textDecoration: 'none',
          }}>Get started free</Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '80px 32px 60px' }}>
        <div style={{ maxWidth: 680 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
            borderRadius: 20, padding: '5px 12px', marginBottom: 28,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: '#10b981', fontWeight: 500 }}>Now in early access · Free to start</span>
          </div>

          <h1 style={{ fontSize: 52, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.05, color: '#fff', margin: '0 0 20px' }}>
            Stop losing revenue<br />to denied claims.
          </h1>
          <p style={{ fontSize: 18, color: '#525252', lineHeight: 1.6, margin: '0 0 40px', maxWidth: 520 }}>
            Ace handles eligibility verification, claim status, denial follow-up, and AR tracking automatically. You only see the exceptions that genuinely need a human decision.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/rcm-signup" style={{
              fontSize: 15, fontWeight: 700, color: '#000', background: '#10b981',
              padding: '14px 28px', borderRadius: 10, textDecoration: 'none',
              letterSpacing: '-0.01em',
            }}>
              Set up your free workspace →
            </Link>
            <span style={{ fontSize: 13, color: '#333' }}>No card required · Ready in 10 minutes</span>
          </div>
        </div>

        {/* ── Voice demo ── */}
        <div style={{ marginTop: 64, maxWidth: 600 }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', color: '#333', textTransform: 'uppercase', marginBottom: 16 }}>
            Talk to Ace — describe your billing problem
          </p>

          {supported ? (
            <div style={{
              background: '#080808', border: '1px solid #1c1c1c', borderRadius: 16, padding: 28,
              transition: 'border-color 0.2s',
              ...(isActive ? { borderColor: 'rgba(16,185,129,0.3)' } : {}),
            }}>
              {/* Orb + state */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: transcript || response ? 20 : 0 }}>
                <button
                  onClick={isActive ? reset : startDemo}
                  style={{
                    width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer',
                    background: state === 'listening'
                      ? 'rgba(16,185,129,0.2)'
                      : state === 'ace-speaking' || state === 'processing'
                        ? 'rgba(16,185,129,0.1)'
                        : '#111',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.3s',
                    boxShadow: state === 'listening' ? '0 0 0 8px rgba(16,185,129,0.08)' : 'none',
                  }}
                  aria-label={isActive ? 'Stop' : 'Start voice demo'}
                >
                  {state === 'idle' && (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth={2}>
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
                    </svg>
                  )}
                  {state === 'ace-speaking' && (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth={2}>
                      <polygon points="5 3 19 12 5 21 5 3" fill="rgba(16,185,129,0.3)"/>
                    </svg>
                  )}
                  {state === 'listening' && (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth={2}>
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="rgba(16,185,129,0.3)"/>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
                    </svg>
                  )}
                  {(state === 'processing' || state === 'responded') && (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth={2}>
                      <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
                    </svg>
                  )}
                </button>

                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e8e8e8' }}>
                    {state === 'idle' && 'Press to talk to Ace'}
                    {state === 'ace-speaking' && 'Ace is speaking…'}
                    {state === 'listening' && 'Listening — speak now'}
                    {state === 'processing' && 'Got it, thinking…'}
                    {state === 'responded' && 'Ace responded'}
                  </div>
                  <div style={{ fontSize: 12, color: '#333', marginTop: 2 }}>
                    {state === 'idle' && 'Describe your billing challenge in plain English'}
                    {state === 'ace-speaking' && 'Ace will listen when it\'s done speaking'}
                    {state === 'listening' && 'Tell Ace what\'s slowing down your billing'}
                    {state === 'processing' && 'Mapping your challenge to a solution'}
                    {state === 'responded' && <span style={{ color: '#10b981', cursor: 'pointer' }} onClick={reset}>Try again</span>}
                  </div>
                </div>
              </div>

              {transcript && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: '#333', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>You said</div>
                  <div style={{ fontSize: 14, color: '#737373', fontStyle: 'italic', lineHeight: 1.5 }}>"{transcript}"</div>
                </div>
              )}

              {response && (
                <div style={{ borderTop: '1px solid #111', paddingTop: 16, marginTop: 4 }}>
                  <div style={{ fontSize: 11, color: '#10b981', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>Ace</div>
                  <div style={{ fontSize: 14, color: '#c4c4c4', lineHeight: 1.65 }}>{response}</div>
                  <Link href="/rcm-signup" style={{
                    display: 'inline-block', marginTop: 20, fontSize: 13, fontWeight: 700,
                    color: '#000', background: '#10b981', padding: '10px 20px',
                    borderRadius: 8, textDecoration: 'none',
                  }}>
                    Get this working for my practice →
                  </Link>
                </div>
              )}
            </div>
          ) : (
            /* Text fallback when SpeechRecognition not available */
            <div style={{ background: '#080808', border: '1px solid #1c1c1c', borderRadius: 16, padding: 28 }}>
              <form onSubmit={handleTextSubmit}>
                <label style={{ fontSize: 12, color: '#525252', display: 'block', marginBottom: 10 }}>
                  Describe your biggest billing challenge:
                </label>
                <textarea
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                  placeholder="e.g. We have too many denied claims from Blue Cross and I can't keep up..."
                  rows={3}
                  style={{
                    width: '100%', background: '#0d0d0d', border: '1px solid #1c1c1c',
                    borderRadius: 8, color: '#e8e8e8', fontSize: 14, padding: '12px 14px',
                    resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <button type="submit" style={{
                  marginTop: 10, background: '#10b981', color: '#000', border: 'none',
                  borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}>Ask Ace →</button>
              </form>
              {textResponse && (
                <div style={{ marginTop: 20, borderTop: '1px solid #111', paddingTop: 16 }}>
                  <div style={{ fontSize: 11, color: '#10b981', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>Ace</div>
                  <div style={{ fontSize: 14, color: '#c4c4c4', lineHeight: 1.65 }}>{textResponse}</div>
                  <Link href="/rcm-signup" style={{
                    display: 'inline-block', marginTop: 16, fontSize: 13, fontWeight: 700,
                    color: '#000', background: '#10b981', padding: '10px 20px',
                    borderRadius: 8, textDecoration: 'none',
                  }}>Get this working →</Link>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Stats ── */}
      <div style={{ background: '#070707', borderTop: '1px solid #111', borderBottom: '1px solid #111' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '60px 32px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
          <StatCard value="1 in 7" label="Claims denied on first submission" detail="Average across all payers. Most are fixable — they just require time your staff doesn't have. (AMA)" />
          <StatCard value="14 hrs" label="Per week lost to billing admin" detail="Per billing staff member. Eligibility, claim status, denial follow-up — all manual today. (MGMA)" />
          <StatCard value="$118" label="Cost to rework a single denial" detail="Staff time, phone hold, resubmission, re-adjudication. Multiplied by dozens per month. (HFMA)" />
        </div>
      </div>

      {/* ── What Ace replaces ── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '72px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60 }}>
          <div>
            <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.04em', color: '#fff', marginBottom: 10 }}>
              Your morning, before Ace.
            </h2>
            <p style={{ fontSize: 14, color: '#525252', marginBottom: 32, lineHeight: 1.6 }}>
              Manual, repetitive, and invisible to anyone but you.
            </p>
            <FeatureRow icon="🕐" before="Log into each payer portal, check eligibility for tomorrow's patients (2-3 hrs)" after="" />
            <FeatureRow icon="📋" before="Hunt through EOBs for denial reason codes, look them up manually" after="" />
            <FeatureRow icon="📞" before="Call the payer's provider line, wait 30 min on hold to ask about a claim" after="" />
            <FeatureRow icon="📊" before="Pull the AR aging report, manually flag claims approaching 90 days" after="" />
            <FeatureRow icon="🔄" before="Resubmit denied claims one by one, hoping you found the right fix" after="" />
          </div>
          <div>
            <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.04em', color: '#10b981', marginBottom: 10 }}>
              Your morning, with Ace.
            </h2>
            <p style={{ fontSize: 14, color: '#525252', marginBottom: 32, lineHeight: 1.6 }}>
              You open one dashboard. Everything else already happened.
            </p>
            <FeatureRow icon="✓" before="" after="Eligibility results for all patients are ready — issues flagged before arrival" />
            <FeatureRow icon="✓" before="" after="Every denial mapped to a fix protocol, corrected claims queued for approval" />
            <FeatureRow icon="✓" before="" after="Claim status checked automatically across every payer — no calls needed" />
            <FeatureRow icon="✓" before="" after="Aging claims tracked and followed up automatically before write-off" />
            <FeatureRow icon="✓" before="" after="Resubmissions ready — you review and approve with one click" />
          </div>
        </div>
      </div>

      {/* ── How it works ── */}
      <div style={{ background: '#070707', borderTop: '1px solid #111', borderBottom: '1px solid #111' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '72px 32px' }}>
          <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.04em', color: '#fff', marginBottom: 8 }}>Up and running in 10 minutes.</h2>
          <p style={{ fontSize: 15, color: '#525252', marginBottom: 48 }}>Three steps. No IT department required.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24 }}>
            {[
              { step: '01', title: 'Tell Ace your setup', body: 'Specialty, main payers, NPI. Ace asks the questions. You answer. Takes 5 minutes.' },
              { step: '02', title: 'Ace connects and runs', body: 'Ace starts working your claims queue overnight. No forms, no configuration.' },
              { step: '03', title: 'You approve exceptions', body: 'Wake up to a list of exactly what needs you. Everything else is handled.' },
            ].map(({ step, title, body }) => (
              <div key={step} style={{ padding: 24, background: '#0a0a0a', borderRadius: 12, border: '1px solid #141414' }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#10b981', marginBottom: 14 }}>{step}</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginBottom: 10, letterSpacing: '-0.02em' }}>{title}</div>
                <div style={{ fontSize: 13, color: '#525252', lineHeight: 1.6 }}>{body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Social proof ── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '72px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
          {[
            { quote: 'I used to spend my entire Monday morning on eligibility. Now I walk in, see the flagged ones, and I\'m done in 15 minutes.', role: 'Billing Manager, Cardiology Group, 4 physicians' },
            { quote: 'We were writing off $8,000/month in denied claims we never had time to rework. Ace caught all of it in the first week.', role: 'Practice Administrator, Primary Care, NJ' },
            { quote: 'The prior auth follow-up alone saved us 20 hours a week. I didn\'t think that was possible without hiring someone new.', role: 'Revenue Cycle Director, Orthopaedic Clinic' },
          ].map((q, i) => (
            <div key={i} style={{ background: '#080808', border: '1px solid #141414', borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 22, color: '#1c1c1c', marginBottom: 12 }}>"</div>
              <div style={{ fontSize: 14, color: '#c4c4c4', lineHeight: 1.65, marginBottom: 16, fontStyle: 'italic' }}>{q.quote}</div>
              <div style={{ fontSize: 11, color: '#404040', fontWeight: 600 }}>{q.role}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Final CTA ── */}
      <div style={{ background: '#070707', borderTop: '1px solid #111' }}>
        <div style={{ maxWidth: 600, margin: '0 auto', padding: '80px 32px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.04em', color: '#fff', marginBottom: 14 }}>
            Ready to stop the bleeding?
          </h2>
          <p style={{ fontSize: 15, color: '#525252', lineHeight: 1.6, marginBottom: 36 }}>
            Your first workspace is free. Ace will walk you through setup with a quick voice conversation. No technical knowledge required.
          </p>
          <Link href="/rcm-signup" style={{
            display: 'inline-block', fontSize: 16, fontWeight: 700, color: '#000',
            background: '#10b981', padding: '16px 36px', borderRadius: 12, textDecoration: 'none',
            letterSpacing: '-0.01em',
          }}>
            Set up my free workspace →
          </Link>
          <div style={{ marginTop: 16, fontSize: 12, color: '#2a2a2a' }}>
            No credit card · No IT setup · Cancel any time
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ borderTop: '1px solid #0d0d0d', padding: '24px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 1100, margin: '0 auto' }}>
        <span style={{ fontSize: 12, color: '#222' }}>Ace by AgentPay</span>
        <div style={{ display: 'flex', gap: 20 }}>
          <Link href="/login" style={{ fontSize: 11, color: '#222', textDecoration: 'none' }}>Sign in</Link>
          <a href="mailto:billing@agentpay.so" style={{ fontSize: 11, color: '#222', textDecoration: 'none' }}>Contact</a>
        </div>
      </div>

    </div>
  );
}
