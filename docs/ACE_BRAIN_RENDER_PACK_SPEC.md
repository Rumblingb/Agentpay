# Ace Brain Render Pack Spec

> Version: 1.0
> Last Updated: 2026-04-03
> Owner: Product + Meridian Engineering

## Objective

Replace the current single bust image ceiling with a real render pack that lets the Ace brain feel like a living intelligence instead of a static sculpture with overlays.

This pack is for:
- Meridian travel
- future Ace outdoor/navigation products
- later Ace operator/B2B surfaces that share the same intelligence layer

## Why This Exists

The current Skia brain is directionally right, but it still has a hard ceiling:
- one PNG can only fade, shift, and tilt
- the mouth is still a synthetic overlay
- focus/cognition cues are still effects around the sculpture, not inside it

To make Ace feel truly attentive, we need source art that engineering can deform, light, and react in real time.

## Visual Target

Ace should feel like:
- a calm oracle for movement
- a luxury intelligence living inside the app
- sculptural, premium, inevitable
- more "attention" than "animation"
- more Steve Jobs restraint than sci-fi spectacle

Ace should not feel like:
- a mannequin
- a robot
- a hologram poster
- a decorative avatar
- a generic AI face

## Required Deliverables

All files must share the exact same framing, pose, crop, and canvas size.

Required files:

1. `ace-brain-beauty.png`
- Primary sculptural bust render
- Transparent background
- Pearl white / silver / cool grey
- No watermark
- No floor shadow
- No text

2. `ace-brain-alpha.png`
- White silhouette of the visible sculpture on black background
- Same framing as beauty
- Used for clean compositing and edge control

3. `ace-brain-depth.png`
- Front-facing depth pass
- Nearest planes brighter, deeper planes darker
- Same framing as beauty
- Prefer 16-bit PNG if possible
- EXR is acceptable as source if a PNG export is also provided

4. `ace-brain-mouth-mask.png`
- Grayscale mask for mouth, lips, lower philtrum, and jaw opening region
- White = strongest deformation/light response
- Black = no deformation
- Same framing as beauty

5. `ace-brain-focus-mask.png`
- Grayscale mask for crown, temples, brow ridge, and upper-face cognition planes
- White = strongest focus-field response
- Black = no response
- Same framing as beauty

Recommended files:

6. `ace-brain-specular.png`
- Highlight map for premium moving edge light and tilt response
- White = strongest highlight contribution
- Black = no contribution

7. `ace-brain-normal.png`
- Optional normal-style pass for future shader work
- Useful, but not required for the first shipping upgrade

## Canvas And Export Rules

Use one master square canvas for every file.

Preferred:
- 2048 x 2048

Acceptable fallback:
- 1536 x 1536

Avoid:
- anything below 1024 x 1024

Pose and framing:
- front-facing
- symmetrical overall
- head and upper neck only
- shoulders trimmed and quiet
- same crop on every layer
- object centered
- designed to live inside the current Ace brain footprint

## Material Direction

Outer sculpture:
- pearl white
- cool silver
- soft graphite shadowing
- gentle subsurface glow

Inner life:
- very subtle ice-blue or blue-white in controlled areas only
- no hard cyan
- no neon
- no HUD overlays

Design language:
- luxury hardware object
- sacred intelligence
- premium travel oracle

## Expression Direction

This is important: the base render should be calm.

Do not bake in:
- exaggerated emotion
- open mouth
- aggressive eye definition
- obvious blinking shapes
- visible circuitry

The beauty render should feel:
- serene
- attentive
- capable
- slightly beyond-human, but not uncanny

## How Engineering Will Use Each Pass

`ace-brain-beauty.png`
- base sculpture
- primary visible object

`ace-brain-alpha.png`
- precise edge control
- clean clip and fade work

`ace-brain-depth.png`
- fake volumetric parallax
- depth-aware highlight drift
- light and shadow weighting by plane

`ace-brain-mouth-mask.png`
- real mouth and jaw response to TTS amplitude
- lip/jaw cavity darkening
- lower-face tension without drawing fake lines

`ace-brain-focus-mask.png`
- thinking/executing cognition response
- crown and temple tightening
- phase-aware internal attention

`ace-brain-specular.png`
- premium moving highlights
- polished edge response on tilt
- "living object" finish instead of matte PNG

## Review Checklist

The pack is ready only if all of this is true:

- The beauty render looks premium on a dark graphite background
- The beauty render still reads clearly at small mobile size
- The eye sockets are soft and not mannequin-like
- The neck and jaw feel sculptural, not airbrushed
- The mouth region is anatomically placed and usable for deformation
- The masks line up perfectly with the beauty render
- The depth pass has meaningful plane separation
- No layer has a shifted crop, shadow, watermark, or baked background

## First Shipping Upgrade After Pack Arrival

Once the pack exists, engineering should do this in order:

1. Swap `ace-brain-beauty.png` into the Skia brain
2. Use `ace-brain-mouth-mask.png` to replace the synthetic mouth line with masked jaw/lip response
3. Use `ace-brain-focus-mask.png` to drive thinking/executing cognition planes
4. Use `ace-brain-depth.png` for depth-aware tilt/parallax and highlight movement
5. Add `ace-brain-specular.png` for final luxury finish

## Artist / Generator Brief

If this is handed to a 3D artist, generator workflow, or Blender pass:

"Create a front-facing sculptural intelligence bust for Ace. It should feel like a calm luxury oracle for travel and movement. Use pearl white, soft silver, cool grey shadowing, and restrained ice-blue inner life. It must feel premium, inevitable, and alive without looking robotic or decorative. Export one perfectly aligned render pack: beauty, alpha, depth, mouth mask, focus mask, and optional specular."

## Decision Rule

If a choice makes the sculpture look more impressive but less attentive, do not take it.

Ace must feel like intelligence first, art second.
