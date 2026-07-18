---
name: game-animation-frames
description: Use when creating 2D game animation frames or looping sprite sequences with Grok Imagine for Unreal Engine. Prefer video-to-frames motion extraction and verify the loop before import.
---

# Game Animation Frames

Use a video-first workflow for motion. Still-image pose guessing is the fallback.

## Workflow

1. Establish one base character/object with the core asset skill.
2. Generate a short image-to-video motion clip with explicit action, camera lock, frame direction, and a flat keyable background.
3. Harvest frames at a declared rate and remove duplicates, bad transition frames, and background contamination.
4. Flip-test the sequence; check contact poses, arcs, spacing, silhouette, and a seamless first/last transition.
5. Export numbered frames with zero-padded names: `<asset>_<action>_<direction>_####.png`.

## Unreal delivery

- Create a Paper2D Sprite Sheet or individual sprites as appropriate.
- Preserve pixel-art edges with nearest filtering; use filtered sampling only for painted assets.
- Record frame rate, pivot, trim mode, and playback range in the manifest.
- Verify the animation in-editor, not just in a contact sheet.

If identity drifts, return to the character-consistency workflow and edit the established base instead of accepting a visually different character.
