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
  em:        '#8dbfe7',
  emBright:  '#dcecff',
  emDim:     '#102031',
  emMid:     '#1d3448',
  emGlow:    '#335772',

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
  idle:       '#8dbfe7',
  listening:  '#cbe8ff',
  thinking:   '#8bc8ff',
  choosing:   '#8dbfe7',
  confirming: '#f59e0b',
  hiring:     '#8bc8ff',
  executing:  '#8dbfe7',
  done:       '#4ade80',
  error:      '#f87171',
};

/** Phase → label colour */
export const PHASE_LABEL_COLOR: Record<string, string> = {
  idle:       '#475569',
  listening:  '#cbe8ff',
  thinking:   '#38bdf8',
  choosing:   '#475569',
  confirming: '#f59e0b',
  hiring:     '#38bdf8',
  executing:  '#38bdf8',
  done:       '#4ade80',
  error:      '#f87171',
};
