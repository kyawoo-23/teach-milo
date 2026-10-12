# Milo sprite sheets

Run `pnpm milo:export` to regenerate from the original SVG and shared motion timelines. Open `preview.html` locally to play every state.

PNG sheets have transparent backgrounds, 256 × 256 cells, eight columns, and 12 fps. `metadata.json` gives exact frame positions and sample times; unused final cells are transparent. Non-looping sheets include the final pose. Use the metadata duration for loop timing. The app animates the SVG directly.
