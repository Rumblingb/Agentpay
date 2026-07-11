import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, Animated, PanResponder, Dimensions,
  TouchableOpacity, Share, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C, STATS, StatKey } from './src/theme';
import { GameState, newGame, currentCard, applyChoice, touchedStats } from './src/engine';
import { CARDS, DEATHS } from './src/cards';

const BEST_KEY = 'pc_best_v1';

const _dim = Dimensions.get('window');
const W = (Platform.OS === 'web' && typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : _dim.width;
const H = (Platform.OS === 'web' && typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : _dim.height;
const SWIPE_OUT = Math.min(W * 0.32, 150);

// ── SCREENSHOT HARNESS (local only — set to 'off' before ship) ──
const SHOT: 'off' | 'title' | 'game1' | 'game2' | 'over' = 'off';
function _seed(idx: number, day: number, stats: any): GameState {
  return { stats, day, deck: CARDS, deckIdx: idx, over: null };
}

function haptic(style: 'light' | 'heavy' = 'light') {
  if (Platform.OS === 'web') return;
  try {
    Haptics.impactAsync(style === 'light' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  } catch {
    // some devices (e.g. iPad with no Taptic Engine) can throw synchronously — never let a haptic crash the app
  }
}

// ───────────────────────── stat bar ─────────────────────────
function StatBar({ k, value, hot }: { k: (typeof STATS)[number]; value: number; hot: boolean }) {
  const anim = useRef(new Animated.Value(value)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const prev = useRef(value);
  React.useEffect(() => {
    Animated.spring(anim, { toValue: value, useNativeDriver: false, friction: 8 }).start();
    if (prev.current !== value) {
      // damage/gain flash — the bar announces every hit
      flash.setValue(1);
      Animated.timing(flash, { toValue: 0, duration: 650, useNativeDriver: false }).start();
      prev.current = value;
    }
  }, [value]);
  const danger = value <= 20 || value >= 80;
  return (
    <View style={st.statCol}>
      <Text style={[st.statIcon, { color: k.color, opacity: hot ? 1 : danger ? 0.9 : 0.5 }]}>{k.icon}</Text>
      <View style={[st.statTrack, danger && { borderColor: k.color, borderWidth: 1 }]}>
        <Animated.View
          style={[st.statFill, {
            backgroundColor: k.color,
            height: anim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
            opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [hot ? 1 : 0.55, 1] }),
          }]}
        />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, {
          backgroundColor: k.color, borderRadius: 4,
          opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] }),
        }]} />
      </View>
      {hot && <View style={[st.hotDot, { backgroundColor: k.color }]} />}
    </View>
  );
}

// ───────────────────────── card entrance ─────────────────────────
function useCardEntrance(dep: number) {
  const enter = useRef(new Animated.Value(Platform.OS === 'web' ? 1 : 0)).current;
  React.useEffect(() => {
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 7, tension: 60 }).start();
  }, [dep]);
  if (Platform.OS === 'web') {
    return { opacity: 1 as any, transform: [] as any };
  }
  return {
    opacity: enter,
    transform: [
      { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [34, 0] }) },
      { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
    ],
  };
}

// ───────────────────────── app ─────────────────────────
export default function App() {
  const [gameState, setGame] = useState<GameState>(newGame);
  const [screenState, setScreen] = useState<'title' | 'game' | 'over'>('title');
  const [best, setBest] = useState(0);

  // ── screenshot harness overrides (no-op when SHOT==='off') ──
  const game: GameState =
    SHOT === 'game1' ? _seed(0, 12, { treasury: 64, people: 47, military: 55, planet: 38 })
    : SHOT === 'game2' ? _seed(1, 23, { treasury: 72, people: 34, military: 61, planet: 51 })
    : SHOT === 'over' ? { stats: { treasury: 0, people: 30, military: 42, planet: 46 }, day: 48, deck: CARDS, deckIdx: 0, over: { dead: true, stat: 'treasury', line: DEATHS.treasury.low } }
    : gameState;
  const screen: 'title' | 'game' | 'over' =
    SHOT === 'off' ? screenState : SHOT === 'title' ? 'title' : SHOT === 'over' ? 'over' : 'game';

  useEffect(() => {
    AsyncStorage.getItem(BEST_KEY).then(v => { if (v) setBest(parseInt(v, 10) || 0); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.style.backgroundColor = C.ink;
      document.body.style.backgroundColor = C.ink;
      document.body.style.margin = '0';
      let vp = document.querySelector('meta[name=viewport]') as HTMLMetaElement | null;
      if (!vp) { vp = document.createElement('meta'); vp.name = 'viewport'; document.head.appendChild(vp); }
      vp.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1');
      const root = document.getElementById('root');
      if (root) { root.style.width = '100vw'; root.style.overflow = 'hidden'; }
    }
  }, []);

  const pan = useRef(new Animated.ValueXY()).current;
  const [tilt, setTilt] = useState<'left' | 'right' | null>(null);

  const card = currentCard(game);
  const hotStats: StatKey[] = tilt ? touchedStats(card, tilt) : [];
  const entrance = useCardEntrance(game.day);

  const settle = useCallback(() => {
    Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true, friction: 6 }).start();
    setTilt(null);
  }, [pan]);

  const commit = useCallback((dir: 'left' | 'right') => {
    haptic('heavy');
    Animated.timing(pan, {
      toValue: { x: dir === 'left' ? -W * 1.3 : W * 1.3, y: 0 },
      duration: 220, useNativeDriver: true,
    }).start(() => {
      pan.setValue({ x: 0, y: 0 });
      setTilt(null);
      setGame(g => {
        const next = applyChoice(g, dir);
        if (next.over) {
          const days = next.day - 1;
          setBest(b => {
            const nb = Math.max(b, days);
            AsyncStorage.setItem(BEST_KEY, String(nb)).catch(() => {});
            return nb;
          });
          setTimeout(() => setScreen('over'), 350);
        }
        return next;
      });
    });
  }, [pan]);

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6,
      onPanResponderMove: (_, g) => {
        pan.setValue({ x: g.dx, y: g.dy * 0.1 });
        const t = g.dx < -28 ? 'left' : g.dx > 28 ? 'right' : null;
        setTilt(prev => { if (prev !== t && t) haptic('light'); return t; });
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -SWIPE_OUT) commit('left');
        else if (g.dx > SWIPE_OUT) commit('right');
        else settle();
      },
    })
  ).current;

  const rotate = pan.x.interpolate({ inputRange: [-W, 0, W], outputRange: ['-13deg', '0deg', '13deg'] });
  const leftOpacity = pan.x.interpolate({ inputRange: [-120, -30, 0], outputRange: [1, 0.25, 0], extrapolate: 'clamp' });
  const rightOpacity = pan.x.interpolate({ inputRange: [0, 30, 120], outputRange: [0, 0.25, 1], extrapolate: 'clamp' });

  // ───────── title ─────────
  if (screen === 'title') {
    return (
      <View style={st.root}>
        <StatusBar style="light" />
        <View style={st.titleWrap}>
          <Text style={st.kicker}>A NEAR-FUTURE NATION. AN IMPOSSIBLE JOB.</Text>
          <Text style={st.title}>POWER{'\n'}CABINET</Text>
          <Text style={st.sub}>
            Your advisors bring you one impossible decision at a time.{'\n'}
            Swipe left or right. Keep four forces in balance.{'\n'}
            Survive as many days as you can.
          </Text>
          <View style={st.statLegend}>
            {STATS.map(s => (
              <View key={s.key} style={st.legendItem}>
                <Text style={[st.legendIcon, { color: s.color }]}>{s.icon}</Text>
                <Text style={st.legendLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={st.cta} onPress={() => { setGame(newGame()); setScreen('game'); haptic('heavy'); }}>
            <Text style={st.ctaText}>TAKE OFFICE</Text>
          </TouchableOpacity>
          {best > 0 && <Text style={st.bestLine}>LONGEST REIGN — {best} DAYS</Text>}
        </View>
        <Text style={st.footer}>BY AGENTPAY LABS</Text>
      </View>
    );
  }

  // ───────── game over ─────────
  if (screen === 'over' && game.over) {
    const days = game.day - 1;
    const s = STATS.find(x => x.key === game.over!.stat)!;
    return (
      <View style={st.root}>
        <StatusBar style="light" />
        <View style={st.titleWrap}>
          <Text style={[st.overIcon, { color: s.color }]}>{s.icon}</Text>
          <Text style={st.overDays}>{days}</Text>
          <Text style={st.kicker}>DAYS IN POWER</Text>
          {days >= best && days > 1 && <Text style={st.newRecord}>NEW RECORD</Text>}
          <Text style={st.deathLine}>{game.over.line}</Text>
          <TouchableOpacity style={st.cta} onPress={() => { setGame(newGame()); setScreen('game'); haptic('heavy'); }}>
            <Text style={st.ctaText}>RUN IT BACK</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={st.ctaGhost}
            onPress={() => Share.share({ message: `I lasted ${days} days running a nation in Power Cabinet. The ${s.label.toLowerCase()} got me. Think you'd last longer?` })}
          >
            <Text style={st.ctaGhostText}>SHARE THE OBITUARY</Text>
          </TouchableOpacity>
        </View>
        <Text style={st.footer}>BY AGENTPAY LABS</Text>
      </View>
    );
  }

  // ───────── game ─────────
  return (
    <View style={st.root} {...responder.panHandlers}>
      <StatusBar style="light" />
      <View style={st.hud}>
        <View style={st.statRow}>
          {STATS.map(s => <StatBar key={s.key} k={s} value={game.stats[s.key]} hot={hotStats.includes(s.key)} />)}
        </View>
        <Text style={st.day}>DAY {game.day}</Text>
      </View>

      <View style={st.cardZone}>
        <Animated.View
          style={[st.card, { opacity: entrance.opacity },
            { transform: [...entrance.transform, { translateX: pan.x }, { translateY: pan.y }, { rotate }] }]}
        >
          <View style={st.advisorRow}>
            <View style={st.avatar}><Text style={st.avatarText}>{card.advisor.split(' ').map(w => w[0]).join('')}</Text></View>
            <View>
              <Text style={st.advisorName}>{card.advisor}</Text>
              <Text style={st.advisorRole}>{card.role.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={st.dilemma}>{card.text}</Text>

          <Animated.View style={[st.choiceTag, st.choiceLeft, { opacity: leftOpacity }]}>
            <Text style={st.choiceText}>{card.left.label.toUpperCase()}</Text>
          </Animated.View>
          <Animated.View style={[st.choiceTag, st.choiceRight, { opacity: rightOpacity }]}>
            <Text style={st.choiceText}>{card.right.label.toUpperCase()}</Text>
          </Animated.View>
        </Animated.View>
      </View>

      <View style={st.hintRow}>
        <Text style={st.hint}>← {card.left.label}</Text>
        <Text style={st.hint}>{card.right.label} →</Text>
      </View>
    </View>
  );
}

// ───────────────────────── styles ─────────────────────────
const st = StyleSheet.create({
  root: { flex: 1, width: '100%', maxWidth: '100%', backgroundColor: C.ink, paddingTop: Platform.OS === 'ios' ? 56 : 36 },

  // HUD
  hud: { width: '100%', alignItems: 'center', gap: 10 },
  statRow: { flexDirection: 'row', gap: 26 },
  statCol: { alignItems: 'center', width: 30 },
  statIcon: { fontSize: 13, marginBottom: 5 },
  statTrack: { width: 8, height: 64, backgroundColor: C.inkRaised, borderRadius: 4, overflow: 'hidden', justifyContent: 'flex-end' },
  statFill: { width: '100%', borderRadius: 4 },
  hotDot: { width: 5, height: 5, borderRadius: 3, marginTop: 5 },
  day: { color: C.dim, fontSize: 12, letterSpacing: 3, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  // card
  cardZone: { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 22 },
  card: {
    alignSelf: 'stretch', minHeight: H * 0.42, backgroundColor: C.inkRaised, borderRadius: 22,
    padding: 26, borderWidth: 1, borderColor: C.line, justifyContent: 'flex-start',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12,
  },
  advisorRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 22 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  avatarText: { color: C.amber, fontSize: 15, fontWeight: '800' },
  advisorName: { color: C.bone, fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
  advisorRole: { color: C.dim, fontSize: 10, letterSpacing: 2, marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  dilemma: { color: C.bone, fontSize: 21, lineHeight: 31, fontWeight: '600', letterSpacing: -0.4 },

  choiceTag: { position: 'absolute', top: 18, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 2 },
  choiceLeft: { left: 18, borderColor: C.military, transform: [{ rotate: '-6deg' }] },
  choiceRight: { right: 18, borderColor: C.people, transform: [{ rotate: '6deg' }] },
  choiceText: { color: C.bone, fontSize: 13, fontWeight: '900', letterSpacing: 1 },

  hintRow: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 30, paddingBottom: 34 },
  hint: { color: C.dim, fontSize: 12.5, maxWidth: 150 },

  // title / over
  titleWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  kicker: { color: C.dim, fontSize: 11, letterSpacing: 3, marginBottom: 18, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', textAlign: 'center' },
  title: { color: C.bone, fontSize: 64, fontWeight: '900', letterSpacing: -2, lineHeight: 64, textAlign: 'center', marginBottom: 22 },
  sub: { color: C.dim, fontSize: 15, lineHeight: 24, textAlign: 'center', marginBottom: 30 },
  statLegend: { flexDirection: 'row', gap: 18, marginBottom: 38 },
  legendItem: { alignItems: 'center', gap: 5 },
  legendIcon: { fontSize: 16 },
  legendLabel: { color: C.dim, fontSize: 9, letterSpacing: 1.5 },
  cta: { backgroundColor: C.amber, paddingHorizontal: 44, paddingVertical: 17, borderRadius: 12 },
  ctaText: { color: C.ink, fontSize: 16, fontWeight: '900', letterSpacing: 2 },
  ctaGhost: { marginTop: 16, paddingHorizontal: 30, paddingVertical: 14 },
  ctaGhostText: { color: C.dim, fontSize: 13, fontWeight: '700', letterSpacing: 1.5 },
  bestLine: { color: C.amber, fontSize: 12, letterSpacing: 2, marginTop: 26, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  newRecord: { color: C.amber, fontSize: 13, fontWeight: '900', letterSpacing: 3, marginTop: 10 },
  overIcon: { fontSize: 40, marginBottom: 8 },
  overDays: { color: C.bone, fontSize: 110, fontWeight: '900', letterSpacing: -4, lineHeight: 112 },
  deathLine: { color: C.bone, fontSize: 17, lineHeight: 27, textAlign: 'center', marginVertical: 28, opacity: 0.85 },
  footer: { color: C.dim, fontSize: 9, letterSpacing: 2, textAlign: 'center', paddingBottom: 24, opacity: 0.6 },
});
