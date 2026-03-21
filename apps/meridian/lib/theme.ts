/** Bro — design system tokens */

export const C = {
  // ── Backgrounds ────────────────────────────────────────────────────────────
  bg:       '#03070f',   // base — true dark, slight blue undertone
  surface:  '#060d18',   // card surface
  surface2: '#091424',   // elevated surface

  // ── Borders ────────────────────────────────────────────────────────────────
  border:   '#0f1f35',   // subtle
  borderMd: '#1a3050',   // visible

  // ── Emerald (brand primary) ────────────────────────────────────────────────
  em:        '#10b981',
  emBright:  '#34d399',
  emDim:     '#052e16',
  emMid:     '#064e3b',
  emGlow:    '#065f46',

  // ── Indigo (AI thinking state) ─────────────────────────────────────────────
  indigo:      '#6366f1',
  indigoBright:'#818cf8',
  indigoDim:   '#10172e',  // user bubble bg
  indigoMid:   '#1e1b4b',

  // ── Sky (transit / TfL layer) ──────────────────────────────────────────────
  sky:    '#38bdf8',
  skyDim: '#0c2a40',

  // ── Amber (payment / confirming) ───────────────────────────────────────────
  amber:      '#f59e0b',
  amberBright:'#fcd34d',
  amberDim:   '#451a03',
  amberMid:   '#92400e',

  // ── Red (error) ────────────────────────────────────────────────────────────
  red:    '#f87171',
  redDim: '#450a0a',
  redMid: '#7f1d1d',

  // ── Green (confirmed / receipt) ────────────────────────────────────────────
  green:    '#4ade80',
  greenDim: '#052e16',
  greenMid: '#14532d',

  // ── Text ───────────────────────────────────────────────────────────────────
  textPrimary:   '#f0f9ff',
  textSecondary: '#94a3b8',
  textMuted:     '#475569',
  textDim:       '#1e293b',
} as const;

/** Phase → glow/shadow colour */
export const PHASE_SHADOW: Record<string, string> = {
  idle:       '#10b981',
  listening:  '#10b981',
  thinking:   '#6366f1',
  choosing:   '#10b981',
  confirming: '#f59e0b',
  hiring:     '#6366f1',
  executing:  '#10b981',
  done:       '#4ade80',
  error:      '#f87171',
};

/** Phase → label colour */
export const PHASE_LABEL_COLOR: Record<string, string> = {
  idle:       '#475569',
  listening:  '#10b981',
  thinking:   '#38bdf8',
  choosing:   '#475569',
  confirming: '#f59e0b',
  hiring:     '#38bdf8',
  executing:  '#38bdf8',
  done:       '#4ade80',
  error:      '#f87171',
};
