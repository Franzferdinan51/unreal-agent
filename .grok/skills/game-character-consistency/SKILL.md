---
name: game-character-consistency
description: Use when generating a 2D game character and maintaining the same identity across poses, turnarounds, damage states, equipment, and palette variants with Grok Imagine.
---

# Game Character Consistency

One approved base character is the source of truth. Everything else is an edit.

## Identity contract

Before variants, record a freeze-list: face and body proportions, silhouette, hair, palette, costume landmarks, accessories, weapon shapes, and distinguishing marks. Keep a reference sheet with front, side, back, and neutral pose views.

## Workflow

- Generate or select one base image and get approval before branching.
- Use image edits with the base/reference attached for every pose, equipment, damage, and palette variant.
- Include the freeze-list in every edit prompt and state exactly what may change.
- Compare each output against the reference sheet at the same scale and framing.
- Reject cousin characters, altered facial features, drifting costume landmarks, extra limbs, and changed proportions.

## Unreal delivery

Organize variants by character/action/state, keep the base source beside derived exports, and write a manifest mapping each variant to its intended animation or material use. Verify pivots and sprite scale are consistent across the set.
