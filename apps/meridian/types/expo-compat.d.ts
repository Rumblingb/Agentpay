declare module 'expo-linear-gradient' {
  import * as React from 'react';
  import { ViewProps, ViewStyle, StyleProp } from 'react-native';

  export interface LinearGradientProps extends ViewProps {
    colors: readonly string[];
    locations?: readonly number[];
    start?: { x: number; y: number };
    end?: { x: number; y: number };
    style?: StyleProp<ViewStyle>;
  }

  export const LinearGradient: React.ComponentType<LinearGradientProps>;
}

declare module 'expo-blur' {
  import * as React from 'react';
  import { ViewProps } from 'react-native';

  export interface BlurViewProps extends ViewProps {
    intensity?: number;
    tint?: 'light' | 'dark' | 'default' | 'extraLight' | 'regular' | 'prominent' | 'systemUltraThinMaterial';
  }

  export const BlurView: React.ComponentType<BlurViewProps>;
}

declare module 'react-native-safe-area-context' {
  import * as React from 'react';
  import { ViewProps } from 'react-native';

  export interface EdgeInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
  }

  export interface SafeAreaViewProps extends ViewProps {
    edges?: readonly ('top' | 'right' | 'bottom' | 'left')[];
  }

  export const SafeAreaView: React.ComponentType<SafeAreaViewProps>;
  export function useSafeAreaInsets(): EdgeInsets;
}
