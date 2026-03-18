/**
 * VoiceButton — hold to talk orb
 *
 * Press & hold → starts recording (listening phase)
 * Release → stops recording, triggers transcription
 */

import React, { useEffect, useRef } from 'react';
import {
  Pressable,
  View,
  Animated,
  StyleSheet,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  listening: boolean;
  disabled?: boolean;
  onPressIn: () => void;
  onPressOut: () => void;
}

export function VoiceButton({ listening, disabled, onPressIn, onPressOut }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const ring  = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (listening) {
      // Pulse animation while recording
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ring, { toValue: 1.5, duration: 900, useNativeDriver: true }),
            Animated.timing(ringOpacity, { toValue: 0, duration: 900, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(ringOpacity, { toValue: 0.6, duration: 0, useNativeDriver: true }),
          ]),
        ]),
      ).start();
      Animated.spring(scale, { toValue: 1.12, useNativeDriver: true, speed: 20 }).start();
    } else {
      ring.stopAnimation();
      ringOpacity.stopAnimation();
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20 }).start();
      ring.setValue(1);
      ringOpacity.setValue(0.6);
    }
  }, [listening]);

  const handlePressIn = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPressIn();
  };

  const handlePressOut = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPressOut();
  };

  return (
    <View style={styles.container}>
      {/* Pulse ring */}
      <Animated.View
        style={[
          styles.ring,
          {
            transform: [{ scale: ring }],
            opacity: listening ? ringOpacity : 0,
          },
        ]}
      />
      {/* Button */}
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={disabled}
          style={[
            styles.button,
            listening && styles.buttonActive,
            disabled && styles.buttonDisabled,
          ]}
        >
          <Ionicons
            name={listening ? 'mic' : 'mic-outline'}
            size={36}
            color={listening ? '#fff' : '#a5b4fc'}
          />
        </Pressable>
      </Animated.View>

      {/* Label */}
      {/* intentionally minimal — screen reader + label below button */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#6366f1',
  },
  button: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#1a1a2e',
    borderWidth: 2,
    borderColor: '#3730a3',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  buttonActive: {
    backgroundColor: '#4338ca',
    borderColor: '#818cf8',
    shadowOpacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
});
