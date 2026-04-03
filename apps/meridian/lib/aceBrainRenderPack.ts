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
 * - we only ship the beauty bust and sigil fallback
 *
 * Next render-pack upgrade:
 * - alpha
 * - depth
 * - mouthMask
 * - focusMask
 * - specular
 *
 * Keeping this contract in one place makes the final art upgrade a drop-in
 * replacement instead of another round of component-local asset wiring.
 */
export const ACE_BRAIN_RENDER_PACK: AceBrainRenderPack = {
  beauty: require('../assets/ace-face-render.png'),
  sigilFallback: require('../assets/ace-mark.png'),
  alpha: null,
  depth: null,
  mouthMask: null,
  focusMask: null,
  specular: null,
};

export const ACE_BRAIN_RENDER_PACK_STATUS = {
  hasBeauty: true,
  hasAlpha: false,
  hasDepth: false,
  hasMouthMask: false,
  hasFocusMask: false,
  hasSpecular: false,
} as const;

export function hasAceBrainDeformationPack(): boolean {
  return Boolean(
    ACE_BRAIN_RENDER_PACK.alpha &&
    ACE_BRAIN_RENDER_PACK.depth &&
    ACE_BRAIN_RENDER_PACK.mouthMask &&
    ACE_BRAIN_RENDER_PACK.focusMask
  );
}
