import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import Svg, { Circle } from 'react-native-svg';
import { getTodayQuestion } from '../data/questions';

const W = typeof window !== 'undefined' ? window.innerWidth : 390;
const STREAK_KEY = '@oq_streak';
const COLORS = { bg: '#0d0d0d', green: '#58cc02', greenDark: '#46a302', text: '#fff', dim: '#808080', gold: '#ffd700' };

function getToday() { return new Date().toISOString().split('T')[0]; }

function StreakRing({ progress, size = 90 }: { progress: number; size?: number }) {
  const sw = 5, r = (size - sw) / 2, circ = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size}>
      <Circle cx={size/2} cy={size/2} r={r} stroke="#333" strokeWidth={sw} fill="none" />
      <Circle cx={size/2} cy={size/2} r={r} stroke={progress>=1?COLORS.gold:COLORS.green} strokeWidth={sw}
        fill="none" strokeDasharray={`${circ} ${circ}`}
        strokeDashoffset={circ * (1 - Math.min(progress,1))}
        strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`} />
    </Svg>
  );
}

export default function Home() {
  const [streak, setStreak] = useState({ c:0, l:0, d:'', t:0 });
  const [done, setDone] = useState(false);
  const [q, setQ] = useState('');
  const pulse = useState(new Animated.Value(1))[0];
  const bounce = useState(new Animated.Value(1))[0];

  useEffect(() => {
    setQ(getTodayQuestion());
    (async () => {
      const raw = await AsyncStorage.getItem(STREAK_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        setStreak(s);
        setDone(s.d === getToday());
      }
    })();
  }, []);

  useEffect(() => {
    if (streak.c > 0) {
      Animated.sequence([
        Animated.timing(bounce, { toValue: 1.12, duration: 200, useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [streak.c]);

  useEffect(() => {
    if (!done) {
      const p = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 0.92, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]));
      p.start(); return () => p.stop();
    }
  }, [done]);

  return (
    <View style={{flex:1, backgroundColor:COLORS.bg, paddingTop:Platform.OS==='ios'?60:40, paddingHorizontal:20, alignItems:'center'}}>
      <Animated.View style={{flexDirection:'row',justifyContent:'space-between',width:'100%',marginBottom:16,transform:[{scale:bounce}]}}>
        <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
          <Text style={{fontSize:16}}>  </Text>
          <Text style={{fontSize:30,fontWeight:'800',color:COLORS.gold,letterSpacing:-1}}>{streak.c}</Text>
          <Text style={{fontSize:13,color:COLORS.dim,fontWeight:'600'}}>day streak</Text>
        </View>
        <View style={{flexDirection:'row',gap:14}}>
          <View style={{alignItems:'center'}}><Text style={{fontSize:16,fontWeight:'700',color:COLORS.text}}>{streak.l}</Text><Text style={{fontSize:10,color:COLORS.dim,textTransform:'uppercase',letterSpacing:1}}>best</Text></View>
          <View style={{alignItems:'center'}}><Text style={{fontSize:16,fontWeight:'700',color:COLORS.text}}>{streak.t}</Text><Text style={{fontSize:10,color:COLORS.dim,textTransform:'uppercase',letterSpacing:1}}>total</Text></View>
        </View>
      </Animated.View>

      <View style={{alignItems:'center',marginBottom:20}}>
        <StreakRing progress={done?1:0.25} />
        <Text style={{fontSize:13,color:COLORS.dim,marginTop:6,fontWeight:'600'}}>Day {streak.c + 1}</Text>
      </View>

      <Animated.View style={{width:'100%',borderRadius:20,overflow:'hidden',elevation:8,shadowColor:COLORS.green,shadowOffset:{width:0,height:4},shadowOpacity:0.15,shadowRadius:12,transform:done?[]:[{scale:pulse}]}}>
        <LinearGradient colors={['#1a1a1a','#222']} style={{padding:28,alignItems:'center',borderWidth:1,borderColor:'#2a2a2a',borderRadius:20}}>
          <Text style={{fontSize:10,color:COLORS.green,fontWeight:'700',letterSpacing:2,marginBottom:14}}>TODAY'S QUESTION</Text>
          <Text style={{fontSize:21,fontWeight:'700',color:COLORS.text,textAlign:'center',lineHeight:29,marginBottom:22}}>{q}</Text>
          {done ? (
            <View style={{backgroundColor:'#0a2e0a',paddingHorizontal:18,paddingVertical:8,borderRadius:12,borderWidth:1,borderColor:COLORS.green}}>
              <Text style={{fontSize:14,fontWeight:'600',color:COLORS.green}}>  Done for today!</Text>
            </View>
          ) : (
            <Pressable onPress={() => router.push('/answer')} style={({pressed}) => ({backgroundColor:COLORS.green,paddingHorizontal:40,paddingVertical:13,borderRadius:14,elevation:4,shadowColor:COLORS.greenDark,shadowOffset:{width:0,height:3},shadowOpacity:0.3,shadowRadius:6,opacity:pressed?0.8:1})}>
              <Text style={{fontSize:16,fontWeight:'700',color:'#000'}}>Answer</Text>
            </Pressable>
          )}
        </LinearGradient>
      </Animated.View>

      {!done && streak.c > 0 && (
        <View style={{backgroundColor:'#2a1a00',paddingHorizontal:16,paddingVertical:10,borderRadius:12,borderWidth:1,borderColor:'#4a2a00',marginTop:16}}>
          <Text style={{fontSize:13,color:COLORS.dim,fontWeight:'500'}}>  Missing today breaks your {streak.c}-day streak!</Text>
        </View>
      )}

      <View style={{flex:1,justifyContent:'flex-end',paddingBottom:40}}>
        <Text style={{fontSize:13,color:'#555',textAlign:'center'}}>{done ? "  See you tomorrow!" : "Takes 15 seconds. That's it."}</Text>
      </View>
    </View>
  );
}
