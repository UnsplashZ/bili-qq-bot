# Image Crop And Badge Design

**Goal:** Adjust preview image cropping so multi-image square thumbnails crop from the top, and slightly enlarge the long-image / animated-image badges.

## Scope

- Dynamic preview card multi-image grids
- Forwarded dynamic multi-image grids
- User profile "recent dynamic" image strip
- Existing "长图" / "动图" badges

## Design

- Keep the current branching in `src/services/imageGenerator/renderers/components/media.js` unchanged.
- Apply top-aligned cropping through CSS by adding `object-position: top` to square thumbnail images.
- Apply the same top alignment to `user-dynamic-image` so the user profile preview matches the dynamic card behavior.
- Slightly enlarge the image type badge by adjusting font size and box sizing values only, without changing content, placement, or detection logic.

## Non-Goals

- No data shape changes
- No renderer template changes
- No new badge types
- No focus-point or smart-crop logic

## Verification

- Run the smallest relevant test scope for image generator behavior.
- If no targeted automated test exists for these CSS details, run the closest relevant unit test scope and report the remaining visual verification risk.
