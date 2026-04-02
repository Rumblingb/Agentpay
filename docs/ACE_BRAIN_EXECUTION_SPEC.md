# Ace Brain Execution Spec

> Version: 1.0
> Last Updated: 2026-04-02
> Owner: Product + Meridian Engineering

## Objective

Build a world-class Ace brain that becomes:
- the premium conversational presence in Meridian
- the reusable brand intelligence surface for future Ace apps
- the visual kernel for travel, outdoor, and later B2B/operator experiences

The Ace brain should not feel like:
- a static face image
- a decorative animation
- a generic waveform
- a generic AI avatar

It should feel like:
- a calm oracle for movement
- a luxury intelligence with attention
- one coherent presence across onboarding, converse, confirmation, and recovery

## Product Principles

1. Attention beats decoration
   - The object must react to real mic and TTS energy.
2. One Ace, not many
   - Onboarding and converse must teach the same presence language.
3. Travel first
   - The presence should reinforce trust, continuity, and control.
4. Restraint wins
   - Fewer stronger cues beat more effects.
5. Older devices still matter
   - Premium must survive smaller screens and weaker GPUs.

## Current State

What we have:
- Skia foundation in `apps/meridian/components/AceFaceSkia.tsx`
- audio metering from mic and TTS in `speech.ts` and `tts.ts`
- main converse surface wired to Skia

What is still missing:
- one shared Ace brain entry point with a safe fallback
- onboarding alignment with the main brain
- deeper sculptural micro-morphs beyond the first speech/focus pass
- stronger volumetric feel beyond the first tilt/parallax pass
- a final art-source ceiling that is worthy of the brand

## P0 - Foundation and Product Coherence

Goal:
Make Ace feel like one coherent being, not a promising prototype.

### P0 Tasks

1. Create one shared `AceBrain` component
   - File: `apps/meridian/components/AceBrain.tsx`
   - Responsibility:
     - use Skia when available
     - fall back safely when Skia/native assets are unavailable
     - expose one stable product API

2. Unify onboarding and converse around the same Ace brain
   - Files:
     - `apps/meridian/app/(main)/converse.tsx`
     - `apps/meridian/app/onboard.tsx`
   - Responsibility:
     - remove the split between `OrbAnimation` and the main brain
     - keep onboarding behavior calm and coherent

3. Add cold-load fallback inside the Skia brain
   - File: `apps/meridian/components/AceFaceSkia.tsx`
   - Responsibility:
     - if the bust render is not loaded yet, render a premium fallback state
     - never flash a broken shell

4. Stabilize the product contract
   - Surfaces:
     - onboarding demo
     - name capture
     - main converse
   - Responsibility:
     - the user should meet the same Ace language everywhere

### P0 Acceptance Criteria

- Converse uses `AceBrain`, not the Skia file directly
- Onboarding uses the same brain family as converse
- If Skia or bust assets are unavailable, Ace still renders cleanly
- No visual seam suggests two different products

## P1 - Intelligence and Volumetric Motion

Goal:
Make Ace feel attentive and alive, not phase-switched.

### P1 Tasks

1. Real mouth and lower-face micro-morphs
   - File: `apps/meridian/components/AceFaceSkia.tsx`
   - Build:
     - lips part with real TTS amplitude
     - lower-face tension varies with speech energy
     - calm closed-mouth state when silent

2. Processing micro-morphs
   - File: `apps/meridian/components/AceFaceSkia.tsx`
   - Build:
     - subtle brow and temple lift while thinking/executing
     - internal field tightens under focus
     - no cartoon emotion

3. Device-motion parallax
   - Files:
     - `apps/meridian/components/AceFaceSkia.tsx`
     - new motion helper under `apps/meridian/lib/`
   - Build:
     - gentle tilt-based perspective shift
     - slight highlight drift
     - safe fallback when motion is unavailable

4. Shared state language
   - Surfaces:
     - onboarding
     - converse
   - Build:
     - idle, listening, thinking, confirming, executing, done, error
     - same visual logic, different intensity where appropriate

### P1 Acceptance Criteria

- Mic input visibly affects Ace while the user is speaking
- TTS playback visibly affects Ace while Ace is speaking
- Thinking feels distinct from listening without extra noise
- Parallax is subtle and premium, not gimmicky

## P2 - Final Brand Ceiling

Goal:
Turn the brain into the base of the Ace empire.

### P2 Tasks

1. Final bust master
   - Replace the interim render with a higher-end sculptural source
   - Keep dimensions and fit aligned with the shipping component

2. Final sigil master
   - Ensure the Ace mark and Ace brain feel like one brand family
   - Use the same object language across icon, splash, header, and presence

3. Cross-app Ace brain package
   - Extract the core brain into a reusable component contract
   - Keep domain logic separate from the visual intelligence layer

4. QA matrix for release
   - Use `docs/TEST_STRATEGY.md`
   - Add explicit pass/fail notes for:
     - fresh install
     - returning user
     - mic denied
     - slow network
     - live journey resume
     - reroute notification tap
     - older iPhone

### P2 Acceptance Criteria

- Ace brain is reusable across future Ace apps
- The visual brand object and the conversational brain feel designed together
- The remaining ceiling is art direction, not component architecture

## Not In Scope Right Now

- Full shader experimentation for its own sake
- Heavy particle systems
- Hyper-real humanoid emotion
- Separate visual systems per app under Ace

## Immediate TODO List

### P0 Now

- [x] Create `AceBrain.tsx`
- [x] Route converse through `AceBrain`
- [x] Route onboarding through `AceBrain`
- [x] Add bust cold-load fallback in Skia
- [ ] Verify no product split remains between onboarding and converse on device

### P1 Next

- [x] Real speech-driven mouth opening
- [x] Processing micro-morphs
- [x] Device-motion parallax
- [x] Shared visual language tuning across states

### P1.5 Next

- [ ] Tune Skia face on real devices, especially older iPhones and Android
- [ ] Decide whether the bust art source is good enough to keep or should be replaced
- [ ] Tighten onboarding intensity so it teaches the same language with calmer motion

### P2 Later

- [ ] Final bust art source
- [ ] Final sigil art source
- [ ] Cross-app Ace brain contract
- [ ] Full mobile QA sweep

## Decision Rule

If there is tension between:
- something that looks technically impressive
- and something that deepens trust and attention

choose trust and attention.
