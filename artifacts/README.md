# Recorded demonstration — scripted responses

`teach-milo-scripted-walkthrough.webm` is a 32-second backup walkthrough of the implemented interface. The visible label identifies its controlled responses. It is **not live Gemini inference** and does not demonstrate the quality of live OCR or assessment.

The recording shows pasted material, extraction review, lesson confirmation, Milo's follow-up and misconception, the deterministic CNN board, an independent check with practice aids hidden, and an evidence-linked report.

The adjacent screenshots show the desktop and mobile layouts. Browser tests generate these files from controlled API fixtures; the application itself has no simulated-response mode.

`teaching-board-sketch.png` shows the always-available sketch and diagram tools, browser draft, and attachment action. It is also generated from a controlled browser fixture; live Gemini sketch-reading and PDF OCR are checked separately.

To regenerate the paced recording, run `pnpm record:walkthrough` and copy the golden-path `video.webm` from `test-results/` into this directory. Use `pnpm test:e2e` to regenerate screenshots and verify desktop/mobile behavior.
