/** Isolated Gemini component benchmark. Never reads/writes the app database.
 * Run: node --conditions=react-server --import tsx scripts/benchmark-gemini.ts
 * Optional: BENCHMARK_REPEATS (default 3), BENCHMARK_GAP_MS (default 20000).
 */
import { GoogleGenAI } from "@google/genai";
import { mkdir, appendFile, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  PREPARE_PROMPT,
  STUDENT_PROMPT,
  EVALUATE_PROMPT,
  languageInstruction,
} from "../src/content/prompts";
import {
  LessonGeneratedSchema,
  StudentReplySchema,
  type Board,
  type Message,
} from "../src/lib/contracts";
import {
  allowedMoves,
  normalizeStudentReply,
  validateStudent,
  validCitations,
} from "../src/lib/controller";
import { reportSchemaForMessages } from "../src/lib/assessment";
import { compileBoard } from "../src/lib/board-catalog";
import { modelResponseSchema } from "../src/server/model-schema";
import {
  lessonFixture,
  sessionFixture,
  messageFixture,
} from "../tests/fixtures";

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {}
  if (!process.env.GEMINI_API_KEY)
    throw new Error("GEMINI_API_KEY is required");
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const repeats = Number(process.env.BENCHMARK_REPEATS || 3);
  const gapMs = Number(process.env.BENCHMARK_GAP_MS || 20000);
  if (
    !Number.isInteger(repeats) ||
    repeats < 1 ||
    repeats > 10 ||
    !Number.isFinite(gapMs) ||
    gapMs < 20000
  )
    throw new Error("Use 1–10 repetitions and a gap of at least 20000 ms");
  const startedAt = new Date().toISOString();
  const output = path.resolve(
    "artifacts/benchmarks",
    startedAt.replace(/[:.]/g, "-"),
  );
  await mkdir(output, { recursive: true });
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const lesson = lessonFixture();
  lesson.id = "00000000-0000-4000-8000-000000000001";
  lesson.teachingLanguage = "en";
  const session = sessionFixture(lesson);
  session.challengeUsed = true;
  const teaching = messageFixture(
    "Distance is speed times time because speed is the distance covered each second. At 10 m/s for 10 s, distance is 100 m. Doubling time to 20 s gives 200 m. Doubling speed also doubles distance, not four times, because the relationship is proportional.",
  );
  teaching.id = "00000000-0000-4000-8000-000000000002";
  const transfer: Message = {
    ...messageFixture(
      "At 6 m/s for 25 s the cyclist travels 150 m. Twice as long gives 300 m, because each second adds the same 6 m and doubling the number of seconds doubles the distance.",
    ),
    id: "00000000-0000-4000-8000-000000000003",
    kind: "transfer",
    sequence: 2,
  };
  const messages = [teaching, transfer];
  const modelMessages = (list: Message[]) =>
    list.map(({ id, role, text, kind }) => ({ id, role, text, kind }));
  const reportSchema = reportSchemaForMessages(messages, true);
  const jobs = [
    {
      name: "lesson_preparation",
      schema: LessonGeneratedSchema,
      system: PREPARE_PROMPT,
      data: {
        topic: "Distance at constant speed",
        level: "introductory",
        sources: lesson.sources,
        teachingLanguage: "en",
      },
      validate(value: any) {
        const links =
          value.objectives.every((o: any) =>
            o.sourceIds.every((id: string) =>
              lesson.sources.some((s) => s.id === id),
            ),
          ) &&
          new Set(value.objectives.map((o: any) => o.id)).size ===
            value.objectives.length;
        compileBoard({ ...value.board, version: 2 } as Board);
        return { objectiveSourceLinks: links, boardCompiles: true };
      },
    },
    {
      name: "teaching_reply",
      schema: StudentReplySchema,
      system: STUDENT_PROMPT,
      data: {
        teachingLanguage: "en",
        knowledge: lesson.knowledge,
        objectives: lesson.objectives,
        allowedMoves: allowedMoves(session),
        openMisconception: lesson.misconception,
        ledger: session.ledger,
        messages: modelMessages([teaching]),
        teachingBoard: {
          title: lesson.board.title,
          instruction: lesson.board.instruction,
          controls: lesson.board.state.map((s) => s.label),
          tools: ["sketch", "concept_map", "matching", "table"],
        },
      },
      validate(value: any) {
        validateStudent(
          normalizeStudentReply(value, session, lesson, [teaching]),
          session,
          lesson,
          [teaching],
        );
        return { appTurnValidation: true };
      },
    },
    {
      name: "report_evaluation",
      schema: reportSchema,
      system: EVALUATE_PROMPT,
      data: {
        teachingLanguage: "en",
        knowledge: lesson.knowledge,
        objectives: lesson.objectives,
        concerns: [],
        misconceptionIntroduced: true,
        misconception: lesson.misconception,
        misconceptionCorrection: lesson.misconceptionCorrection,
        transfer: {
          question: lesson.transfer.question,
          expected: lesson.transfer.expected,
          criteria: lesson.transfer.criteria,
        },
        messages: modelMessages([teaching]),
        transferAnswer: modelMessages([transfer])[0],
        ledger: session.ledger,
        skipped: false,
        numericCheck: {
          fields: [
            {
              ...lesson.transfer.numeric!.fields[0],
              submitted: 150,
              matches: true,
            },
          ],
          complete: true,
        },
      },
      validate(value: any) {
        const scores = Object.entries(value.scores) as [string, any][];
        const citationGrounding = scores.every(
          ([key, d]) =>
            validCitations(
              d.citations,
              messages,
              key === "transfer" ? "transfer" : "teaching",
            ).length === d.citations.length &&
            (d.score === null || d.citations.length > 0),
        );
        return {
          scoreCitationGrounding: citationGrounding,
          fixtureAccuracyScoreIs2: value.scores.accuracy.score === 2,
          fixtureTransferReasoningIs2: value.transferReasoning.score === 2,
        };
      },
    },
  ];
  const fixtures = jobs.map((j) => ({
    workload: j.name,
    system: j.system + languageInstruction("en"),
    data: j.data,
    schema: modelResponseSchema(j.schema as any),
  }));
  await writeFile(
    path.join(output, "fixtures.json"),
    JSON.stringify(fixtures, null, 2),
  );
  const metadata = {
    startedAt,
    model,
    node: process.version,
    platform: os.platform(),
    architecture: os.arch(),
    cpu: os.cpus()[0]?.model,
    cpuCount: os.cpus().length,
    memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1),
    sdk: JSON.parse(
      await readFile("node_modules/@google/genai/package.json", "utf8"),
    ).version,
    gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    dirtyWorkingTree:
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim().length > 0,
    fixtureSha256: createHash("sha256")
      .update(JSON.stringify(fixtures))
      .digest("hex"),
    requestedCalls: repeats * jobs.length,
    concurrency: 1,
    minimumGapAfterCompletionMs: gapMs,
    sdkAttempts: 1,
    warmupCalls: 0,
    temperature: 0.35,
    maxOutputTokens: 10000,
    timeoutMs: 120000,
    quotaTier: "not independently verified",
    activeRpmTpmRpd: "not available from API key",
    scope:
      "Direct Gemini SDK component benchmark. Excludes browser, Next.js, HTTP route, Firestore, full session, PDF OCR, repair calls, concurrent load, and learning outcomes.",
    pricing: {
      source:
        "https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite",
      checkedOn: "2026-10-18",
      standardInputUsdPerMillion: 0.3,
      standardCachedInputUsdPerMillion: 0.03,
      formula:
        "(input - cached) * 0.30/M + cached * 0.03/M + (output + thinking) * 2.50/M",
      standardOutputIncludingThinkingUsdPerMillion: 2.5,
      freeTierInferenceChargeIfEligible: 0,
    },
    methodology:
      "Three repetitions per workload with identical synthetic English fixtures and production prompts/schema/settings. One request at a time, 20s minimum after completion. No retry or warmup. Stop on quota/auth errors. Latency includes request serialization, network and complete SDK response, excludes validation and pacing. Nearest-rank p50, min/max and descriptive paced throughput, no capacity claim. Correctness checks are narrow fixture checks, not general AI accuracy.",
  };
  await writeFile(
    path.join(output, "environment.json"),
    JSON.stringify(metadata, null, 2),
  );
  const records: any[] = [];
  let stop = false;
  for (let repeat = 1; repeat <= repeats && !stop; repeat++) {
    for (const [index, job] of jobs.entries()) {
      if (records.length)
        await new Promise((resolve) => setTimeout(resolve, gapMs));
      const callStart = new Date().toISOString(),
        timer = performance.now();
      const row: any = { workload: job.name, repeat, startedAt: callStart };
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            { role: "user", parts: [{ text: JSON.stringify(job.data) }] },
          ],
          config: {
            systemInstruction: fixtures[index].system,
            responseMimeType: "application/json",
            responseJsonSchema: fixtures[index].schema,
            temperature: 0.35,
            maxOutputTokens: 10000,
            httpOptions: { timeout: 120000, retryOptions: { attempts: 1 } },
            abortSignal: AbortSignal.timeout(120000),
            automaticFunctionCalling: { disable: true },
          },
        });
        row.latencyMs = +(performance.now() - timer).toFixed(2);
        row.apiSuccess = true;
        row.finishReason = response.candidates?.[0]?.finishReason;
        row.usage = response.usageMetadata ?? null;
        row.modelVersion = response.modelVersion ?? null;
        const usage = response.usageMetadata;
        row.paidEquivalentUsd = usage
          ? (((usage.promptTokenCount ?? 0) -
              (usage.cachedContentTokenCount ?? 0)) *
              0.3 +
              (usage.cachedContentTokenCount ?? 0) * 0.03 +
              ((usage.candidatesTokenCount ?? 0) +
                (usage.thoughtsTokenCount ?? 0)) *
                2.5) /
            1e6
          : null;
        await writeFile(
          path.join(output, `${job.name}-${repeat}-response.json`),
          JSON.stringify(
            {
              text: response.text,
              usage: response.usageMetadata,
              finishReason: row.finishReason,
            },
            null,
            2,
          ),
        );
        try {
          const parsed = job.schema.parse(JSON.parse(response.text ?? ""));
          row.schemaValid = true;
          row.checks = job.validate(parsed);
          row.checksPass = Object.values(row.checks).every(Boolean);
        } catch (error) {
          row.validationFailure =
            error instanceof Error ? error.name : "unknown";
          row.checksPass = false;
        }
      } catch (error: any) {
        row.latencyMs = +(performance.now() - timer).toFixed(2);
        row.apiSuccess = false;
        row.errorStatus = error.status ?? null;
        row.errorName = error.name ?? "Error";
        row.networkErrorCode = error.cause?.code ?? null;
        // Deliberately omit full errors/headers/URLs to keep credentials out of logs.
        try {
          const details = JSON.parse(error.message).error?.details;
          row.quotaDetails = details?.filter((d: any) =>
            /QuotaFailure|RetryInfo/.test(d["@type"] ?? ""),
          );
        } catch {}
        stop =
          [429, 401, 403, 404].includes(error.status) ||
          error.name === "TypeError";
      }
      records.push(row);
      await appendFile(
        path.join(output, "calls.jsonl"),
        JSON.stringify(row) + "\n",
      );
      console.log(JSON.stringify(row));
      if (stop) break;
    }
  }
  const endedAt = new Date().toISOString();
  const elapsedSeconds = (Date.parse(endedAt) - Date.parse(startedAt)) / 1000;
  const summary = {
    startedAt,
    endedAt,
    elapsedSeconds,
    output,
    attempted: records.length,
    requested: repeats * jobs.length,
    apiSuccesses: records.filter((r) => r.apiSuccess).length,
    stoppedOnError: stop,
    pacedSuccessfulCallsPerMinute:
      (records.filter((r) => r.apiSuccess).length / elapsedSeconds) * 60,
    workloads: jobs.map((job) => {
      const all = records.filter((r) => r.workload === job.name),
        ok = all.filter((r) => r.apiSuccess),
        times = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
      return {
        name: job.name,
        attempts: all.length,
        apiSuccesses: ok.length,
        schemaPasses: ok.filter((r) => r.schemaValid).length,
        fixtureCheckPasses: ok.filter((r) => r.checksPass).length,
        latencyMs: times.length
          ? {
              min: times[0],
              p50: times[Math.ceil(times.length * 0.5) - 1],
              max: times.at(-1),
            }
          : null,
        promptTokens: ok.reduce(
          (n, r) => n + (r.usage?.promptTokenCount ?? 0),
          0,
        ),
        outputTokens: ok.reduce(
          (n, r) => n + (r.usage?.candidatesTokenCount ?? 0),
          0,
        ),
        thinkingTokens: ok.reduce(
          (n, r) => n + (r.usage?.thoughtsTokenCount ?? 0),
          0,
        ),
        paidEquivalentUsd: ok.reduce(
          (n, r) => n + (r.paidEquivalentUsd ?? 0),
          0,
        ),
      };
    }),
    limitations: [
      metadata.scope,
      "Tiny repeated single-topic synthetic sample. No general factual-accuracy or learning-gain estimate.",
      "Account tier and project quotas not verified in AI Studio. Results use current API access without requesting higher limits.",
      "Paid equivalent uses published standard rates, not billed cost or measured session cost. Free charge is conditional on free-tier eligibility.",
      "The app's global daily model-call guard is bypassed because this script calls Gemini directly. No production records are created.",
    ],
  };
  await writeFile(
    path.join(output, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log("BENCHMARK_OUTPUT=" + output);
}
main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.name + ": " + error.message.replace(/AIza[\w-]+/g, "[REDACTED]")
      : "Benchmark setup failed",
  );
  process.exitCode = 1;
});
