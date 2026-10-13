# Reducing PDF OCR calls

Researched and implemented on 2026-10-13. No cloud deployment or paid Gemini benchmark was performed.

## Research

- PDF.js exposes page text items, positions and font information through `getTextContent()`, and drawing operations through `getOperatorList()`. These enable local page inspection; they do not provide a built-in reliable-extraction classifier. [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html)
- Gemini vision can interpret images, diagrams, tables and document layout. For Gemini 3, embedded native PDF text is included without charging its text tokens, while page image tokens are reported under IMAGE. Sending the same native text separately duplicates input, so extraction requests now send only the selected PDF and page count. [Google document understanding](https://ai.google.dev/gemini-api/docs/document-processing)
- Gemini 3 media-resolution settings affect image-token use. Physical compression alone should not be treated as a token-cost reduction. This implementation preserves the existing model resolution setting. [Google media resolution](https://ai.google.dev/gemini-api/docs/media-resolution)
- Tesseract documents limitations with table recognition without custom segmentation. Adding local OCR would also require deployment, rendering and language assets; it is deferred until ordinary scans are shown to dominate costs. [Tesseract quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html)

## Implemented behavior

The worker skips vision only for conservatively classified text pages or confirmed blank pages. All image operations, paths, shading, forms, annotations and non-default text rendering require vision. Text must have at least 30 characters and avoid replacement/private-use characters, math symbols, superscripts and control characters. Rotated, mirrored, right-to-left, complex baseline positioning, wide horizontal gaps and reading-order resets also require vision. Unsupported operator inspection retains the vision path. These are generic document heuristics, not subject-specific rules.

Selected pages are packed in original order, at most five per attachment. An explicit original-page mapping translates model-local page numbers back to source IDs. All original pages remain in the review, including blank pages with warnings. Coverage, duplicate-page and aggregate text-size validation happen before successful batches are saved. Existing document and upload limits remain in place.

`extraction_cache` stores only validated sources and warnings. The cache key combines the authenticated user, SHA-256 of exact bytes, model, OCR prompt and extraction version. Rename does not invalidate it; a new user, changed bytes, model, prompt or extraction version does. A six-minute transactional lease prevents overlapping uploads of the same document. Successful batches survive later failures; an interrupted retry skips those batches. Lost external-provider responses can still be charged again because inference cannot be made exactly-once by Firestore.

Retention is fixed at creation using `SESSION_RETENTION_DAYS` (seven days by default), including partial extraction. Reads reject expired entries even before asynchronous TTL deletion. Cleanup includes `extraction_cache`, and source arrays are exempt from indexing. Apply the updated Firestore index/TTL configuration with the existing deployment workflow when releasing this change.

## Verification and limitations

Automated fixtures cover prose without calls, blank pages, noncontiguous scans/drawings/formulas, superscripts, columns, incomplete coverage, original page references, cache identity, successful-batch resume, concurrent leases, owner isolation, expiry and cleanup. They use controlled model responses and the Firestore emulator, not paid Gemini calls.

A clean 20-page prose fixture needs zero OCR calls. A mixed seven-page fixture with visual content on pages 2, 4, 6 and 7 needs one four-page call. These are fixture results, not production savings estimates. Conservative routing can still send decorative visuals or simple formulas through Gemini. Text extraction is not semantic verification; review representative multilingual materials and complex layouts before relaxing the classifier. Measure actual usage metadata and perform the documented real-Gemini smoke test before production release.
