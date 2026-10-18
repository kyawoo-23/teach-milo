# Teach Milo: Gemini component benchmark

Measured 2026-10-18T04:41:57.323Z to 2026-10-18T04:45:12.914Z (18 October 2026, Bangkok time).

**9/9 API requests succeeded.** These measurements cover Gemini API component calls only. The local web app and Firestore emulator were not running. Application/HTTP latency, full-session cost, PDF OCR, sustained capacity and general AI accuracy remain unmeasured.

## Results

| Workload | n | p50 latency | min–max latency | Input tokens (total) | Output + thinking tokens (total) | Schema / fixture pass | Paid equivalent (USD) |
| --- | ---: | ---: | --- | ---: | ---: | --- | ---: |
| lesson_preparation | 3 | 5.198 s | 4.559–5.797 s | 5,793 | 5,008 | 3/3 / 3/3 | $0.0140149 |
| teaching_reply | 3 | 2.502 s | 2.399–2.698 s | 3,513 | 1,624 | 3/3 / 3/3 | $0.0051139 |
| report_evaluation | 3 | 4.074 s | 4.074–4.209 s | 3,849 | 3,918 | 3/3 / 3/3 | $0.0107837 |

Total: **13,155 input tokens** (including 1,515 cached), **10,550 output/thinking tokens**, **US$0.0299125 paid equivalent**. Observed paced throughput: **2.761 successful calls/minute** over 195.59 seconds including deliberate pauses. This is not a capacity estimate.

## Environment

- Client: darwin arm64, Apple M4 Pro, 12 logical CPUs, 24 GiB RAM.
- Node v26.11.1, @google/genai 2.28.0, model `gemini-3.5-flash-lite`.
- Hosted Gemini Developer API, nonstreaming JSON responses. Client network conditions and model region are not controlled.
- Repository HEAD `b86c3135b3d19086170d1f77bf3b5d184cc3f886` with uncommitted work. The fixture JSON freezes the actual prompts, data and schemas. SHA-256: `ced481d5dc117cfd8a7d2319a38341a866fba7e59e462b50575bc4e006e7f3a2`.
- Application database and HTTP routes are bypassed. No production sessions were created. API keys, cookies and auth headers are excluded from logs.

## Methodology

1. Use the actual repository preparation, teaching and evaluation prompts and response schemas. Use one fixed synthetic English constant-speed example, based on existing test fixtures. This fixture is benchmark data, not a subject-specific application path.
2. Interleave three independent repetitions of lesson preparation, one teaching reply and report evaluation. Keep each request identical within a workload. Each call is independent, not a measured complete session.
3. Run one request at a time. Pause at least 20 seconds after each response. Disable SDK retries and stop on quota/auth errors. No warmup request is excluded.
4. Use temperature 0.35, a 10,000-token output cap, and 120-second timeout. Measure request-to-complete-response time with `performance.now()`. This includes network time and SDK work, and excludes post-response validation and pacing.
5. Report nearest-rank p50 and observed min/max across three successful calls per workload. The sample is too small for a defensible p95 or concurrency conclusion.
6. Retain raw SDK `usageMetadata`, finish reason and model text for every successful call. Input totals include cached tokens. Output totals include thinking tokens, when present.
7. Validate Zod JSON structure. Preparation checks source IDs and board compilation. Teaching checks normalized app turn rules and quote citations. Reports check quote grounding and expected scores for a deliberately correct synthetic answer. Passing these checks is not general factual accuracy or proof of learning gains.

## Quotas and costs

- No 429 quota failures occurred in this 9-call run. No higher API limits were requested. Account tier and active numeric RPM, input TPM and RPD were not independently verified in AI Studio, so free-tier eligibility is not claimed.
- Google applies rate limits per project. Other consumers of the same project share quota. Any of RPM, input TPM or RPD can limit a request. RPD resets at midnight Pacific time. Published limits are not guaranteed. [Google rate-limit documentation](https://ai.google.dev/gemini-api/docs/rate-limits).
- Free-tier eligible input/output inference costs US$0 within the applicable quota. The benchmark did not access billing records. `serviceTier: standard` in SDK metadata does not establish the account billing tier.
- The paid equivalent uses published Gemini 3.5 Flash-Lite standard prices checked on 18 October 2026: US$0.30/M uncached input, US$0.03/M cached input and US$2.50/M output including thinking. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite).
- Formula: `(input − cached) × 0.30 / 1M + cached × 0.03 / 1M + (output + thinking) × 2.50 / 1M`. Derived costs were recalculated from raw metadata after completion to account for cache hits. No explicit cache was created. Actual billing, infrastructure costs and costs of repairs/retries are not measured.
- The prior v6 claim of US$0.0269 per session has no supplied supporting logs. This isolated component benchmark does not validate it. The 12-call/session illustration on slide 10 remains an assumption.

## Limitations and next measurements

- Three repetitions of one English synthetic example give a smoke benchmark, not representative accuracy, document-size scaling, teaching-language coverage or reliability under load.
- Measure HTTP routes and browser interaction separately, including database latency, cold starts, uploads, OCR, repair calls and full teaching history.
- Add a labelled multi-topic accuracy set, human review, larger repeated runs, controlled network conditions and verified quota information before making capacity or learning-impact claims.
- The application’s database-backed daily call guard is bypassed by this script. Do not infer deployable throughput from these measurements.

## Reproduce

From the project root, with `.env.local` containing the existing Gemini key and model:

```sh
node --conditions=react-server --import tsx scripts/benchmark-gemini.ts
```

Default: 3 samples per workload and a 20-second gap. Optional `BENCHMARK_REPEATS` (1–10) and `BENCHMARK_GAP_MS` (at least 20000). Each invocation creates a new evidence directory. Running this calls the live API and consumes the current project quota.

Files: `calls.jsonl` (per-call observations), `environment.json` (environment/settings), `fixtures.json` (exact request content), `summary.json` (aggregate results), and `*-response.json` (raw response text and usage).

A separate earlier sandbox-only attempt failed before reaching Gemini and was interrupted. Its directory contains an `ABORTED.md` note and is excluded from all reported results.
