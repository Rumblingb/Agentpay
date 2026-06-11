// Fable design system — Power Cabinet
export const C = {
  ink: '#0B0F14',        // background — never pure black
  inkRaised: '#121821',  // card surfaces
  bone: '#F2EEE3',       // primary text — never pure white
  dim: '#6B7080',        // secondary text
  amber: '#FFB020',      // the contested thing — one use per screen
  treasury: '#FFB020',
  people: '#22CCFF',
  military: '#FF66AA',
  planet: '#2EA86A',
  danger: '#FF4455',
  line: 'rgba(242,238,227,0.08)',
};

export const STATS = [
  { key: 'treasury', label: 'TREASURY', icon: '◆', color: C.treasury },
  { key: 'people',   label: 'PEOPLE',   icon: '●', color: C.people },
  { key: 'military', label: 'GUARD',    icon: '▲', color: C.military },
  { key: 'planet',   label: 'GRID',     icon: '■', color: C.planet },
] as const;

export type StatKey = (typeof STATS)[number]['key'];

export const FONT = {
  // System stacks tuned per platform; Anton/SpaceGrotesk shipped later via expo-font
  hero: { fontWeight: '900' as const, letterSpacing: -1.5 },
  body: { fontWeight: '600' as const, letterSpacing: -0.3 },
  mono: { fontFamily: 'Menlo', letterSpacing: 1.2 },
};
