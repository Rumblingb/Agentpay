import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Asset } from 'expo-asset';
import * as Haptics from 'expo-haptics';
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import type { SharedValue } from 'react-native-reanimated';
import type { AppPhase } from '../lib/store';
import { useAceMotion } from '../lib/aceMotion';
import type { AceBrainMode } from './AceBrain';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _fiber = require('@react-three/fiber/native') as {
  Canvas: React.ComponentType<any>;
  useFrame: typeof import('@react-three/fiber/native').useFrame;
  useLoader: typeof import('@react-three/fiber/native').useLoader;
};

const Canvas = _fiber.Canvas;
const useFrame = _fiber.useFrame;
const useLoader = _fiber.useLoader;

const AmbientLightNode = 'ambientLight' as unknown as React.ComponentType<any>;
const DirectionalLightNode = 'directionalLight' as unknown as React.ComponentType<any>;
const MeshNode = 'mesh' as unknown as React.ComponentType<any>;
const TorusGeometryNode = 'torusGeometry' as unknown as React.ComponentType<any>;
const MeshStandardMaterialNode = 'meshStandardMaterial' as unknown as React.ComponentType<any>;
const GroupNode = 'group' as unknown as React.ComponentType<any>;
const PrimitiveNode = 'primitive' as unknown as React.ComponentType<any>;

const CW = 270;
const CH = 310;
const ACE_GLB = require('../assets/ace-brain-foundation.glb');
type AceFaceFallbackComponent = React.ComponentType<Props>;

let AceFaceSkiaImpl: AceFaceFallbackComponent | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  AceFaceSkiaImpl = require('./AceFaceSkia').AceFaceSkia as AceFaceFallbackComponent;
} catch {
  AceFaceSkiaImpl = null;
}

interface Props {
  phase: AppPhase;
  isSpeaking: boolean;
  mode?: AceBrainMode;
  micAmplitude?: SharedValue<number>;
  ttsAmplitude?: SharedValue<number>;
  onPress?: () => void;
  disabled?: boolean;
}

type MorphTargets = Partial<Record<'Jaw_Open' | 'Viseme_OO' | 'Viseme_EE' | 'Focus_Brow' | 'Serene_Smile', number>>;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function phaseAccent(phase: AppPhase): string {
  switch (phase) {
    case 'listening':
      return '#f5fbff';
    case 'thinking':
    case 'hiring':
    case 'executing':
      return '#d8e7fb';
    case 'confirming':
      return '#f3e3c4';
    case 'done':
      return '#dcefe1';
    case 'error':
      return '#f2d9e2';
    default:
      return '#dde7f4';
  }
}

function useBundledAssetUri(moduleRef: number): string | null {
  const [uri, setUri] = useState<string | null>(() => {
    const asset = Asset.fromModule(moduleRef);
    return asset.localUri ?? asset.uri;
  });

  useEffect(() => {
    let active = true;

    (async () => {
      const asset = Asset.fromModule(moduleRef);
      await asset.downloadAsync();
      if (!active) return;
      setUri(asset.localUri ?? asset.uri);
    })().catch(() => {
      if (active) setUri(null);
    });

    return () => {
      active = false;
    };
  }, [moduleRef]);

  return uri;
}

function createMorphTargets(phase: AppPhase, isSpeaking: boolean, speechEnergy: number): MorphTargets {
  const jaw = isSpeaking ? Math.min(0.88, 0.14 + speechEnergy * 0.78) : 0;
  const oo = isSpeaking ? Math.min(0.32, Math.max(0, 0.42 - speechEnergy) * 0.76) : 0;
  const ee = isSpeaking ? Math.min(0.28, Math.max(0, speechEnergy - 0.18) * 0.58) : 0;
  const focus =
    phase === 'thinking' || phase === 'hiring' || phase === 'executing'
      ? 0.7
      : phase === 'listening'
        ? 0.18
        : phase === 'confirming'
          ? 0.12
          : 0;
  const smile = phase === 'done' ? 0.3 : phase === 'confirming' ? 0.08 : 0;

  return {
    Jaw_Open: jaw,
    Viseme_OO: oo,
    Viseme_EE: ee,
    Focus_Brow: focus,
    Serene_Smile: smile,
  };
}

function AceOracleScene({
  assetUri,
  phase,
  isSpeaking,
  mode = 'conversation',
  micAmplitude,
  ttsAmplitude,
  disabled,
  onReady,
}: Props & { assetUri: string; onReady: () => void }) {
  const { scene } = useLoader(GLTFLoader, assetUri);
  const { tiltX, tiltY } = useAceMotion(!disabled);
  const rootRef = useRef<Group>(null);
  const ambientRef = useRef<AmbientLight>(null);
  const keyRef = useRef<DirectionalLight>(null);
  const fillRef = useRef<DirectionalLight>(null);
  const rimRef = useRef<DirectionalLight>(null);
  const crownRef = useRef<DirectionalLight>(null);
  const haloRef = useRef<Mesh>(null);
  const pulseRef = useRef<Mesh>(null);
  const morphMeshesRef = useRef<Mesh[]>([]);

  const model = useMemo(() => {
    const clone = scene.clone(true);
    const box = new Box3().setFromObject(clone);
    const size = new Vector3();
    const center = new Vector3();
    box.getSize(size);
    box.getCenter(center);

    clone.position.x -= center.x;
    clone.position.y -= center.y - size.y * 0.05;
    clone.position.z -= center.z;

    const fitHeight = mode === 'onboarding' ? 2.02 : 2.16;
    const scale = fitHeight / Math.max(size.y, 0.001);
    clone.scale.setScalar(scale);

    const morphMeshes: Mesh[] = [];
    clone.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        const standard = material as MeshStandardMaterial;
        if (typeof standard.metalness === 'number') {
          standard.metalness = Math.max(standard.metalness, 0.34);
          standard.roughness = Math.min(standard.roughness, 0.22);
        }
      });
      if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        morphMeshes.push(mesh);
      }
    });
    morphMeshesRef.current = morphMeshes;
    return clone;
  }, [mode, scene]);

  useEffect(() => {
    onReady();
  }, [model, onReady]);

  useFrame((state, delta) => {
    const elapsed = state.clock.getElapsedTime();
    const rawSpeech = clamp(isSpeaking ? ttsAmplitude?.value ?? 0 : 0);
    const speechEnergy = Math.pow(rawSpeech, 0.82);
    const micEnergy = clamp(micAmplitude?.value ?? 0);
    const liveEnergy = Math.max(speechEnergy, phase === 'listening' ? micEnergy * 0.55 : 0);
    const motionFactor = mode === 'onboarding' ? 0.65 : 1;
    const accent = phaseAccent(phase);
    const morphTargets = createMorphTargets(phase, isSpeaking, speechEnergy);

    for (const mesh of morphMeshesRef.current) {
      const influences = mesh.morphTargetInfluences;
      const dictionary = mesh.morphTargetDictionary;
      if (!influences || !dictionary) continue;
      Object.entries(dictionary).forEach(([name, index]) => {
        const target = morphTargets[name as keyof MorphTargets] ?? 0;
        influences[index] = MathUtils.lerp(influences[index] ?? 0, target, 0.18);
      });
    }

    if (rootRef.current) {
      const targetRotY = tiltX.value * 0.22 * motionFactor + Math.sin(elapsed * 0.26) * 0.025;
      const targetRotX = -tiltY.value * 0.12 * motionFactor + Math.cos(elapsed * 0.24) * 0.018;
      const targetY = -0.34 + Math.sin(elapsed * 0.46) * 0.02;
      rootRef.current.rotation.y = MathUtils.lerp(rootRef.current.rotation.y, targetRotY, 0.08);
      rootRef.current.rotation.x = MathUtils.lerp(rootRef.current.rotation.x, targetRotX, 0.08);
      rootRef.current.position.y = MathUtils.lerp(rootRef.current.position.y, targetY, 0.08);
    }

    const ambientTarget =
      phase === 'thinking' || phase === 'hiring' || phase === 'executing'
        ? 0.34
        : phase === 'listening'
          ? 0.28
          : 0.24;
    const keyTarget = 1.5 + liveEnergy * 0.65;
    const fillTarget = phase === 'confirming' ? 0.62 : 0.46;
    const rimTarget =
      phase === 'thinking' || phase === 'hiring' || phase === 'executing'
        ? 1.95
        : phase === 'listening'
          ? 1.72
          : 1.58;
    const crownTarget = 0.48 + liveEnergy * 0.38;

    if (ambientRef.current) {
      ambientRef.current.intensity = MathUtils.lerp(ambientRef.current.intensity, ambientTarget, 0.08);
      ambientRef.current.color.set('#f1f6ff');
    }
    if (keyRef.current) {
      keyRef.current.intensity = MathUtils.lerp(keyRef.current.intensity, keyTarget, 0.08);
      keyRef.current.color.set('#fff7ef');
    }
    if (fillRef.current) {
      fillRef.current.intensity = MathUtils.lerp(fillRef.current.intensity, fillTarget, 0.08);
      fillRef.current.color.set('#b9cde4');
    }
    if (rimRef.current) {
      rimRef.current.intensity = MathUtils.lerp(rimRef.current.intensity, rimTarget, 0.08);
      rimRef.current.color.set(accent);
    }
    if (crownRef.current) {
      crownRef.current.intensity = MathUtils.lerp(crownRef.current.intensity, crownTarget, 0.08);
      crownRef.current.color.set('#eef6ff');
    }

    if (haloRef.current) {
      const haloMaterial = haloRef.current.material as MeshStandardMaterial;
      const targetScale =
        phase === 'listening'
          ? 1.02 + liveEnergy * 0.12
          : phase === 'thinking' || phase === 'hiring' || phase === 'executing'
            ? 1.08 + liveEnergy * 0.1
            : 1 + liveEnergy * 0.06;
      haloRef.current.scale.x = MathUtils.lerp(haloRef.current.scale.x, targetScale, 0.08);
      haloRef.current.scale.y = MathUtils.lerp(haloRef.current.scale.y, targetScale, 0.08);
      haloMaterial.color.set(accent);
      haloMaterial.emissive.set(accent);
      haloMaterial.emissiveIntensity = 0.48 + liveEnergy * 1.15;
      haloMaterial.opacity =
        phase === 'listening'
          ? 0.24 + liveEnergy * 0.16
          : 0.12 + liveEnergy * 0.1;
    }

    if (pulseRef.current) {
      const pulseMaterial = pulseRef.current.material as MeshStandardMaterial;
      const pulseScale =
        phase === 'listening'
          ? 1.08 + Math.sin(elapsed * 2.6) * 0.035 + liveEnergy * 0.12
          : 1.02 + liveEnergy * 0.04;
      pulseRef.current.scale.x = MathUtils.lerp(pulseRef.current.scale.x, pulseScale, 0.08);
      pulseRef.current.scale.y = MathUtils.lerp(pulseRef.current.scale.y, pulseScale, 0.08);
      pulseMaterial.color.set(accent);
      pulseMaterial.emissive.set(accent);
      pulseMaterial.emissiveIntensity =
        phase === 'listening'
          ? 0.28 + liveEnergy * 0.7
          : 0.12 + liveEnergy * 0.3;
      pulseMaterial.opacity =
        phase === 'listening'
          ? 0.08 + liveEnergy * 0.12
          : 0.04 + liveEnergy * 0.04;
    }

    state.camera.position.x = MathUtils.lerp(state.camera.position.x, tiltX.value * 0.08 * motionFactor, 0.06);
    state.camera.position.y = MathUtils.lerp(state.camera.position.y, 0.08 - tiltY.value * 0.04 * motionFactor, 0.06);
    state.camera.lookAt(0, 0.1, 0);
  });

  return (
    <>
      <AmbientLightNode ref={ambientRef} intensity={0.24} color="#f1f6ff" />
      <DirectionalLightNode ref={keyRef} position={[-2.4, 1.9, 2.8]} intensity={1.5} color="#fff7ef" />
      <DirectionalLightNode ref={fillRef} position={[2.2, 0.6, 1.8]} intensity={0.46} color="#b9cde4" />
      <DirectionalLightNode ref={rimRef} position={[2.6, 1.4, -1.4]} intensity={1.58} color="#dde7f4" />
      <DirectionalLightNode ref={crownRef} position={[0, 3.2, 1.4]} intensity={0.48} color="#eef6ff" />

      <MeshNode ref={pulseRef} position={[0, 0.05, -0.42]} rotation={[Math.PI / 2, 0, 0]}>
        <TorusGeometryNode args={[1.02, 0.014, 24, 120]} />
        <MeshStandardMaterialNode
          transparent
          opacity={0.05}
          color="#dde7f4"
          emissive="#dde7f4"
          emissiveIntensity={0.2}
        />
      </MeshNode>
      <MeshNode ref={haloRef} position={[0, 0.04, -0.38]} rotation={[Math.PI / 2, 0, 0]}>
        <TorusGeometryNode args={[0.92, 0.02, 24, 144]} />
        <MeshStandardMaterialNode
          transparent
          opacity={0.14}
          color="#dde7f4"
          emissive="#dde7f4"
          emissiveIntensity={0.48}
        />
      </MeshNode>

      <GroupNode ref={rootRef} position={[0, -0.34, 0]}>
        <PrimitiveNode object={model} />
      </GroupNode>
    </>
  );
}

export function AceFace3D({
  phase,
  isSpeaking,
  mode = 'conversation',
  micAmplitude,
  ttsAmplitude,
  onPress,
  disabled,
}: Props) {
  const assetUri = useBundledAssetUri(ACE_GLB);
  const [isSceneReady, setIsSceneReady] = useState(false);
  const handleSceneReady = useCallback(() => {
    setIsSceneReady(true);
  }, []);

  useEffect(() => {
    setIsSceneReady(false);
  }, [assetUri]);

  const handlePress = () => {
    if (disabled) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress?.();
  };

  const loadingFallback =
    AceFaceSkiaImpl && !isSceneReady ? (
      <View pointerEvents="none" style={styles.overlayLayer}>
        <AceFaceSkiaImpl
          phase={phase}
          isSpeaking={isSpeaking}
          mode={mode}
          micAmplitude={micAmplitude}
          ttsAmplitude={ttsAmplitude}
          disabled={disabled}
        />
      </View>
    ) : null;

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={styles.container}
      accessibilityRole={onPress ? 'button' : 'image'}
      accessibilityLabel="Ace presence"
    >
      <View style={styles.shell}>
        {loadingFallback}
        {assetUri !== null && (
          <View pointerEvents="none" style={styles.overlayLayer}>
            <Canvas
              style={[styles.canvas, !isSceneReady && styles.canvasHidden]}
              camera={{ position: [0, 0.08, 3.16], fov: 25 }}
              gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
            >
              <Suspense fallback={null}>
                <AceOracleScene
                  assetUri={assetUri}
                  phase={phase}
                  isSpeaking={isSpeaking}
                  mode={mode}
                  micAmplitude={micAmplitude}
                  ttsAmplitude={ttsAmplitude}
                  disabled={disabled}
                  onReady={handleSceneReady}
                />
              </Suspense>
            </Canvas>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    width: CW,
    height: CH,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  shell: {
    width: CW,
    height: CH,
    borderRadius: CH / 2,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  canvas: {
    width: CW,
    height: CH,
    backgroundColor: 'transparent',
  },
  canvasHidden: {
    opacity: 0,
  },
  overlayLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
