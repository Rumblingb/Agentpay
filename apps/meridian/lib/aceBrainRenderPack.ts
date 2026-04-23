import type { ImageSourcePropType } from 'react-native';

export type AceBrainRenderPack = {
  beauty: ImageSourcePropType;
  sigilFallback: ImageSourcePropType;
  alpha: ImageSourcePropType | null;
  depth: ImageSourcePropType | null;
  mouthMask: ImageSourcePropType | null;
  focusMask: ImageSourcePropType | null;
  specular: ImageSourcePropType | null;
  speechJaw: ImageSourcePropType | null;
  speechOo: ImageSourcePropType | null;
  speechEe: ImageSourcePropType | null;
  expressionFocus: ImageSourcePropType | null;
  expressionSmile: ImageSourcePropType | null;
};

/**
 * Central contract for the Ace brain art source.
 *
 * Today:
 * - Meridian ships a high-resolution render pack with mesh-derived speech and
 *   expression frames behind one stable contract
 *
 * Remaining ceiling:
 * - the next leap after this pack is a live 3D runtime, not another render
 *   source rewrite
 */
export const ACE_BRAIN_RENDER_PACK: AceBrainRenderPack = {
  beauty: require('../assets/ace-face-render.png'),
  sigilFallback: require('../assets/ace-mark.png'),
  alpha: require('../assets/ace-face-alpha.png'),
  depth: require('../assets/ace-face-depth.png'),
  mouthMask: require('../assets/ace-face-mouth-mask.png'),
  focusMask: require('../assets/ace-face-focus-mask.png'),
  specular: require('../assets/ace-face-specular.png'),
  speechJaw: require('../assets/ace-face-viseme-jaw.png'),
  speechOo: require('../assets/ace-face-viseme-oo.png'),
  speechEe: require('../assets/ace-face-viseme-ee.png'),
  expressionFocus: require('../assets/ace-face-focus-brow.png'),
  expressionSmile: require('../assets/ace-face-serene-smile.png'),
};

export const ACE_BRAIN_RENDER_PACK_STATUS = {
  hasBeauty: true,
  hasAlpha: true,
  hasDepth: true,
  hasMouthMask: true,
  hasFocusMask: true,
  hasSpecular: true,
  hasSpeechJaw: true,
  hasSpeechOo: true,
  hasSpeechEe: true,
  hasExpressionFocus: true,
  hasExpressionSmile: true,
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

export function hasAceBrainSpeechRenderPack(): boolean {
  return Boolean(
    ACE_BRAIN_RENDER_PACK.speechJaw &&
    ACE_BRAIN_RENDER_PACK.speechOo &&
    ACE_BRAIN_RENDER_PACK.speechEe
  );
}

export function hasAceBrainExpressionRenderPack(): boolean {
  return Boolean(
    ACE_BRAIN_RENDER_PACK.expressionFocus &&
    ACE_BRAIN_RENDER_PACK.expressionSmile
  );
}
