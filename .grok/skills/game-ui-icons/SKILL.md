---
name: game-ui-icons
description: Use when creating coherent game UI icons, button states, panels, and 9-slice assets with Grok Imagine for Unreal Engine. Enforces readable geometry, no accidental text, and one shared style contract.
---

# Game UI Icons

Treat UI as a system, not a collection of unrelated pictures.

## Style contract

Define stroke weight, corner radius, perspective, palette, contrast, lighting, silhouette language, and padding before generating the set. Icons must remain legible at the requested size, especially 32px.

## Workflow

- Generate a named icon set on a consistent grid with isolated subjects and no text.
- Produce geometry-identical normal, hover, pressed, disabled, and selected button states; vary only the declared state treatment.
- Create panels with blank text-ready interiors and safe margins.
- Use 9-slice construction for scalable panels; keep borders and corners free of content that would distort when stretched.
- Review the full contact sheet for style drift, optical weight, and contrast before import.

## Unreal delivery

Export icons and states with stable names, record pixel dimensions and pivot/anchor intent, and import as UMG-ready textures. Verify a sample widget at target resolution and in a stretched 9-slice panel before declaring the set complete.
