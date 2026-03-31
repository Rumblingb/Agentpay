import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface AceMarkProps {
  size?: number;
  ringColor?: string;
  glowColor?: string;
  backgroundColor?: string;
  iconColor?: string;
  headingDeg?: number;
}

export function AceMark({
  size = 96,
  ringColor = 'rgba(220, 238, 255, 0.76)',
  glowColor = '#cbe8ff',
  backgroundColor = '#303844',
  iconColor = 'rgba(246, 250, 255, 0.98)',
  headingDeg = 12,
}: AceMarkProps) {
  const ovalW = size * 0.86;
  const ovalH = size * 1.04;
  const borderW = Math.max(1, size * 0.015);
  const haloW = ovalW * 1.2;
  const haloH = ovalH * 1.1;
  const markW = size * 0.38;
  const markH = size * 0.46;
  const rightW = markW * 0.38;
  const rightH = markH * 0.92;
  const leftW = markW * 0.3;
  const leftH = markH * 0.56;
  const notchW = markW * 0.16;
  const notchH = markH * 0.32;
  const footW = markW * 0.22;
  const footH = markH * 0.16;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: haloW,
          height: haloH,
          borderRadius: size,
          backgroundColor: glowColor,
          opacity: 0.1,
          shadowColor: glowColor,
          shadowOpacity: 0.5,
          shadowRadius: size * 0.34,
          shadowOffset: { width: 0, height: 0 },
        }}
      />

      <LinearGradient
        colors={[
          'rgba(255,255,255,0.14)',
          'rgba(255,255,255,0.06)',
          'rgba(255,255,255,0.015)',
        ]}
        start={{ x: 0.18, y: 0.04 }}
        end={{ x: 0.86, y: 0.92 }}
        style={{
          position: 'absolute',
          width: ovalW,
          height: ovalH,
          borderRadius: size,
          borderWidth: borderW,
          borderColor: ringColor,
          backgroundColor,
          overflow: 'hidden',
          shadowColor: glowColor,
          shadowOpacity: 0.2,
          shadowRadius: size * 0.2,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        <LinearGradient
          colors={['rgba(255,255,255,0.18)', 'rgba(255,255,255,0)']}
          start={{ x: 0.18, y: 0 }}
          end={{ x: 0.72, y: 0.46 }}
          style={StyleSheet.absoluteFill}
        />
      </LinearGradient>

      <View
        style={{
          width: markW,
          height: markH,
          marginBottom: size * 0.01,
          transform: [{ rotate: `${headingDeg}deg` }],
        }}
      >
        <LinearGradient
          colors={['rgba(255,255,255,0.98)', iconColor, '#d4e7ff']}
          start={{ x: 0.18, y: 0 }}
          end={{ x: 0.88, y: 1 }}
          style={[
            styles.arm,
            {
              width: rightW,
              height: rightH,
              left: markW * 0.42,
              top: markH * 0.02,
              borderRadius: rightW * 0.82,
              transform: [{ rotate: '27deg' }],
              shadowColor: '#eff8ff',
              shadowOpacity: 0.35,
              shadowRadius: size * 0.12,
              shadowOffset: { width: 0, height: 0 },
            },
          ]}
        >
          <LinearGradient
            colors={['rgba(255,255,255,0.28)', 'rgba(255,255,255,0)']}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.75, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </LinearGradient>

        <LinearGradient
          colors={['#f4fbff', '#d5e7fb']}
          start={{ x: 0.12, y: 0 }}
          end={{ x: 0.88, y: 1 }}
          style={[
            styles.arm,
            {
              width: leftW,
              height: leftH,
              left: markW * 0.08,
              top: markH * 0.42,
              borderRadius: leftW * 0.9,
              transform: [{ rotate: '-29deg' }],
            },
          ]}
        />

        <LinearGradient
          colors={['rgba(245, 250, 255, 0.98)', '#d9ecff']}
          start={{ x: 0, y: 0.35 }}
          end={{ x: 1, y: 0.85 }}
          style={[
            styles.arm,
            {
              width: footW,
              height: footH,
              left: markW * 0.17,
              top: markH * 0.75,
              borderRadius: footH,
              transform: [{ rotate: '-5deg' }],
            },
          ]}
        />

        <LinearGradient
          colors={['#526272', '#2b3541']}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.86, y: 1 }}
          style={[
            styles.arm,
            {
              width: notchW,
              height: notchH,
              left: markW * 0.37,
              top: markH * 0.44,
              borderRadius: notchW,
              transform: [{ rotate: '18deg' }],
              shadowColor: '#1a2531',
              shadowOpacity: 0.18,
              shadowRadius: size * 0.03,
              shadowOffset: { width: 0, height: 1 },
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  arm: {
    position: 'absolute',
    overflow: 'hidden',
  },
});
