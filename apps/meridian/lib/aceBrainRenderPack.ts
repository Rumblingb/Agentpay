import type { ImageSourcePropType } from 'react-native';

export type AceBrainRenderPack = {
  beauty: ImageSourcePropType;
  sigilFallback: ImageSourcePropType;
  alpha: ImageSourcePropType | null;
  depth: ImageSourcePropType | null;
  mouthMask: ImageSourcePropType | null;
  focusMask: ImageSourcePropType | null;
  specular: ImageSourcePropType | null;
};

/**
 * Central contract for the Ace brain art source.
 *
 * Today:
 * - Meridian ships a six-pass render pack behind one stable contract
 *
 * Remaining ceiling:
 * - the source renders still need a coordinated high-resolution art refresh
 *   rather than another round of component-local rewiring
 */
export const ACE_BRAIN_RENDER_PACK: AceBrainRenderPack = {
  beauty: require('../assets/ace-face-render.png'),
  sigilFallback: require('../assets/ace-mark.png'),
  alpha: require('../assets/ace-face-alpha.png'),
  depth: require('../assets/ace-face-depth.png'),
  mouthMask: require('../assets/ace-face-mouth-mask.png'),
  focusMask: require('../assets/ace-face-focus-mask.png'),
  specular: require('../assets/ace-face-specular.png'),
};

export const ACE_BRAIN_RENDER_PACK_STATUS = {
  hasBeauty: true,
  hasAlpha: true,
  hasDepth: true,
  hasMouthMask: true,
  hasFocusMask: true,
  hasSpecular: true,
} as const;

export function hasAceBrainDeformationPack(): boolean {
  return Boolean(
    ACE_BRAIN_RENDER_PACK.alpha &&
    ACE_BRAIN_RENDER_PACK.depth &&
    ACE_BRAIN_RENDER_PACK.mouthMask &&
    ACE_BRAIN_RENDER_PACK.focusMask &&
    ACE_BRAIN_RENDER_PACK.specular
  );
}
