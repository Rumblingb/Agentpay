import { CARDS, Card, Effect, DEATHS } from './cards';
import { StatKey, STATS } from './theme';

export interface GameState {
  stats: Record<StatKey, number>;   // 0..100
  day: number;
  deck: Card[];
  deckIdx: number;
  over: { dead: boolean; stat?: StatKey; line?: string } | null;
}

const SCALE = 6; // card fx are -3..+3 → -18..+18

function shuffle<T>(a: T[]): T[] {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function newGame(): GameState {
  return {
    stats: { treasury: 50, people: 50, military: 50, planet: 50 },
    day: 1,
    deck: shuffle(CARDS),
    deckIdx: 0,
    over: null,
  };
}

export function currentCard(g: GameState): Card {
  return g.deck[g.deckIdx % g.deck.length];
}

export function applyChoice(g: GameState, dir: 'left' | 'right'): GameState {
  const card = currentCard(g);
  const fx: Effect = dir === 'left' ? card.left.fx : card.right.fx;
  const stats = { ...g.stats };
  (Object.keys(fx) as StatKey[]).forEach(k => {
    stats[k] = stats[k] + (fx[k] || 0) * SCALE;
  });

  // check death
  let over: GameState['over'] = null;
  for (const s of STATS) {
    if (stats[s.key] <= 0) { over = { dead: true, stat: s.key, line: DEATHS[s.key].low }; stats[s.key] = 0; break; }
    if (stats[s.key] >= 100) { over = { dead: true, stat: s.key, line: DEATHS[s.key].high }; stats[s.key] = 100; break; }
  }

  let deck = g.deck, deckIdx = g.deckIdx + 1;
  if (deckIdx >= deck.length) { deck = shuffle(CARDS); deckIdx = 0; }

  return { stats, day: g.day + 1, deck, deckIdx, over };
}

// which stats a choice touches (for preview dots while tilting)
export function touchedStats(card: Card, dir: 'left' | 'right'): StatKey[] {
  const fx = dir === 'left' ? card.left.fx : card.right.fx;
  return Object.keys(fx) as StatKey[];
}
