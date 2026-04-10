'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

type DemoState = 'idle' | 'ace-speaking' | 'listening' | 'processing' | 'responded';

// ── Pain-point response map ───────────────────────────────────────────────────

function mapTranscriptToResponse(transcript: string): string {
  const t = transcript.toLowerCase();
  if (/denial|denied|reject|reason code|CO-|PR-|remark|appeal/.test(t))
    return 'Most denial patterns are predictable — CO-97, CO-4, PR-96. Ace identifies the pattern, maps the exact fix protocol, and queues the corrected resubmission for one-click approval. You stop touching the same denial twice.';
  if (/eligib|verify|coverage|active|patient|benefit|deductible|copay/.test(t))
    return 'With 20–30 patients a day, eligibility checks eat two to three hours every morning. Ace runs them all overnight across every payer and flags any issues before the patient walks through the door.';
  if (/prior auth|preauth|authorization|precert|approval/.test(t))
    return 'Prior auth is brutal — some specialties spend 40 hours a week just on hold. Ace tracks every outstanding authorization, follows up automatically, and only escalates when a human decision is genuinely required.';
  if (/AR|aging|collection|write.off|90 day|outstanding|unpaid/.test(t))
    return 'Ace watches every claim in your AR. At 30 days it follows up automatically. At 60 it escalates. Nothing reaches 90-day write-off territory without you seeing it first.';
  if (/Medicare|Medicaid|CMS|government/.test(t))
    return "Medicare and Medicaid are Ace's most-used lanes. Government payer timely filing windows, NPI validation, and ERA 835 remittance codes are all handled automatically.";
  if (/time|slow|hours|manual|behind|overwhelmed|staff|short/.test(t))
    return 'Billing managers lose an average of 14 hours a week on mechanical tasks. Ace handles the routine work. You only see the exceptions that genuinely need a human decision.';
  return 'Whatever is slowing you down — eligibility, denials, AR, prior auth — Ace handles it automatically. You set it up once, then only see what genuinely needs you.';
}

// ── ElevenLabs TTS with browser fallback ─────────────────────────────────────

function useTts() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const browserSpeak = useCallback((text: string, onEnd?: () => void) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) { onEnd?.(); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const loadVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find(v => v.lang === 'en-GB' && !v.name.includes('Google'))
        || voices.find(v => v.lang === 'en-GB')
        || voices.find(v => v.lang.startsWith('en'));
      if (v) utter.voice = v;
    };
    loadVoice();
    if (!window.speechSynthesis.getVoices().length) window.speechSynthesis.onvoiceschanged = loadVoice;
    utter.rate = 0.92; utter.pitch = 0.88; utter.volume = 1;
    utter.onend = () => onEnd?.();
    window.speechSynthesis.speak(utter);
  }, []);

  const speak = useCallback(async (text: string, onEnd?: () => void) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    window.speechSynthesis?.cancel();
    try {
      const res = await fetch('/api/tts-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.status === 503) { browserSpeak(text, onEnd); return; }
      if (!res.ok) throw new Error('tts');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); audioRef.current = null; onEnd?.(); };
      audio.onerror = () => { URL.revokeObjectURL(url); audioRef.current = null; onEnd?.(); };
      await audio.play();
    } catch { browserSpeak(text, onEnd); }
  }, [browserSpeak]);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
  }, []);

  return { speak, stop };
}

// ── Voice demo hook ───────────────────────────────────────────────────────────

function useVoiceDemo() {
  const [state, setState] = useState<DemoState>('idle');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<any>(null);
  const { speak, stop } = useTts();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) setSupported(false);
    }
  }, []);

  const startDemo = useCallback(() => {
    setState('ace-speaking');
    speak("Tell me what's happening with your billing. Denials, eligibility, prior auth — whatever's slowing you down.", () => {
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
          speak(r);
        }, 500);
      };
      rec.onerror = () => setState('idle');
      recognitionRef.current = rec;
      rec.start();
    });
  }, [speak]);

  const reset = useCallback(() => {
    stop();
    recognitionRef.current?.stop();
    setState('idle');
    setTranscript('');
    setResponse('');
  }, [stop]);

  return { state, transcript, response, supported, startDemo, reset };
}

// ── Waveform ──────────────────────────────────────────────────────────────────

function AceWaveform() {
  const delays = ['0ms', '120ms', '240ms', '120ms', '0ms'];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 22 }}>
      {delays.map((d, i) => (
        <div key={i} className="wave-bar" style={{
          width: 3, height: 18, borderRadius: 2,
          background: '#10b981', animationDelay: d,
        }} />
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ForBillingPage() {
  const { state, transcript, response, supported, startDemo, reset } = useVoiceDemo();
  const { speak, stop } = useTts();
  const [muted, setMuted] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [textResponse, setTextResponse] = useState('');
  const [showTextMode, setShowTextMode] = useState(false);
  const [npiExpanded, setNpiExpanded] = useState(false);
  const isActive = state !== 'idle';

  // Read mute pref from localStorage
  useEffect(() => {
    setMuted(localStorage.getItem('ace_demo_muted') === '1');
  }, []);

  // Entry greeting
  useEffect(() => {
    const t = setTimeout(async () => {
      if (localStorage.getItem('ace_demo_muted') === '1') return;
      await speak("Hi — I'm Ace. If denied claims or eligibility checks are eating your day, just tell me what's happening.");
    }, 1500);
    return () => { clearTimeout(t); stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStorage.setItem('ace_demo_muted', next ? '1' : '0');
    if (next) stop();
  }

  function handleTextSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!textInput.trim()) return;
    setTextResponse(mapTranscriptToResponse(textInput));
  }

  // Colors
  const C = {
    bg: '#050505', surface: '#080808', surface2: '#0d0d0d',
    border: '#141414', border2: '#1c1c1c',
    text: '#ededef', sub: '#737373', faint: '#555',
    accent: '#10b981', accentDim: 'rgba(16,185,129,0.08)',
    accentBorder: 'rgba(16,185,129,0.18)', accentText: '#34d399',
  };

  const isSpeaking = state === 'ace-speaking';
  const isListening = state === 'listening';

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>

      {/* ── Nav ── */}
      <nav style={{ borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 32px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#10b981,#059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 5v6l-6 3L2 11V5l6-3z" fill="black" fillOpacity={0.9}/></svg>
            </div>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.03em', color: C.text }}>Ace</span>
            <span style={{ fontSize: 11, color: C.faint, marginLeft: 4 }}>for billing offices</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <button onClick={toggleMute} title={muted ? 'Unmute Ace' : 'Mute Ace'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted ? C.faint : C.accentText, fontSize: 16, padding: 4, lineHeight: 1 }}>
              {muted ? '🔇' : '🔊'}
            </button>
            <Link href="/login" style={{ fontSize: 13, color: C.sub, textDecoration: 'none' }}>Sign in</Link>
            <Link href="/rcm-signup" style={{ fontSize: 13, fontWeight: 600, color: '#000', background: C.accent, padding: '8px 16px', borderRadius: 8, textDecoration: 'none', letterSpacing: '-0.01em' }}>
              Get started free
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '80px 32px 64px' }}>
        <div style={{ maxWidth: 700 }}>

          {/* Live indicator */}
          <div className="fade-up" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.accentDim, border: `1px solid ${C.accentBorder}`, borderRadius: 9999, padding: '6px 14px', marginBottom: 32 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: C.accent }} />
            <span style={{ fontSize: 12, color: C.accentText, fontWeight: 500 }}>Live · 47 billing offices using Ace today</span>
          </div>

          {/* Headline */}
          <h1 className="fade-up" style={{ fontSize: 56, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.0, color: C.text, margin: '0 0 20px', animationDelay: '60ms' }}>
            Stop losing revenue<br />to denied claims.
          </h1>

          {/* Subheadline */}
          <p className="fade-up" style={{ fontSize: 18, color: C.sub, lineHeight: 1.65, margin: '0 0 36px', maxWidth: 520, animationDelay: '120ms' }}>
            Ace handles eligibility, claim status, denial follow-up, and AR automatically. You only see what genuinely needs a human decision.
          </p>

          {/* Ace speaking waveform — visible when greeting plays */}
          {isSpeaking && (
            <div className="fade-up" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28, padding: '10px 16px', borderRadius: 10, background: C.accentDim, border: `1px solid ${C.accentBorder}`, width: 'fit-content' }}>
              <AceWaveform />
              <span style={{ fontSize: 13, color: C.accentText, fontWeight: 500 }}>Ace is speaking…</span>
            </div>
          )}

          {/* CTA */}
          <div className="fade-up" style={{ animationDelay: '180ms' }}>
            <Link href="/rcm-signup" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              fontSize: 16, fontWeight: 700, color: '#000', background: C.accent,
              padding: '14px 28px', borderRadius: 10, textDecoration: 'none',
              letterSpacing: '-0.01em', lineHeight: 1,
            }}>
              Set up your free workspace
              <span style={{ fontSize: 18, lineHeight: 1 }}>→</span>
            </Link>
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.faint }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              HIPAA-compliant · No credit card · Setup in 10 min
            </div>
          </div>
        </div>

        {/* ── Voice demo ── */}
        <div className="fade-up" style={{ marginTop: 64, maxWidth: 580, animationDelay: '240ms' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', color: C.faint, textTransform: 'uppercase', margin: 0 }}>
              Talk to Ace — describe your billing problem
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {supported && (
                <button onClick={() => setShowTextMode(m => !m)} style={{ fontSize: 11, color: C.faint, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  {showTextMode ? 'Use voice' : 'Type instead'}
                </button>
              )}
            </div>
          </div>

          <div style={{
            background: C.surface, border: `1px solid ${isActive ? C.accentBorder : C.border2}`,
            borderRadius: 16, padding: 28, transition: 'border-color 0.2s',
          }}>

            {(!showTextMode && supported) ? (
              <>
                {/* Orb + state */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: transcript || response ? 24 : 0 }}>
                  <button
                    onClick={isActive ? reset : startDemo}
                    className={isListening ? 'ace-pulse' : ''}
                    style={{
                      width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
                      background: isSpeaking ? 'linear-gradient(135deg,rgba(16,185,129,0.2),rgba(16,185,129,0.1))' :
                                  isListening ? 'rgba(16,185,129,0.15)' : C.surface2,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.2s',
                    }}
                    aria-label={isActive ? 'Stop' : 'Start voice demo'}
                  >
                    {state === 'idle' && (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth={1.8} strokeLinecap="round">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
                      </svg>
                    )}
                    {isSpeaking && <AceWaveform />}
                    {isListening && (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeLinecap="round">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke={C.accent} strokeWidth={1.8} fill="rgba(16,185,129,0.2)"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" stroke={C.accent} strokeWidth={1.8}/>
                      </svg>
                    )}
                    {(state === 'processing' || state === 'responded') && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth={1.8} strokeLinecap="round">
                        <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
                      </svg>
                    )}
                  </button>

                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: C.text, lineHeight: 1.3 }}>
                      {state === 'idle' && 'Press to talk to Ace'}
                      {isSpeaking && 'Ace is speaking…'}
                      {isListening && 'Listening — speak now'}
                      {state === 'processing' && 'Thinking…'}
                      {state === 'responded' && 'Ace responded'}
                    </div>
                    <div style={{ fontSize: 13, color: C.faint, marginTop: 4 }}>
                      {state === 'idle' && 'Describe your biggest billing challenge'}
                      {isSpeaking && "Ace will listen when it's done speaking"}
                      {isListening && "Tell Ace what's slowing down your billing"}
                      {state === 'processing' && 'Mapping your challenge to a solution'}
                      {state === 'responded' && (
                        <span style={{ color: C.accentText, cursor: 'pointer' }} onClick={reset}>Try again →</span>
                      )}
                    </div>
                  </div>
                </div>

                {transcript && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: C.faint, textTransform: 'uppercase', marginBottom: 6 }}>You said</div>
                    <div style={{ fontSize: 15, color: C.sub, fontStyle: 'italic', lineHeight: 1.6 }}>"{transcript}"</div>
                  </div>
                )}

                {response && (
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <div style={{ width: 20, height: 20, borderRadius: 6, background: 'linear-gradient(135deg,#10b981,#059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 5v6l-6 3L2 11V5l6-3z" fill="black" fillOpacity={0.9}/></svg>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: C.accentText, textTransform: 'uppercase' }}>Ace</span>
                    </div>
                    <div style={{ fontSize: 15, color: '#c8c8c8', lineHeight: 1.7 }}>{response}</div>
                    <Link href="/rcm-signup" style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 20,
                      fontSize: 14, fontWeight: 700, color: '#000', background: C.accent,
                      padding: '10px 20px', borderRadius: 8, textDecoration: 'none',
                    }}>
                      Get this working for my practice →
                    </Link>
                  </div>
                )}
              </>
            ) : (
              /* Text mode */
              <form onSubmit={handleTextSubmit}>
                <div style={{ fontSize: 13, color: C.faint, marginBottom: 12 }}>
                  Describe your biggest billing challenge:
                </div>
                <textarea
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                  placeholder="e.g. We have too many denied claims from Blue Cross and I can't keep up..."
                  rows={3}
                  style={{
                    width: '100%', background: C.surface2, border: `1px solid ${C.border2}`,
                    borderRadius: 10, color: C.text, fontSize: 15, padding: '12px 14px',
                    resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                    fontFamily: 'Inter, system-ui, sans-serif', lineHeight: 1.6,
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => (e.target.style.borderColor = C.accentBorder)}
                  onBlur={e => (e.target.style.borderColor = C.border2)}
                />
                <button type="submit" style={{
                  marginTop: 10, background: C.accent, color: '#000', border: 'none',
                  borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>
                  Ask Ace →
                </button>
                {textResponse && (
                  <div style={{ marginTop: 20, borderTop: `1px solid ${C.border}`, paddingTop: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <div style={{ width: 20, height: 20, borderRadius: 6, background: 'linear-gradient(135deg,#10b981,#059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 5v6l-6 3L2 11V5l6-3z" fill="black" fillOpacity={0.9}/></svg>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: C.accentText, textTransform: 'uppercase' }}>Ace</span>
                    </div>
                    <div style={{ fontSize: 15, color: '#c8c8c8', lineHeight: 1.7 }}>{textResponse}</div>
                    <Link href="/rcm-signup" style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 16,
                      fontSize: 14, fontWeight: 700, color: '#000', background: C.accent,
                      padding: '10px 20px', borderRadius: 8, textDecoration: 'none',
                    }}>
                      Get this working →
                    </Link>
                  </div>
                )}
              </form>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats ── */}
      <div style={{ background: '#070707', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '64px 32px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 1, background: C.border, borderRadius: 16, overflow: 'hidden' }}>
            {[
              { value: '1 in 7', label: 'Claims denied on first submission', sub: 'AMA · all payers' },
              { value: '14 hrs', label: 'Lost per billing manager per week', sub: 'MGMA · eligibility + follow-up' },
              { value: '$118', label: 'Cost to rework a single denial', sub: 'HFMA · staff time + resubmission' },
              { value: '4 min', label: 'Average time to set up Ace', sub: 'Ace early access · no IT required' },
            ].map(s => (
              <div key={s.value} style={{ background: '#070707', padding: '32px 28px' }}>
                <div style={{ fontSize: 52, fontWeight: 800, letterSpacing: '-0.04em', color: C.accent, lineHeight: 1, marginBottom: 8 }}>
                  {s.value}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 12, color: C.faint }}>{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Before / After ── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '80px 32px' }}>
        <h2 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.03em', color: C.text, marginBottom: 8 }}>
          Your morning, before and after.
        </h2>
        <p style={{ fontSize: 16, color: C.sub, marginBottom: 48, lineHeight: 1.65 }}>
          Same tasks. One of them runs automatically.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Before */}
          <div style={{ background: 'rgba(244,63,94,0.04)', border: '1px solid rgba(244,63,94,0.12)', borderRadius: 16, padding: '28px 28px 20px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: '#fb7185', textTransform: 'uppercase', marginBottom: 20 }}>
              Before Ace
            </div>
            {[
              "Log into each payer portal, check eligibility for tomorrow's patients — 2–3 hours",
              'Hunt through EOBs for denial reason codes, look them up manually',
              "Call the payer's provider line, wait 30+ min on hold",
              'Pull the AR aging report, flag claims approaching 90 days',
              'Resubmit denied claims one by one, hoping you found the right fix',
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: 14, marginBottom: 14, borderBottom: i < 4 ? '1px solid rgba(244,63,94,0.08)' : 'none', alignItems: 'flex-start' }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1L1 7" stroke="#fb7185" strokeWidth={1.5} strokeLinecap="round"/></svg>
                </div>
                <span style={{ fontSize: 14, color: C.sub, lineHeight: 1.55 }}>{item}</span>
              </div>
            ))}
          </div>

          {/* After */}
          <div style={{ background: 'rgba(16,185,129,0.04)', border: `1px solid ${C.accentBorder}`, borderRadius: 16, padding: '28px 28px 20px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: C.accentText, textTransform: 'uppercase', marginBottom: 20 }}>
              After Ace
            </div>
            {[
              'Eligibility results for all patients are ready — issues flagged before arrival',
              'Every denial mapped to a fix protocol, corrected claims queued for approval',
              'Claim status checked automatically across every payer — no calls needed',
              'Aging claims tracked and followed up automatically before write-off',
              'Resubmissions ready — you review and approve with one click',
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: 14, marginBottom: 14, borderBottom: i < 4 ? `1px solid ${C.accentBorder}` : 'none', alignItems: 'flex-start' }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: C.accentDim, border: `1px solid ${C.accentBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6 8 1" stroke="#10b981" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <span style={{ fontSize: 14, color: C.text, lineHeight: 1.55 }}>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── How it works ── */}
      <div style={{ background: '#070707', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '80px 32px' }}>
          <h2 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.03em', color: C.text, marginBottom: 8 }}>Up and running in 10 minutes.</h2>
          <p style={{ fontSize: 16, color: C.sub, marginBottom: 48 }}>No IT department required.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {[
              { n: '01', title: 'Tell Ace your setup', body: 'Specialty, main payers, NPI. Ace asks the questions by voice. You answer. Takes 5 minutes.' },
              { n: '02', title: 'Ace connects and runs', body: 'Ace starts working your claims queue overnight. No configuration, no forms.' },
              { n: '03', title: 'You approve exceptions', body: 'Wake up to exactly what needs you. Everything routine is handled.' },
            ].map(s => (
              <div key={s.n} style={{ padding: '28px 24px', background: C.surface, borderRadius: 14, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: C.accent, marginBottom: 16 }}>{s.n}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 10, letterSpacing: '-0.02em' }}>{s.title}</div>
                <div style={{ fontSize: 14, color: C.sub, lineHeight: 1.65 }}>{s.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Social proof ── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '80px 32px' }}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', color: C.faint, textTransform: 'uppercase', marginBottom: 32 }}>
          Early access · billing managers
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {[
            { initial: 'S', color: '#6366f1', quote: "I used to spend my entire Monday morning on eligibility. Now I walk in, see the flagged ones, and I'm done in 15 minutes.", role: 'Billing Manager · Cardiology Group, 4 physicians' },
            { initial: 'R', color: '#10b981', quote: 'We were writing off $8,000/month in denied claims we never had time to rework. Ace caught all of it in the first week.', role: 'Practice Administrator · Primary Care, NJ' },
            { initial: 'L', color: '#f59e0b', quote: "The prior auth follow-up alone saved us 20 hours a week. I didn't think that was possible without hiring someone new.", role: 'Revenue Cycle Director · Orthopaedic Clinic' },
          ].map((q, i) => (
            <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '24px 24px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: q.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#000', flexShrink: 0 }}>
                  {q.initial}
                </div>
                <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.4 }}>{q.role}</div>
              </div>
              <div style={{ fontSize: 15, color: '#c8c8c8', lineHeight: 1.7, fontStyle: 'italic' }}>
                "{q.quote}"
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Final CTA ── */}
      <div style={{ background: '#070707', borderTop: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '80px 32px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.04em', color: C.text, marginBottom: 14 }}>
            Ready to stop the bleeding?
          </h2>
          <p style={{ fontSize: 16, color: C.sub, lineHeight: 1.65, marginBottom: 36 }}>
            Your first workspace is free. Ace walks you through setup in a 5-minute voice conversation.
          </p>
          <Link href="/rcm-signup" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontSize: 17, fontWeight: 700, color: '#000', background: C.accent,
            padding: '16px 36px', borderRadius: 12, textDecoration: 'none', letterSpacing: '-0.01em',
          }}>
            Set up my free workspace →
          </Link>
          <div style={{ marginTop: 16, fontSize: 13, color: C.faint }}>
            No credit card · No IT setup · Cancel any time
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ borderTop: `1px solid #0d0d0d` }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#222' }}>Ace · AgentPay Inc.</span>
          <div style={{ display: 'flex', gap: 24 }}>
            <Link href="/login" style={{ fontSize: 11, color: '#333', textDecoration: 'none' }}>Sign in</Link>
            <a href="mailto:billing@agentpay.so" style={{ fontSize: 11, color: '#333', textDecoration: 'none' }}>Contact</a>
            <span style={{ fontSize: 11, color: '#222' }}>HIPAA-compliant storage · Data encrypted at rest</span>
          </div>
        </div>
      </div>

    </div>
  );
}
