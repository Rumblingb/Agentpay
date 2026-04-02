import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

interface AceMarkProps {
  size?: number;
  ringColor?: string;
  glowColor?: string;
  backgroundColor?: string;
}

const ACE_MARK_ASSET = require('../assets/ace-mark.png');

export function AceMark({
  size = 96,
  ringColor = 'rgba(220, 238, 255, 0.36)',
  glowColor = '#cbe8ff',
  backgroundColor = 'transparent',
}: AceMarkProps) {
  const haloSize = size * 1.08;
  const markW = size * 0.9;
  const markH = size * 0.94;
  const showBackdrop = backgroundColor !== 'transparent';

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <View
        style={[
          styles.halo,
          {
            width: haloSize,
            height: haloSize,
            borderRadius: haloSize / 2,
            backgroundColor: glowColor,
            shadowColor: glowColor,
            shadowRadius: size * 0.26,
          },
        ]}
      />

      {showBackdrop ? (
        <View
          style={[
            styles.backdrop,
            {
              width: size * 0.9,
              height: size * 0.9,
              borderRadius: size * 0.45,
              backgroundColor,
              borderColor: ringColor,
            },
          ]}
        />
      ) : null}

      <Image
        source={ACE_MARK_ASSET}
        style={{ width: markW, height: markH }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    opacity: 0.08,
    shadowOpacity: 0.42,
    shadowOffset: { width: 0, height: 0 },
  },
  backdrop: {
    position: 'absolute',
    opacity: 0.18,
    borderWidth: 1,
  },
});
