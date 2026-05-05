import { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, Pressable, Animated, Platform, TextInput } from 'react-native';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { getTodayQuestion } from '../data/questions';

const COLORS = { bg: '#0d0d0d', green: '#58cc02', greenDark: '#46a302', text: '#fff', dim: '#808080', card: '#1a1a1a' };
const STREAK_KEY = '@oq_streak';

function getToday() { return new Date().toISOString().split('T')[0]; }

export default function Answer() {
  const [mode, setMode] = useState<'choose'|'voice'|'type'>('choose');
  const [answer, setAnswer] = useState('');
  const [answered, setAnswered] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRec, setIsRec] = useState(false);
  const scale = useRef(new Animated.Value(0.9)).current;
  const q = getTodayQuestion();

  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }).start();
  }, []);

  const handleRecord = useCallback(async () => {
    try {
      if (isRec && recording) {
        await recording.stopAndUnloadAsync();
        setRecording(null);
        setIsRec(false);
        setAnswer('[Voice captured — transcript coming with Ace integration]');
        setMode('voice');
      } else {
        const perm = await Audio.requestPermissionsAsync();
        if (!perm.granted) return;
        const { recording: rec } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );
        setRecording(rec);
        setIsRec(true);
      }
    } catch (e) {
      console.error(e);
      setIsRec(false);
    }
  }, [isRec, recording]);

  const handleSubmit = useCallback(async () => {
    if (!answer.trim()) return;
    const today = getToday();
    const raw = await AsyncStorage.getItem(STREAK_KEY);
    const prev = raw ? JSON.parse(raw) : { c:0, l:0, d:'', t:0 };
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const consecutive = prev.d === yesterday || prev.d === '';
    const updated = { c: consecutive ? prev.c + 1 : 1, l: Math.max(prev.l, consecutive ? prev.c + 1 : 1), d: today, t: prev.t + 1 };
    await AsyncStorage.setItem(STREAK_KEY, JSON.stringify(updated));
    setAnswered(true);
  }, [answer]);

  return (
    <View style={{flex:1,backgroundColor:COLORS.bg,paddingTop:Platform.OS==='ios'?60:40}}>
      <Pressable onPress={() => router.back()} style={{paddingHorizontal:20,paddingVertical:8}}>
        <Text style={{fontSize:16,color:COLORS.dim,fontWeight:'600'}}>  Back</Text>
      </Pressable>

      <Animated.View style={{flex:1,paddingHorizontal:24,paddingTop:20,alignItems:'center',transform:[{scale}]}}>
        <Text style={{fontSize:10,color:COLORS.green,fontWeight:'700',letterSpacing:2,marginBottom:12}}>YOUR ANSWER</Text>
        <Text style={{fontSize:20,fontWeight:'700',color:COLORS.text,textAlign:'center',lineHeight:28,marginBottom:32,paddingHorizontal:20}}>{q}</Text>

        {!answered ? (
          <>
            {mode === 'choose' && (
              <View style={{width:'100%',gap:12}}>
                <Pressable onPress={() => setMode('voice')} style={{padding:20,borderRadius:16,alignItems:'center',borderWidth:1,borderColor:'#333',backgroundColor:'#222'}}>
                  <Text style={{fontSize:32,marginBottom:8}}>  </Text>
                  <Text style={{fontSize:16,fontWeight:'700',color:COLORS.text}}>Voice</Text>
                  <Text style={{fontSize:13,color:COLORS.dim}}>Speak your answer</Text>
                </Pressable>
                <Pressable onPress={() => setMode('type')} style={{padding:20,borderRadius:16,alignItems:'center',borderWidth:1,borderColor:'#333',backgroundColor:'#222'}}>
                  <Text style={{fontSize:32,marginBottom:8}}>  </Text>
                  <Text style={{fontSize:16,fontWeight:'700',color:COLORS.text}}>Type</Text>
                  <Text style={{fontSize:13,color:COLORS.dim}}>Write it down</Text>
                </Pressable>
              </View>
            )}

            {mode === 'voice' && (
              <View style={{alignItems:'center',gap:16}}>
                <Pressable onPress={handleRecord} style={{width:80,height:80,borderRadius:40,backgroundColor:'#222',justifyContent:'center',alignItems:'center',borderWidth:2,borderColor:isRec?'#ff4444':COLORS.green}}>
                  <Text style={{fontSize:32}}>{isRec ? '  ' : '  '}</Text>
                </Pressable>
                <Text style={{fontSize:14,color:COLORS.dim}}>{isRec ? 'Recording... tap to stop' : 'Tap to record'}</Text>
                {mode === 'voice' && answer ? (
                  <View style={{alignItems:'center',gap:12}}>
                    <Text style={{fontSize:12,color:COLORS.dim}}>Transcript:</Text>
                    <Text style={{fontSize:15,color:COLORS.text,textAlign:'center',fontStyle:'italic'}}>{answer}</Text>
                    <Pressable onPress={handleSubmit} style={{backgroundColor:COLORS.green,paddingHorizontal:40,paddingVertical:14,borderRadius:14}}>
                      <Text style={{fontSize:16,fontWeight:'700',color:'#000'}}>Save answer</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            )}

            {mode === 'type' && (
              <View style={{width:'100%',gap:16}}>
                <TextInput
                  style={{backgroundColor:'#1a1a1a',borderRadius:16,padding:20,fontSize:16,color:COLORS.text,minHeight:120,borderWidth:1,borderColor:'#333',textAlignVertical:'top'}}
                  placeholder="Type your answer..."
                  placeholderTextColor="#555"
                  multiline
                  value={answer}
                  onChangeText={setAnswer}
                  autoFocus
                />
                {answer.trim().length > 0 && (
                  <Pressable onPress={handleSubmit} style={{backgroundColor:COLORS.green,paddingHorizontal:40,paddingVertical:14,borderRadius:14,alignSelf:'center'}}>
                    <Text style={{fontSize:16,fontWeight:'700',color:'#000'}}>Save answer</Text>
                  </Pressable>
                )}
              </View>
            )}
          </>
        ) : (
          <View style={{alignItems:'center',gap:10}}>
            <Text style={{fontSize:48}}>  </Text>
            <Text style={{fontSize:22,fontWeight:'700',color:COLORS.text}}>Answer saved!</Text>
            <Text style={{fontSize:15,color:COLORS.dim}}>Your streak is growing.</Text>
            <Pressable onPress={() => router.replace('/')} style={{marginTop:16,backgroundColor:COLORS.green,paddingHorizontal:40,paddingVertical:14,borderRadius:14}}>
              <Text style={{fontSize:16,fontWeight:'700',color:'#000'}}>Back to home</Text>
            </Pressable>
          </View>
        )}
      </Animated.View>
    </View>
  );
}
