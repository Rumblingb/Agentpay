'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

type DemoState = 'idle' | 'ace-speaking' | 'listening' | 'processing' | 'responded';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly [index: number]: SpeechRecognitionAlternativeLike | undefined;
}

interface SpeechRecognitionEventLike {
  readonly results: {
    readonly [index: number]: SpeechRecognitionResultLike | undefined;
  };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

// ── Pain-point response map ───────────────────────────────────────────────────

function mapTranscriptToResponse(transcript: string): string {
  const t = transcript.toLowerCase();
  if (/denial|denied|reject|reason code|CO-|PR-|remark|appeal/.test(t))
    return 'In this demo, Ace shows how a team could organise denial reasons and choose what to review next. It does not identify a fix, resubmit a claim, or connect to a payer system.';
  if (/eligib|verify|coverage|active|patient|benefit|deductible|copay/.test(t))
    return 'This demo illustrates an eligibility-review workflow: gather the questions, organise a checklist, and route uncertain items for human review. It does not query coverage or patient records.';
  if (/prior auth|preauth|authorization|precert|approval/.test(t))
    return 'This demo illustrates how a team might track an authorisation follow-up and decide what needs a person next. It does not submit, follow up on, or change an authorisation.';
  if (/ar|aging|collection|write.off|90 day|outstanding|unpaid/.test(t))
    return 'This demo illustrates a structured accounts-receivable review. It does not access balances, send follow-ups, or take action on a claim.';
  if (/medicare|medicaid|cms|government/.test(t))
    return 'This demo can frame questions for a government-payer workflow. It does not validate enrolment, interpret remittances, or connect to payer systems.';
  if (/time|slow|hours|manual|behind|overwhelmed|staff|short/.test(t))
    return 'This demo helps turn a manual bottleneck into a reviewable workflow. The next step is to discuss the team, systems, and controls needed for an early-access evaluation.';
  return 'Use this demo to explore an illustrative workflow for eligibility, denials, AR, or prior authorisation. It does not connect to records, payers, or live queues.';
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
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const { speak, stop } = useTts();

  useEffect(() => {
    const updateSupport = window.setTimeout(() => {
      setSupported(Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition));
    }, 0);
    return () => window.clearTimeout(updateSupport);
  }, []);

  const startDemo = useCallback(() => {
    setState('ace-speaking');
    speak('Tell me which billing workflow you want to explore in this demo: denials, eligibility, prior authorisation, or AR review.', () => {
      setState('listening');
      const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
      if (!SR) { setState('idle'); return; }
      const rec = new SR();
      rec.lang = 'en-US';
      rec.continuous = false;
      rec.interimResults = false;
      rec.onresult = (e: SpeechRecognitionEventLike) => {
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
  const isActive = state !== 'idle';

  // Read mute pref from localStorage
  useEffect(() => {
    const loadPreference = window.setTimeout(() => {
      setMuted(localStorage.getItem('ace_demo_muted') === '1');
    }, 0);
    return () => window.clearTimeout(loadPreference);
  }, []);

  // Entry greeting
  useEffect(() => {
    const t = setTimeout(async () => {
      if (localStorage.getItem('ace_demo_muted') === '1') return;
      await speak("Hi, I'm Ace. This is a workflow demo for billing teams. Tell me which process you want to explore.");
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
    accentBorder: 'rgba(16,185,129,0.18)', accentText: '#5BBE7E',
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
            <span style={{ fontSize: 11, color: C.faint, marginLeft: 4 }}>for billing teams</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <button onClick={toggleMute} title={muted ? 'Unmute Ace' : 'Mute Ace'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted ? C.faint : C.accentText, fontSize: 16, padding: 4, lineHeight: 1 }}>
              {muted ? '🔇' : '🔊'}
            </button>
            <Link href="/login" style={{ fontSize: 13, color: C.sub, textDecoration: 'none' }}>Sign in</Link>
            <Link href="#workflow-demo" style={{ fontSize: 13, fontWeight: 600, color: '#000', background: C.accent, padding: '8px 16px', borderRadius: 8, textDecoration: 'none', letterSpacing: '-0.01em' }}>
              Explore the demo
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
            <span style={{ fontSize: 12, color: C.accentText, fontWeight: 500 }}>Early access · workflow demo</span>
          </div>

          {/* Headline */}
          <h1 className="fade-up" style={{ fontSize: 56, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.0, color: C.text, margin: '0 0 20px', animationDelay: '60ms' }}>
            Explore a billing<br />workflow demo.
          </h1>

          {/* Subheadline */}
          <p className="fade-up" style={{ fontSize: 18, color: C.sub, lineHeight: 1.65, margin: '0 0 36px', maxWidth: 520, animationDelay: '120ms' }}>
            Ace demonstrates an early-access workflow for eligibility, claim-status review, denial follow-up, and accounts-receivable review. Every proposed next step stays visible for human review; this demo does not connect to payer or patient systems.
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
            <Link href="#workflow-demo" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              fontSize: 16, fontWeight: 700, color: '#000', background: C.accent,
              padding: '14px 28px', borderRadius: 10, textDecoration: 'none',
              letterSpacing: '-0.01em', lineHeight: 1,
            }}>
              Try the workflow demo
              <span style={{ fontSize: 18, lineHeight: 1 }}>→</span>
            </Link>
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.faint }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Demo mode · No payer, patient-record, or claim connection
            </div>
          </div>
        </div>

        {/* ── Voice demo ── */}
        <div id="workflow-demo" className="fade-up" style={{ marginTop: 64, maxWidth: 580, animationDelay: '240ms', scrollMarginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', color: C.faint, textTransform: 'uppercase', margin: 0 }}>
              Talk to Ace · explore a workflow demo
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
                      {state === 'idle' && 'Describe a billing workflow you want to explore'}
                      {isSpeaking && "Ace will listen when it's done speaking"}
                      {isListening && 'Tell Ace what you want to review in the demo'}
                      {state === 'processing' && 'Preparing an illustrative workflow response'}
                      {state === 'responded' && (
                        <span style={{ color: C.accentText, cursor: 'pointer' }} onClick={reset}>Try again →</span>
                      )}
                    </div>
                  </div>
                </div>

                {transcript && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: C.faint, textTransform: 'uppercase', marginBottom: 6 }}>You said</div>
                    <div style={{ fontSize: 15, color: C.sub, fontStyle: 'italic', lineHeight: 1.6 }}>&ldquo;{transcript}&rdquo;</div>
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
                      Request early access →
                    </Link>
                  </div>
                )}
              </>
            ) : (
              /* Text mode */
              <form onSubmit={handleTextSubmit}>
                <div style={{ fontSize: 13, color: C.faint, marginBottom: 12 }}>
                  Describe a billing workflow you want to explore:
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
                  Explore with Ace →
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
                      Request early access →
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
              { value: 'Eligibility', label: 'Explore a review checklist', sub: 'Illustrative workflow only' },
              { value: 'Claim status', label: 'Map questions for review', sub: 'No payer connection in this demo' },
              { value: 'Denial follow-up', label: 'See a proposed next-step flow', sub: 'No claim changes or resubmissions' },
              { value: 'AR review', label: 'Organise items for human review', sub: 'No live balances or outreach' },
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
          From manual questions to a reviewable workflow.
        </h2>
        <p style={{ fontSize: 16, color: C.sub, marginBottom: 48, lineHeight: 1.65 }}>
          This demo contrasts a familiar manual process with an illustrative review flow. It does not perform live payer actions.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Before */}
          <div style={{ background: 'rgba(244,63,94,0.04)', border: '1px solid rgba(244,63,94,0.12)', borderRadius: 16, padding: '28px 28px 20px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: '#fb7185', textTransform: 'uppercase', marginBottom: 20 }}>
              A manual review might involve
            </div>
            {[
              'Check the questions that need eligibility review',
              'Read denial and remittance information',
              'Prepare a payer or authorisation follow-up',
              'Review aging items and priorities',
              'Decide what a person should do next',
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
              In this demo, Ace illustrates
            </div>
            {[
              'A checklist for the questions a team may review',
              'A way to organise denial reasons for discussion',
              'A proposed follow-up path for human review',
              'A structured view of items that may need attention',
              'A visible proposed next step before any future action',
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
          <h2 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.03em', color: C.text, marginBottom: 8 }}>Explore the workflow in three steps.</h2>
          <p style={{ fontSize: 16, color: C.sub, marginBottom: 48 }}>Demo mode only. Ace does not connect to payer, patient, or claim systems on this page.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {[
              { n: '01', title: 'Describe a scenario', body: 'Use an illustrative billing question. Do not enter patient, claim, or payer credentials.' },
              { n: '02', title: 'Review an example workflow', body: 'Ace returns a simulated way to organise the question for a team discussion.' },
              { n: '03', title: 'Decide what to evaluate next', body: 'Request early access to discuss systems, safeguards, and the controls needed for a real evaluation.' },
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
          Early access · product context
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {[
            { title: 'Founder-led conversations', body: 'The demo is shaped by conversations about common billing workflows and review points.' },
            { title: 'Offline feedback', body: 'We are collecting structured feedback and preserving the evidence needed for any future case study.' },
            { title: 'Referrals', body: 'Early interest includes referrals. We do not publish referral counts or endorsements without records and consent.' },
          ].map((q, i) => (
            <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '24px 24px 20px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: C.accentText, textTransform: 'uppercase', marginBottom: 12 }}>{q.title}</div>
              <div style={{ fontSize: 15, color: '#c8c8c8', lineHeight: 1.7 }}>{q.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Final CTA ── */}
      <div style={{ background: '#070707', borderTop: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '80px 32px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.04em', color: C.text, marginBottom: 14 }}>
            Explore the workflow before you commit.
          </h2>
          <p style={{ fontSize: 16, color: C.sub, lineHeight: 1.65, marginBottom: 36 }}>
            Request early access to review the demo and discuss whether an evaluation is appropriate for your team.
          </p>
          <Link href="/rcm-signup" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontSize: 17, fontWeight: 700, color: '#000', background: C.accent,
            padding: '16px 36px', borderRadius: 12, textDecoration: 'none', letterSpacing: '-0.01em',
          }}>
            Request early access →
          </Link>
          <div style={{ marginTop: 16, fontSize: 13, color: C.faint }}>
            Early access · Demo mode · No live payer connection
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
            <span style={{ fontSize: 11, color: '#222' }}>Workflow demo · Connected controls are not represented as live</span>
          </div>
        </div>
      </div>

    </div>
  );
}
